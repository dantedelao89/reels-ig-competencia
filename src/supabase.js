// Espejo en Supabase (Postgres) que alimenta el dashboard de curación.
// Se activa solo si hay SUPABASE_URL + SUPABASE_SERVICE_KEY. El cliente se importa de forma
// perezosa. Los mappers NO incluyen estado/mi_guion/mi_* a propósito: así un upsert por re-scrape
// nunca pisa la capa de curación (Postgres solo actualiza las columnas presentes en el payload).

import { config } from './config.js';
import { r2Enabled, rehostImage, rehostVideo } from './r2.js';

const enabled = !!(config.supabaseUrl && config.supabaseServiceKey);

let client = null;

export function supabaseEnabled() {
  return enabled;
}

export async function getClient() {
  if (client) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
    // Esquema por defecto de la BD. En el proyecto Pro las tablas viven en 'disecta' (aislado del
    // otro sistema en 'public'). Default 'public' para no romper hasta que se setee SUPABASE_SCHEMA.
    db: { schema: process.env.SUPABASE_SCHEMA || 'public' },
  });
  return client;
}

// Upsert en lotes de 100. onConflict = columna única (shortcode / video_id).
async function upsert(table, rows, onConflict) {
  if (!enabled || rows.length === 0) return 0;
  const c = await getClient();
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await c.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(error.message);
    n += chunk.length;
  }
  return n;
}

// Igual que upsert(), pero devuelve las filas insertadas/actualizadas (columnas de `select`).
// Lo usa syncReels para poder transcribir DESPUÉS de insertar (necesita el id de Supabase).
async function upsertReturning(table, rows, onConflict, select) {
  if (!enabled || rows.length === 0) return [];
  const c = await getClient();
  const out = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { data, error } = await c.from(table).upsert(chunk, { onConflict }).select(select);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

// Sets de dedup: IDs ya presentes en Supabase (fuente única desde la fase 3 de la migración).
export async function getExistingShortcodes() {
  return getExistingColumn(config.igReelsTable, 'shortcode');
}
export async function getExistingVideoIds() {
  return getExistingColumn(config.ytVideosTable, 'video_id');
}
// Ids ya presentes en una columna. `filters` acota la consulta ({ eq, gte, notNull }): sin él
// habría que paginar la tabla entera, que en historias serían decenas de páginas al año.
async function getExistingColumn(table, column, filters = null) {
  if (!enabled) return new Set();
  const c = await getClient();
  const ids = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = c.from(table).select(column);
    if (filters?.eq) q = q.eq(filters.eq[0], filters.eq[1]);
    if (filters?.gte) q = q.gte(filters.gte[0], filters.gte[1]);
    if (filters?.notNull) q = q.not(filters.notNull, 'is', null);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    data.forEach((r) => ids.add(String(r[column])));
    if (data.length < PAGE) break;
  }
  return ids;
}

// Historias de un creador que YA están archivadas de verdad (con su media en R2).
// Dos matices importantes:
// - Se acota por fecha porque una historia de Instagram no puede tener más de 24h: con 3 días de
//   margen la consulta devuelve ~13-40 ids para siempre, aunque el archivo acumule miles de filas.
// - Se exige `media_url` no nulo para que una historia cuyo archivado falló se REINTENTE en la
//   siguiente captura, mientras siga viva en Instagram. Si no, se perdería para siempre.
export async function getExistingStoryIds(creador, desdeIso) {
  return getExistingColumn(config.igStoriesTable, 'story_id', {
    eq: ['creador', creador],
    gte: ['fecha_publicacion', desdeIso],
    notNull: 'media_url',
  });
}

// Videos sin subtítulos (para backfillSubtitles). Devuelve [{ recordId, videoId, url }].
export async function getVideosWithoutSubtitles() {
  if (!enabled) return [];
  const c = await getClient();
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c
      .from(config.ytVideosTable)
      .select('id, video_id, url')
      .or('subtitulos.is.null,subtitulos.eq.')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) {
      if (r.video_id && r.url) out.push({ recordId: r.id, videoId: r.video_id, url: r.url });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

// Actualiza campos de un row por id (lo usa la transcripción manual bajo demanda).
export async function updateRowById(table, id, fields) {
  if (!enabled) return 0;
  const c = await getClient();
  const { error } = await c.from(table).update(fields).eq('id', id);
  if (error) throw new Error(error.message);
  return 1;
}

// Busca un row por una columna única (ej. shortcode / video_id). Lo usa el slash command de Slack
// para leer la transcripción de contenido que ya existía en la base (inserted=0).
export async function getRowByField(table, field, value, select = '*') {
  if (!enabled) return null;
  const c = await getClient();
  const { data, error } = await c.from(table).select(select).eq(field, value).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// --- Regenerador de carruseles ---

// Referencias activas de la biblioteca del regenerador (anclas de branding + fotos CTA).
export async function getRegenRefs() {
  if (!enabled) return [];
  const c = await getClient();
  const { data, error } = await c
    .from('regen_refs')
    .select('id, tipo, nombre, url, notas')
    .eq('activo', true)
    .order('creado_en');
  if (error) throw new Error(error.message);
  return data || [];
}

// Patch atómico de UN slide dentro de ig_reels.regen (RPC en Postgres: merge dentro de un solo
// UPDATE). Lo usan el job de generación y la UI; así nunca se pisan entre sí el array completo.
export async function regenPatchSlide(shortcode, idx, patch) {
  if (!enabled) return;
  const c = await getClient();
  const { error } = await c.rpc('regen_patch_slide', {
    p_shortcode: shortcode,
    p_idx: idx,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
}

// Estados en los que hay un job trabajando: el guard los bloquea a todos.
const OCUPADOS = ['leyendo', 'escribiendo', 'generando', 'revisando'];

// Guarda el plan completo (o cambia el estado global) del regenerador para un carrusel.
// Con guard=true solo escribe si NO hay un job en curso (o el job lleva >15 min sin dar
// señales, p.ej. porque Railway redesplegó a mitad); devuelve false si el guard lo bloqueó.
export async function setRegen(shortcode, fields, { guard = false } = {}) {
  if (!enabled) return false;
  const c = await getClient();
  let q = c
    .from(config.igReelsTable)
    .update({ ...fields, regen_actualizado: new Date().toISOString() })
    .eq('shortcode', shortcode);
  if (guard) {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    q = q.or(
      `regen_estado.is.null,regen_estado.not.in.(${OCUPADOS.join(',')}),regen_actualizado.lt.${cutoff}`
    );
  }
  const { data, error } = await q.select('shortcode');
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

// Análisis + ganchos + gancho elegido + historial del carrusel (columna regen_meta).
export async function setMeta(shortcode, meta) {
  if (!enabled) return;
  const c = await getClient();
  const { error } = await c
    .from(config.igReelsTable)
    .update({ regen_meta: meta, regen_actualizado: new Date().toISOString() })
    .eq('shortcode', shortcode);
  if (error) throw new Error(error.message);
}

// Progreso visible del job (paso + mensaje + hechos/total). Es telemetría: sin guard, la
// última escritura gana, y nunca lanza para no tumbar el job por un fallo de red.
export async function setProgreso(shortcode, { paso, mensaje, hechos = null, total = null }) {
  if (!enabled) return;
  try {
    const c = await getClient();
    await c
      .from(config.igReelsTable)
      .update({ regen_progreso: { paso, mensaje, hechos, total, ts: new Date().toISOString() } })
      .eq('shortcode', shortcode);
  } catch (e) {
    console.warn(`[regen ${shortcode}] no se pudo guardar el progreso: ${e.message}`);
  }
}

// Variantes de CTA usadas en los últimos carruseles regenerados, para no repetir la foto.
export async function getCtaVariantesRecientes(n = 3) {
  if (!enabled) return [];
  const c = await getClient();
  const { data, error } = await c
    .from(config.igReelsTable)
    .select('regen_meta, regen_actualizado')
    .not('regen_meta', 'is', null)
    .order('regen_actualizado', { ascending: false })
    .limit(n);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.regen_meta?.ctaVariante).filter(Boolean);
}

// Extrae el video_id de una URL de YouTube (watch?v=, youtu.be, shorts, live, embed).
function youtubeIdFromUrl(u) {
  const m =
    u.match(/[?&]v=([\w-]{6,})/) ||
    u.match(/youtu\.be\/([\w-]{6,})/i) ||
    u.match(/\/(?:shorts|live|embed)\/([\w-]{6,})/i);
  return m ? m[1] : null;
}

// Liga el "recurso del creador" (URL) a un contenido YA scrapeado, ubicándolo por su URL original.
// Soporta Instagram (por shortcode) y YouTube (por video_id). Devuelve { ok, plataforma, quien } o
// { ok:false, error }. El nombre del recurso = el dominio del link (etiqueta rápida).
export async function attachRecursoByUrl(contentUrl, recursoUrl) {
  if (!enabled) return { ok: false, error: 'Supabase no configurado' };
  const url = (contentUrl || '').trim();
  let table, col, id;
  const ig = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
  if (ig) {
    table = config.igReelsTable;
    col = 'shortcode';
    id = ig[1];
  } else {
    const yt = youtubeIdFromUrl(url);
    if (yt) {
      table = config.ytVideosTable;
      col = 'video_id';
      id = yt;
    }
  }
  if (!table) return { ok: false, error: 'URL no reconocida (usa un link de Instagram o YouTube).' };

  let nombre = null;
  try {
    nombre = new URL(recursoUrl).hostname.replace(/^www\./, '');
  } catch {}

  const quienCol = table === config.igReelsTable ? 'creador' : 'canal';
  const c = await getClient();
  const { data, error } = await c
    .from(table)
    .update({ recurso_url: recursoUrl, recurso_nombre: nombre })
    .eq(col, id)
    .select(quienCol);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    return { ok: false, notFound: true, plataforma: table === config.igReelsTable ? 'ig' : 'yt', error: 'No encontré ese contenido en la base.' };
  }
  return { ok: true, plataforma: table === config.igReelsTable ? 'ig' : 'yt', quien: data[0][quienCol] || null };
}

// IDs de anuncios ya presentes en Supabase (meta_ads). Dedup primario del pipeline de ads.
export async function getSyncedAdIds() {
  if (!enabled) return new Set();
  const c = await getClient();
  const ids = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c
      .from(config.adsMetaAdsTable)
      .select('ad_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    data.forEach((r) => ids.add(String(r.ad_id)));
    if (data.length < PAGE) break;
  }
  return ids;
}

// ----------------------------- Ads (Meta) -----------------------------

function adMedia(item) {
  const s = item.snapshot || {};
  let thumb = null;
  let video = null;
  if (Array.isArray(s.videos) && s.videos.length) {
    video = s.videos[0].videoHdUrl || s.videos[0].videoSdUrl || null;
    thumb = s.videos[0].videoPreviewImageUrl || null;
  }
  if (!thumb && Array.isArray(s.images) && s.images.length) {
    thumb = s.images[0].originalImageUrl || s.images[0].resizedImageUrl || null;
  }
  if (Array.isArray(s.cards) && s.cards.length) {
    const c = s.cards[0];
    if (!thumb) thumb = c.originalImageUrl || c.resizedImageUrl || c.videoPreviewImageUrl || null;
    if (!video) video = c.videoHdUrl || c.videoSdUrl || null;
  }
  return { thumb, video };
}

function adDaysRunning(item) {
  const start = item.startDate ? item.startDate * 1000 : null;
  const end = item.isActive ? Date.now() : item.endDate ? item.endDate * 1000 : null;
  if (!start || !end) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function adRow(item, scrapedAtIso, project, thumbnailUrl, videoUrlOverride) {
  const s = item.snapshot || {};
  const { video } = adMedia(item);
  return {
    ad_id: item.adArchiveID,
    anunciante: item.pageName || null,
    pagina_url: s.pageProfileUri || item.inputUrl || null,
    copy: s.body?.text || null,
    titulo: s.title || null,
    cta: s.ctaText || null,
    link_destino: s.linkUrl || null,
    formato: s.displayFormat || null,
    plataformas: (item.publisherPlatform || []).join(', ') || null,
    activo: !!item.isActive,
    fecha_inicio: item.startDateFormatted || (item.startDate ? new Date(item.startDate * 1000).toISOString() : null),
    fecha_fin: item.endDateFormatted || (item.endDate ? new Date(item.endDate * 1000).toISOString() : null),
    dias_corriendo: item.daysActive ?? adDaysRunning(item),
    thumbnail_original: adMedia(item).thumb,
    thumbnail_url: thumbnailUrl,
    video_url: videoUrlOverride || video,
    proyecto: project || null,
    scrapeado_en: scrapedAtIso,
    // Señales de bovi: agrupación oficial (dedup) + ganadores.
    collation_id: item.collationId || null,
    is_scaled: item.isScaled ?? null,
    longevity_score: item.longevityScore ?? null,
  };
}

// Sincroniza anuncios nuevos a Supabase. ctx: { scrapedAtIso, projectByUrl }.
export async function syncAds(items, ctx = {}) {
  if (!enabled) throw new Error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  if (!items?.length) return { synced: 0, rehosted: 0 };
  const { scrapedAtIso, projectByUrl } = ctx;
  let rehosted = 0;
  const rows = [];
  for (const item of items) {
    if (!item.adArchiveID) continue;
    const project = projectByUrl?.get((item.inputUrl || '').trim());
    const { thumb, video } = adMedia(item);
    let thumbnailUrl = null;
    let videoUrl = null;
    if (r2Enabled() && thumb) {
      thumbnailUrl = await rehostImage(thumb, `thumbnails/ads/${item.adArchiveID}.jpg`);
      if (thumbnailUrl) rehosted++;
    }
    if (r2Enabled() && video) {
      videoUrl = await rehostVideo(video, `videos/ads/${item.adArchiveID}.mp4`);
    }
    rows.push(adRow(item, scrapedAtIso, project, thumbnailUrl, videoUrl));
  }
  const synced = await upsert(config.adsMetaAdsTable, rows, 'ad_id');
  return { synced, rehosted };
}

// Sincroniza UN post/video de Facebook (traído por link directo con premiumscraper) como una fila
// de meta_ads. Es contenido ORGÁNICO del post, así que los campos de Ad Library (activo, días
// corriendo, is_scaled, collation) quedan null. ad_id se prefija con "fbpost_" para no chocar con
// los ad_archive_id reales. ctx: { scrapedAtIso, project }.
export async function syncSinglePostAsAd(post, ctx = {}) {
  if (!enabled) throw new Error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  if (!post?.postId) return { synced: 0 };
  const { scrapedAtIso, project } = ctx;
  const adId = `fbpost_${post.postId}`;
  let thumbnailUrl = null;
  let videoUrl = null;
  if (r2Enabled() && post.imageUrl) {
    thumbnailUrl = await rehostImage(post.imageUrl, `thumbnails/ads/${adId}.jpg`);
  }
  if (r2Enabled() && post.videoHd) {
    videoUrl = await rehostVideo(post.videoHd, `videos/ads/${adId}.mp4`);
  }
  const row = {
    ad_id: adId,
    anunciante: post.pageName || null,
    pagina_url: post.pageUrl || null,
    copy: post.message || null,
    titulo: post.title || null,
    cta: null,
    link_destino: post.destino || null,
    formato: post.videoHd ? 'Video' : 'Imagen',
    plataformas: 'Facebook',
    activo: null, // no viene de la Ad Library: no sabemos si sigue corriendo como anuncio
    fecha_inicio: post.datePosted || null,
    fecha_fin: null,
    dias_corriendo: null,
    thumbnail_original: post.imageUrl || null,
    thumbnail_url: thumbnailUrl,
    video_url: videoUrl || post.videoHd || null,
    proyecto: project || null,
    scrapeado_en: scrapedAtIso,
  };
  const synced = await upsert(config.adsMetaAdsTable, [row], 'ad_id');
  return { synced, adId };
}

// ----------------------------- Instagram -----------------------------

// Diapositivas de un carrusel (type=Sidecar). Cada slide puede ser VIDEO o IMAGEN: si el childPost
// es Video devolvemos su mp4 (src) + su portada (poster); si es Imagen, solo la imagen. Antes solo
// tomábamos la portada de todos, perdiendo los videos.
function carouselSlides(item) {
  if (Array.isArray(item.childPosts) && item.childPosts.length) {
    return item.childPosts
      .map((c) => {
        if (!c) return null;
        if (c.type === 'Video' && c.videoUrl) return { tipo: 'video', src: c.videoUrl, poster: c.displayUrl || null };
        if (c.displayUrl) return { tipo: 'image', src: c.displayUrl, poster: null };
        return null;
      })
      .filter(Boolean);
  }
  if (Array.isArray(item.images) && item.images.length) {
    return item.images.filter(Boolean).map((u) => ({ tipo: 'image', src: u, poster: null }));
  }
  return [];
}

function reelRow(item, scrapedAtIso, project, transcripcion, thumbnailUrl, imagenes) {
  const music = item.musicInfo
    ? [item.musicInfo.song_name, item.musicInfo.artist_name].filter(Boolean).join(' — ')
    : '';
  return {
    imagenes: imagenes && imagenes.length ? imagenes : null,
    shortcode: item.shortCode,
    creador: item.ownerUsername || null,
    url: item.url || null,
    video_url: item.videoUrl || null,
    caption: item.caption || null,
    fecha_publicacion: item.timestamp || null,
    likes: item.likesCount ?? null,
    comentarios: item.commentsCount ?? null,
    views: item.videoViewCount ?? item.videoPlayCount ?? null,
    duracion_seg: item.videoDuration ?? null,
    hashtags: (item.hashtags || []).map((h) => `#${h}`).join(' ') || null,
    mentions: (item.mentions || []).join(' ') || null,
    tipo: item.productType || item.type || null,
    musica: music || null,
    thumbnail_original: item.displayUrl || null,
    thumbnail_url: thumbnailUrl,
    proyecto: project || null,
    transcripcion: transcripcion || null,
    scrapeado_en: scrapedAtIso,
  };
}

// Sincroniza reels nuevos a Supabase. ctx: { scrapedAtIso, projectByUser, transcriptionByShort }.
// Devuelve { synced, rehosted, idsByShortcode }. idsByShortcode permite transcribir DESPUÉS de
// insertar (Supabase es ahora el destino primario, no un mirror best-effort: si el upsert falla,
// lanza y el llamador debe propagar el error).
export async function syncReels(items, ctx = {}) {
  if (!enabled) throw new Error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  if (!items?.length) return { synced: 0, rehosted: 0, idsByShortcode: new Map() };
  const { scrapedAtIso, projectByUser, transcriptionByShort } = ctx;
  let rehosted = 0;
  const rows = [];
  for (const item of items) {
    if (!item.shortCode) continue;
    const project = projectByUser?.get((item.ownerUsername || '').toLowerCase());
    const transcripcion = transcriptionByShort?.get(item.shortCode);
    let thumbnailUrl = null;
    if (r2Enabled() && item.displayUrl) {
      thumbnailUrl = await rehostImage(item.displayUrl, `thumbnails/ig/${item.shortCode}.jpg`);
      if (thumbnailUrl) rehosted++;
    }
    // Carrusel (Sidecar): rehospeda TODAS las diapositivas a R2 (las URLs de IG caducan). Cada slide
    // se guarda como objeto { tipo:'video'|'image', url, poster }. Video → mp4; imagen → jpg. Solo si
    // hay más de 1 slide (un post de imagen/video única se cubre con thumbnail/video_url).
    let imagenes = null;
    const slides = carouselSlides(item);
    if (slides.length > 1) {
      imagenes = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        if (s.tipo === 'video') {
          let url = s.src;
          let poster = s.poster || null;
          if (r2Enabled()) {
            const v = await rehostVideo(s.src, `carousels/ig/${item.shortCode}_${i}.mp4`);
            if (v) { url = v; rehosted++; }
            if (s.poster) {
              const p = await rehostImage(s.poster, `carousels/ig/${item.shortCode}_${i}_poster.jpg`);
              if (p) { poster = p; rehosted++; }
            }
          }
          imagenes.push({ tipo: 'video', url, poster });
        } else {
          let url = s.src;
          if (r2Enabled()) {
            const u = await rehostImage(s.src, `carousels/ig/${item.shortCode}_${i}.jpg`);
            if (u) { url = u; rehosted++; }
          }
          imagenes.push({ tipo: 'image', url });
        }
      }
    }
    rows.push(reelRow(item, scrapedAtIso, project, transcripcion, thumbnailUrl, imagenes));
  }
  const data = await upsertReturning(config.igReelsTable, rows, 'shortcode', 'id, shortcode');
  const idsByShortcode = new Map(data.map((r) => [r.shortcode, r.id]));
  return { synced: data.length, rehosted, idsByShortcode };
}

// ----------------------------- YouTube -----------------------------

function videoRow(item, scrapedAtIso, project, origin, subtitulos, thumbnailUrl) {
  return {
    video_id: item.id,
    titulo: item.title || null,
    canal: item.channelName || null,
    canal_url: item.channelUrl || null,
    url: item.url || null,
    fecha_publicacion: item.date || null,
    views: item.viewCount ?? null,
    duracion: item.duration || null,
    hashtags: (item.hashtags || []).map((h) => `#${h}`).join(' ') || null,
    thumbnail_original: item.thumbnailUrl || null,
    thumbnail_url: thumbnailUrl,
    subtitulos: subtitulos || null,
    proyecto: project || null,
    origen: origin || null,
    scrapeado_en: scrapedAtIso,
  };
}

// Sincroniza videos nuevos a Supabase. ctx: { scrapedAtIso, resolve(item)->{project,origin}, subtitlesOf(item)->text }.
// Las thumbnails de YouTube no expiran, pero igual se rehospedan a R2 si está activo (opcional/uniforme).
export async function syncVideos(items, ctx = {}) {
  if (!enabled) throw new Error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  if (!items?.length) return { synced: 0, rehosted: 0 };
  const { scrapedAtIso, resolve, subtitlesOf } = ctx;
  let rehosted = 0;
  const rows = [];
  for (const item of items) {
    if (!item.id) continue;
    const { project, origin } = resolve ? resolve(item) : {};
    const subtitulos = subtitlesOf ? subtitlesOf(item) : '';
    let thumbnailUrl = null;
    if (r2Enabled() && item.thumbnailUrl) {
      thumbnailUrl = await rehostImage(item.thumbnailUrl, `thumbnails/yt/${item.id}.jpg`);
      if (thumbnailUrl) rehosted++;
    }
    rows.push(videoRow(item, scrapedAtIso, project, origin, subtitulos, thumbnailUrl));
  }
  const synced = await upsert(config.ytVideosTable, rows, 'video_id');
  return { synced, rehosted };
}

// --- Historias de Instagram (archivo permanente) ---

// El día al que pertenece una historia, en horario de CDMX. Se resuelve AQUÍ y no en el navegador
// para que el archivo no cambie de día según quién lo mire; y no como columna generada porque
// `at time zone 'America/Mexico_City'` es STABLE y Postgres no la admite en un GENERATED.
const TZ_ARCHIVO = 'America/Mexico_City';
function diaDe(epochSegundos) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_ARCHIVO }).format(new Date(epochSegundos * 1000));
}

// Fila de historia. NO incluye notas/favorito a propósito: así un re-scrape nunca pisa la curación
// (misma disciplina que reelRow con estado/mi_*).
function storyRow(s, { creador, userId, scrapedAtIso, proyecto, mediaUrl, posterUrl, mediaError }) {
  return {
    story_id: String(s.id),
    creador,
    user_id: userId || null,
    fecha_publicacion: new Date(s.takenAt * 1000).toISOString(),
    dia: diaDe(s.takenAt),
    expira_en: s.expiringAt ? new Date(s.expiringAt * 1000).toISOString() : null,
    tipo: s.mediaType === 'video' ? 'video' : 'image',
    media_url: mediaUrl,
    poster_url: posterUrl,
    media_original: s.videoUrl || s.imageUrl || null,
    media_error: mediaError || null,
    ancho: s.originalWidth ?? null,
    alto: s.originalHeight ?? null,
    tiene_audio: s.hasAudio ?? null,
    duracion_seg: s.videoDuration ?? null,
    proyecto: proyecto || null,
    scrapeado_en: scrapedAtIso,
  };
}

// Cuántas historias se archivan a la vez. Secuencial, 13 videos tardaban ~190s, peligrosamente
// cerca del techo de 290s del proxy del dashboard; de 4 en 4 baja a ~50s.
const STORIES_CONCURRENCIA = 4;

// Archiva UNA historia en R2. Nunca lanza: devuelve qué se pudo guardar y por qué falló.
async function archivarHistoria(s, creador) {
  const esVideo = s.mediaType === 'video' && !!s.videoUrl;
  const base = `stories/ig/${creador}/${s.id}`;
  if (!r2Enabled()) return { mediaUrl: null, posterUrl: null, mediaError: 'R2 no está configurado: la historia caducará' };

  let mediaUrl = null;
  let posterUrl = null;
  if (esVideo) {
    mediaUrl = await rehostVideo(s.videoUrl, `${base}.mp4`);
    if (s.imageUrl) posterUrl = await rehostImage(s.imageUrl, `${base}_poster.jpg`);
  } else if (s.imageUrl) {
    mediaUrl = await rehostImage(s.imageUrl, `${base}.jpg`);
  }
  const mediaError = mediaUrl
    ? null
    : esVideo
    ? 'No se pudo archivar el video (caducó en Instagram, tardó demasiado o supera los 60 MB)'
    : 'No se pudo archivar la imagen (caducó en Instagram o tardó demasiado)';
  return { mediaUrl, posterUrl, mediaError };
}

// Archiva historias en R2 y las guarda. Recibe [{ username, userId, stories: [...] }] YA filtrado
// (solo las nuevas). ctx: { scrapedAtIso, proyecto }.
// Si el rehost falla, la fila se guarda IGUAL con media_error: la hora y el orden son el valor del
// archivo, y perderlos por un fallo de red sería peor que quedarse sin el archivo.
export async function syncStories(userRecords, ctx = {}) {
  if (!enabled) throw new Error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY)');
  const { scrapedAtIso, proyecto } = ctx;

  // Se aplana a una sola cola para que la concurrencia valga aunque sean varias cuentas.
  const pendientes = [];
  for (const rec of userRecords || []) {
    const creador = (rec.username || '').replace(/^@/, '').toLowerCase();
    for (const s of rec.stories || []) {
      if (s?.id && s.takenAt) pendientes.push({ s, creador, userId: rec.userId });
    }
  }
  if (!pendientes.length) return { synced: 0, rehosted: 0, fallidas: 0 };

  const rows = [];
  let rehosted = 0;
  let fallidas = 0;
  const cola = [...pendientes];
  const workers = Array.from({ length: Math.min(STORIES_CONCURRENCIA, cola.length) }, async () => {
    while (cola.length) {
      const item = cola.shift();
      if (!item) break;
      const { mediaUrl, posterUrl, mediaError } = await archivarHistoria(item.s, item.creador);
      if (mediaUrl) rehosted++;
      else fallidas++;
      rows.push(
        storyRow(item.s, {
          creador: item.creador,
          userId: item.userId,
          scrapedAtIso,
          proyecto,
          mediaUrl,
          posterUrl,
          mediaError,
        })
      );
    }
  });
  await Promise.all(workers);

  const synced = await upsert(config.igStoriesTable, rows, 'story_id');
  return { synced, rehosted, fallidas };
}

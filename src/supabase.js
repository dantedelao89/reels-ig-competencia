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
async function getExistingColumn(table, column) {
  if (!enabled) return new Set();
  const c = await getClient();
  const ids = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c.from(table).select(column).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    data.forEach((r) => ids.add(String(r[column])));
    if (data.length < PAGE) break;
  }
  return ids;
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

function reelRow(item, scrapedAtIso, project, transcripcion, thumbnailUrl) {
  const music = item.musicInfo
    ? [item.musicInfo.song_name, item.musicInfo.artist_name].filter(Boolean).join(' — ')
    : '';
  return {
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
    rows.push(reelRow(item, scrapedAtIso, project, transcripcion, thumbnailUrl));
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

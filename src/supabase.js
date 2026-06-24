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

async function getClient() {
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

// Actualiza campos de un row por id (lo usa la transcripción manual bajo demanda).
export async function updateRowById(table, id, fields) {
  if (!enabled) return 0;
  const c = await getClient();
  const { error } = await c.from(table).update(fields).eq('id', id);
  if (error) throw new Error(error.message);
  return 1;
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
    dias_corriendo: adDaysRunning(item),
    thumbnail_original: adMedia(item).thumb,
    thumbnail_url: thumbnailUrl,
    video_url: videoUrlOverride || video,
    proyecto: project || null,
    scrapeado_en: scrapedAtIso,
  };
}

// Sincroniza anuncios nuevos a Supabase. ctx: { scrapedAtIso, projectByUrl }.
export async function syncAds(items, ctx = {}) {
  if (!enabled || !items?.length) return { synced: 0, rehosted: 0 };
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

// Upsert directo de filas ya mapeadas (snake_case). Lo usa el backfill desde Airtable.
export async function upsertReelRows(rows) {
  return upsert(config.igReelsTable, rows, 'shortcode');
}
export async function upsertVideoRows(rows) {
  return upsert(config.ytVideosTable, rows, 'video_id');
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
// Devuelve { synced, rehosted }. Resiliente: lanza solo si el upsert falla (el llamador lo envuelve).
export async function syncReels(items, ctx = {}) {
  if (!enabled || !items?.length) return { synced: 0, rehosted: 0 };
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
  const synced = await upsert(config.igReelsTable, rows, 'shortcode');
  return { synced, rehosted };
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
  if (!enabled || !items?.length) return { synced: 0, rehosted: 0 };
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

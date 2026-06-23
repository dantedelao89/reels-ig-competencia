// Espejo en Supabase (Postgres) que alimenta el dashboard de curación.
// Se activa solo si hay SUPABASE_URL + SUPABASE_SERVICE_KEY. El cliente se importa de forma
// perezosa. Los mappers NO incluyen estado/mi_guion/mi_* a propósito: así un upsert por re-scrape
// nunca pisa la capa de curación (Postgres solo actualiza las columnas presentes en el payload).

import { config } from './config.js';
import { r2Enabled, rehostImage } from './r2.js';

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

// Orquestación de YouTube: por cada búsqueda (palabra clave) y cada canal activo dispara el actor
// (solo videos nuevos), filtra duplicados contra Airtable e inserta únicamente los nuevos. Los
// subtítulos nativos vienen en el mismo item, así que no hace falta transcripción aparte.

import { config } from './config.js';
import {
  getActiveSearches,
  getActiveChannels,
  getExistingVideoIds,
  insertVideos,
  updateSearchLastRun,
  updateChannelLastRun,
} from './airtable.js';
import { scrapeSearchVideos, scrapeChannelVideos } from './youtubeApify.js';

// Mapea un item del actor a los campos de la tabla Videos YT.
// `origin` = la palabra clave o la URL de canal que trajo el video.
function mapVideo(item, scrapedAtIso, project, origin) {
  const fields = {
    'Video ID': item.id,
    Título: item.title || '',
    Canal: item.channelName || '',
    'Canal URL': item.channelUrl || '',
    URL: item.url || '',
    'Fecha publicación': item.date || null,
    Views: item.viewCount ?? null,
    Likes: item.likes ?? null,
    Comentarios: item.commentsCount ?? null,
    Duración: item.duration || '',
    Suscriptores: item.numberOfSubscribers ?? null,
    Descripción: item.text || '',
    Hashtags: (item.hashtags || []).map((h) => `#${h}`).join(' '),
    Thumbnail: item.thumbnailUrl || '',
    Origen: origin || item.input || '',
    Formato: (item.url || '').includes('/shorts/') ? 'Short' : 'Video',
    Subtítulos: item.subtitles?.plaintext || '',
    'Scrapeado en': scrapedAtIso,
  };
  if (project) fields.Proyecto = project;
  return fields;
}

// Inserta los videos nuevos (no vistos) y los marca en el Set de existentes. Devuelve cuántos.
async function insertFreshVideos(items, existing, scrapedAtIso, project, origin) {
  const fresh = items.filter((it) => !existing.has(it.id));
  const rows = fresh.map((it) => mapVideo(it, scrapedAtIso, project, origin));
  if (rows.length === 0) return 0;
  const inserted = await insertVideos(rows);
  rows.forEach((r) => existing.add(r['Video ID'])); // evita duplicados entre fuentes
  return inserted;
}

export async function runScrapeYoutube() {
  const startedAt = new Date().toISOString();
  const searches = await getActiveSearches();
  const channels = await getActiveChannels();
  if (searches.length === 0 && channels.length === 0) {
    return { ok: true, message: 'No hay búsquedas ni canales activos.', inserted: 0, details: [] };
  }

  const existing = await getExistingVideoIds();
  const details = [];
  let totalInserted = 0;

  // --- Búsquedas por palabra clave ---
  for (const s of searches) {
    const onlyNewerThan = s.lastRun || config.youtubeFirstRunLookback;
    try {
      const items = await scrapeSearchVideos({ query: s.query, maxResults: s.maxResults, maxShorts: s.maxShorts, onlyNewerThan });
      const inserted = await insertFreshVideos(items, existing, startedAt, s.project, s.query);
      await updateSearchLastRun(s.recordId, startedAt);
      totalInserted += inserted;
      details.push({ tipo: 'búsqueda', origen: s.query, scraped: items.length, inserted });
      console.log(`[YT búsqueda: ${s.query}] scrapeados=${items.length} nuevos=${inserted}`);
    } catch (err) {
      console.error(`[YT búsqueda: ${s.query}] ERROR:`, err.message);
      details.push({ tipo: 'búsqueda', origen: s.query, error: err.message });
    }
  }

  // --- Canales ---
  for (const c of channels) {
    const onlyNewerThan = c.lastRun || config.youtubeFirstRunLookback;
    try {
      const items = await scrapeChannelVideos({ channelUrl: c.channelUrl, maxResults: c.maxResults, maxShorts: c.maxShorts, onlyNewerThan });
      const inserted = await insertFreshVideos(items, existing, startedAt, c.project, c.channelUrl);
      await updateChannelLastRun(c.recordId, startedAt);
      totalInserted += inserted;
      details.push({ tipo: 'canal', origen: c.channelUrl, scraped: items.length, inserted });
      console.log(`[YT canal: ${c.channelUrl}] scrapeados=${items.length} nuevos=${inserted}`);
    } catch (err) {
      console.error(`[YT canal: ${c.channelUrl}] ERROR:`, err.message);
      details.push({ tipo: 'canal', origen: c.channelUrl, error: err.message });
    }
  }

  return { ok: true, searches: searches.length, channels: channels.length, inserted: totalInserted, details };
}

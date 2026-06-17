// Orquestación de YouTube: por cada búsqueda activa dispara el actor (solo videos nuevos),
// filtra duplicados contra Airtable e inserta únicamente los nuevos. Los subtítulos nativos
// vienen en el mismo item, así que no hace falta un paso aparte de transcripción.

import { config } from './config.js';
import {
  getActiveSearches,
  getExistingVideoIds,
  insertVideos,
  updateSearchLastRun,
} from './airtable.js';
import { scrapeSearchVideos } from './youtubeApify.js';

// Mapea un item del actor a los campos de la tabla Videos YT.
function mapVideo(item, scrapedAtIso, project) {
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
    Búsqueda: item.input || '',
    Subtítulos: item.subtitles?.plaintext || '',
    'Scrapeado en': scrapedAtIso,
  };
  if (project) fields.Proyecto = project;
  return fields;
}

export async function runScrapeYoutube() {
  const startedAt = new Date().toISOString();
  const searches = await getActiveSearches();
  if (searches.length === 0) {
    return { ok: true, message: 'No hay búsquedas activas.', searches: 0, inserted: 0, details: [] };
  }

  const existing = await getExistingVideoIds();
  const details = [];
  let totalInserted = 0;

  for (const search of searches) {
    const onlyNewerThan = search.lastRun || config.youtubeFirstRunLookback;
    try {
      const items = await scrapeSearchVideos({
        query: search.query,
        maxResults: search.maxResults,
        onlyNewerThan,
      });

      const fresh = items.filter((it) => !existing.has(it.id));
      const rows = fresh.map((it) => mapVideo(it, startedAt, search.project));

      let inserted = 0;
      if (rows.length > 0) {
        inserted = await insertVideos(rows);
        rows.forEach((r) => existing.add(r['Video ID'])); // evita duplicados entre búsquedas
      }

      await updateSearchLastRun(search.recordId, startedAt);
      totalInserted += inserted;
      details.push({ query: search.query, scraped: items.length, inserted });
      console.log(`[YT: ${search.query}] scrapeados=${items.length} nuevos=${inserted}`);
    } catch (err) {
      console.error(`[YT: ${search.query}] ERROR:`, err.message);
      details.push({ query: search.query, error: err.message });
    }
  }

  return { ok: true, searches: searches.length, inserted: totalInserted, details };
}

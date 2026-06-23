// Orquestación YouTube (batched): trae todas las búsquedas y todos los canales activos en pocas
// corridas del actor (split nuevos/recientes por ventana de fecha), deduplica por Video ID,
// inserta solo lo nuevo y asigna Origen + Proyecto mapeando cada video a su fuente.

import { config } from './config.js';
import {
  getActiveSearches,
  getActiveChannels,
  getExistingVideoIds,
  insertVideos,
  updateSearchLastRun,
  updateChannelLastRun,
} from './airtable.js';
import { scrapeSearches, scrapeChannels } from './youtubeApify.js';
import { syncVideos, supabaseEnabled } from './supabase.js';

// El actor devuelve `subtitles` a veces como objeto y a veces como array de pistas.
const MAX_SUBTITLE_CHARS = 95000; // Airtable limita la celda a 100k

export function extractSubtitles(subs) {
  if (!subs) return '';
  const tracks = Array.isArray(subs) ? subs : [subs];
  const withText = tracks.find((t) => t && t.plaintext) || tracks[0];
  let text = (withText && withText.plaintext) || '';
  if (text.length > MAX_SUBTITLE_CHARS) text = text.slice(0, MAX_SUBTITLE_CHARS) + '… [recortado]';
  return text;
}

// Extrae el @handle de una URL de canal (para mapear video → proyecto por canal).
function handleFromUrl(url) {
  const m = (url || '').match(/@([^/?\s]+)/);
  return m ? m[1].toLowerCase() : '';
}

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
    Origen: origin || '',
    Formato: (item.url || '').includes('/shorts/') ? 'Short' : 'Video',
    Subtítulos: extractSubtitles(item.subtitles),
    'Scrapeado en': scrapedAtIso,
  };
  if (project) fields.Proyecto = project;
  return fields;
}

// Inserta los videos nuevos; resolve(item) → { project, origin }. Devuelve cuántos insertó.
async function ingestVideos(items, existing, startedAt, resolve) {
  const fresh = items.filter((it) => it.id && !existing.has(it.id));
  if (fresh.length === 0) return 0;
  const rows = fresh.map((it) => {
    const { project, origin } = resolve(it);
    return mapVideo(it, startedAt, project, origin);
  });
  const inserted = await insertVideos(rows);
  rows.forEach((r) => existing.add(r['Video ID']));

  // Espejo a Supabase (dashboard). Solo los videos nuevos → nunca pisa la capa de curación.
  if (supabaseEnabled()) {
    try {
      const { synced, rehosted } = await syncVideos(fresh, {
        scrapedAtIso: startedAt,
        resolve,
        subtitlesOf: (it) => extractSubtitles(it.subtitles),
      });
      console.log(`[YT supabase] sincronizados=${synced} thumbnails_rehospedadas=${rehosted}`);
    } catch (e) {
      console.error(`[YT supabase] sync falló: ${e.message}`);
    }
  }

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

  // ---- Búsquedas por palabra clave ----
  const projByQuery = new Map(searches.map((s) => [s.query, s.project]));
  const searchGroups = [
    { label: 'búsquedas-nuevas', list: searches.filter((s) => !s.lastRun), window: config.youtubeFirstRunLookback },
    { label: 'búsquedas-recientes', list: searches.filter((s) => s.lastRun), window: config.youtubeRecentLookback },
  ];
  for (const g of searchGroups) {
    if (g.list.length === 0) continue;
    const queries = g.list.map((s) => s.query);
    try {
      const items = await scrapeSearches({
        queries,
        maxResults: config.youtubeBatchMaxResults,
        maxShorts: config.youtubeBatchMaxShorts,
        onlyNewerThan: g.window,
      });
      const inserted = await ingestVideos(items, existing, startedAt, (it) => ({
        project: projByQuery.get(it.input),
        origin: it.input,
      }));
      totalInserted += inserted;
      details.push({ grupo: g.label, fuentes: queries.length, scraped: items.length, inserted });
      console.log(`[YT ${g.label}] fuentes=${queries.length} scrapeados=${items.length} nuevos=${inserted}`);
    } catch (err) {
      console.error(`[YT ${g.label}] ERROR:`, err.message);
      details.push({ grupo: g.label, fuentes: queries.length, error: err.message });
    }
  }

  // ---- Canales ----
  const projByHandle = new Map(channels.map((c) => [handleFromUrl(c.channelUrl), c.project]));
  const channelGroups = [
    { label: 'canales-nuevos', list: channels.filter((c) => !c.lastRun), window: config.youtubeFirstRunLookback },
    { label: 'canales-recientes', list: channels.filter((c) => c.lastRun), window: config.youtubeRecentLookback },
  ];
  for (const g of channelGroups) {
    if (g.list.length === 0) continue;
    const urls = g.list.map((c) => c.channelUrl);
    try {
      const items = await scrapeChannels({
        urls,
        maxResults: config.youtubeBatchMaxResults,
        maxShorts: config.youtubeBatchMaxShorts,
        onlyNewerThan: g.window,
      });
      const inserted = await ingestVideos(items, existing, startedAt, (it) => ({
        project: projByHandle.get((it.channelUsername || '').toLowerCase()),
        origin: it.channelUrl || '',
      }));
      totalInserted += inserted;
      details.push({ grupo: g.label, fuentes: urls.length, scraped: items.length, inserted });
      console.log(`[YT ${g.label}] fuentes=${urls.length} scrapeados=${items.length} nuevos=${inserted}`);
    } catch (err) {
      console.error(`[YT ${g.label}] ERROR:`, err.message);
      details.push({ grupo: g.label, fuentes: urls.length, error: err.message });
    }
  }

  // Marca última corrida de todas las fuentes activas.
  for (const s of searches) {
    try { await updateSearchLastRun(s.recordId, startedAt); } catch (e) { console.error(`[YT lastRun búsqueda] ${e.message}`); }
  }
  for (const c of channels) {
    try { await updateChannelLastRun(c.recordId, startedAt); } catch (e) { console.error(`[YT lastRun canal] ${e.message}`); }
  }

  return { ok: true, searches: searches.length, channels: channels.length, inserted: totalInserted, details };
}

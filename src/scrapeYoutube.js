// Orquestación YouTube (batched): trae todas las búsquedas y todos los canales activos en pocas
// corridas del actor (split nuevos/recientes por ventana de fecha), deduplica por Video ID,
// inserta solo lo nuevo y asigna Origen + Proyecto mapeando cada video a su fuente.

import { config } from './config.js';
import {
  getActiveSearches,
  getActiveChannels,
  getChannelByUrl,
  createChannel,
  updateSearchLastRun,
  updateChannelLastRun,
} from './sources.js';
import { scrapeSearches, scrapeChannels, scrapeVideosByUrls } from './youtubeApify.js';
import { syncVideos, getExistingVideoIds } from './supabase.js';

// El actor devuelve `subtitles` a veces como objeto y a veces como array de pistas.
const MAX_SUBTITLE_CHARS = 95000;

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

// Inserta los videos nuevos en Supabase (destino primario); resolve(item) → { project, origin }.
// Devuelve cuántos insertó.
async function ingestVideos(items, existing, startedAt, resolve) {
  const fresh = items.filter((it) => it.id && !existing.has(it.id));
  if (fresh.length === 0) return 0;
  const { synced, rehosted } = await syncVideos(fresh, {
    scrapedAtIso: startedAt,
    resolve,
    subtitlesOf: (it) => extractSubtitles(it.subtitles),
  });
  fresh.forEach((it) => existing.add(it.id));
  console.log(`[YT supabase] sincronizados=${synced} thumbnails_rehospedadas=${rehosted}`);
  return synced;
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

// Agrega UN video de YouTube por su URL directa, pegada en DISECTA. Reutiliza el mismo pipeline:
// mapeo, subtítulos, rehost de thumbnail a R2 y espejo a Supabase. Hereda proyecto si el canal ya
// es una fuente nuestra.
export async function runScrapeYoutubeVideo(videoUrl) {
  const startedAt = new Date().toISOString();
  const url = (videoUrl || '').trim();
  if (!/youtu\.?be/i.test(url)) {
    return { ok: false, error: 'URL de YouTube inválida', inserted: 0 };
  }
  const existing = await getExistingVideoIds();
  let items;
  try {
    items = await scrapeVideosByUrls([url]);
  } catch (err) {
    console.error(`[YT url ${url}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
  if (!items.length) {
    return { ok: true, inserted: 0, message: 'No se pudo extraer el video de esa URL' };
  }
  // Si el canal ya es una fuente nuestra, hereda su proyecto; si no, lo da de alta como fuente
  // nueva (activa, sin proyecto) para que el próximo cron ya lo cubra solo.
  let projByHandle = new Map();
  try {
    const channels = await getActiveChannels();
    projByHandle = new Map(channels.map((c) => [handleFromUrl(c.channelUrl), c.project]));
  } catch (e) {
    console.error(`[YT url] no se pudo leer canales: ${e.message}`);
  }
  const it = items[0];
  const handle = (it.channelUsername || handleFromUrl(it.channelUrl || '')).toLowerCase();
  let canalNuevo = false;
  if (handle && !projByHandle.has(handle) && it.channelUrl) {
    try {
      const existingChannel = await getChannelByUrl(it.channelUrl);
      if (existingChannel) {
        projByHandle.set(handle, existingChannel.project);
      } else {
        const created = await createChannel(it.channelUrl);
        projByHandle.set(handle, created.project);
        canalNuevo = true;
        console.log(`[YT url] canal nuevo agregado a Fuentes: ${it.channelUrl}`);
      }
    } catch (e) {
      console.error(`[YT url] no se pudo dar de alta al canal ${it.channelUrl}: ${e.message}`);
    }
  }
  const inserted = await ingestVideos(items, existing, startedAt, (it2) => ({
    project: projByHandle.get((it2.channelUsername || '').toLowerCase()),
    origin: it2.channelUrl || url,
  }));
  console.log(`[YT url] ${url} videoId=${it.id} nuevo=${inserted}`);
  return {
    ok: true,
    inserted,
    videoId: it.id,
    titulo: it.title || null,
    canal: it.channelName || null,
    canalNuevo,
    subtitulos: extractSubtitles(it.subtitles) || null,
  };
}

// Búsqueda manual por palabra clave (ad-hoc, disparada desde DISECTA). No requiere que la búsqueda
// exista en Airtable. Trae los videos recientes que matchean, ordenados por fecha, e ingesta lo nuevo.
export async function runScrapeYoutubeSearch(query, opts = {}) {
  const startedAt = new Date().toISOString();
  const q = (query || '').trim();
  if (!q) return { ok: false, error: 'query vacía', scraped: 0, inserted: 0 };
  const window = opts.window || config.youtubeRecentLookback;
  const maxResults = Math.max(Number(opts.maxResults) || 20, 1);
  const existing = await getExistingVideoIds();
  let scraped = 0;
  let inserted = 0;
  try {
    const items = await scrapeSearches({
      queries: [q],
      maxResults,
      maxShorts: 0,
      onlyNewerThan: window,
    });
    scraped = items.length;
    inserted = await ingestVideos(items, existing, startedAt, (it) => ({
      project: opts.project || undefined,
      origin: it.input || q,
    }));
    console.log(`[YT búsqueda manual] "${q}" ventana=${window} max=${maxResults} scrapeados=${scraped} nuevos=${inserted}`);
  } catch (err) {
    console.error(`[YT búsqueda manual "${q}"] ERROR:`, err.message);
    return { ok: false, error: err.message, scraped, inserted: 0 };
  }
  return { ok: true, query: q, scraped, inserted };
}

// Re-scrape manual de UN solo canal (disparado desde DISECTA cuando el cron no lo alcanzó).
// Usa una ventana amplia (30 días) y más resultados para "ponerse al día" con lo que faltó.
export async function runScrapeYoutubeChannel(channelUrl) {
  const startedAt = new Date().toISOString();
  const channel = await getChannelByUrl(channelUrl);
  if (!channel) {
    return { ok: false, error: `No se encontró el canal: ${channelUrl}`, inserted: 0 };
  }
  const existing = await getExistingVideoIds();
  let inserted = 0;
  try {
    const items = await scrapeChannels({
      urls: [channel.channelUrl],
      maxResults: Math.max(channel.maxResults || config.youtubeDefaultMaxResults, 15),
      maxShorts: channel.maxShorts || 0,
      onlyNewerThan: '30 days',
    });
    inserted = await ingestVideos(items, existing, startedAt, () => ({
      project: channel.project,
      origin: channel.channelUrl,
    }));
    console.log(`[YT manual] ${channel.channelUrl} scrapeados=${items.length} nuevos=${inserted}`);
  } catch (err) {
    console.error(`[YT manual ${channel.channelUrl}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
  try {
    await updateChannelLastRun(channel.recordId, startedAt);
  } catch (e) {
    console.error(`[YT manual lastRun] ${e.message}`);
  }
  return { ok: true, channel: channel.channelUrl, inserted };
}

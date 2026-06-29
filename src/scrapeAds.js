// Orquestación del Pipeline Ads: trae los anunciantes activos, scrapea sus anuncios de la Meta
// Ad Library en una sola corrida batched, deduplica por Ad ID, inserta lo nuevo en Airtable y
// lo espeja a Supabase (con rehospedaje de creatividad a R2). Hereda Proyecto por anunciante.

import { config } from './config.js';
import {
  getActiveAdvertisers,
  getAdvertiserByUrl,
  getExistingAdIds,
  insertAds,
  updateAdvertiserLastRun,
} from './airtable.js';
import { scrapeFacebookAds } from './facebookAds.js';
import { syncAds, supabaseEnabled, getSyncedAdIds } from './supabase.js';

function mediaOf(item) {
  const s = item.snapshot || {};
  let thumb = null;
  let video = null;
  if (Array.isArray(s.videos) && s.videos.length) {
    video = s.videos[0].videoHdUrl || s.videos[0].videoSdUrl || null;
    thumb = s.videos[0].videoPreviewImageUrl || null;
  }
  if (!thumb && Array.isArray(s.images) && s.images.length) thumb = s.images[0].originalImageUrl || null;
  if (Array.isArray(s.cards) && s.cards.length) {
    const c = s.cards[0];
    if (!thumb) thumb = c.originalImageUrl || c.videoPreviewImageUrl || null;
    if (!video) video = c.videoHdUrl || c.videoSdUrl || null;
  }
  return { thumb, video };
}

function daysRunning(item) {
  const start = item.startDate ? item.startDate * 1000 : null;
  const end = item.isActive ? Date.now() : item.endDate ? item.endDate * 1000 : null;
  if (!start || !end) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

// Mapea un anuncio del actor a los campos de la tabla Airtable "Anuncios".
function mapAd(item, scrapedAtIso, project) {
  const s = item.snapshot || {};
  const { thumb, video } = mediaOf(item);
  const fields = {
    'Ad ID': item.adArchiveID,
    Anunciante: item.pageName || '',
    'Página URL': s.pageProfileUri || item.inputUrl || '',
    Copy: s.body?.text || '',
    Título: s.title || '',
    CTA: s.ctaText || '',
    'Link destino': s.linkUrl || '',
    Formato: s.displayFormat || '',
    Plataformas: (item.publisherPlatform || []).join(', '),
    Activo: !!item.isActive,
    'Fecha inicio': item.startDateFormatted || null,
    'Fecha fin': item.endDateFormatted || null,
    'Días corriendo': item.daysActive ?? daysRunning(item),
    Thumbnail: thumb || '',
    'Video URL': video || '',
    'Scrapeado en': scrapedAtIso,
  };
  if (project) fields.Proyecto = project;
  return fields;
}

// opts.onlyUrl: si se pasa, scrapea solo ese anunciante (disparo manual desde DISECTA).
export async function runScrapeAds(opts = {}) {
  const startedAt = new Date().toISOString();
  let advertisers;
  if (opts.onlyUrl) {
    const one = await getAdvertiserByUrl(opts.onlyUrl);
    if (!one) {
      return { ok: false, error: `No se encontró el anunciante: ${opts.onlyUrl}`, advertisers: 0, inserted: 0, details: [] };
    }
    advertisers = [one];
  } else {
    advertisers = await getActiveAdvertisers();
  }
  if (advertisers.length === 0) {
    return { ok: true, message: 'No hay anunciantes activos.', advertisers: 0, inserted: 0, details: [] };
  }

  const existing = await getExistingAdIds();
  // Dedup de Supabase INDEPENDIENTE de Airtable: si un sync falló antes, un re-scrape lo reintenta.
  const synced0 = supabaseEnabled() ? await getSyncedAdIds() : new Set();

  let inserted = 0;
  const details = [];
  // Una corrida del actor POR anunciante. bovi colapsa por collation_id y filtra por activeStatus
  // (config.adsActiveStatus) + países (config.adsCountries), así que no aplica ventana de fecha.
  for (const a of advertisers) {
    try {
      const items = await scrapeFacebookAds({
        url: a.url,
        resultsLimit: a.resultsLimit, // null = usa config.adsMaxResults
      });
      // Nuevos para Airtable (lo que aún no está en Airtable).
      const fresh = items.filter((it) => it.adArchiveID && !existing.has(it.adArchiveID.toString()));
      fresh.forEach((it) => existing.add(it.adArchiveID.toString()));

      const rows = fresh.map((it) => mapAd(it, startedAt, a.project));
      let ins = 0;
      if (rows.length) ins = await insertAds(rows);
      inserted += ins;

      // Nuevos para Supabase (lo que aún no está en meta_ads), sin depender de Airtable.
      const freshSupa = items.filter((it) => it.adArchiveID && !synced0.has(it.adArchiveID.toString()));
      freshSupa.forEach((it) => synced0.add(it.adArchiveID.toString()));
      let synced = 0;
      let syncErr = null;
      if (supabaseEnabled() && freshSupa.length) {
        try {
          const projectByUrl = new Map([[a.url.trim(), a.project]]);
          const r = await syncAds(freshSupa, { scrapedAtIso: startedAt, projectByUrl });
          synced = r.synced;
          console.log(`[ADS supabase ${a.marca || a.url}] sincronizados=${r.synced} rehospedadas=${r.rehosted}`);
        } catch (e) {
          syncErr = e.message;
          console.error(`[ADS supabase ${a.marca || a.url}] sync falló: ${e.message}`);
        }
      }
      details.push({ anunciante: a.marca || a.url, scraped: items.length, inserted: ins, synced, ...(syncErr ? { syncError: syncErr } : {}) });
      console.log(`[ADS] ${a.marca || a.url} scrapeados=${items.length} nuevos=${ins} synced=${synced}`);
    } catch (err) {
      console.error(`[ADS ${a.marca || a.url}] ERROR:`, err.message);
      details.push({ anunciante: a.marca || a.url, error: err.message });
    }
    try {
      await updateAdvertiserLastRun(a.recordId, startedAt);
    } catch (e) {
      console.error(`[ADS lastRun ${a.marca || a.url}] ${e.message}`);
    }
  }

  return { ok: true, advertisers: advertisers.length, inserted, details };
}

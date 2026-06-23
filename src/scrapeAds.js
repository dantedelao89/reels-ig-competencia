// Orquestación del Pipeline Ads: trae los anunciantes activos, scrapea sus anuncios de la Meta
// Ad Library en una sola corrida batched, deduplica por Ad ID, inserta lo nuevo en Airtable y
// lo espeja a Supabase (con rehospedaje de creatividad a R2). Hereda Proyecto por anunciante.

import { config } from './config.js';
import {
  getActiveAdvertisers,
  getExistingAdIds,
  insertAds,
  updateAdvertiserLastRun,
} from './airtable.js';
import { scrapeFacebookAds } from './facebookAds.js';
import { syncAds, supabaseEnabled } from './supabase.js';

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
    'Días corriendo': daysRunning(item),
    Thumbnail: thumb || '',
    'Video URL': video || '',
    'Scrapeado en': scrapedAtIso,
  };
  if (project) fields.Proyecto = project;
  return fields;
}

export async function runScrapeAds() {
  const startedAt = new Date().toISOString();
  const advertisers = await getActiveAdvertisers();
  if (advertisers.length === 0) {
    return { ok: true, message: 'No hay anunciantes activos.', advertisers: 0, inserted: 0, details: [] };
  }

  const existing = await getExistingAdIds();
  const projectByUrl = new Map(advertisers.map((a) => [a.url.trim(), a.project]));
  // Límite por URL: el mayor configurado entre los anunciantes (el actor aplica resultsLimit por URL).
  const resultsLimit = Math.max(...advertisers.map((a) => a.resultsLimit || config.adsBatchMaxResults));

  let inserted = 0;
  const details = [];
  try {
    const items = await scrapeFacebookAds({ urls: advertisers.map((a) => a.url), resultsLimit });
    const fresh = items.filter((it) => it.adArchiveID && !existing.has(it.adArchiveID.toString()));
    fresh.forEach((it) => existing.add(it.adArchiveID.toString()));

    const rows = fresh.map((it) => mapAd(it, startedAt, projectByUrl.get((it.inputUrl || '').trim())));
    if (rows.length) inserted = await insertAds(rows);

    if (supabaseEnabled()) {
      try {
        const { synced, rehosted } = await syncAds(fresh, { scrapedAtIso: startedAt, projectByUrl });
        console.log(`[ADS supabase] sincronizados=${synced} creatividades_rehospedadas=${rehosted}`);
      } catch (e) {
        console.error(`[ADS supabase] sync falló: ${e.message}`);
      }
    }
    details.push({ anunciantes: advertisers.length, scraped: items.length, inserted });
    console.log(`[ADS] anunciantes=${advertisers.length} scrapeados=${items.length} nuevos=${inserted}`);
  } catch (err) {
    console.error('[ADS] ERROR:', err.message);
    details.push({ anunciantes: advertisers.length, error: err.message });
  }

  for (const a of advertisers) {
    try {
      await updateAdvertiserLastRun(a.recordId, startedAt);
    } catch (e) {
      console.error(`[ADS lastRun ${a.marca || a.url}] ${e.message}`);
    }
  }

  return { ok: true, advertisers: advertisers.length, inserted, details };
}

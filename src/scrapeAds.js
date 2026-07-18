// Orquestación del Pipeline Ads: trae los anunciantes activos, scrapea sus anuncios de la Meta
// Ad Library en una sola corrida batched, deduplica por Ad ID contra Supabase (destino primario,
// con rehospedaje de creatividad a R2). Hereda Proyecto por anunciante.

import { getActiveAdvertisers, getAdvertiserByUrl, updateAdvertiserLastRun, createAdvertiser } from './sources.js';
import { scrapeFacebookAds, scrapeFacebookAdsByPageId, resolveAdvertiserPageIdFromUrl } from './facebookAds.js';
import { syncAds, getSyncedAdIds } from './supabase.js';

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

  const existing = await getSyncedAdIds();

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
      const fresh = items.filter((it) => it.adArchiveID && !existing.has(it.adArchiveID.toString()));
      fresh.forEach((it) => existing.add(it.adArchiveID.toString()));

      let synced = 0;
      if (fresh.length) {
        const projectByUrl = new Map([[a.url.trim(), a.project]]);
        const r = await syncAds(fresh, { scrapedAtIso: startedAt, projectByUrl });
        synced = r.synced;
        console.log(`[ADS supabase ${a.marca || a.url}] sincronizados=${r.synced} rehospedadas=${r.rehosted}`);
      }
      inserted += synced;
      details.push({ anunciante: a.marca || a.url, scraped: items.length, inserted: synced });
      console.log(`[ADS] ${a.marca || a.url} scrapeados=${items.length} nuevos=${synced}`);
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

// Agrega/scrapea UN anunciante a partir de CUALQUIER link de Facebook (post, anuncio compartido,
// página, etc.), pegado en DISECTA. Sigue la redirección para sacar el page_id gratis (sin actor);
// si la página todavía no es una fuente nuestra, la da de alta (sin proyecto, se asigna después).
export async function runScrapeAdvertiserUrl(contentUrl) {
  const startedAt = new Date().toISOString();
  const clean = (contentUrl || '').trim();
  if (!/facebook\.com/i.test(clean)) {
    return { ok: false, error: 'URL de Facebook inválida', inserted: 0 };
  }
  const pageId = await resolveAdvertiserPageIdFromUrl(clean);
  if (!pageId) {
    return {
      ok: false,
      error: 'No se pudo identificar al anunciante desde ese link (prueba con el link de su página de Facebook).',
      inserted: 0,
    };
  }
  const advertiserUrl = `https://www.facebook.com/profile.php?id=${pageId}`;
  let advertiser = await getAdvertiserByUrl(advertiserUrl);
  let anuncianteNuevo = false;
  if (!advertiser) {
    advertiser = await createAdvertiser(advertiserUrl);
    anuncianteNuevo = true;
    console.log(`[ADS url] anunciante nuevo agregado a Fuentes: ${advertiserUrl}`);
  }

  let items;
  try {
    items = await scrapeFacebookAdsByPageId({ pageId, resultsLimit: advertiser.resultsLimit, inputUrl: advertiserUrl });
  } catch (err) {
    console.error(`[ADS url ${clean}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }

  const existing = await getSyncedAdIds();
  const fresh = items.filter((it) => it.adArchiveID && !existing.has(it.adArchiveID.toString()));
  let synced = 0;
  if (fresh.length) {
    const projectByUrl = new Map([[advertiserUrl, advertiser.project]]);
    const r = await syncAds(fresh, { scrapedAtIso: startedAt, projectByUrl });
    synced = r.synced;
  }
  try {
    await updateAdvertiserLastRun(advertiser.recordId, startedAt);
  } catch (e) {
    console.error(`[ADS url lastRun] ${e.message}`);
  }

  console.log(`[ADS url] ${clean} pageId=${pageId} scrapeados=${items.length} nuevos=${synced}`);
  return {
    ok: true,
    inserted: synced,
    scraped: items.length,
    anunciante: advertiser.marca || advertiserUrl,
    anuncianteNuevo,
  };
}

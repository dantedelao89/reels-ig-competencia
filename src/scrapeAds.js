// Orquestación del Pipeline Ads: trae los anunciantes activos, scrapea sus anuncios de la Meta
// Ad Library en una sola corrida batched, deduplica por Ad ID contra Supabase (destino primario,
// con rehospedaje de creatividad a R2). Hereda Proyecto por anunciante.

import {
  getActiveAdvertisers,
  getAdvertiserByUrl,
  updateAdvertiserLastRun,
  createAdvertiser,
  setAdvertiserMarca,
  findOrCreateAdvertiserByPage,
} from './sources.js';
import { scrapeFacebookAds, scrapeFacebookAdsByPageId, resolveAdvertiserPageIdFromUrl } from './facebookAds.js';
import { scrapeFacebookPostByUrl, isSpecificContentLink } from './facebookPost.js';
import { syncAds, syncSinglePostAsAd, getSyncedAdIds } from './supabase.js';

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
      // Rellena el nombre del anunciante en Fuentes si aún no lo tiene (para verlo y re-scrapearlo).
      if (!a.marca && items[0]?.pageName) {
        try { await setAdvertiserMarca(a.recordId, items[0].pageName); } catch (e) { console.error(`[ADS marca] ${e.message}`); }
      }
      details.push({ anunciante: a.marca || items[0]?.pageName || a.url, scraped: items.length, inserted: synced });
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

// Trae UN solo anuncio/video por su link directo de Facebook (share/p, reel, video, etc.). No trae
// toda la página del anunciante. Es contenido orgánico del post (video + copy + métricas), sin la
// metadata de Ad Library (activo/días corriendo/ganador). Se inserta en meta_ads con ad_id "fbpost_".
export async function runScrapeSingleAdVideo(contentUrl) {
  const startedAt = new Date().toISOString();
  const clean = (contentUrl || '').trim();
  let post;
  try {
    post = await scrapeFacebookPostByUrl(clean);
  } catch (err) {
    console.error(`[ADS single ${clean}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
  if (!post) {
    return { ok: true, inserted: 0, message: 'No se pudo extraer ese contenido de Facebook' };
  }
  const { synced } = await syncSinglePostAsAd(post, { scrapedAtIso: startedAt });

  // Si el dueño del anuncio todavía no era fuente nuestra, lo damos de alta en Fuentes → Anunciantes
  // (mismo comportamiento que el orgánico con creadores/canales). Así queda listo para re-scrapearlo.
  let anuncianteNuevo = false;
  try {
    const { creado } = await findOrCreateAdvertiserByPage({
      pageId: post.pageId,
      pageUrl: post.pageUrl,
      pageName: post.pageName,
    });
    anuncianteNuevo = creado;
    if (creado) console.log(`[ADS single] anunciante nuevo agregado a Fuentes: ${post.pageName || post.pageId}`);
  } catch (e) {
    console.error(`[ADS single] no se pudo dar de alta al anunciante: ${e.message}`);
  }

  console.log(`[ADS single] ${clean} postId=${post.postId} nuevo=${synced}`);
  return {
    ok: true,
    inserted: synced,
    scraped: 1,
    anunciante: post.pageName || 'Facebook',
    anuncianteNuevo,
    unico: true, // marca que fue un solo video, no un anunciante completo
  };
}

// Agrega/scrapea a partir de CUALQUIER link de Facebook, pegado en DISECTA. Ramifica: si es un link
// a UN contenido específico (post/video/reel) → trae solo ese video; si es un link de PÁGINA →
// resuelve el anunciante y trae todos sus anuncios de la Ad Library (dándolo de alta si es nuevo).
export async function runScrapeAdvertiserUrl(contentUrl) {
  const startedAt = new Date().toISOString();
  const clean = (contentUrl || '').trim();
  if (!/facebook\.com|fb\.watch/i.test(clean)) {
    return { ok: false, error: 'URL de Facebook inválida', inserted: 0 };
  }
  if (isSpecificContentLink(clean)) {
    return runScrapeSingleAdVideo(clean);
  }

  // `facebook.com/share/<id>/` PELADO (sin /p/, /r/ ni /v/) es ambiguo: lo produce el botón de
  // compartir del iPhone tanto para un POST como para una PÁGINA, y desde fuera no se distingue —
  // Facebook responde 400 al seguirlo (medido el 11 nov 2026 desde Railway Y desde una conexión
  // doméstica, así que no es el bloqueo de IP que suponía `tryFreeRedirect`).
  //
  // Antes caía directo al camino de ANUNCIANTE, así que Dante compartía un post del feed y recibía
  // un error de anunciante. Ahora se prueba primero como POST —el resolutor de `facebookPost.js`
  // sí sabe abrir links cortos— y solo si ahí no hay contenido se sigue con el camino de siempre.
  //
  // El orden importa: al revés, un post se daría de alta como anunciante (es lo que pasó con
  // "Nexum school") y el post se perdería. Así el caso de la página se conserva intacto, porque
  // sigue llegando al mismo sitio, solo que un paso después.
  if (/facebook\.com\/share\/[^/]+\/?(\?|$)/i.test(clean)) {
    try {
      const comoPost = await runScrapeSingleAdVideo(clean);
      if (comoPost?.ok !== false && (comoPost?.inserted || 0) > 0) return comoPost;
      console.log(`[ads url] ${clean} no resolvió como post; se intenta como anunciante`);
    } catch (e) {
      console.warn(`[ads url] el intento como post falló (${e.message}); se intenta como anunciante`);
    }
  }

  const pageId = await resolveAdvertiserPageIdFromUrl(clean);
  if (!pageId) {
    // El mensaje dice DOS cosas, porque la confusión de fondo no es el link sino qué hace DISECTA
    // con Facebook: aquí un link de FB siempre significa «dar de alta un ANUNCIANTE», no «guardar
    // este post». Decir solo «prueba con el link de su página» mandaba a Dante a traer justo lo que
    // no quería (11 nov 2026: copió un post del feed y acabó con un error de anunciante).
    //
    // Y sobre el link en sí: un `facebook.com/share/<id>/` pelado —sin `/p/`, `/r/` ni `/v/`— no se
    // puede resolver. Facebook responde 400 al seguirlo, y medido ese día NO es el bloqueo de la IP
    // de Railway que suponía el comentario de `tryFreeRedirect`: devuelve 400 también desde una
    // conexión doméstica. Antes de llegar aquí ya se gastó una corrida del actor de anuncios.
    const esShareCorto = /facebook\.com\/share\/[^/]+\/?(\?|$)/i.test(clean);
    return {
      ok: false,
      error: esShareCorto
        ? 'Ese link de «compartir» de Facebook no se puede abrir desde fuera (responde 400). Y ojo: ' +
          'DISECTA lee Facebook como ANUNCIANTES, no guarda posts sueltos — si lo que quieres es ' +
          'seguir a ese anunciante, manda el link de su página; si querías el post, hoy no se puede.'
        : 'No se pudo identificar al anunciante desde ese link. DISECTA lee Facebook como ' +
          'anunciantes: manda el link de la PÁGINA, no el de un post.',
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
  // Rellena el nombre del anunciante en Fuentes si aún no lo tiene.
  if (!advertiser.marca && items[0]?.pageName) {
    try { await setAdvertiserMarca(advertiser.recordId, items[0].pageName); } catch (e) { console.error(`[ADS marca] ${e.message}`); }
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

// Trae anuncios de la Meta Ad Library con bovi/meta-ads-library-scraper, que expone collation_id
// (la agrupación oficial de Meta: todas las instancias del mismo anuncio comparten id) + is_scaled
// (ganadores) + longevity_score. Normaliza la salida al shape interno que ya usan los mappers, y
// colapsa por collation_id para no traer duplicados. bovi pide page_id numérico y países explícitos.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

// Normaliza un nombre/handle para comparar: sin acentos, minúsculas, solo alfanuméricos.
// "Diosmos Mkt" y "DiosmosMkt" → "diosmosmkt" (así el handle de la URL casa con el page_name).
function normalizeName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Extrae el handle (nombre de usuario) de una URL de página de Facebook. Devuelve null si la URL
// no es un handle de página (numérica, profile.php, ads/library, share, etc.).
function extractHandle(url) {
  try {
    const u = new URL((url || '').trim());
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    const reserved = new Set(['profile.php', 'ads', 'share', 'people', 'pages', 'permalink.php', 'story.php', 'watch', 'reel', 'groups']);
    if (!seg || /^\d+$/.test(seg) || reserved.has(seg.toLowerCase())) return null;
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

// Convierte un handle en un término de búsqueda que la Ad Library sepa emparejar: separadores a
// espacios y corte de camelCase. "DiosmosMkt" → "Diosmos Mkt"; "empleados.io" → "empleados io".
function handleToSearchTerm(handle) {
  return (handle || '')
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resuelve el page_id de un handle vía bovi por búsqueda (proxy residencial, confiable desde el
// servidor). Empareja el resultado por nombre normalizado; así evita traer el anunciante equivocado.
// Es el fallback cuando el resolver clásico (apify/facebook-ads-scraper) devuelve "empty/private data".
async function resolvePageIdViaSearch(handle) {
  const term = handleToSearchTerm(handle);
  if (!term) return null;
  const target = normalizeName(handle);
  try {
    const items = await runActorItems(config.adsActor, {
      searchTerms: [term],
      countries: config.adsCountries,
      activeStatus: 'all',
      maxResults: 30,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    });
    const byId = new Map();
    for (const it of items || []) {
      if (it && it.page_id) byId.set(String(it.page_id), it.page_name || '');
    }
    // 1) coincidencia exacta por nombre normalizado (handle == page_name sin espacios/acentos).
    for (const [id, name] of byId) {
      if (normalizeName(name) === target) return id;
    }
    // 2) si la búsqueda devolvió UNA sola página, es casi seguro la correcta.
    if (byId.size === 1) return [...byId.keys()][0];
    console.log(`[ads resolve] búsqueda "${term}" no coincidió con "${handle}" (${byId.size} páginas)`);
    return null;
  } catch (e) {
    console.error(`[ads resolve] fallo búsqueda de "${handle}": ${e.message}`);
    return null;
  }
}

// La URL del anunciante (ej. facebook.com/61553980501732/) NO contiene el page_id real. Lo resolvemos
// con el actor clásico en modo onlyTotal (casi gratis); si falla (Facebook a veces bloquea el handle
// con "empty/private data"), caemos a resolver por búsqueda en bovi. Se cachea por proceso.
const pageIdCache = new Map();
async function resolvePageId(url) {
  if (pageIdCache.has(url)) return pageIdCache.get(url);
  let pid = null;
  try {
    const items = await runActorItems(config.adsPageIdResolver, {
      startUrls: [{ url }],
      onlyTotal: true,
    });
    pid = (items || [])[0]?.pageInfo?.page?.id || null;
  } catch (e) {
    console.error(`[ads resolve] resolver clásico falló para ${url}: ${e.message}`);
  }
  if (!pid) {
    const handle = extractHandle(url);
    if (handle) {
      console.log(`[ads resolve] resolver clásico sin page_id para ${url}, probando búsqueda por handle "${handle}"`);
      pid = await resolvePageIdViaSearch(handle);
    }
  }
  pageIdCache.set(url, pid);
  return pid;
}

// Intenta sacar el page_id de un link de post/anuncio compartido SIN gastar en el actor: Facebook
// a veces expone el id numérico de la página dueña en la URL final tras seguir la redirección
// (ej. facebook.com/share/p/… → permalink.php?...&id=...). Solo funciona si Facebook nos deja
// seguir la redirección (desde Railway suele devolver 400 en vez de redirigir — ver fallback abajo).
async function tryFreeRedirect(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' },
    });
    const finalUrl = res.url || '';
    const m = finalUrl.match(/[?&]id=(\d{6,})/) || finalUrl.match(/facebook\.com\/(\d{6,})(?:[/?]|$)/);
    return m ? m[1] : null;
  } catch (e) {
    console.error(`[ads url] no se pudo seguir la redirección de ${url}: ${e.message}`);
    return null;
  }
}

// Resuelve el page_id de CUALQUIER link de Facebook (post, anuncio compartido, página, etc.),
// pegado en DISECTA. Primero intenta gratis (id ya visible en la URL, o vía redirección); si
// Facebook bloquea la IP del servidor (devuelve 400 en vez de redirigir), cae al actor clásico
// (con proxy residencial, casi gratis) que ya usa el resto del pipeline.
export async function resolveAdvertiserPageIdFromUrl(url) {
  const clean = (url || '').trim();
  const direct = clean.match(/[?&]id=(\d{6,})/) || clean.match(/facebook\.com\/(\d{6,})(?:[/?]|$)/);
  if (direct) return direct[1];
  const free = await tryFreeRedirect(clean);
  if (free) return free;
  console.log(`[ads url] redirect gratis falló para ${clean}, cayendo al actor con proxy`);
  return resolvePageId(clean);
}

// Normaliza un item de bovi al shape interno (item.snapshot.*, adArchiveID, etc.) + campos nuevos.
function normalizeBovi(b, inputUrl) {
  const videos = Array.isArray(b.snapshot_videos) ? b.snapshot_videos.filter(Boolean) : [];
  const images = Array.isArray(b.snapshot_images) ? b.snapshot_images.filter(Boolean) : [];
  return {
    adArchiveID: b.ad_archive_id,
    pageName: b.page_name || '',
    inputUrl,
    publisherPlatform: b.publisher_platforms || [],
    isActive: !!b.is_active,
    startDateFormatted: b.ad_delivery_start_date || null,
    endDateFormatted: b.ad_delivery_stop_date || null,
    // Campos nuevos de bovi (los consume el mapper de Supabase).
    daysActive: b.days_active ?? null,
    collationId: b.collation_id != null ? String(b.collation_id) : null,
    collationCount: b.collation_count ?? null,
    isScaled: !!b.is_scaled,
    longevityScore: b.longevity_score ?? null,
    snapshot: {
      pageProfileUri: b.page_profile_uri || null,
      body: { text: (b.ad_creative_bodies || [])[0] || '' },
      title: (b.ad_creative_link_titles || [])[0] || '',
      ctaText: b.cta_text || '',
      linkUrl: b.link_url || '',
      displayFormat: b.display_format || '',
      videos: videos.length ? [{ videoHdUrl: videos[0], videoPreviewImageUrl: images[0] || null }] : [],
      images: images.length ? [{ originalImageUrl: images[0] }] : [],
    },
  };
}

// Puntaje para elegir el representante de un grupo collation: activo + con video gana.
function repScore(it) {
  return (it.isActive ? 2 : 0) + (it.snapshot.videos.length ? 1 : 0);
}

// Colapsa instancias del mismo anuncio: una fila por collation_id (sin collation, por ad id).
function collapseByCollation(items) {
  const byColl = new Map();
  const out = [];
  for (const it of items) {
    if (!it.collationId) { out.push(it); continue; }
    const prev = byColl.get(it.collationId);
    if (!prev || repScore(it) > repScore(prev)) byColl.set(it.collationId, it);
  }
  return [...byColl.values(), ...out];
}

// Scrapea un anunciante ya con su page_id resuelto (evita gastar en resolvePageId si ya se conoce,
// ej. cuando el page_id salió gratis de resolveAdvertiserPageIdFromUrl). Devuelve items normalizados
// y ya deduplicados por collation_id.
export async function scrapeFacebookAdsByPageId({ pageId, resultsLimit, inputUrl }) {
  const items = await runActorItems(config.adsActor, {
    pageIds: [pageId],
    countries: config.adsCountries,
    activeStatus: config.adsActiveStatus,
    maxResults: resultsLimit || config.adsMaxResults,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  });
  const normalized = (items || [])
    .filter((it) => it && it.ad_archive_id && !it.error)
    .map((b) => normalizeBovi(b, inputUrl || `https://www.facebook.com/profile.php?id=${pageId}`));
  return collapseByCollation(normalized);
}

// Scrapea un anunciante por su URL de página (resuelve el page_id vía el actor clásico).
// Devuelve items normalizados y ya deduplicados por collation_id.
export async function scrapeFacebookAds({ url, resultsLimit }) {
  const pageId = await resolvePageId(url);
  if (!pageId) throw new Error(`No se pudo resolver el page_id de ${url}`);
  const items = await runActorItems(config.adsActor, {
    pageIds: [pageId],
    countries: config.adsCountries,
    activeStatus: config.adsActiveStatus,
    maxResults: resultsLimit || config.adsMaxResults,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  });
  const normalized = (items || [])
    .filter((it) => it && it.ad_archive_id && !it.error)
    .map((b) => normalizeBovi(b, url));
  return collapseByCollation(normalized);
}

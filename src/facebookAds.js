// Trae anuncios de la Meta Ad Library con bovi/meta-ads-library-scraper, que expone collation_id
// (la agrupación oficial de Meta: todas las instancias del mismo anuncio comparten id) + is_scaled
// (ganadores) + longevity_score. Normaliza la salida al shape interno que ya usan los mappers, y
// colapsa por collation_id para no traer duplicados. bovi pide page_id numérico y países explícitos.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

// La URL del anunciante (ej. facebook.com/61553980501732/) NO contiene el page_id real. Lo resolvemos
// con el actor clásico en modo onlyTotal (casi gratis) y lo cacheamos por proceso.
const pageIdCache = new Map();
async function resolvePageId(url) {
  if (pageIdCache.has(url)) return pageIdCache.get(url);
  const items = await runActorItems(config.adsPageIdResolver, {
    startUrls: [{ url }],
    onlyTotal: true,
  });
  const r = (items || [])[0] || {};
  const pid = r.pageInfo?.page?.id || null;
  pageIdCache.set(url, pid);
  return pid;
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

// Scrapea un anunciante. Devuelve items normalizados y ya deduplicados por collation_id.
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

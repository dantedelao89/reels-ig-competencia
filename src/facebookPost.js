// Trae UN post/video/anuncio específico de Facebook por su link directo (share/p, share/r, share/v,
// /videos/, /reel/, /watch, fb.watch, permalink), sin traer toda la página del anunciante.
//
// Cadena de 2 actores (los links cortos/compartidos no los acepta el scraper de media directamente,
// y desde Railway no se puede seguir la redirección — Facebook devuelve 400):
//   1. clappi resuelve CUALQUIER link → realId (id del post) + page id (del autor) + copy + thumbnail.
//   2. Con eso se arma la URL canónica facebook.com/<pageId>/posts/<realId> y premiumscraper trae
//      el video HD (o las imágenes si es post de imagen) + copy completo.
//
// Nota: son datos ORGÁNICOS del post (no de la Ad Library), así que no hay días-corriendo / ganador.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

// ¿Es un link a UN contenido específico (post/video/reel) y no a una página/anunciante?
export function isSpecificContentLink(url) {
  const u = (url || '').trim();
  return /\/share\/(p|r|v)\//i.test(u)
    || /\/videos?\//i.test(u)
    || /\/reel\//i.test(u)
    || /\/watch\/?\?v=/i.test(u)
    || /fb\.watch\//i.test(u)
    || /permalink\.php/i.test(u)
    || /story\.php/i.test(u)
    || /\/posts\//i.test(u);
}

function first(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

// El id numérico de la página dueña, desde authorId o desde la authorUrl (.../people/Nombre/<id>/).
function pageIdOf(resolved) {
  if (resolved.authorId && /^\d{6,}$/.test(String(resolved.authorId))) return String(resolved.authorId);
  const m = (resolved.authorUrl || '').match(/(\d{6,})\/?$/) || (resolved.authorUrl || '').match(/(\d{6,})/);
  return m ? m[1] : null;
}

// Paso 1: clappi resuelve el link. Devuelve el item crudo o null.
async function resolveLink(url) {
  const items = await runActorItems(config.fbResolverActor, {
    postUrls: [url],
    proxyConfiguration: { useApifyProxy: true },
  });
  return (items || []).find((it) => it && (it.realId || it.shortcode)) || null;
}

// Paso 2: premiumscraper con la URL canónica trae el media completo (video HD / imágenes). Null si falla.
async function fetchMedia(pageId, realId) {
  const canonical = `https://www.facebook.com/${pageId}/posts/${realId}`;
  const items = await runActorItems(config.fbPostActor, {
    facebook_urls: [{ url: canonical }],
    include_individual_posts: true,
    posts_count: 1,
  });
  return (items || []).find((it) => it && (it.post_id || it.id)) || null;
}

function textOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.text || null; // premiumscraper devuelve message como { text, __typename }
}

// Scrapea un solo contenido por URL. Devuelve el objeto normalizado o null si no se pudo extraer.
export async function scrapeFacebookPostByUrl(url) {
  const resolved = await resolveLink(url);
  if (!resolved) return null;
  const realId = (resolved.realId || '').toString() || null;
  const pageId = pageIdOf(resolved);

  // Media completa (video HD) vía premiumscraper si tenemos con qué armar la canónica.
  let media = null;
  if (realId && pageId) {
    try {
      media = await fetchMedia(pageId, realId);
    } catch (e) {
      console.error(`[fb post] premiumscraper falló para ${pageId}/${realId}: ${e.message}`);
    }
  }

  const videoHd = media ? (first(media.video_urls_hd) || first(media.video_urls_sd)) : null;
  const imageUrl = (media && (media.primary_image_url || first(media.image_urls))) || resolved.thumbnailUrl || null;

  return {
    postId: realId || (resolved.shortcode || '').toString() || null,
    pageId,
    pageName: resolved.authorName || media?.profile_name || null,
    pageUrl: resolved.authorUrl || media?.profile_url || (pageId ? `https://www.facebook.com/profile.php?id=${pageId}` : null),
    message: resolved.caption || textOf(media?.message) || null,
    title: media?.title || media?.seo_title || null,
    videoHd,
    imageUrl,
    destino: media?.primary_attachment_target_url || first(media?.attachment_target_urls) || null,
    views: resolved.views ?? media?.video_view_count_total ?? null,
    permalink: resolved.url || media?.permalink_url || url,
    datePosted: resolved.datePosted || null,
  };
}

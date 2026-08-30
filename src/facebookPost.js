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
// Solo numérico a propósito: es lo que Fuentes usa para armar profile.php?id=<pageId>.
function pageIdOf(resolved) {
  if (resolved.authorId && /^\d{6,}$/.test(String(resolved.authorId))) return String(resolved.authorId);
  const m = (resolved.authorUrl || '').match(/(\d{6,})\/?$/) || (resolved.authorUrl || '').match(/(\d{6,})/);
  return m ? m[1] : null;
}

// El identificador que va en la URL canónica del post: facebook.com/<ref>/posts/<realId>.
// Facebook acepta ahí tanto el id numérico como el nombre de usuario, y eso es lo que faltaba:
// clappi devuelve `authorId: null` SIEMPRE, así que el id numérico solo aparece cuando la página
// no tiene nombre de usuario (facebook.com/people/Nombre/<id>/). Con páginas tipo
// facebook.com/Area8Marketing/ esto daba null, el paso 2 se saltaba EN SILENCIO y el post
// quedaba guardado sin link de CTA, sin video HD y marcado como "Imagen" aunque fuera video.
// Medido en producción: 22 de 22 posts de páginas con nombre de usuario salieron mochos, contra
// 39 de 39 completos en las de id numérico.
function pageRefOf(resolved) {
  const numerico = pageIdOf(resolved);
  if (numerico) return numerico;
  const delUrl = ((resolved.authorUrl || '').match(/facebook\.com\/([^/?#]+)/i) || [])[1] || '';
  const vanity = ((resolved.author || '').trim() || delUrl).replace(/^@/, '');
  // 'people', 'pages' y 'profile.php' son segmentos de ruta, no la cuenta.
  if (/^(people|pages|profile\.php|share|watch|reel|videos?)$/i.test(vanity)) return null;
  return /^[A-Za-z0-9.\-_]{3,}$/.test(vanity) ? vanity : null;
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
async function fetchMedia(pageRef, realId) {
  const canonical = `https://www.facebook.com/${pageRef}/posts/${realId}`;
  const items = await runActorItems(config.fbPostActor, {
    facebook_urls: [{ url: canonical }],
    include_individual_posts: true,
    posts_count: 1,
  });
  return (items || []).find((it) => it && (it.post_id || it.id)) || null;
}

// Desenvuelve el redirector de Facebook: l.facebook.com/l.php?u=<url codificada>&h=…
function desenvolverLink(u) {
  try {
    const url = new URL(u);
    if (/(^|\.)facebook\.com$/i.test(url.hostname) && url.pathname === '/l.php') {
      return url.searchParams.get('u') || u;
    }
  } catch {
    /* no es una URL válida: se devuelve tal cual y el filtro de abajo la descarta */
  }
  return u;
}

// ¿El target apunta al propio post en vez de al destino del anuncio?
function esAutoReferencia(u) {
  try {
    const { hostname, pathname } = new URL(u);
    if (!/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i.test(hostname)) return false;
    return /^\/(reel|watch|photo|permalink\.php|story\.php)/i.test(pathname)
      || /\/(posts|videos|photos)\//i.test(pathname);
  } catch {
    return false;
  }
}

// El destino REAL del CTA. premiumscraper mete en attachment_target_urls tanto el link del
// anuncio como el propio post, y `primary_attachment_target_url` es casi siempre el post:
// tomarlo tal cual guardaba un "destino" que solo devuelve al mismo video. Medido en producción:
// los 39 posts que tenían link guardado apuntaban al reel, ninguno a la landing. El link bueno
// va en la lista, envuelto en el redirector l.facebook.com.
function destinoDe(media) {
  const candidatos = [media?.primary_attachment_target_url, ...(media?.attachment_target_urls || [])]
    .filter(Boolean)
    .map(desenvolverLink);
  return candidatos.find((u) => !esAutoReferencia(u)) || null;
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
  const pageRef = pageRefOf(resolved);

  // Media completa (video HD) vía premiumscraper si tenemos con qué armar la canónica.
  // Sin este paso el post se guarda a medias, así que cuando no corre se dice por qué: antes
  // se saltaba en silencio y el síntoma ("me llegó el anuncio sin el link del CTA") aparecía
  // días después, ya en el dashboard.
  let media = null;
  if (realId && pageRef) {
    try {
      media = await fetchMedia(pageRef, realId);
    } catch (e) {
      console.error(`[fb post] premiumscraper falló para ${pageRef}/${realId}: ${e.message}`);
    }
    if (!media) console.warn(`[fb post] ${url}: sin media de premiumscraper → sin link de CTA ni video HD`);
  } else {
    console.warn(`[fb post] ${url}: no pude identificar la página (realId=${realId}) → se omite premiumscraper`);
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
    destino: destinoDe(media),
    views: resolved.views ?? media?.video_view_count_total ?? null,
    permalink: resolved.url || media?.permalink_url || url,
    datePosted: resolved.datePosted || null,
  };
}

// Trae UN post/video/anuncio específico de Facebook por su link directo (share/p, share/r,
// share/v, /videos/, /reel/, /watch, fb.watch, permalink) usando premiumscraper/facebook-posts-scraper.
// Devuelve el video HD + copy + métricas de ESE contenido, sin traer toda la página del anunciante.
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

// Normaliza el item de premiumscraper a un shape simple que consume syncSinglePostAsAd.
function normalize(p) {
  const videoHd = first(p.video_urls_hd) || first(p.video_urls_sd) || null;
  return {
    postId: (p.post_id || p.id || '').toString() || null,
    pageName: p.profile_name || null,
    pageUrl: p.profile_url || null,
    message: p.message || p.message_text || null,
    title: p.title || p.seo_title || null,
    videoHd,
    imageUrl: p.primary_image_url || first(p.image_urls) || null,
    destino: p.primary_attachment_target_url || first(p.attachment_target_urls) || null,
    views: p.video_view_count_total ?? null,
    reactions: p.reaction_count_total ?? null,
    comments: p.comment_count_total ?? null,
    shares: p.share_count_total ?? null,
    permalink: p.permalink_url || p.url || null,
    datePosted: p.creation_time ? new Date(p.creation_time * 1000).toISOString() : (p.date_posted || null),
  };
}

// Scrapea un solo contenido por URL. Devuelve el objeto normalizado o null si no se pudo extraer.
export async function scrapeFacebookPostByUrl(url) {
  const items = await runActorItems(config.fbPostActor, {
    facebook_urls: [url],
    include_individual_posts: true,
    posts_count: 1,
  });
  const p = (items || []).find((it) => it && !it.error && (it.post_id || it.id));
  return p ? normalize(p) : null;
}

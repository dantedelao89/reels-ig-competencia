// Dispara el actor apify/instagram-reel-scraper para varios creadores en UNA sola corrida.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

// Corre el actor para una lista de usernames a la vez (el actor procesa cada uno por separado,
// aplicando resultsLimit por perfil). onlyPostsNewerThan es global para toda la corrida.
export async function scrapeCreators({ usernames, resultsLimit, onlyPostsNewerThan }) {
  const input = {
    username: usernames,
    resultsLimit,
    skipPinnedPosts: false,
  };
  if (onlyPostsNewerThan) input.onlyPostsNewerThan = onlyPostsNewerThan;

  const items = await runActorItems(config.actorId, input);
  return items.filter((it) => it && it.shortCode && !it.error);
}

// Scrapea UN contenido de Instagram por su URL directa (reel, post o carrusel). Usa el actor general
// que soporta los 3 tipos y devuelve el mismo shape (shortCode, caption, videoUrl, audioUrl, etc.).
export async function scrapeInstagramUrl(url) {
  const isReel = /\/reels?\//i.test(url);
  const input = {
    directUrls: [url],
    resultsType: isReel ? 'reels' : 'posts',
    resultsLimit: 1,
  };
  const items = await runActorItems(config.igUrlActorId, input);
  return items.filter((it) => it && it.shortCode && !it.error);
}

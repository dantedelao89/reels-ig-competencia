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

// Bandeja de historias de 24h de una o varias cuentas. Los highlights se piden aparte (v1 no los usa).
// El actor cobra PLANO por usuario, así que da igual que la cuenta tenga 3 historias o 30.
//
// OJO: este actor NO está roto si lo ves fallar al instante con
// `ValidationError: meta.origin ... input_value='MCP'`. Su SDK de Python no conoce el origen 'MCP',
// así que truena si se lanza desde el conector MCP. Desde apify-client (como aquí) funciona.
export async function scrapeStories(usernames) {
  const items = await runActorItems(config.storiesActorId, {
    usernames,
    includeStories: true,
    includeHighlights: false,
    expandHighlightItems: false,
    compactOutput: true,
  });
  // El dataset incluye un registro recordType:'summary' que no es una cuenta.
  return items.filter((it) => it && it.recordType !== 'summary' && it.username);
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

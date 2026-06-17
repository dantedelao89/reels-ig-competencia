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

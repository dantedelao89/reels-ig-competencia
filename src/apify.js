// Dispara el actor apify/instagram-reel-scraper para un creador y devuelve los items.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

// Corre el actor para un solo creador y espera a que termine.
// onlyPostsNewerThan: fecha ISO o relativo ("3 months"); si null, se omite.
export async function scrapeCreatorReels({ username, resultsLimit, onlyPostsNewerThan }) {
  const input = {
    username: [username],
    resultsLimit,
    skipPinnedPosts: false,
  };
  if (onlyPostsNewerThan) input.onlyPostsNewerThan = onlyPostsNewerThan;

  const items = await runActorItems(config.actorId, input);
  // Descarta items de error que el actor a veces incluye.
  return items.filter((it) => it && it.shortCode && !it.error);
}

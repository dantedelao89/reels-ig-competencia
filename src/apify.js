// Dispara el actor apify/instagram-reel-scraper para un creador y devuelve los items.

import { ApifyClient } from 'apify-client';
import { config } from './config.js';

const client = new ApifyClient({ token: config.apifyToken });

// Corre el actor para un solo creador y espera a que termine.
// onlyPostsNewerThan: fecha ISO o relativo ("3 months"); si null, se omite.
export async function scrapeCreatorReels({ username, resultsLimit, onlyPostsNewerThan }) {
  const input = {
    username: [username],
    resultsLimit,
    skipPinnedPosts: false,
  };
  if (onlyPostsNewerThan) input.onlyPostsNewerThan = onlyPostsNewerThan;

  const run = await client.actor(config.actorId).call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  // Descarta items de error que el actor a veces incluye.
  return items.filter((it) => it && it.shortCode && !it.error);
}

// Dispara apify/facebook-ads-scraper en modo batched: varias páginas (anunciantes) en UNA corrida.
// Devuelve los items crudos de la Meta Ad Library (activos + inactivos, todos los países).

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

const ADS_ACTOR = 'apify/facebook-ads-scraper';

// urls: array de URLs de páginas de Facebook. resultsLimit: máximo de anuncios por URL.
export async function scrapeFacebookAds({ urls, resultsLimit }) {
  const input = {
    startUrls: urls.map((u) => ({ url: u })),
    resultsLimit: resultsLimit || config.adsBatchMaxResults,
  };
  const items = await runActorItems(ADS_ACTOR, input);
  // Cada item es un anuncio con adArchiveID. Filtramos los que traen error/sin id.
  return (items || []).filter((it) => it && it.adArchiveID && !it.error);
}

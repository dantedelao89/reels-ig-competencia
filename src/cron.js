// Punto de entrada para el Cron de Railway: corre una vez y termina.

import { runScrape } from './scrape.js';

runScrape()
  .then((result) => {
    console.log('Resultado:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Falló la corrida:', err);
    process.exit(1);
  });

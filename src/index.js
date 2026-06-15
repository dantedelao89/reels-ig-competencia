// Servidor web (Railway): expone el disparo manual vía webhook y un health check.

import express from 'express';
import { config } from './config.js';
import { runScrape } from './scrape.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Disparo manual. Protegido con un secreto en el header o en query (?secret=).
app.post('/scrape', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  try {
    const result = await runScrape();
    res.json(result);
  } catch (err) {
    console.error('Error en /scrape:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`Servicio escuchando en puerto ${config.port}`);
});

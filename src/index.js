// Servidor web (Railway): expone el disparo manual vía webhook y un health check.

import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { runScrape } from './scrape.js';
import { scrapeCreatorReels } from './apify.js';
import { transcribeAudio } from './transcribe.js';

const app = express();
app.use(express.json());

// Evita que el cron y un disparo manual corran a la vez (o dos crons solapados).
let running = false;
async function runGuarded(origen) {
  if (running) {
    console.log(`[${origen}] omitido: ya hay una corrida en curso`);
    return { ok: false, error: 'Ya hay una corrida en curso' };
  }
  running = true;
  try {
    return await runScrape();
  } finally {
    running = false;
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// DIAGNÓSTICO TEMPORAL: scrapea 1 reel y prueba la transcripción, devolviendo el error crudo.
app.get('/transcribe-test', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  const out = { hasKey: !!config.openrouterApiKey, model: config.transcribeModel, format: config.transcribeFormat };
  try {
    const items = await scrapeCreatorReels({
      username: req.query.user || 'soyenriquerocha',
      resultsLimit: 1,
      onlyPostsNewerThan: '1 year',
    });
    const it = items[0];
    out.shortCode = it?.shortCode;
    out.hasAudioUrl = !!it?.audioUrl;
    if (!it?.audioUrl) return res.json({ ok: false, error: 'reel sin audioUrl', ...out });
    const text = await transcribeAudio(it.audioUrl);
    res.json({ ok: true, textPreview: (text || '').slice(0, 300), ...out });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message, ...out });
  }
});

// Disparo manual. Protegido con un secreto en el header o en query (?secret=).
app.post('/scrape', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  try {
    const result = await runGuarded('manual');
    res.json(result);
  } catch (err) {
    console.error('Error en /scrape:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`Servicio escuchando en puerto ${config.port}`);

  if (config.enableCron) {
    if (!cron.validate(config.cronSchedule)) {
      console.error(`CRON_SCHEDULE inválido: "${config.cronSchedule}" — cron desactivado`);
      return;
    }
    cron.schedule(
      config.cronSchedule,
      async () => {
        console.log(`[cron] disparando corrida (${config.cronSchedule} ${config.cronTimezone})`);
        try {
          const result = await runGuarded('cron');
          console.log('[cron] resultado:', JSON.stringify(result));
        } catch (err) {
          console.error('[cron] error:', err.message);
        }
      },
      { timezone: config.cronTimezone }
    );
    console.log(`Cron interno activo: "${config.cronSchedule}" (${config.cronTimezone})`);
  }
});

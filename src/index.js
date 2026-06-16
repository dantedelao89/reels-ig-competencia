// Servidor web (Railway): expone el disparo manual vía webhook y un health check.

import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { runScrape } from './scrape.js';

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

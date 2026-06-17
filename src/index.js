// Servidor web (Railway): expone el disparo manual vía webhook y un health check.

import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { runScrape } from './scrape.js';
import { runScrapeYoutube } from './scrapeYoutube.js';
import { backfillSubtitles } from './backfill.js';
import { tgSend, isAllowed } from './telegram.js';

const app = express();
app.use(express.json());

// Corre Instagram y (si está activo) YouTube en una sola pasada.
async function runAll() {
  const instagram = await runScrape();
  const youtube = config.enableYoutube ? await runScrapeYoutube() : null;
  return { ok: true, instagram, youtube };
}

// Evita que el cron y un disparo manual corran a la vez (o dos crons solapados).
let running = false;
async function runGuarded(origen) {
  if (running) {
    console.log(`[${origen}] omitido: ya hay una corrida en curso`);
    return { ok: false, error: 'Ya hay una corrida en curso' };
  }
  running = true;
  try {
    return await runAll();
  } finally {
    running = false;
  }
}

// Resume el resultado de una corrida (IG + YT) en texto para Telegram.
function formatResult(r) {
  if (!r.ok) return `❌ Error: ${r.error}`;
  const parts = [];
  if (r.instagram) {
    const lines = (r.instagram.details || []).map((d) =>
      d.error ? `• ${d.grupo}: error` : `• ${d.grupo}: ${d.inserted} nuevos`
    );
    parts.push(`📸 *Instagram* — ${r.instagram.inserted} nuevos\n${lines.join('\n')}`);
  }
  if (r.youtube) {
    const lines = (r.youtube.details || []).map((d) =>
      d.error ? `• ${d.grupo}: error` : `• ${d.grupo}: ${d.inserted} nuevos`
    );
    parts.push(`▶️ *YouTube* — ${r.youtube.inserted} nuevos\n${lines.join('\n')}`);
  }
  return `✅ *Corrida lista*\n\n${parts.join('\n\n')}`;
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

// Backfill manual de subtítulos para videos ya guardados sin subtítulos.
app.post('/backfill-subtitles', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  try {
    const result = await backfillSubtitles();
    res.json(result);
  } catch (err) {
    console.error('Error en /backfill-subtitles:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Webhook de Telegram: recibe mensajes del bot y procesa comandos.
app.post('/telegram/webhook', async (req, res) => {
  if (config.telegramWebhookSecret) {
    const token = req.get('x-telegram-bot-api-secret-token');
    if (token !== config.telegramWebhookSecret) return res.sendStatus(401);
  }
  res.sendStatus(200); // responder rápido SIEMPRE para que Telegram no reintente

  const msg = req.body?.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const cmd = msg.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();

  if (!isAllowed(chatId)) {
    await tgSend(
      chatId,
      `🔒 No autorizado.\nTu chat ID es: \`${chatId}\`\nPídele al admin que lo agregue a *TELEGRAM_ALLOWED_CHAT_IDS* en Railway.`
    );
    return;
  }

  if (cmd === '/start' || cmd === '/help') {
    await tgSend(chatId, '🤖 *Reels IG Competencia*\n\n/scrape — disparar una corrida ahora\n/status — estado del servicio');
  } else if (cmd === '/status') {
    await tgSend(chatId, running ? '⏳ Hay una corrida en curso.' : '✅ Listo. Sin corridas en curso.');
  } else if (cmd === '/scrape') {
    if (running) {
      await tgSend(chatId, '⏳ Ya hay una corrida en curso, espera a que termine.');
      return;
    }
    await tgSend(chatId, '🔄 Iniciando scrape de la competencia… te aviso al terminar.');
    runGuarded('telegram')
      .then((r) => tgSend(chatId, formatResult(r)))
      .catch((e) => tgSend(chatId, `❌ Error: ${e.message}`));
  } else {
    await tgSend(chatId, 'Comando no reconocido. Usa /scrape o /help.');
  }
});

app.listen(config.port, () => {
  console.log(`Servicio escuchando en puerto ${config.port}`);
  if (config.telegramBotToken) {
    console.log(`Bot de Telegram activo (${config.telegramAllowedChatIds.length} chat IDs autorizados)`);
  }

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

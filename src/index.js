// Servidor web (Railway): expone el disparo manual vía webhook y un health check.

import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { runScrape } from './scrape.js';
import { runScrapeYoutube, runScrapeYoutubeChannel } from './scrapeYoutube.js';
import { refreshVideoVariants } from './youtubeVariants.js';
import { runScrapeAds } from './scrapeAds.js';
import { backfillSubtitles } from './backfill.js';
import { resetApifySpend, getApifySpend } from './apifyRun.js';
import { tgSend, isAllowed } from './telegram.js';
import { getYoutubeAudioUrl } from './youtubeAudio.js';
import { transcribeAudio } from './transcribe.js';
import { translateToSpanish } from './translate.js';
import { updateRowById, supabaseEnabled } from './supabase.js';

const app = express();
app.use(express.json());

// Guarda el resultado de la última corrida para poder consultarlo aunque el HTTP del webhook
// se corte por timeout del edge (corridas largas).
let lastRun = null;

// Corre Instagram y (si está activo) YouTube en una sola pasada, midiendo el gasto de Apify.
async function runAll() {
  resetApifySpend();
  const startedAt = new Date().toISOString();
  const instagram = await runScrape();
  const youtube = config.enableYoutube ? await runScrapeYoutube() : null;
  const result = { ok: true, startedAt, apifyUsd: getApifySpend(), instagram, youtube };
  lastRun = result;
  return result;
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

// Guard independiente para el pipeline de ads (puede correr en paralelo al orgánico).
let runningAds = false;
async function runAdsGuarded(origen, opts = {}) {
  if (runningAds) {
    console.log(`[${origen}] ads omitido: ya hay una corrida de ads en curso`);
    return { ok: false, error: 'Ya hay una corrida de ads en curso' };
  }
  runningAds = true;
  try {
    return await runScrapeAds(opts);
  } finally {
    runningAds = false;
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

// Resultado de la última corrida (incluye gasto de Apify). Útil cuando el webhook se corta por timeout.
app.get('/last-run', (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  res.json(lastRun || { ok: false, error: 'Aún no hay corridas registradas' });
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

// Disparo manual del pipeline de ads. Protegido con el secreto.
app.post('/scrape-ads', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  try {
    const url = req.body?.url;
    const result = await runAdsGuarded('manual', url ? { onlyUrl: url } : {});
    res.json(result);
  } catch (err) {
    console.error('Error en /scrape-ads:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Re-scrape manual de UN canal de YouTube (cuando el cron no lo alcanzó). Protegido con el secreto.
app.post('/scrape-channel', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  const url = req.body?.url;
  if (!url) return res.status(400).json({ ok: false, error: 'url requerida' });
  try {
    const result = await runScrapeYoutubeChannel(url);
    res.json(result);
  } catch (err) {
    console.error('Error en /scrape-channel:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Busca variantes A/B (portada/título) de UN video: re-scrapea el feed del canal con proxy fresco
// y, si YouTube sirve una variante nueva, la guarda (máx 3). Disparado por botón en DISECTA.
app.post('/scrape-video', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  const videoId = req.body?.videoId;
  if (!videoId) return res.status(400).json({ ok: false, error: 'videoId requerido' });
  try {
    const result = await refreshVideoVariants(videoId);
    res.json(result);
  } catch (err) {
    console.error('Error en /scrape-video:', err);
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

// Transcripción manual bajo demanda (la dispara DISECTA). Baja el audio del video con un actor
// de Apify y lo transcribe con el mismo modelo de los reels. Solo YouTube (IG ya se transcribe).
app.post('/transcribe', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  const { platform, id, url } = req.body || {};
  if (platform !== 'yt' || !id || !url) {
    return res.status(400).json({ ok: false, error: 'Faltan platform=yt, id y url válidos' });
  }
  if (!config.enableTranscription) {
    return res.status(400).json({ ok: false, error: 'Transcripción deshabilitada (falta OPENROUTER_API_KEY)' });
  }
  try {
    const audioUrl = await getYoutubeAudioUrl(url);
    if (!audioUrl) throw new Error('No se obtuvo audio del video');
    const text = await transcribeAudio(audioUrl);
    if (!text) throw new Error('La transcripción quedó vacía');
    if (supabaseEnabled()) await updateRowById('yt_videos', id, { subtitulos: text });
    console.log(`[transcribe] yt ${id} → ${text.length} chars`);
    res.json({ ok: true, text });
  } catch (err) {
    console.error(`[transcribe] error ${id}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Traducción manual de una transcripción a español (botón en DISECTA). Recibe el texto desde el
// dashboard (ya lo tiene cargado), lo traduce con Gemini 2.5 Flash y lo guarda en la columna traduccion.
app.post('/translate', async (req, res) => {
  if (config.triggerSecret) {
    const provided = req.get('x-trigger-secret') || req.query.secret;
    if (provided !== config.triggerSecret) {
      return res.status(401).json({ ok: false, error: 'No autorizado' });
    }
  }
  const { platform, id, text } = req.body || {};
  if ((platform !== 'yt' && platform !== 'ig') || !id || !text) {
    return res.status(400).json({ ok: false, error: 'Faltan platform (yt|ig), id y text válidos' });
  }
  if (!config.enableTranscription) {
    return res.status(400).json({ ok: false, error: 'OpenRouter no configurado (falta OPENROUTER_API_KEY)' });
  }
  try {
    const translated = await translateToSpanish(text);
    if (!translated) throw new Error('La traducción quedó vacía');
    const table = platform === 'yt' ? 'yt_videos' : 'ig_reels';
    if (supabaseEnabled()) await updateRowById(table, id, { traduccion: translated });
    console.log(`[translate] ${platform} ${id} → ${translated.length} chars`);
    res.json({ ok: true, text: translated });
  } catch (err) {
    console.error(`[translate] error ${id}:`, err.message);
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

  // Cron del pipeline de ads (8am CDMX), independiente del orgánico.
  // enableAdsCron permite apagar SOLO esta corrida diaria sin tocar el scrape manual.
  if (config.enableAds && config.enableCron && config.enableAdsCron) {
    if (cron.validate(config.adsCronSchedule)) {
      cron.schedule(
        config.adsCronSchedule,
        async () => {
          console.log(`[cron-ads] disparando corrida de ads (${config.adsCronSchedule} ${config.cronTimezone})`);
          try {
            const result = await runAdsGuarded('cron');
            console.log('[cron-ads] resultado:', JSON.stringify(result));
          } catch (err) {
            console.error('[cron-ads] error:', err.message);
          }
        },
        { timezone: config.cronTimezone }
      );
      console.log(`Cron de ads activo: "${config.adsCronSchedule}" (${config.cronTimezone})`);
    } else {
      console.error(`ADS_CRON_SCHEDULE inválido: "${config.adsCronSchedule}" — cron de ads desactivado`);
    }
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

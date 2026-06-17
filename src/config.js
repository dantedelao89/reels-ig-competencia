// Carga y valida la configuración desde variables de entorno.

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return v;
}

export const config = {
  apifyToken: required('APIFY_TOKEN'),
  airtableToken: required('AIRTABLE_TOKEN'),
  airtableBaseId: required('AIRTABLE_BASE_ID'),

  // Nombres de tabla (overridables; defaults coinciden con la base "Benchmarking Dante")
  creatorsTable: process.env.CREATORS_TABLE || 'Creadores',
  reelsTable: process.env.REELS_TABLE || 'Reels',

  // Ejecución de actores Apify (compartido). Las corridas son secuenciales (1 a la vez), así que
  // nunca se excede el cupo de memoria de la cuenta (32 GB). Estos parámetros blindan el caso de
  // que el cupo esté lleno por otros actores externos: se reintenta con espera.
  apifyRunMemoryMb: Number(process.env.APIFY_RUN_MEMORY_MB || 0), // 0 = usar el default del actor
  apifyMaxRetries: Number(process.env.APIFY_MAX_RETRIES || 4),
  apifyRetryBaseMs: Number(process.env.APIFY_RETRY_BASE_MS || 30000), // 30s, 60s, 90s…

  // Actor de Apify (Instagram)
  actorId: process.env.APIFY_ACTOR_ID || 'apify/instagram-reel-scraper',

  // Reels máximos por creador si la columna "Reels por corrida" está vacía
  defaultResultsLimit: Number(process.env.DEFAULT_RESULTS_LIMIT || 30),

  // Si un creador nunca se ha corrido, qué tan atrás traer (ej. "3 months")
  firstRunLookback: process.env.FIRST_RUN_LOOKBACK || '3 months',

  // ---- YouTube (búsqueda por palabra clave y por canal) ----
  youtubeActorId: process.env.YT_ACTOR_ID || 'streamers/youtube-scraper',
  searchesTable: process.env.YT_SEARCHES_TABLE || 'Búsquedas YT',
  channelsTable: process.env.YT_CHANNELS_TABLE || 'Canales YT',
  videosTable: process.env.YT_VIDEOS_TABLE || 'Videos YT',
  // Videos por búsqueda si la columna está vacía
  youtubeDefaultMaxResults: Number(process.env.YT_DEFAULT_MAX_RESULTS || 5),
  // Si una búsqueda nunca se ha corrido, qué tan atrás traer
  youtubeFirstRunLookback: process.env.YT_FIRST_RUN_LOOKBACK || '7 days',
  // Bajar subtítulos nativos de YouTube y guardarlos
  youtubeDownloadSubtitles: process.env.YT_DOWNLOAD_SUBTITLES !== 'false',
  // Si está false, no corre la parte de YouTube
  enableYoutube: process.env.ENABLE_YOUTUBE !== 'false',

  // Secreto para proteger el endpoint manual POST /scrape
  triggerSecret: process.env.TRIGGER_SECRET || '',

  // Transcripción vía OpenRouter (opcional). Se activa solo si hay API key.
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  enableTranscription:
    process.env.ENABLE_TRANSCRIPTION !== 'false' && !!process.env.OPENROUTER_API_KEY,
  transcribeModel: process.env.TRANSCRIBE_MODEL || 'openai/gpt-4o-mini-transcribe',
  transcribeFormat: process.env.TRANSCRIBE_FORMAT || 'm4a', // audioUrl de IG = AAC en mp4
  maxTranscribeBytes: Number(process.env.MAX_TRANSCRIBE_BYTES || 24 * 1024 * 1024), // 24 MB
  transcribeTimeoutMs: Number(process.env.TRANSCRIBE_TIMEOUT_MS || 120000),

  // Telegram (opcional): disparo manual desde el bot. Se activa solo si hay token.
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramAllowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Secreto que valida que el webhook venga de Telegram (reusa TRIGGER_SECRET por defecto).
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || process.env.TRIGGER_SECRET || '',

  // Cron interno: el mismo servicio se auto-dispara según este horario.
  // ENABLE_CRON=false para apagarlo. CRON_SCHEDULE en formato cron (5 campos).
  enableCron: process.env.ENABLE_CRON !== 'false',
  cronSchedule: process.env.CRON_SCHEDULE || '0 9 * * *', // 9:00 todos los días (CDMX)
  cronTimezone: process.env.CRON_TZ || 'America/Mexico_City',

  port: Number(process.env.PORT || 3000),
};

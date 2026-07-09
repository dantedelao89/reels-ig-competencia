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
  // Actor para scrapear UNA URL directa (post/reel/carrusel) al agregar contenido ad-hoc desde DISECTA.
  igUrlActorId: process.env.APIFY_IG_URL_ACTOR || 'apify/instagram-scraper',

  // Reels máximos por creador si la columna "Reels por corrida" está vacía
  defaultResultsLimit: Number(process.env.DEFAULT_RESULTS_LIMIT || 30),

  // Si un creador nunca se ha corrido, qué tan atrás traer (ej. "3 months")
  firstRunLookback: process.env.FIRST_RUN_LOOKBACK || '3 months',

  // --- Modo batched (todas las fuentes en 1-2 corridas por plataforma) ---
  // maxResults global por fuente (un solo valor para toda la corrida batched)
  igBatchMaxResults: Number(process.env.IG_BATCH_MAX_RESULTS || 5),
  // Ventana de fecha para fuentes YA corridas antes (cubre 1-2 días perdidos del cron)
  igRecentLookback: process.env.IG_RECENT_LOOKBACK || '2 days',

  // ---- YouTube (búsqueda por palabra clave y por canal) ----
  youtubeActorId: process.env.YT_ACTOR_ID || 'streamers/youtube-scraper',
  searchesTable: process.env.YT_SEARCHES_TABLE || 'Búsquedas YT',
  channelsTable: process.env.YT_CHANNELS_TABLE || 'Canales YT',
  videosTable: process.env.YT_VIDEOS_TABLE || 'Videos YT',
  // Videos por búsqueda si la columna está vacía
  youtubeDefaultMaxResults: Number(process.env.YT_DEFAULT_MAX_RESULTS || 5),
  // Si una búsqueda/canal nunca se ha corrido, qué tan atrás traer
  youtubeFirstRunLookback: process.env.YT_FIRST_RUN_LOOKBACK || '7 days',
  // Batched: maxResults global por fuente, shorts global, y ventana para fuentes ya corridas
  youtubeBatchMaxResults: Number(process.env.YT_BATCH_MAX_RESULTS || 3),
  youtubeBatchMaxShorts: Number(process.env.YT_BATCH_MAX_SHORTS || 0),
  youtubeRecentLookback: process.env.YT_RECENT_LOOKBACK || '2 days',
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
  // Tope de descarga del audio. Con troceo soportamos audios grandes (videos largos), así que
  // el tope es generoso; solo evita bajar archivos absurdos a memoria.
  maxTranscribeBytes: Number(process.env.MAX_TRANSCRIBE_BYTES || 300 * 1024 * 1024), // 300 MB
  transcribeTimeoutMs: Number(process.env.TRANSCRIBE_TIMEOUT_MS || 120000),
  // Traducción manual de transcripciones a español (botón en DISECTA). Modelo barato vía OpenRouter.
  translateModel: process.env.TRANSLATE_MODEL || 'google/gemini-2.5-flash',
  // Si el audio supera este tamaño, se trocea con ffmpeg en segmentos antes de transcribir
  // (OpenRouter rechaza con 502 audios muy largos en una sola llamada). Reels IG quedan debajo.
  transcribeChunkThresholdBytes: Number(process.env.TRANSCRIBE_CHUNK_THRESHOLD_BYTES || 15 * 1024 * 1024), // 15 MB
  transcribeChunkSeconds: Number(process.env.TRANSCRIBE_CHUNK_SECONDS || 600), // 10 min por trozo

  // Telegram (opcional): disparo manual desde el bot. Se activa solo si hay token.
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramAllowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Secreto que valida que el webhook venga de Telegram (reusa TRIGGER_SECRET por defecto).
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || process.env.TRIGGER_SECRET || '',

  // Slack (opcional): slash command /scrape <url> desde el workspace. Firma cada request con
  // este secreto (Basic Information → Signing Secret de la Slack App).
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || '',

  // --- Espejo en Supabase (opcional): alimenta el dashboard de curación. ---
  // Se activa solo si hay URL + service key. Nunca rompe el flujo de Airtable (errores se loguean).
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  igReelsTable: process.env.SUPABASE_IG_TABLE || 'ig_reels',
  ytVideosTable: process.env.SUPABASE_YT_TABLE || 'yt_videos',

  // --- Cloudflare R2 (opcional): rehospeda thumbnails para que no expiren (las de IG caducan). ---
  // Se activa solo si están las 4 credenciales. Sin esto, thumbnail_url queda null y el dashboard
  // cae a thumbnail_original (la URL efímera de IG).
  r2AccountId: process.env.R2_ACCOUNT_ID || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2Bucket: process.env.R2_BUCKET || 'competencia-media',
  // URL pública del bucket (dominio r2.dev o dominio propio). Necesaria para servir las imágenes.
  r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL || '',

  // --- Pipeline Ads (Meta Ad Library vía apify/facebook-ads-scraper) ---
  enableAds: process.env.ENABLE_ADS !== 'false',
  advertisersTable: process.env.ADVERTISERS_TABLE || 'Anunciantes',
  adsTable: process.env.ADS_TABLE || 'Anuncios',
  adsBatchMaxResults: Number(process.env.ADS_BATCH_MAX_RESULTS || 30),
  // Ventana del cron diario de ads: solo anuncios recientes (el histórico completo se trae con
  // el botón manual "Scrapear ahora", que NO aplica ventana). Mantiene barato el costo diario.
  adsRecentLookback: process.env.ADS_RECENT_LOOKBACK || '10 days',
  adsMetaAdsTable: process.env.SUPABASE_ADS_TABLE || 'meta_ads',
  // Actor de ads: bovi expone collation_id (agrupación oficial de Meta para deduplicar) + is_scaled
  // (anuncios ganadores) + longevity_score. Requiere países explícitos (no acepta "todos").
  adsActor: process.env.ADS_ACTOR || 'bovi/meta-ads-library-scraper',
  adsCountries: (process.env.ADS_COUNTRIES || 'MX,ES').split(',').map((c) => c.trim()).filter(Boolean),
  adsActiveStatus: process.env.ADS_ACTIVE_STATUS || 'active', // active | inactive | all
  adsMaxResults: Number(process.env.ADS_MAX_RESULTS || 200),
  // Actor auxiliar solo para resolver el page_id real desde la URL del anunciante (onlyTotal, ~$0).
  adsPageIdResolver: process.env.ADS_PAGEID_RESOLVER || 'apify/facebook-ads-scraper',
  // Cron de ads: diario a las 8am CDMX (separado del orgánico de las 9am).
  adsCronSchedule: process.env.ADS_CRON_SCHEDULE || '0 8 * * *',
  // Apaga SOLO el cron de ads (el scrape manual desde DISECTA sigue funcionando).
  // Útil para no gastar en la corrida diaria de ads (~$1.6/día). ENABLE_ADS_CRON=false.
  enableAdsCron: process.env.ENABLE_ADS_CRON !== 'false',

  // Cron interno: el mismo servicio se auto-dispara según este horario.
  // ENABLE_CRON=false para apagarlo. CRON_SCHEDULE en formato cron (5 campos).
  enableCron: process.env.ENABLE_CRON !== 'false',
  cronSchedule: process.env.CRON_SCHEDULE || '0 9 * * *', // 9:00 todos los días (CDMX)
  cronTimezone: process.env.CRON_TZ || 'America/Mexico_City',

  port: Number(process.env.PORT || 3000),
};

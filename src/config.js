// Carga y valida la configuración desde variables de entorno.

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno requerida: ${name}`);
  return v;
}

export const config = {
  apifyToken: required('APIFY_TOKEN'),

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
  // Actor de historias (bandeja de 24h). Cobra plano por usuario (~$0.0065) + arranque (~$0.0013).
  storiesActorId: process.env.APIFY_STORIES_ACTOR || 'goat255/instagram-stories-highlights-scraper',

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

  // ---- TikTok (videos de cuentas) ----
  // Dos actores, como en Instagram: uno para cuentas y otro para una URL de video suelta.
  tiktokActorId: process.env.TT_ACTOR_ID || 'clockworks/tiktok-profile-scraper',
  tiktokUrlActorId: process.env.TT_URL_ACTOR || 'clockworks/tiktok-video-scraper',
  tiktokDefaultMaxResults: Number(process.env.TT_DEFAULT_MAX_RESULTS || 5),
  tiktokBatchMaxResults: Number(process.env.TT_BATCH_MAX_RESULTS || 3),
  // OJO: la documentación del actor dice que acepta un número suelto de días, pero su validación
  // exige "N days" (o una fecha ISO), igual que YouTube. Un número pelado da error de input.
  tiktokFirstRunLookback: process.env.TT_FIRST_RUN_LOOKBACK || '7 days',
  tiktokRecentLookback: process.env.TT_RECENT_LOOKBACK || '2 days',
  // Subtítulos que TikTok ya trae (gratis). Transcribir con IA se hace a pedido desde el detalle.
  tiktokDownloadSubtitles: process.env.TT_DOWNLOAD_SUBTITLES !== 'false',
  // Igual que enableYoutube: TikTok entra en la corrida cuando Dante la dispara. Que algo corra
  // SOLO no depende de esto sino del cron, y los crons están pausados (CRONS_PAUSED en index.js).
  enableTiktok: process.env.ENABLE_TIKTOK !== 'false',

  // ---- X / Twitter (posts de cuentas) ----
  // UN SOLO actor cubre las dos rutas: `username` para una cuenta y `lookup_post_ids` para un
  // post suelto. Se eligió danek por una razón medida: es el único de los cinco probados que
  // devuelve el TEXTO COMPLETO. El más popular (apidojo/tweet-scraper) corta en 280 caracteres
  // y en estas cuentas el prompt entero vive justo después del corte; kaitoeasyapi sí trae el
  // texto pero inyecta ~14 filas de publicidad propia por corrida y las cobra (15x su precio).
  xActorId: process.env.X_ACTOR_ID || 'danek/twitter-scraper',
  xDefaultMaxResults: Number(process.env.X_DEFAULT_MAX_RESULTS || 20),
  xBatchMaxResults: Number(process.env.X_BATCH_MAX_RESULTS || 20),
  // El actor NO tiene filtro de fecha (a diferencia de TikTok/YouTube): la única defensa contra
  // volver a pagar por lo mismo es el dedup por post_id, que ya hace ingestX.
  enableX: process.env.ENABLE_X !== 'false',
  // El MP4 de video.twimg.com se descarga directo y sin login, así que a diferencia de TikTok
  // el video sí se archiva en R2: es lo que hace que se pueda descargar desde el dashboard
  // aunque X deje de servirlo.
  xRehostVideo: process.env.X_REHOST_VIDEO !== 'false',

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

  // --- Regenerador de carruseles (Wavespeed + visión vía OpenRouter) ---
  // Se activa solo si hay WAVESPEED_API_KEY. La generación es bajo demanda desde DISECTA.
  wavespeedApiKey: process.env.WAVESPEED_API_KEY || '',
  // Modelo de visión: lee las láminas del carrusel ajeno y revisa las generadas (barato).
  regenVisionModel: process.env.REGEN_VISION_MODEL || 'google/gemini-2.5-flash',
  // Modelo que escribe (titulares, guion, interpretación de instrucciones). Es env var a
  // propósito: si el id no existe en OpenRouter, llm.js cae al de visión y lo avisa.
  regenWriterModel: process.env.REGEN_WRITER_MODEL || 'anthropic/claude-sonnet-4.5',
  // Cuántos slides se generan en paralelo (cada uno tarda 3-6 min en gpt-image-2).
  regenConcurrency: Number(process.env.REGEN_CONCURRENCY || 3),
  // Modelo que revisa cada lámina generada (visión, barato).
  regenQaModel: process.env.REGEN_QA_MODEL || 'google/gemini-2.5-flash',
  // Tope de reintentos por lámina cuando el auto-QA la rechaza (acota el costo).
  regenQaMaxRetries: Number(process.env.REGEN_QA_MAX_RETRIES || 2),
  // Tope de láminas por carrusel.
  regenMaxLaminas: Number(process.env.REGEN_MAX_LAMINAS || 14),

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

  // --- Supabase: destino primario del contenido scrapeado y fuente del dashboard de curación. ---
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  igReelsTable: process.env.SUPABASE_IG_TABLE || 'ig_reels',
  ytVideosTable: process.env.SUPABASE_YT_TABLE || 'yt_videos',
  igStoriesTable: process.env.SUPABASE_IG_STORIES_TABLE || 'ig_stories',
  tiktokVideosTable: process.env.SUPABASE_TIKTOK_TABLE || 'tiktok_videos',
  xPostsTable: process.env.SUPABASE_X_TABLE || 'x_posts',

  // --- Fuentes (Supabase, reemplaza a Airtable Creadores/Canales YT/Búsquedas YT/Anunciantes) ---
  igCreatorsTable: process.env.SUPABASE_IG_CREATORS_TABLE || 'ig_creators',
  ytChannelsTable: process.env.SUPABASE_YT_CHANNELS_TABLE || 'yt_channels',
  ytSearchesTable: process.env.SUPABASE_YT_SEARCHES_TABLE || 'yt_searches',
  fbAdvertisersTable: process.env.SUPABASE_FB_ADVERTISERS_TABLE || 'fb_advertisers',
  tiktokCreatorsTable: process.env.SUPABASE_TIKTOK_CREATORS_TABLE || 'tiktok_creators',
  xCreatorsTable: process.env.SUPABASE_X_CREATORS_TABLE || 'x_creators',

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
  // Traer UN post/video/anuncio específico por su link directo (sin traer toda la página). Cadena
  // de 2 actores: fbResolverActor (clappi) resuelve el link corto/compartido → realId + page id +
  // copy + thumbnail; luego fbPostActor (premiumscraper) con la URL canónica → video_urls_hd HD.
  fbResolverActor: process.env.FB_RESOLVER_ACTOR || 'clappi/facebook-posts-reels-scraper',
  fbPostActor: process.env.FB_POST_ACTOR || 'premiumscraper/facebook-posts-scraper',
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

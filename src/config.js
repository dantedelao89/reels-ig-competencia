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

  // Actor de Apify
  actorId: process.env.APIFY_ACTOR_ID || 'apify/instagram-reel-scraper',

  // Reels máximos por creador si la columna "Reels por corrida" está vacía
  defaultResultsLimit: Number(process.env.DEFAULT_RESULTS_LIMIT || 30),

  // Si un creador nunca se ha corrido, qué tan atrás traer (ej. "3 months")
  firstRunLookback: process.env.FIRST_RUN_LOOKBACK || '3 months',

  // Secreto para proteger el endpoint manual POST /scrape
  triggerSecret: process.env.TRIGGER_SECRET || '',

  // Cron interno: el mismo servicio se auto-dispara según este horario.
  // ENABLE_CRON=false para apagarlo. CRON_SCHEDULE en formato cron (5 campos).
  enableCron: process.env.ENABLE_CRON !== 'false',
  cronSchedule: process.env.CRON_SCHEDULE || '0 16 * * *', // PRUEBA: 16:00 (luego volver a 8am)
  cronTimezone: process.env.CRON_TZ || 'America/Mexico_City',

  port: Number(process.env.PORT || 3000),
};

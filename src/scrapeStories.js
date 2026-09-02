// Captura manual de la bandeja de historias de 24h de un creador y la archiva para siempre.
//
// Las historias caducan en Instagram a las 24h, así que este archivo solo puede crecer con lo que
// se capture a tiempo: lo que no se captura hoy no se recupera nunca. Por eso el media se rehospeda
// a R2 en el momento y, si eso falla, la fila se guarda igual con su hora (ver syncStories).

import { config } from './config.js';
import { scrapeStories, fallóElActor } from './apify.js';
import { getCreatorByUsername, updateCreatorStoriesRun } from './sources.js';
import { getExistingStoryIds, syncStories } from './supabase.js';

// Margen del dedup: una historia de IG no puede tener más de 24h, así que 3 días sobran y la
// consulta se mantiene diminuta aunque el archivo acumule decenas de miles de filas.
const VENTANA_DEDUP_DIAS = 3;

const COSTO_ARRANQUE = 0.0013;
const COSTO_POR_CUENTA = 0.0065;
// El actor de respaldo, medido: ~$0.10 por cuenta (13x el primario).
const COSTO_RESPALDO_POR_CUENTA = 0.102;

export async function runScrapeInstagramStories(usernameOrUrl) {
  const startedAt = new Date().toISOString();
  const creator = await getCreatorByUsername(usernameOrUrl);
  if (!creator) {
    return { ok: false, error: `No se encontró el creador: ${usernameOrUrl}. Agrégalo primero en Fuentes.` };
  }
  const creador = creator.username.replace(/^@/, '').toLowerCase();
  let costoEstimadoUsd = Math.round((COSTO_ARRANQUE + COSTO_POR_CUENTA) * 10000) / 10000;

  let rec;
  try {
    const records = await scrapeStories([creador]);
    rec = records[0];
  } catch (err) {
    console.error(`[historias ${creador}] ERROR:`, err.message);
    return { ok: false, error: err.message };
  }

  // "No pude" del scraper y "la cuenta no se puede ver" son cosas DISTINTAS, y confundirlas hacía
  // que un scraper roto se reportara como si la cuenta tuviera la culpa. Cuando el actor no llega a
  // Instagram se devuelve ok:false, que es lo que es: un fallo nuestro, no información sobre ella.
  if (!rec || fallóElActor(rec)) {
    const detalle = rec?.errorMessage ? ` (${rec.errorMessage})` : '';
    console.error(`[historias] ${creador}: el scraper no pudo llegar a Instagram${detalle}`);
    return {
      ok: false,
      creador,
      falloDelScraper: true,
      error: `El scraper no pudo llegar a Instagram${detalle}. No es que la cuenta no exista: reintenta en un rato.`,
      costoEstimadoUsd,
    };
  }
  // Privada o sin historias SÍ es información sobre la cuenta, no un error.
  if (rec.isAccessible === false) {
    console.log(`[historias] ${creador}: no accesible (privada=${!!rec.isPrivate})`);
    return {
      ok: true, creador, accesible: false, privada: !!rec.isPrivate,
      encontradas: 0, nuevas: 0,
      mensaje: rec.isPrivate ? 'La cuenta es privada' : 'La cuenta no es accesible ahora mismo',
      costoEstimadoUsd,
    };
  }

  const todas = Array.isArray(rec.stories) ? rec.stories.filter((s) => s?.id && s.takenAt) : [];
  if (!todas.length) {
    console.log(`[historias] ${creador}: sin historias activas (actor ${rec.actor || 'primario'})`);
    await marcarCorrida(creator.recordId, startedAt);
    return {
      ok: true, creador, accesible: true, encontradas: 0, nuevas: 0,
      // El respaldo no distingue "sin historias" de "privada o inexistente": se dice, no se inventa.
      mensaje: rec.indeterminado
        ? 'Sin historias activas ahora mismo (o la cuenta es privada: el scraper de respaldo no las distingue)'
        : 'Sin historias activas ahora mismo',
      costoEstimadoUsd,
    };
  }

  // Dedup: solo las que no estén ya archivadas pasan por R2 y por el upsert.
  const desde = new Date(Date.now() - VENTANA_DEDUP_DIAS * 24 * 3600 * 1000).toISOString();
  const existentes = await getExistingStoryIds(creador, desde);
  const nuevas = todas.filter((s) => !existentes.has(String(s.id)));

  if (!nuevas.length) {
    console.log(`[historias] ${creador}: ${todas.length} encontradas, 0 nuevas (todas ya archivadas)`);
    await marcarCorrida(creator.recordId, startedAt);
    return {
      ok: true, creador, accesible: true,
      encontradas: todas.length, nuevas: 0, yaArchivadas: todas.length,
      rehospedadas: 0, fallidas: 0, costoEstimadoUsd,
    };
  }

  let synced = 0;
  let rehosted = 0;
  let fallidas = 0;
  try {
    const r = await syncStories([{ username: creador, userId: rec.userId, stories: nuevas }], {
      scrapedAtIso: startedAt,
      proyecto: creator.project,
    });
    synced = r.synced;
    rehosted = r.rehosted;
    fallidas = r.fallidas;
  } catch (err) {
    console.error(`[historias ${creador}] error al guardar:`, err.message);
    return { ok: false, error: err.message };
  }

  // El respaldo cuesta ~13x: si corrió, el número que se reporta tiene que decirlo.
  if (rec.actor === 'respaldo') costoEstimadoUsd = COSTO_RESPALDO_POR_CUENTA;

  console.log(
    `[historias] ${creador}: ${todas.length} encontradas, ${synced} nuevas, ${rehosted} archivadas` +
      (fallidas ? `, ${fallidas} sin archivar` : '')
  );
  await marcarCorrida(creator.recordId, startedAt);

  return {
    ok: true, creador, accesible: true,
    encontradas: todas.length,
    nuevas: synced,
    yaArchivadas: todas.length - nuevas.length,
    rehospedadas: rehosted,
    fallidas,
    costoEstimadoUsd,
    actor: rec.actor || 'primario',
  };
}

async function marcarCorrida(recordId, iso) {
  try {
    await updateCreatorStoriesRun(recordId, iso);
  } catch (e) {
    console.error(`[historias lastRun] ${e.message}`);
  }
}

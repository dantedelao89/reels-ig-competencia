// Orquestación de TikTok: trae los videos de las cuentas activas (split nuevos/recientes por
// ventana de fecha), deduplica por video_id e inserta solo lo nuevo, asignando Proyecto.
// Molde: scrapeYoutube.js.

import { config } from './config.js';
import {
  getActiveTiktokCreators,
  getTiktokCreatorByUsername,
  createTiktokCreator,
  updateTiktokCreatorLastRun,
} from './sources.js';
import { scrapeTiktokProfiles, scrapeTiktokUrls, fetchSubtitles, normalizeTiktokHandle } from './tiktokApify.js';
import { syncTiktok, getExistingTiktokIds } from './supabase.js';

// Inserta los videos nuevos. resolve(item) → { project }. Devuelve cuántos insertó.
async function ingestTiktok(items, existing, startedAt, resolve) {
  const fresh = items.filter((it) => it.id && !existing.has(String(it.id)));
  if (fresh.length === 0) return 0;
  const { synced, rehosted, conTexto } = await syncTiktok(fresh, {
    scrapedAtIso: startedAt,
    resolve,
    textOf: (it) => fetchSubtitles(it.videoMeta?.subtitleLinks),
  });
  fresh.forEach((it) => existing.add(String(it.id)));
  console.log(`[TT supabase] sincronizados=${synced} thumbnails=${rehosted} con_texto=${conTexto}`);
  return synced;
}

// Corrida completa de todas las cuentas activas, en dos grupos: las que nunca se han corrido
// (ventana amplia) y las que sí (ventana corta, para cubrir días perdidos).
export async function runScrapeTiktok() {
  const startedAt = new Date().toISOString();
  const creators = await getActiveTiktokCreators();
  if (!creators.length) return { ok: true, cuentas: 0, inserted: 0, details: [] };

  const existing = await getExistingTiktokIds();
  const projByHandle = new Map(creators.map((c) => [normalizeTiktokHandle(c.username), c.project]));
  const resolve = (it) => ({ project: projByHandle.get(normalizeTiktokHandle(it.authorMeta?.name)) });

  const grupos = [
    { grupo: 'nuevas', fuentes: creators.filter((c) => !c.lastRun), lookback: config.tiktokFirstRunLookback },
    { grupo: 'recientes', fuentes: creators.filter((c) => c.lastRun), lookback: config.tiktokRecentLookback },
  ].filter((g) => g.fuentes.length);

  const details = [];
  let inserted = 0;
  for (const g of grupos) {
    try {
      const items = await scrapeTiktokProfiles({
        usernames: g.fuentes.map((c) => c.username),
        resultsPerPage: config.tiktokBatchMaxResults,
        oldestPostDateUnified: g.lookback,
      });
      const n = await ingestTiktok(items, existing, startedAt, resolve);
      inserted += n;
      details.push({ grupo: g.grupo, fuentes: g.fuentes.length, scraped: items.length, inserted: n });
      console.log(`[TT ${g.grupo}] cuentas=${g.fuentes.length} scrapeados=${items.length} nuevos=${n}`);
    } catch (err) {
      console.error(`[TT ${g.grupo}] ERROR:`, err.message);
      details.push({ grupo: g.grupo, fuentes: g.fuentes.length, error: err.message });
    }
  }

  for (const c of creators) {
    try {
      await updateTiktokCreatorLastRun(c.recordId, startedAt);
    } catch (e) {
      console.error(`[TT lastRun ${c.username}] ${e.message}`);
    }
  }
  return { ok: true, cuentas: creators.length, inserted, details };
}

// Re-scrape manual de UNA cuenta (botón de Fuentes). Ventana amplia para "ponerse al día".
export async function runScrapeTiktokCreator(usernameOrUrl) {
  const startedAt = new Date().toISOString();
  const creator = await getTiktokCreatorByUsername(usernameOrUrl);
  if (!creator) {
    return { ok: false, error: `No se encontró la cuenta de TikTok: ${usernameOrUrl}`, inserted: 0 };
  }
  const existing = await getExistingTiktokIds();
  const resolve = () => ({ project: creator.project });
  try {
    const items = await scrapeTiktokProfiles({
      usernames: [creator.username],
      resultsPerPage: Math.max(creator.resultsLimit || config.tiktokDefaultMaxResults, 10),
      oldestPostDateUnified: '30 days',
    });
    const inserted = await ingestTiktok(items, existing, startedAt, resolve);
    console.log(`[TT manual] ${creator.username} scrapeados=${items.length} nuevos=${inserted}`);
    try {
      await updateTiktokCreatorLastRun(creator.recordId, startedAt);
    } catch (e) {
      console.error(`[TT manual lastRun] ${e.message}`);
    }
    return { ok: true, cuenta: creator.username, inserted };
  } catch (err) {
    console.error(`[TT manual ${creator.username}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
}

// UN video por su URL. Da de alta la cuenta como fuente si no la teníamos, y fuerza upsert
// (Set vacío) para que re-pegar la misma URL siempre actualice.
export async function runScrapeTiktokUrl(url) {
  const startedAt = new Date().toISOString();
  if (!/tiktok\.com/i.test(url || '')) {
    return { ok: false, error: 'La URL no es de TikTok', inserted: 0 };
  }
  try {
    const items = await scrapeTiktokUrls([url]);
    if (!items.length) return { ok: false, error: 'No se pudo leer ese video de TikTok', inserted: 0 };
    const item = items[0];
    const handle = normalizeTiktokHandle(item.authorMeta?.name || url);

    let creator = handle ? await getTiktokCreatorByUsername(handle) : null;
    let cuentaNueva = false;
    if (!creator && handle) {
      try {
        creator = await createTiktokCreator(handle);
        cuentaNueva = true;
        console.log(`[TT url] cuenta nueva agregada a Fuentes: ${handle}`);
      } catch (e) {
        console.error(`[TT url] no se pudo dar de alta ${handle}: ${e.message}`);
      }
    }

    const resolve = () => ({ project: creator?.project });
    const inserted = await ingestTiktok(items, new Set(), startedAt, resolve);
    console.log(`[TT url] ${url} video_id=${item.id} actualizado/nuevo=${inserted}`);
    return {
      ok: true,
      inserted,
      videoId: String(item.id),
      creador: handle,
      caption: item.text || null,
      cuentaNueva,
    };
  } catch (err) {
    console.error(`[TT url] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
}

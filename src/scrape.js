// Orquestación Instagram (batched): trae todos los creadores activos en 1-2 corridas del actor
// (una para los nunca corridos con ventana amplia, otra para los ya corridos con ventana corta),
// deduplica por ShortCode, inserta solo lo nuevo, transcribe y hereda Proyecto.

import { config } from './config.js';
import { getActiveCreators, getCreatorByUsername, createCreator, updateCreatorLastRun } from './sources.js';
import { scrapeCreators, scrapeInstagramUrl } from './apify.js';
import { transcribeAudio } from './transcribe.js';
import { syncReels, getExistingShortcodes, updateRowById } from './supabase.js';

// Inserta los reels nuevos de un conjunto de items en Supabase (destino primario) y los
// transcribe después de insertar (necesita el id de Supabase para guardar la transcripción).
// Asigna Proyecto según el creador dueño (projectByUser). Devuelve { inserted, transcribed }.
async function ingestReels(items, existing, startedAt, projectByUser) {
  const fresh = items.filter((it) => it.shortCode && !existing.has(it.shortCode));
  if (fresh.length === 0) return { inserted: 0, transcribed: 0, transcriptionByShort: new Map() };

  const { synced, rehosted, idsByShortcode } = await syncReels(fresh, {
    scrapedAtIso: startedAt,
    projectByUser,
  });
  fresh.forEach((it) => existing.add(it.shortCode));
  console.log(`[IG supabase] sincronizados=${synced} thumbnails_rehospedadas=${rehosted}`);

  let transcribed = 0;
  const transcriptionByShort = new Map();
  if (config.enableTranscription) {
    for (const item of fresh) {
      const id = idsByShortcode.get(item.shortCode);
      if (!item.audioUrl || !id) continue;
      try {
        const text = await transcribeAudio(item.audioUrl);
        if (text) {
          await updateRowById(config.igReelsTable, id, { transcripcion: text });
          transcriptionByShort.set(item.shortCode, text);
          transcribed++;
        }
      } catch (e) {
        console.error(`[IG transcripción ${item.shortCode}] falló: ${e.message}`);
      }
    }
  }

  return { inserted: synced, transcribed, transcriptionByShort };
}

export async function runScrape() {
  const startedAt = new Date().toISOString();
  const creators = await getActiveCreators();
  if (creators.length === 0) {
    return { ok: true, message: 'No hay creadores activos.', creators: 0, inserted: 0, details: [] };
  }

  const existing = await getExistingShortcodes();
  const projectByUser = new Map(creators.map((c) => [c.username.toLowerCase(), c.project]));

  // Dos grupos: nunca corridos (ventana amplia) y ya corridos (ventana corta).
  const groups = [
    { label: 'nuevos', list: creators.filter((c) => !c.lastRun), window: config.firstRunLookback },
    { label: 'recientes', list: creators.filter((c) => c.lastRun), window: config.igRecentLookback },
  ];

  const details = [];
  let totalInserted = 0;
  let totalTranscribed = 0;

  for (const group of groups) {
    if (group.list.length === 0) continue;
    const usernames = group.list.map((c) => c.username);
    try {
      const items = await scrapeCreators({
        usernames,
        resultsLimit: config.igBatchMaxResults,
        onlyPostsNewerThan: group.window,
      });
      const { inserted, transcribed } = await ingestReels(items, existing, startedAt, projectByUser);
      totalInserted += inserted;
      totalTranscribed += transcribed;
      details.push({ grupo: group.label, creadores: usernames.length, scraped: items.length, inserted, transcribed });
      console.log(`[IG ${group.label}] creadores=${usernames.length} scrapeados=${items.length} nuevos=${inserted} transcritos=${transcribed}`);
    } catch (err) {
      console.error(`[IG ${group.label}] ERROR:`, err.message);
      details.push({ grupo: group.label, creadores: usernames.length, error: err.message });
    }
  }

  // Marca la última corrida de todos los creadores activos.
  for (const c of creators) {
    try {
      await updateCreatorLastRun(c.recordId, startedAt);
    } catch (e) {
      console.error(`[IG lastRun ${c.username}] ${e.message}`);
    }
  }

  return { ok: true, creators: creators.length, inserted: totalInserted, transcribed: totalTranscribed, details };
}

// Agrega UN contenido de Instagram (reel/post/carrusel) por su URL directa, pegada en DISECTA.
// Reutiliza todo el pipeline: mapeo, transcripción (si trae audio), R2 y espejo a Supabase.
export async function runScrapeInstagramUrl(url) {
  const startedAt = new Date().toISOString();
  const clean = (url || '').trim();
  if (!/instagram\.com/i.test(clean)) {
    return { ok: false, error: 'URL de Instagram inválida', inserted: 0 };
  }
  const existing = await getExistingShortcodes();
  let items;
  try {
    items = await scrapeInstagramUrl(clean);
  } catch (err) {
    console.error(`[IG url ${clean}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
  if (!items.length) {
    return { ok: true, inserted: 0, message: 'No se pudo extraer contenido de esa URL' };
  }
  // Si el dueño ya es un creador nuestro, hereda su proyecto; si no, lo da de alta como fuente
  // nueva (activa, sin proyecto) para que el próximo cron ya lo cubra solo.
  let projectByUser = new Map();
  try {
    const creators = await getActiveCreators();
    projectByUser = new Map(creators.map((c) => [c.username.toLowerCase(), c.project]));
  } catch (e) {
    console.error(`[IG url] no se pudo leer proyectos de creadores: ${e.message}`);
  }
  const it = items[0];
  let creadorNuevo = false;
  if (it.ownerUsername) {
    const key = it.ownerUsername.toLowerCase();
    if (!projectByUser.has(key)) {
      try {
        const existing = await getCreatorByUsername(it.ownerUsername);
        if (existing) {
          projectByUser.set(key, existing.project);
        } else {
          const created = await createCreator(it.ownerUsername);
          projectByUser.set(key, created.project);
          creadorNuevo = true;
          console.log(`[IG url] creador nuevo agregado a Fuentes: ${it.ownerUsername}`);
        }
      } catch (e) {
        console.error(`[IG url] no se pudo dar de alta al creador ${it.ownerUsername}: ${e.message}`);
      }
    }
  }
  const { inserted, transcribed, transcriptionByShort } = await ingestReels(items, existing, startedAt, projectByUser);
  console.log(`[IG url] ${clean} shortCode=${it.shortCode} nuevo=${inserted} transcrito=${transcribed}`);
  return {
    ok: true,
    inserted,
    transcribed,
    shortCode: it.shortCode,
    creador: it.ownerUsername || null,
    tipo: it.type || null,
    transcripcion: transcriptionByShort.get(it.shortCode) || null,
    creadorNuevo,
  };
}

// Re-scrape manual de UN solo creador de Instagram (disparado desde DISECTA cuando el cron no lo
// alcanzó). Usa una ventana amplia (30 días) y más resultados para "ponerse al día".
export async function runScrapeInstagramCreator(usernameOrUrl) {
  const startedAt = new Date().toISOString();
  const creator = await getCreatorByUsername(usernameOrUrl);
  if (!creator) {
    return { ok: false, error: `No se encontró el creador: ${usernameOrUrl}`, inserted: 0 };
  }
  const existing = await getExistingShortcodes();
  const projectByUser = new Map([[creator.username.toLowerCase(), creator.project]]);
  let inserted = 0;
  let transcribed = 0;
  try {
    const items = await scrapeCreators({
      usernames: [creator.username],
      resultsLimit: Math.max(creator.resultsLimit || config.defaultResultsLimit, 15),
      onlyPostsNewerThan: '30 days',
    });
    const r = await ingestReels(items, existing, startedAt, projectByUser);
    inserted = r.inserted;
    transcribed = r.transcribed;
    console.log(`[IG manual] ${creator.username} scrapeados=${items.length} nuevos=${inserted} transcritos=${transcribed}`);
  } catch (err) {
    console.error(`[IG manual ${creator.username}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
  try {
    await updateCreatorLastRun(creator.recordId, startedAt);
  } catch (e) {
    console.error(`[IG manual lastRun] ${e.message}`);
  }
  return { ok: true, creator: creator.username, inserted, transcribed };
}

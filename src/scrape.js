// Orquestación Instagram (batched): trae todos los creadores activos en 1-2 corridas del actor
// (una para los nunca corridos con ventana amplia, otra para los ya corridos con ventana corta),
// deduplica por ShortCode, inserta solo lo nuevo, transcribe y hereda Proyecto.

import { config } from './config.js';
import {
  getActiveCreators,
  getExistingShortCodes,
  insertReels,
  updateCreatorLastRun,
  updateReelTranscription,
} from './airtable.js';
import { scrapeCreators } from './apify.js';
import { transcribeAudio } from './transcribe.js';
import { syncReels, supabaseEnabled } from './supabase.js';

function mapReel(item, scrapedAtIso, project) {
  const music = item.musicInfo
    ? [item.musicInfo.song_name, item.musicInfo.artist_name].filter(Boolean).join(' — ')
    : '';
  const fields = {
    ShortCode: item.shortCode,
    Creador: item.ownerUsername || '',
    URL: item.url || '',
    Caption: item.caption || '',
    'Fecha publicación': item.timestamp || null,
    Likes: item.likesCount ?? null,
    Comentarios: item.commentsCount ?? null,
    Views: item.videoViewCount ?? item.videoPlayCount ?? null,
    'Duración (seg)': item.videoDuration ?? null,
    Hashtags: (item.hashtags || []).map((h) => `#${h}`).join(' '),
    Mentions: (item.mentions || []).join(' '),
    Tipo: item.productType || item.type || '',
    Música: music,
    Thumbnail: item.displayUrl || '',
    'Video URL': item.videoUrl || '',
    'Scrapeado en': scrapedAtIso,
  };
  if (project) fields.Proyecto = project;
  return fields;
}

// Inserta los reels nuevos de un conjunto de items y los transcribe. Asigna Proyecto según el
// creador dueño (projectByUser). Devuelve { inserted, transcribed }.
async function ingestReels(items, existing, startedAt, projectByUser) {
  const fresh = items.filter((it) => it.shortCode && !existing.has(it.shortCode));
  if (fresh.length === 0) return { inserted: 0, transcribed: 0 };

  const rows = fresh.map((it) =>
    mapReel(it, startedAt, projectByUser.get((it.ownerUsername || '').toLowerCase()))
  );
  const created = await insertReels(rows);
  rows.forEach((r) => existing.add(r.ShortCode));

  let transcribed = 0;
  const transcriptionByShort = new Map();
  if (config.enableTranscription) {
    const itemByShort = new Map(fresh.map((it) => [it.shortCode, it]));
    for (const rec of created) {
      const item = itemByShort.get(rec.shortCode);
      if (!item?.audioUrl) continue;
      try {
        const text = await transcribeAudio(item.audioUrl);
        if (text) {
          await updateReelTranscription(rec.id, text);
          transcriptionByShort.set(rec.shortCode, text);
          transcribed++;
        }
      } catch (e) {
        console.error(`[IG transcripción ${rec.shortCode}] falló: ${e.message}`);
      }
    }
  }

  // Espejo a Supabase (dashboard). Solo los reels nuevos → nunca pisa la capa de curación.
  if (supabaseEnabled()) {
    try {
      const { synced, rehosted } = await syncReels(fresh, {
        scrapedAtIso: startedAt,
        projectByUser,
        transcriptionByShort,
      });
      console.log(`[IG supabase] sincronizados=${synced} thumbnails_rehospedadas=${rehosted}`);
    } catch (e) {
      console.error(`[IG supabase] sync falló: ${e.message}`);
    }
  }

  return { inserted: created.length, transcribed };
}

export async function runScrape() {
  const startedAt = new Date().toISOString();
  const creators = await getActiveCreators();
  if (creators.length === 0) {
    return { ok: true, message: 'No hay creadores activos.', creators: 0, inserted: 0, details: [] };
  }

  const existing = await getExistingShortCodes();
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

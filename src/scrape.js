// Orquestación: por cada creador activo dispara Apify (solo reels nuevos),
// filtra duplicados contra Airtable e inserta únicamente los nuevos.

import { config } from './config.js';
import {
  getActiveCreators,
  getExistingShortCodes,
  insertReels,
  updateCreatorLastRun,
  updateReelTranscription,
} from './airtable.js';
import { scrapeCreatorReels } from './apify.js';
import { transcribeAudio } from './transcribe.js';

// Mapea un item del actor a los campos de la tabla Reels.
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

export async function runScrape() {
  const startedAt = new Date().toISOString();
  const creators = await getActiveCreators();
  if (creators.length === 0) {
    return { ok: true, message: 'No hay creadores activos.', creators: 0, inserted: 0, details: [] };
  }

  const existing = await getExistingShortCodes();
  const details = [];
  let totalInserted = 0;

  for (const creator of creators) {
    const onlyPostsNewerThan = creator.lastRun || config.firstRunLookback;
    try {
      const items = await scrapeCreatorReels({
        username: creator.username,
        resultsLimit: creator.resultsLimit,
        onlyPostsNewerThan,
      });

      const fresh = items.filter((it) => !existing.has(it.shortCode));
      const rows = fresh.map((it) => mapReel(it, startedAt, creator.project));

      let inserted = 0;
      let transcribed = 0;
      if (rows.length > 0) {
        const created = await insertReels(rows);
        inserted = created.length;
        rows.forEach((r) => existing.add(r.ShortCode)); // evita duplicados entre creadores en la misma corrida

        // Transcribe solo los reels recién insertados (los nuevos).
        if (config.enableTranscription) {
          const itemByShort = new Map(fresh.map((it) => [it.shortCode, it]));
          for (const rec of created) {
            const item = itemByShort.get(rec.shortCode);
            if (!item?.audioUrl) continue;
            try {
              const text = await transcribeAudio(item.audioUrl);
              if (text) {
                await updateReelTranscription(rec.id, text);
                transcribed++;
              }
            } catch (e) {
              console.error(`[${creator.username}] transcripción ${rec.shortCode} falló: ${e.message}`);
            }
          }
        }
      }

      await updateCreatorLastRun(creator.recordId, startedAt);
      totalInserted += inserted;
      details.push({ username: creator.username, scraped: items.length, inserted, transcribed });
      console.log(`[${creator.username}] scrapeados=${items.length} nuevos=${inserted} transcritos=${transcribed}`);
    } catch (err) {
      console.error(`[${creator.username}] ERROR:`, err.message);
      details.push({ username: creator.username, error: err.message });
    }
  }

  return { ok: true, creators: creators.length, inserted: totalInserted, details };
}

// Backfill de subtítulos: rellena la columna Subtítulos de los videos ya guardados que están
// vacíos (p. ej. insertados antes del fix). No duplica filas; solo actualiza la columna.

import { getVideosWithoutSubtitles, updateVideoSubtitles } from './airtable.js';
import { scrapeVideosByUrls } from './youtubeApify.js';
import { extractSubtitles } from './scrapeYoutube.js';

export async function backfillSubtitles() {
  const videos = await getVideosWithoutSubtitles();
  if (videos.length === 0) return { ok: true, pending: 0, updated: 0 };

  let updated = 0;
  // Procesa en lotes para no mandar demasiadas URLs en una sola corrida del actor.
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const items = await scrapeVideosByUrls(batch.map((v) => v.url));
    const textById = new Map(items.map((it) => [it.id, extractSubtitles(it.subtitles)]));
    for (const v of batch) {
      const text = textById.get(v.videoId);
      if (text) {
        await updateVideoSubtitles(v.recordId, text);
        updated++;
      }
    }
    console.log(`[backfill] lote ${i / 50 + 1}: ${batch.length} videos, ${updated} actualizados acumulado`);
  }

  return { ok: true, pending: videos.length, updated };
}

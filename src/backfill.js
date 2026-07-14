// Backfill de subtítulos: rellena la columna subtitulos de los videos ya guardados en Supabase
// que están vacíos (p. ej. insertados antes del fix). No duplica filas; solo actualiza la columna.

import { getVideosWithoutSubtitles, updateRowById } from './supabase.js';
import { scrapeVideosByUrls } from './youtubeApify.js';
import { extractSubtitles } from './scrapeYoutube.js';
import { config } from './config.js';

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
      if (!text) continue;
      try {
        await updateRowById(config.ytVideosTable, v.recordId, { subtitulos: text });
        updated++;
      } catch (e) {
        console.error(`[backfill] no se pudo actualizar ${v.videoId}: ${e.message}`);
      }
    }
    console.log(`[backfill] lote ${i / 50 + 1}: ${batch.length} videos, ${updated} actualizados acumulado`);
  }

  return { ok: true, pending: videos.length, updated };
}

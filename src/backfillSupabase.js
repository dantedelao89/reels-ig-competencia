// Backfill: vuelca el histórico de Airtable (Reels + Videos YT) a Supabase una sola vez.
// Idempotente (upsert por shortcode / video_id), así que puede correrse las veces que haga falta.
// No rehospeda thumbnails (las viejas de IG ya expiraron); el sync diario sí las rehospeda a futuro.
//
// Uso:  node src/backfillSupabase.js
//       node src/backfillSupabase.js ig     (solo Instagram)
//       node src/backfillSupabase.js yt     (solo YouTube)

import Airtable from 'airtable';
import { config } from './config.js';
import { supabaseEnabled, upsertReelRows, upsertVideoRows } from './supabase.js';

const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);

function num(v) {
  return v === undefined || v === null || v === '' ? null : Number(v);
}
function str(v) {
  return v === undefined || v === null || v === '' ? null : v.toString();
}

async function backfillReels() {
  const rows = [];
  await base(config.reelsTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const shortcode = str(r.get('ShortCode'));
        if (!shortcode) continue;
        rows.push({
          shortcode,
          creador: str(r.get('Creador')),
          url: str(r.get('URL')),
          video_url: str(r.get('Video URL')),
          caption: str(r.get('Caption')),
          fecha_publicacion: r.get('Fecha publicación') || null,
          likes: num(r.get('Likes')),
          comentarios: num(r.get('Comentarios')),
          views: num(r.get('Views')),
          duracion_seg: num(r.get('Duración (seg)')),
          hashtags: str(r.get('Hashtags')),
          mentions: str(r.get('Mentions')),
          tipo: str(r.get('Tipo')),
          musica: str(r.get('Música')),
          thumbnail_original: str(r.get('Thumbnail')),
          proyecto: str(r.get('Proyecto')),
          transcripcion: str(r.get('Transcripción')),
          scrapeado_en: r.get('Scrapeado en') || null,
        });
      }
      next();
    });
  const n = await upsertReelRows(rows);
  console.log(`[backfill IG] ${n} reels volcados a Supabase`);
  return n;
}

async function backfillVideos() {
  const rows = [];
  await base(config.videosTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const videoId = str(r.get('Video ID'));
        if (!videoId) continue;
        rows.push({
          video_id: videoId,
          titulo: str(r.get('Título')),
          canal: str(r.get('Canal')),
          canal_url: str(r.get('Canal URL')),
          url: str(r.get('URL')),
          fecha_publicacion: r.get('Fecha publicación') || null,
          views: num(r.get('Views')),
          duracion: str(r.get('Duración')),
          hashtags: str(r.get('Hashtags')),
          thumbnail_original: str(r.get('Thumbnail')),
          subtitulos: str(r.get('Subtítulos')),
          proyecto: str(r.get('Proyecto')),
          origen: str(r.get('Origen')),
          scrapeado_en: r.get('Scrapeado en') || null,
        });
      }
      next();
    });
  const n = await upsertVideoRows(rows);
  console.log(`[backfill YT] ${n} videos volcados a Supabase`);
  return n;
}

async function main() {
  if (!supabaseEnabled()) {
    console.error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY).');
    process.exit(1);
  }
  const only = (process.argv[2] || '').toLowerCase();
  if (only !== 'yt') await backfillReels();
  if (only !== 'ig') await backfillVideos();
  console.log('Backfill completo.');
}

main().catch((e) => {
  console.error('Backfill falló:', e.message);
  process.exit(1);
});

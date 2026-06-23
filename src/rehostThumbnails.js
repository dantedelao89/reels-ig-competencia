// Rehost-backfill: recupera a R2 las thumbnails de filas que aún tienen thumbnail_url vacío
// (el histórico volcado por backfillSupabase). Baja thumbnail_original y la sube a R2; si la
// original ya expiró (típico en IG viejas), se salta y deja thumbnail_url en null.
// Idempotente: solo toca filas sin thumbnail_url, así que puede correrse varias veces.
//
// Uso:  node src/rehostThumbnails.js        (IG + YT)
//       node src/rehostThumbnails.js ig
//       node src/rehostThumbnails.js yt

import { config } from './config.js';
import { r2Enabled, rehostImage } from './r2.js';

async function getClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

async function rehostTable(supabase, table, idCol, prefix) {
  const { data, error } = await supabase
    .from(table)
    .select(`${idCol}, thumbnail_original`)
    .is('thumbnail_url', null)
    .not('thumbnail_original', 'is', null)
    .limit(5000);
  if (error) throw new Error(error.message);

  let ok = 0;
  let fail = 0;
  const POOL = 8;
  for (let i = 0; i < data.length; i += POOL) {
    const chunk = data.slice(i, i + POOL);
    await Promise.all(
      chunk.map(async (row) => {
        const id = row[idCol];
        const key = `${prefix}/${id}.jpg`;
        const publicUrl = `${config.r2PublicBaseUrl.replace(/\/$/, '')}/${key}`;
        // 1) Si el objeto YA existe en R2 (p. ej. lo borró el backfill de la BD), solo re-apunta.
        let url = null;
        try {
          const head = await fetch(publicUrl, { method: 'HEAD' });
          if (head.ok) url = publicUrl;
        } catch {
          /* sigue al rehost */
        }
        // 2) Si no existe, baja la original y súbela.
        if (!url) url = await rehostImage(row.thumbnail_original, key);
        if (!url) {
          fail++;
          return;
        }
        const { error: upErr } = await supabase.from(table).update({ thumbnail_url: url }).eq(idCol, id);
        if (upErr) {
          fail++;
          return;
        }
        ok++;
      })
    );
    console.log(`[${table}] ${Math.min(i + POOL, data.length)}/${data.length}  ok=${ok} fail=${fail}`);
  }
  return { total: data.length, ok, fail };
}

async function main() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.error('Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
    process.exit(1);
  }
  if (!r2Enabled()) {
    console.error('R2 no configurado (faltan R2_*).');
    process.exit(1);
  }
  const supabase = await getClient();
  const only = (process.argv[2] || '').toLowerCase();
  if (only !== 'yt') {
    const r = await rehostTable(supabase, config.igReelsTable, 'shortcode', 'thumbnails/ig');
    console.log(`[IG] total=${r.total} rehospedadas=${r.ok} expiradas/fallidas=${r.fail}`);
  }
  if (only !== 'ig') {
    const r = await rehostTable(supabase, config.ytVideosTable, 'video_id', 'thumbnails/yt');
    console.log(`[YT] total=${r.total} rehospedadas=${r.ok} expiradas/fallidas=${r.fail}`);
  }
  console.log('Rehost completo.');
}

main().catch((e) => {
  console.error('Rehost falló:', e.message);
  process.exit(1);
});

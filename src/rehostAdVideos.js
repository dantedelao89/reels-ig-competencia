// Rehost-backfill de videos de anuncios: recorre meta_ads cuyo video_url todavía apunta al CDN
// de Facebook (no a R2) y los rehospeda a R2 (videos/ads/<ad_id>.mp4). Idempotente.
// Uso:  node src/rehostAdVideos.js

import { config } from './config.js';
import { r2Enabled, rehostVideo } from './r2.js';

async function getClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
}

async function main() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.error('Supabase no configurado.');
    process.exit(1);
  }
  if (!r2Enabled()) {
    console.error('R2 no configurado.');
    process.exit(1);
  }
  const base = config.r2PublicBaseUrl.replace(/\/$/, '');
  const supabase = await getClient();

  const { data, error } = await supabase
    .from(config.adsMetaAdsTable)
    .select('id, ad_id, video_url')
    .not('video_url', 'is', null)
    .limit(5000);
  if (error) throw new Error(error.message);

  // Solo los que aún NO están en R2.
  const pending = (data || []).filter((r) => r.video_url && !r.video_url.startsWith(base));
  console.log(`Videos a rehospedar: ${pending.length} (de ${data.length} con video)`);

  let ok = 0;
  let fail = 0;
  const POOL = 4;
  for (let i = 0; i < pending.length; i += POOL) {
    const chunk = pending.slice(i, i + POOL);
    await Promise.all(
      chunk.map(async (row) => {
        const url = await rehostVideo(row.video_url, `videos/ads/${row.ad_id}.mp4`);
        if (!url) {
          fail++;
          return;
        }
        const { error: upErr } = await supabase.from(config.adsMetaAdsTable).update({ video_url: url }).eq('id', row.id);
        if (upErr) {
          fail++;
          return;
        }
        ok++;
      })
    );
    console.log(`  ${Math.min(i + POOL, pending.length)}/${pending.length}  ok=${ok} fail=${fail}`);
  }
  console.log(`Rehost de videos completo. ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error('Rehost de videos falló:', e.message);
  process.exit(1);
});

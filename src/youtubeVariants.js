// Variantes A/B de un video de YouTube: cada clic re-scrapea el FEED del canal (contexto de
// impresión, como abrir en incógnito) con un proxy fresco. Ahí YouTube puede servir una portada
// distinta (hqdefault_custom_1/2/3...) o un título distinto. Si es nueva, la guarda (máx 3).
// Scrapear el video directo NO sirve: devuelve la portada canónica (maxresdefault), siempre igual.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';
import { r2Enabled, rehostImage } from './r2.js';

async function getClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
}

// Extrae la "clave de variante" de la URL de thumbnail de YouTube.
// .../vi/<id>/hqdefault_custom_2.jpg?sqp=... → "hqdefault_custom_2" ; .../maxresdefault.jpg → "maxresdefault"
function variantKey(url) {
  const m = (url || '').match(/\/vi\/[^/]+\/([^/?.]+)/);
  return m ? m[1] : 'default';
}

const MAX_VARIANTS = 3;

export async function refreshVideoVariants(videoId) {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    return { ok: false, error: 'Supabase no configurado' };
  }
  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from('yt_videos')
    .select('id, video_id, canal_url, titulo, thumbnail_url, thumbnail_original, scrapeado_en, variantes')
    .eq('video_id', videoId)
    .single();
  if (error || !row) return { ok: false, error: 'Video no encontrado' };
  if (!row.canal_url) return { ok: false, error: 'El video no tiene canal_url' };

  // Variantes ya guardadas; si está vacío, siembra la variante #1 con la portada/título original.
  let variantes = Array.isArray(row.variantes) ? [...row.variantes] : [];
  if (variantes.length === 0) {
    variantes.push({
      titulo: row.titulo || '',
      key: variantKey(row.thumbnail_original),
      thumbnail: row.thumbnail_url || null,
      visto_en: row.scrapeado_en || new Date().toISOString(),
    });
  }
  if (variantes.length >= MAX_VARIANTS) {
    return { ok: true, added: false, message: 'Ya tiene el máximo de 3 variantes', variantes };
  }

  // Re-scrape del feed del canal (proxy fresco), sin subtítulos.
  const items = await runActorItems(config.youtubeActorId, {
    startUrls: [{ url: row.canal_url }],
    maxResults: 10,
    maxResultsShorts: 0,
    maxResultStreams: 0,
    sortVideosBy: 'NEWEST',
    downloadSubtitles: false,
  });
  const hit = (items || []).find((it) => it && it.id === videoId);
  if (!hit) {
    return { ok: true, added: false, message: 'El video no apareció en el feed reciente del canal', variantes };
  }

  const servedTitle = (hit.title || '').trim();
  const servedKey = variantKey(hit.thumbnailUrl);
  const keys = new Set(variantes.map((v) => v.key));
  const titles = new Set(variantes.map((v) => (v.titulo || '').trim()));
  const isNew = !keys.has(servedKey) || (servedTitle && !titles.has(servedTitle));

  if (!isNew) {
    return { ok: true, added: false, message: 'No encontré nuevas (misma portada y título)', variantes };
  }

  // Rehospeda la portada nueva a R2.
  let thumb = hit.thumbnailUrl || null;
  if (r2Enabled() && thumb) {
    const r = await rehostImage(thumb, `variantes/${videoId}/${servedKey}.jpg`);
    if (r) thumb = r;
  }
  variantes.push({ titulo: servedTitle, key: servedKey, thumbnail: thumb, visto_en: new Date().toISOString() });

  const { error: upErr } = await supabase
    .from('yt_videos')
    .update({ variantes })
    .eq('video_id', videoId);
  if (upErr) return { ok: false, error: upErr.message };

  console.log(`[YT variantes] ${videoId} nueva variante (${servedKey}) total=${variantes.length}`);
  return { ok: true, added: true, message: `¡Nueva variante encontrada! (${variantes.length}/3)`, variantes };
}

// Backfill de los videos de reels de Instagram que se guardaron cuando `video_url` todavía
// apuntaba al CDN de Instagram. Esas URLs MUEREN en ~3 días, así que no basta con rehospedarlas:
// hay que volver a pedirle el reel al actor para que dé una URL viva, y entonces archivarla.
//
// Se hace en UNA corrida del actor con todas las URLs (`directUrls` es un array), no una por reel:
// 50 corridas sueltas costarían ~$0.12 y tardarían media hora; en lote es una fracción de eso.
//
// Idempotente: solo toca los reels cuyo `video_url` no está ya en R2.
//
// Uso:  node src/rehostReelVideos.js [cuántos]     (por defecto 50, los más recientes)

import { config } from './config.js';
import { r2Enabled, rehostVideo } from './r2.js';
import { runActorItems } from './apifyRun.js';
import { getApifySpend, resetApifySpend } from './apifyRun.js';

const LOTE_ACTOR = 25; // el actor acepta muchas URLs, pero en lotes se ve el avance y falla más barato

async function getClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false },
    db: { schema: process.env.SUPABASE_SCHEMA || 'disecta' },
  });
}

// Igual que en syncReels: N en vuelo a la vez, conservando el orden.
function enPool(items, n, fn) {
  const out = new Array(items.length);
  let siguiente = 0;
  return Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = siguiente++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  ).then(() => out);
}

async function main() {
  const cuantos = Number(process.argv[2] || 50);
  if (!config.supabaseUrl || !config.supabaseServiceKey) throw new Error('Supabase no configurado');
  if (!r2Enabled()) throw new Error('R2 no configurado');
  resetApifySpend();

  const supabase = await getClient();
  const base = config.r2PublicBaseUrl.replace(/\/$/, '');

  // Los más recientes primero: son los que Dante está usando.
  const { data, error } = await supabase
    .from(config.igReelsTable)
    .select('id, shortcode, url, video_url, scrapeado_en')
    .not('video_url', 'is', null)
    .not('video_url', 'like', `${base}%`)
    .order('scrapeado_en', { ascending: false })
    .limit(cuantos);
  if (error) throw new Error(error.message);

  const pendientes = (data || []).filter((r) => r.url && r.shortcode);
  console.log(`${pendientes.length} reels por recuperar (de ${data?.length || 0} candidatos)`);
  if (!pendientes.length) return;

  let recuperados = 0;
  let sinVideo = 0;
  let fallidos = 0;

  for (let i = 0; i < pendientes.length; i += LOTE_ACTOR) {
    const lote = pendientes.slice(i, i + LOTE_ACTOR);
    console.log(`\n— lote ${Math.floor(i / LOTE_ACTOR) + 1}: ${lote.length} reels —`);

    let items = [];
    try {
      items = await runActorItems(config.igUrlActorId, {
        directUrls: lote.map((r) => r.url),
        resultsType: 'posts',
        resultsLimit: lote.length,
      });
    } catch (e) {
      console.error(`  el actor falló en este lote: ${e.message}`);
      fallidos += lote.length;
      continue;
    }

    const porShort = new Map(items.filter((it) => it?.shortCode).map((it) => [it.shortCode, it]));

    await enPool(lote, 3, async (fila) => {
      const it = porShort.get(fila.shortcode);
      if (!it) {
        console.warn(`  ${fila.shortcode}: el actor no lo devolvió`);
        fallidos++;
        return;
      }
      if (!it.videoUrl) {
        // Post de imagen o carrusel: no hay video suelto que archivar, y no es un fallo.
        sinVideo++;
        return;
      }
      // rehostVideo se encarga de pegar el audio y de pasar VP9 a H.264.
      const nueva = await rehostVideo(it.videoUrl, `videos/ig/${fila.shortcode}.mp4`, {
        audioUrl: it.audioUrl || null,
      });
      if (!nueva) {
        console.warn(`  ${fila.shortcode}: no se pudo archivar`);
        fallidos++;
        return;
      }
      const { error: e2 } = await supabase
        .from(config.igReelsTable)
        .update({ video_url: nueva, video_original: it.videoUrl })
        .eq('id', fila.id);
      if (e2) {
        console.error(`  ${fila.shortcode}: no se pudo guardar (${e2.message})`);
        fallidos++;
        return;
      }
      recuperados++;
      console.log(`  ✅ ${fila.shortcode}`);
    });
  }

  console.log(
    `\nRecuperados: ${recuperados} · sin video (imagen/carrusel): ${sinVideo} · fallidos: ${fallidos}` +
      ` · gasto Apify: $${getApifySpend().toFixed(4)}`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

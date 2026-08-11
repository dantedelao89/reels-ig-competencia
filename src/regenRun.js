// Generación del Regenerador de carruseles: procesa los slides del plan (limpiar/regenerar) con
// Wavespeed, con pool de concurrencia limitada, persistiendo el estado slide a slide vía la RPC
// regen_patch_slide. Se lanza fire-and-forget desde el endpoint (cada slide tarda 3-6 min); la UI
// hace polling del estado en Supabase.

import { config } from './config.js';
import { getRowByField, regenPatchSlide, setRegen } from './supabase.js';
import { rehostImage, uploadBuffer } from './r2.js';
import { gptImageEdit, qwenEdit, downloadOutput, wavespeedEnabled } from './wavespeed.js';
import { buildCleanPrompt, buildQwenFallbackPrompt } from './regenPrompts.js';

// Descarga una imagen y la devuelve como data URL base64 (input de gpt-image-2/edit).
async function toDataUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`descarga de ${url.slice(0, 60)}… → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Garantiza que la URL fuente del slide viva en R2 (las de IG expiran). Devuelve la URL buena
// o null si la fuente ya murió.
async function ensureR2(url, shortcode, idx) {
  if (!url) return null;
  const base = config.r2PublicBaseUrl.replace(/\/$/, '');
  if (base && url.startsWith(base)) return url;
  return rehostImage(url, `carousels/ig/${shortcode}_${idx}.jpg`);
}

// Normaliza ig_reels.imagenes al formato {tipo, url, poster}.
function normalizeSlides(imagenes) {
  if (!Array.isArray(imagenes)) return [];
  return imagenes.map((x) => (typeof x === 'string' ? { tipo: 'image', url: x } : x));
}

// Procesa UN slide de principio a fin. Nunca lanza: deja el resultado (o el error) en la DB.
async function runSlide(shortcode, slide, srcUrl, refsById) {
  const { idx, accion } = slide;
  try {
    const urlR2 = await ensureR2(srcUrl, shortcode, idx);
    if (!urlR2) throw new Error('Fuente expirada: re-scrapea el post para recuperar el slide');

    let outputUrl;
    let modelo;

    if (accion === 'limpiar') {
      outputUrl = await qwenEdit({ prompt: buildCleanPrompt(), imageUrls: [urlR2] });
      modelo = 'qwen';
    } else {
      // regenerar: base = slide original (o foto CTA de Dante), + referencia de estilo.
      const ref = slide.refId ? refsById.get(slide.refId) : null;
      const esCta = slide.tipoSlide === 'cta';
      if (esCta && !ref) throw new Error('El slide de CTA necesita una referencia tipo "cta" (tu foto)');
      const baseUrl = esCta ? ref.url : urlR2;
      const styleRef = esCta ? null : ref?.url || null;
      const images = [await toDataUrl(baseUrl)];
      if (styleRef) images.push(await toDataUrl(styleRef));
      // La nota del usuario se inyecta al momento de generar (el prompt del plan se armó sin ella,
      // y así los re-tiros con nota nueva no requieren reconstruir el prompt).
      let prompt = slide.prompt || '';
      if (slide.nota && !prompt.includes(slide.nota)) {
        prompt += `\n\nInstrucción adicional del autor (prioritaria): ${slide.nota}`;
      }
      try {
        outputUrl = await gptImageEdit({ prompt, images });
        modelo = 'gpt-image-2';
      } catch (e) {
        if (!e.flagged) throw e;
        // Filtro de contenido → fallback automático a Qwen (comportamiento aprobado por Dante).
        console.log(`[regen ${shortcode}#${idx}] filtro de contenido, fallback a Qwen`);
        const qwenPrompt = buildQwenFallbackPrompt({
          tipoSlide: slide.tipoSlide,
          textoNuevo: slide.textoNuevo,
          nota: slide.nota,
        });
        outputUrl = await qwenEdit({ prompt: qwenPrompt, imageUrls: [baseUrl] });
        modelo = 'qwen';
      }
    }

    // Las URLs de Wavespeed expiran: el output vive en R2. Timestamp para no cachear re-tiros.
    const buf = await downloadOutput(outputUrl);
    const finalUrl = await uploadBuffer(buf, `regen/${shortcode}/${idx}_${Date.now()}.png`);
    if (!finalUrl) throw new Error('No se pudo subir el resultado a R2');

    await regenPatchSlide(shortcode, idx, { estado: 'listo', outputUrl: finalUrl, modelo, error: null });
    console.log(`[regen ${shortcode}#${idx}] listo (${modelo})`);
  } catch (e) {
    console.error(`[regen ${shortcode}#${idx}] error: ${e.message}`);
    await regenPatchSlide(shortcode, idx, { estado: 'error', error: e.message.slice(0, 300) }).catch(() => {});
  }
}

// Valida, marca el carrusel como 'generando' (guard anti doble-lanzamiento con ventana de 15 min
// para reanudar jobs muertos) y devuelve lo que el endpoint responde. El procesamiento real corre
// después en background con runQueue().
export async function startRegeneration(shortcode, indices) {
  if (!wavespeedEnabled()) return { ok: false, status: 400, error: 'Falta WAVESPEED_API_KEY en el scraper' };

  const item = await getRowByField(
    config.igReelsTable,
    'shortcode',
    shortcode,
    'shortcode, imagenes, regen, regen_estado, regen_actualizado'
  );
  if (!item) return { ok: false, status: 404, error: `No existe el carrusel ${shortcode}` };
  if (!Array.isArray(item.regen) || !item.regen.length) {
    return { ok: false, status: 400, error: 'Este carrusel no tiene plan: analízalo primero' };
  }

  const wanted = Array.isArray(indices) && indices.length ? new Set(indices.map(Number)) : null;
  const targets = item.regen.filter(
    (s) => s.accion !== 'copiar' && (wanted ? wanted.has(s.idx) : s.estado !== 'listo')
  );
  if (!targets.length) return { ok: false, status: 400, error: 'No hay slides pendientes de generar' };

  const marked = await setRegen(shortcode, { regen_estado: 'generando' }, { guard: true });
  if (!marked) return { ok: false, status: 409, error: 'Ya hay una generación en curso para este carrusel' };

  for (const s of targets) {
    await regenPatchSlide(shortcode, s.idx, { estado: 'generando', error: null });
  }

  const slides = normalizeSlides(item.imagenes);
  return {
    ok: true,
    launched: targets.length,
    // El endpoint invoca esto en fire-and-forget después de responder.
    run: () => runQueue(shortcode, targets, slides),
  };
}

async function runQueue(shortcode, targets, slides) {
  try {
    const { getRegenRefs } = await import('./supabase.js');
    const refs = await getRegenRefs();
    const refsById = new Map(refs.map((r) => [r.id, r]));

    const queue = [...targets];
    const workers = Array.from({ length: Math.max(1, config.regenConcurrency) }, async () => {
      while (queue.length) {
        const slide = queue.shift();
        if (!slide) break;
        const srcUrl = slides[slide.idx]?.url || null;
        await runSlide(shortcode, slide, srcUrl, refsById);
      }
    });
    await Promise.all(workers);
  } catch (e) {
    console.error(`[regen ${shortcode}] job falló: ${e.message}`);
  } finally {
    await setRegen(shortcode, { regen_estado: 'listo' }).catch(() => {});
    console.log(`[regen ${shortcode}] job terminado`);
  }
}

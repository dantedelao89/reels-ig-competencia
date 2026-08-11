// Etapas B→C→D del regenerador: con el titular elegido escribe el guion, genera cada lámina
// con Wavespeed en un pool acotado, y cada lámina generada pasa por el auto-QA (que puede
// pedir hasta 2 reintentos con una corrección concreta). Se lanza fire-and-forget desde el
// endpoint; la UI sigue el avance por polling de regen_estado + regen_progreso.

import { config } from './config.js';
import {
  getRowByField,
  regenPatchSlide,
  setRegen,
  setMeta,
  setProgreso,
  getRegenRefs,
} from './supabase.js';
import { rehostImage, uploadBuffer } from './r2.js';
import { gptImageEdit, qwenEdit, downloadOutput, wavespeedEnabled } from './wavespeed.js';
import { buildCleanPrompt, buildQwenFallbackPrompt } from './regenPrompts.js';
import { escribirGuion, estimarCosto } from './regenGuion.js';
import { normalizeSlides } from './regenAnalizar.js';
import { revisarLamina } from './regenQA.js';

// Descarga una imagen y la devuelve como data URL base64 (input de gpt-image-2/edit).
async function toDataUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`descarga de ${url.slice(0, 60)}… → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Garantiza que la URL fuente del slide viva en R2 (las de IG expiran).
async function ensureR2(url, shortcode, idx) {
  if (!url) return null;
  const base = config.r2PublicBaseUrl.replace(/\/$/, '');
  if (base && url.startsWith(base)) return url;
  return rehostImage(url, `carousels/ig/${shortcode}_${idx}.jpg`);
}

// Genera una lámina una vez (sin QA). Devuelve {url, modelo}.
async function generarUnaVez(shortcode, slide, urlR2, refsById, correccion) {
  const ref = slide.refId ? refsById.get(slide.refId) : null;
  const esCta = (slide.rol || slide.tipoSlide) === 'cta';
  if (esCta && !ref) throw new Error('El CTA necesita una foto tuya en Referencias (tipo "cta")');

  // El CTA parte de la foto real de Dante; el resto, del slide original + un ancla de estilo.
  const baseUrl = esCta ? ref.url : urlR2;
  const styleRef = esCta ? null : ref?.url || null;
  const images = [await toDataUrl(baseUrl)];
  if (styleRef) images.push(await toDataUrl(styleRef));

  let prompt = slide.prompt || '';
  if (correccion) prompt += `\n\nCORRECCIÓN OBLIGATORIA — el intento anterior falló por esto: ${correccion}`;
  if (slide.nota) prompt += `\n\nInstrucción adicional del autor (prioritaria): ${slide.nota}`;

  try {
    return { url: await gptImageEdit({ prompt, images }), modelo: 'gpt-image-2' };
  } catch (e) {
    if (!e.flagged) throw e;
    // Filtro de contenido → fallback automático a Qwen (comportamiento aprobado por Dante).
    console.log(`[regen ${shortcode}#${slide.idx}] filtro de contenido, fallback a Qwen`);
    const qwenPrompt = buildQwenFallbackPrompt({
      textos: slide.textos || (slide.textoNuevo ? [slide.textoNuevo] : []),
      foto: slide.foto,
      acento: slide.acento,
    });
    return { url: await qwenEdit({ prompt: qwenPrompt, imageUrls: [baseUrl] }), modelo: 'qwen' };
  }
}

// Procesa UN slide de principio a fin, con su bucle de QA. Nunca lanza: deja el resultado
// (o el error) en la base.
async function runSlide(shortcode, slide, srcUrl, refsById) {
  const { idx, accion } = slide;
  try {
    const urlR2 = await ensureR2(srcUrl, shortcode, idx);
    if (!urlR2) throw new Error('Fuente expirada: re-scrapea el post para recuperar el slide');

    let finalUrl = null;
    let modelo = null;
    let correccion = null;
    let qa = null;

    const maxIntentos = accion === 'regenerar' ? config.regenQaMaxRetries + 1 : 1;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      let out;
      if (accion === 'limpiar') {
        out = { url: await qwenEdit({ prompt: buildCleanPrompt(), imageUrls: [urlR2] }), modelo: 'qwen' };
      } else {
        out = await generarUnaVez(shortcode, slide, urlR2, refsById, correccion);
      }

      // Las URLs de Wavespeed expiran: el resultado vive en R2. Timestamp por intento, así
      // los intentos anteriores siguen accesibles.
      const buf = await downloadOutput(out.url);
      finalUrl = await uploadBuffer(buf, `regen/${shortcode}/${idx}_${Date.now()}.png`);
      if (!finalUrl) throw new Error('No se pudo subir el resultado a R2');
      modelo = out.modelo;

      // Solo se revisa lo que lleva texto nuevo hecho por gpt-image. Las limpiezas no tienen
      // texto que verificar, y Qwen comete más erratas por naturaleza: reintentar solo quema.
      if (accion !== 'regenerar') break;
      if (modelo === 'qwen') {
        qa = {
          ok: false,
          problemas: ['generada con Qwen por el filtro de contenido, revísala tú'],
          instruccion: null,
        };
        break;
      }

      await setProgreso(shortcode, {
        paso: 'revisando',
        mensaje: `Revisando la lámina ${idx + 1}${intento > 1 ? ` (intento ${intento})` : ''}`,
      });
      qa = await revisarLamina({ url: finalUrl, slide });
      await regenPatchSlide(shortcode, idx, { qa: { ...qa, intentos: intento, ts: new Date().toISOString() } });
      if (qa.ok || intento >= maxIntentos) break;
      correccion = qa.instruccion;
      console.log(`[regen ${shortcode}#${idx}] QA falló: ${qa.problemas.join('; ')} → reintento ${intento + 1}`);
    }

    await regenPatchSlide(shortcode, idx, {
      estado: 'listo',
      outputUrl: finalUrl,
      modelo,
      error: null,
      ...(qa ? { qa: { ...qa, ts: new Date().toISOString() } } : {}),
    });
    console.log(`[regen ${shortcode}#${idx}] listo (${modelo}${qa && !qa.ok ? ', con aviso' : ''})`);
  } catch (e) {
    console.error(`[regen ${shortcode}#${idx}] error: ${e.message}`);
    await regenPatchSlide(shortcode, idx, { estado: 'error', error: e.message.slice(0, 300) }).catch(() => {});
  }
}

// Pool de generación: N workers consumiendo la misma cola, actualizando el progreso.
async function runQueue(shortcode, targets, slides) {
  const total = targets.length;
  let hechos = 0;
  try {
    const refs = await getRegenRefs();
    const refsById = new Map(refs.map((r) => [r.id, r]));

    await setProgreso(shortcode, { paso: 'generando', mensaje: 'Generando láminas', hechos, total });

    const queue = [...targets];
    const workers = Array.from({ length: Math.max(1, config.regenConcurrency) }, async () => {
      while (queue.length) {
        const slide = queue.shift();
        if (!slide) break;
        await runSlide(shortcode, slide, slides[slide.idx]?.url || null, refsById);
        hechos++;
        await setProgreso(shortcode, { paso: 'generando', mensaje: 'Generando láminas', hechos, total });
      }
    });
    await Promise.all(workers);
  } catch (e) {
    console.error(`[regen ${shortcode}] job falló: ${e.message}`);
  } finally {
    await setRegen(shortcode, { regen_estado: 'listo' }).catch(() => {});
    await setProgreso(shortcode, { paso: 'listo', mensaje: `Listo: ${hechos} de ${total}`, hechos, total });
    console.log(`[regen ${shortcode}] job terminado (${hechos}/${total})`);
  }
}

// --- Entradas públicas ---

// Flujo completo desde el titular elegido: escribe el guion (B) y lanza la generación (C+D).
// Con dry=true solo devuelve el guion, sin gastar en imágenes.
export async function lanzarCarrusel(shortcode, { gancho, brief = null, dry = false } = {}) {
  if (!dry && !wavespeedEnabled()) {
    return { ok: false, status: 400, error: 'Falta WAVESPEED_API_KEY en el scraper' };
  }

  const item = await getRowByField(config.igReelsTable, 'shortcode', shortcode, 'imagenes, regen_meta, regen_estado, regen_actualizado');
  if (!item) return { ok: false, status: 404, error: `No existe el carrusel ${shortcode}` };
  const meta = item.regen_meta;
  if (!meta?.analisis) return { ok: false, status: 400, error: 'Este carrusel aún no se ha leído' };

  if (!dry) {
    const marcado = await setRegen(shortcode, { regen_estado: 'escribiendo' }, { guard: true });
    if (!marcado) return { ok: false, status: 409, error: 'Ya hay un trabajo en curso para este carrusel' };
    await setProgreso(shortcode, { paso: 'escribiendo', mensaje: 'Escribiendo el carrusel completo…' });
  }

  const guion = await escribirGuion(shortcode, { gancho, brief: brief ?? meta.brief });
  if (!guion.ok) {
    if (!dry) await setRegen(shortcode, { regen_estado: 'ganchos' }).catch(() => {});
    return { ok: false, status: 400, error: guion.error };
  }

  if (dry) {
    return { ok: true, dry: true, plan: guion.plan, keyword: guion.keyword, costoEstimado: guion.costoEstimado, avisos: guion.avisos };
  }

  const slides = normalizeSlides(item.imagenes);
  const targets = guion.plan.filter((s) => s.accion !== 'copiar');

  await setMeta(shortcode, {
    ...meta,
    ganchoElegido: gancho,
    ctaVariante: guion.variante,
    keyword: guion.keyword,
    costoEstimado: guion.costoEstimado,
    avisos: guion.avisos,
  });
  await setRegen(shortcode, { regen: guion.plan, regen_estado: 'generando' });

  return {
    ok: true,
    launched: targets.length,
    costoEstimado: guion.costoEstimado,
    avisos: guion.avisos,
    run: () => runQueue(shortcode, targets, slides),
  };
}

// Re-tiro de láminas concretas sobre un plan ya existente (⚙️ detalle e instrucciones).
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
    return { ok: false, status: 400, error: 'Este carrusel no tiene guion todavía' };
  }

  const wanted = Array.isArray(indices) && indices.length ? new Set(indices.map(Number)) : null;
  const targets = item.regen.filter(
    (s) => s.accion !== 'copiar' && (wanted ? wanted.has(s.idx) : s.estado !== 'listo')
  );
  if (!targets.length) return { ok: false, status: 400, error: 'No hay láminas pendientes de generar' };

  const marked = await setRegen(shortcode, { regen_estado: 'generando' }, { guard: true });
  if (!marked) return { ok: false, status: 409, error: 'Ya hay un trabajo en curso para este carrusel' };

  for (const s of targets) {
    await regenPatchSlide(shortcode, s.idx, { estado: 'generando', error: null });
  }

  const slides = normalizeSlides(item.imagenes);
  return {
    ok: true,
    launched: targets.length,
    costoEstimado: estimarCosto(targets),
    run: () => runQueue(shortcode, targets, slides),
  };
}

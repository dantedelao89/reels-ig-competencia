// Plan del Regenerador de carruseles: una llamada de visión (OpenRouter, Gemini 2.5 Flash)
// clasifica cada slide del carrusel, extrae/traduce su texto y el server arma el plan por slide
// (acción + referencia de la biblioteca + prompt). El plan queda en ig_reels.regen para que
// Dante lo revise/edite en DISECTA antes de gastar en generación.

import { config } from './config.js';
import { getRowByField, getRegenRefs, setRegen } from './supabase.js';
import { buildVisionPrompt, buildRegenPrompt, buildCtaPrompt } from './regenPrompts.js';

// Normaliza ig_reels.imagenes (formato viejo: string[], nuevo: {tipo,url,poster}[]) igual que DetailModal.
function normalizeSlides(imagenes) {
  if (!Array.isArray(imagenes)) return [];
  return imagenes.map((x) => (typeof x === 'string' ? { tipo: 'image', url: x } : x));
}

// La visión se pide en lotes pequeños: una salida corta por llamada es mucho menos propensa a
// llegar truncada (pasa de forma no-determinista), y si un lote se rompe no se pierde el resto
// del carrusel. Cada lote se reintenta antes de rendirse.
const VISION_BATCH = 6;
const VISION_TRIES = 3;

// Una llamada de visión sobre un lote de slides. Devuelve el array crudo del modelo.
async function visionBatch(slides) {
  const content = [{ type: 'text', text: buildVisionPrompt(slides.length) }];
  for (const s of slides) {
    content.push({ type: 'image_url', image_url: { url: s.url } });
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.regenVisionModel,
      max_tokens: 30000,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }),
    signal: AbortSignal.timeout(240000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  const choice = json.choices?.[0];
  let text = (choice?.message?.content || '').trim();
  if (!text) throw new Error('la visión devolvió una respuesta vacía');
  // Defensa por si el modelo envuelve el JSON en fences.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const motivo = choice?.finish_reason === 'length' ? 'se quedó sin tokens' : 'llegó cortada';
    throw new Error(`la respuesta ${motivo} (${e.message})`);
  }
  if (!Array.isArray(parsed.slides)) throw new Error('la visión no devolvió slides[]');
  return parsed.slides;
}

// Clasifica todos los slides de imagen. Devuelve un Map por idx original + los avisos de los
// lotes que no se pudieron clasificar (esos slides quedan con valores por defecto, editables).
async function classifySlides(imageSlides) {
  const byIdx = new Map();
  const avisos = [];

  for (let from = 0; from < imageSlides.length; from += VISION_BATCH) {
    const batch = imageSlides.slice(from, from + VISION_BATCH);
    let out = null;
    let ultimoError = '';
    for (let intento = 1; intento <= VISION_TRIES; intento++) {
      try {
        out = await visionBatch(batch);
        break;
      } catch (e) {
        ultimoError = e.message;
        console.warn(`[regen] visión lote ${from}-${from + batch.length - 1} intento ${intento}: ${e.message}`);
        if (intento < VISION_TRIES) await new Promise((r) => setTimeout(r, 2000 * intento));
      }
    }
    if (!out) {
      const nums = batch.map((s) => s.idx + 1).join(', ');
      avisos.push(`No se pudieron analizar los slides ${nums} (${ultimoError}). Quedaron en blanco: edítalos a mano o re-analiza.`);
      continue;
    }
    // El modelo numera dentro del lote; se mapea por posición (su "idx" solo se usa si cuadra).
    out.forEach((c, i) => {
      const original = batch[Number.isInteger(c.idx) && batch[c.idx] ? c.idx : i];
      if (original) byIdx.set(original.idx, c);
    });
  }

  return { byIdx, avisos };
}

// Elige la referencia para un tipo de slide. Para CTA rota entre las fotos de Dante según el idx
// (variedad entre carruseles sin aleatoriedad). Fallback: contenido → cualquiera no-CTA.
function pickRef(refs, tipoSlide, idx) {
  const of = (t) => refs.filter((r) => r.tipo === t);
  if (tipoSlide === 'cta') {
    const ctas = of('cta');
    return ctas.length ? ctas[idx % ctas.length] : null;
  }
  const exact = of(tipoSlide);
  if (exact.length) return exact[idx % exact.length];
  const contenido = of('contenido');
  if (contenido.length) return contenido[0];
  const rest = refs.filter((r) => r.tipo !== 'cta');
  return rest[0] || null;
}

const CLASIF_ACCION = { foto: 'copiar', foto_marca: 'limpiar', diseno: 'regenerar' };

// Costo aproximado por slide (USD): gpt-image-2 medium ~0.07, qwen ~0.02.
export function estimateCost(plan) {
  const n = (a) => plan.filter((s) => s.accion === a).length;
  return Math.round((n('regenerar') * 0.07 + n('limpiar') * 0.02) * 100) / 100;
}

export async function buildRegenPlan(shortcode) {
  if (!config.openrouterApiKey) return { ok: false, error: 'Falta OPENROUTER_API_KEY' };

  const item = await getRowByField(
    config.igReelsTable,
    'shortcode',
    shortcode,
    'id, shortcode, creador, imagenes, regen_estado'
  );
  if (!item) return { ok: false, error: `No existe el carrusel ${shortcode}` };
  if (item.regen_estado === 'generando') {
    return { ok: false, error: 'Este carrusel se está generando ahora mismo; espera a que termine' };
  }

  const slides = normalizeSlides(item.imagenes);
  if (slides.length < 2) return { ok: false, error: 'Este contenido no es un carrusel (menos de 2 slides)' };

  const refs = await getRegenRefs();

  // Los videos no pasan por visión: se copian tal cual (v1) y nacen "listos".
  const imageSlides = slides
    .map((s, idx) => ({ ...s, idx }))
    .filter((s) => s.tipo !== 'video');

  let byIdx = new Map();
  let avisos = [];
  if (imageSlides.length) {
    ({ byIdx, avisos } = await classifySlides(imageSlides));
    if (!byIdx.size) {
      return { ok: false, error: `La visión falló en todos los slides: ${avisos[0] || 'sin detalle'}` };
    }
  }

  const plan = slides.map((s, idx) => {
    if (s.tipo === 'video') {
      return {
        idx,
        tipoMedia: 'video',
        accion: 'copiar',
        tipoSlide: 'foto',
        refId: null,
        textoOriginal: null,
        textoNuevo: null,
        nota: null,
        prompt: null,
        estado: 'listo',
        outputUrl: s.url,
        error: null,
        modelo: null,
      };
    }
    const c = byIdx.get(idx) || {};
    const accion = CLASIF_ACCION[c.clasificacion] || 'regenerar';
    const tipoSlide = accion === 'regenerar' ? c.tipoSlide || 'contenido' : 'foto';
    const ref = accion === 'regenerar' ? pickRef(refs, tipoSlide, idx) : null;
    const base = {
      idx,
      tipoMedia: 'image',
      accion,
      tipoSlide,
      refId: ref?.id || null,
      textoOriginal: c.textoOriginal || null,
      textoNuevo: c.textoNuevo || null,
      nota: null,
      estado: accion === 'copiar' ? 'listo' : 'pendiente',
      outputUrl: accion === 'copiar' ? s.url : null,
      error: null,
      modelo: null,
    };
    base.prompt =
      accion === 'regenerar'
        ? tipoSlide === 'cta'
          ? buildCtaPrompt({ textoNuevo: base.textoNuevo, nota: null })
          : buildRegenPrompt({ tipoSlide, textoNuevo: base.textoNuevo, nota: null })
        : null;
    return base;
  });

  const saved = await setRegen(shortcode, { regen: plan, regen_estado: 'plan' }, { guard: true });
  if (!saved) return { ok: false, error: 'No se pudo guardar el plan (¿se está generando?)' };

  return { ok: true, shortcode, plan, costoEstimado: estimateCost(plan), avisos };
}

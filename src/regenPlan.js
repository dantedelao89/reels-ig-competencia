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

// Llama al modelo de visión con las imágenes por URL y devuelve el JSON parseado.
async function classifySlides(imageSlides) {
  const content = [{ type: 'text', text: buildVisionPrompt(imageSlides.length) }];
  for (const s of imageSlides) {
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
  let text = (json.choices?.[0]?.message?.content || '').trim();
  // Defensa por si el modelo envuelve el JSON en fences.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.slides)) throw new Error('La visión no devolvió slides[]');
  return parsed.slides;
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

  const byIdx = new Map();
  if (imageSlides.length) {
    const classified = await classifySlides(imageSlides);
    // La visión recibe los slides SIN los videos: su "idx" es la posición en imageSlides.
    classified.forEach((c, i) => {
      const original = imageSlides[Number.isInteger(c.idx) && imageSlides[c.idx] ? c.idx : i];
      if (original) byIdx.set(original.idx, c);
    });
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

  return { ok: true, shortcode, plan, costoEstimado: estimateCost(plan) };
}

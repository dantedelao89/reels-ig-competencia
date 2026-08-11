// Etapa E: Dante le habla al carrusel en lenguaje natural ("el 5 más agresivo y sin la foto",
// "cambia el CTA a comenta HOJA", "todos más oscuros") y un LLM lo traduce a cambios concretos
// por lámina, que se aplican y se regeneran solo esas.

import { config } from './config.js';
import { getRowByField, regenPatchSlide, setMeta } from './supabase.js';
import { chatJSON } from './llm.js';
import { buildInstruccionPrompt, buildImagenPrompt, buildCtaImagenPrompt } from './regenPrompts.js';

export async function interpretarInstruccion(shortcode, texto) {
  const t = (texto || '').trim();
  if (!t) return { ok: false, status: 400, error: 'Escribe qué quieres cambiar' };

  const item = await getRowByField(config.igReelsTable, 'shortcode', shortcode, 'regen, regen_meta, regen_estado');
  if (!item) return { ok: false, status: 404, error: `No existe el carrusel ${shortcode}` };
  if (!Array.isArray(item.regen) || !item.regen.length) {
    return { ok: false, status: 400, error: 'Este carrusel no tiene guion todavía' };
  }
  if (['leyendo', 'escribiendo', 'generando', 'revisando'].includes(item.regen_estado)) {
    return { ok: false, status: 409, error: 'Espera a que termine el trabajo en curso' };
  }

  const meta = item.regen_meta || {};
  const keyword = meta.keyword || meta.analisis?.keyword || 'PROMPTS';

  let out;
  try {
    out = await chatJSON({
      model: config.regenWriterModel,
      temperature: 0.4,
      maxTokens: 8000,
      messages: [{ role: 'user', content: buildInstruccionPrompt({ plan: item.regen, texto: t }) }],
    });
  } catch (e) {
    return { ok: false, status: 502, error: `No pude interpretar la instrucción: ${e.message}` };
  }

  const cambios = (Array.isArray(out.cambios) ? out.cambios : []).filter((c) =>
    Number.isInteger(c.idx) && item.regen.some((s) => s.idx === c.idx)
  );
  if (!cambios.length) {
    return { ok: true, mensaje: out.mensaje || 'No entendí qué cambiar. Sé más concreto (ej. "la 5 más agresiva").', idxs: [] };
  }

  // Aplica los cambios por RPC (merge atómico) y reconstruye el prompt de imagen de cada una.
  const idxs = [];
  for (const c of cambios) {
    const actual = item.regen.find((s) => s.idx === c.idx);
    if (!actual || actual.accion === 'copiar') continue;

    const textos = Array.isArray(c.textos) && c.textos.filter(Boolean).length
      ? c.textos.filter(Boolean)
      : actual.textos || [];
    const foto = c.foto ?? actual.foto;
    const acento = c.acento ?? actual.acento;
    const rol = actual.rol || actual.tipoSlide;

    const prompt =
      rol === 'cta'
        ? buildCtaImagenPrompt({ textos, foto, keyword, variante: actual.variante })
        : buildImagenPrompt({ rol, textos, foto, acento, chip: actual.chip });

    await regenPatchSlide(shortcode, c.idx, {
      textos,
      textoNuevo: textos.join('\n') || null,
      foto,
      acento,
      prompt,
      nota: c.motivo || null,
      qa: null,
      error: null,
    });
    idxs.push(c.idx);
  }

  // Deja constancia de lo que pidió, para que se vea en "Cambios pedidos".
  await setMeta(shortcode, {
    ...meta,
    historial: [
      ...(meta.historial || []),
      { ts: new Date().toISOString(), texto: t, idxs, mensaje: out.mensaje || null },
    ],
  }).catch(() => {});

  return { ok: true, mensaje: out.mensaje || `Voy a rehacer ${idxs.length} lámina(s).`, idxs };
}

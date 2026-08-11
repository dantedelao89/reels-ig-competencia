// Etapa B del regenerador: el guionista. Con el titular ya elegido, escribe el copy de TODAS
// las láminas en la voz de Dante, decide el rol y la acción de cada una, y describe la foto.
// Es texto puro (sin imágenes) para que no se corte, y su salida se valida por código antes
// de gastar un solo dólar en generación.

import { config } from './config.js';
import { getRowByField, getRegenRefs, getCtaVariantesRecientes } from './supabase.js';
import { chatJSON } from './llm.js';
import { buildGuionPrompt, buildImagenPrompt, buildCtaImagenPrompt } from './regenPrompts.js';
import { normalizeSlides } from './regenAnalizar.js';

const ROLES = [
  'portada', 'credibilidad', 'paso', 'statement', 'checklist', 'comparacion',
  'cita', 'imagen', 'prompt', 'antes-despues', 'dato', 'cta',
];

// Variantes de encuadre del CTA, todas en clave foto-a-sangre (las del catálogo viejo —
// polaroid, nota manuscrita, firma al pie— eran de papel y están prohibidas en carruseles).
// Se rota para no repetir la misma que el carrusel anterior.
const VARIANTES_CTA = [
  'primer plano a sangre: su cara ocupa la mitad superior, el texto abajo sobre el degradado',
  'plano medio trabajando: él a un lado del encuadre, el texto en la columna libre del otro lado',
  'recorte lateral: él grande en el tercio derecho, cortado por el borde inferior, el texto respira a la izquierda',
  'de tres cuartos mirando su pantalla, la luz del monitor en la cara, el texto abajo',
  'reacción: su gesto de sorpresa es el gancho y el titular pisa la parte baja de la foto',
];

const sinTildes = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Validación determinista del guion. Devuelve la lista de errores concretos (vacía = ok).
export function validarGuion(laminas, analisis, gancho) {
  const errores = [];
  if (!Array.isArray(laminas)) return ['no devolvió laminas[]'];
  if (laminas.length !== analisis.numLaminas) {
    errores.push(`devolviste ${laminas.length} láminas y el carrusel tiene ${analisis.numLaminas}`);
  }
  const vistos = new Set();
  for (const l of laminas) {
    const n = (l.idx ?? -1) + 1;
    if (!Number.isInteger(l.idx) || l.idx < 0 || l.idx >= analisis.numLaminas) {
      errores.push(`hay una lámina con idx inválido (${l.idx})`);
      continue;
    }
    if (vistos.has(l.idx)) errores.push(`el idx ${l.idx} está repetido`);
    vistos.add(l.idx);
    if (!['copiar', 'limpiar', 'regenerar'].includes(l.accion)) {
      errores.push(`lámina ${n}: accion "${l.accion}" no es válida`);
    }
    if (l.rol && !ROLES.includes(l.rol)) errores.push(`lámina ${n}: rol "${l.rol}" no está en la taxonomía`);
    if (l.accion === 'regenerar') {
      if (!Array.isArray(l.textos) || !l.textos.filter(Boolean).length) {
        errores.push(`lámina ${n}: se regenera pero no tiene textos`);
      }
      if (!l.foto) errores.push(`lámina ${n}: se regenera pero no describiste la foto`);
      if (l.acento && Array.isArray(l.textos) && !l.textos.some((t) => (t || '').includes(l.acento))) {
        errores.push(`lámina ${n}: el acento "${l.acento}" no aparece en sus textos`);
      }
    }
  }
  const portadas = laminas.filter((l) => l.rol === 'portada');
  if (portadas.length !== 1) errores.push(`debe haber exactamente 1 portada y hay ${portadas.length}`);
  else if (portadas[0].idx !== 0) errores.push('la portada tiene que ser la lámina 1');
  const ctas = laminas.filter((l) => l.rol === 'cta');
  if (ctas.length !== 1) errores.push(`debe haber exactamente 1 CTA y hay ${ctas.length}`);
  else if (ctas[0].idx !== analisis.numLaminas - 1) errores.push('el CTA tiene que ser la última lámina');

  // La portada tiene que llevar el titular elegido. El modelo lo puede entregar como una sola
  // cadena con saltos o partido en varias entradas de textos[]: ambas valen.
  const portada = portadas[0];
  if (portada && gancho?.titular) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const objetivo = norm(gancho.titular);
    const textos = portada.textos || [];
    const suelto = textos.some((t) => norm(t) === objetivo);
    const junto = norm(textos.join(' ')).startsWith(objetivo);
    if (!suelto && !junto) errores.push('la lámina 1 no lleva el titular elegido tal cual');
  }
  return errores;
}

// Si el guionista falla dos veces, se arma un guion mínimo: SOLO portada y CTA se regeneran
// (son las dos que sabemos escribir sin el modelo), y las intermedias se copian tal cual.
// Deliberadamente no se regeneran las intermedias: sin guion, su texto sería el del creador
// ajeno —a veces en otro idioma— y gastar $0.07 por lámina en eso es tirar el dinero.
export function planDeEmergencia(analisis, gancho, keyword) {
  return analisis.laminas.map((l) => {
    if (l.idx === 0) {
      return {
        idx: 0, accion: 'regenerar', rol: 'portada', textos: [gancho.titular],
        acento: null, chip: null,
        foto: l.descripcionVisual || 'primer plano relacionado con el tema, luz dura, textura de piel real',
      };
    }
    if (l.idx === analisis.numLaminas - 1) {
      return {
        idx: l.idx, accion: 'regenerar', rol: 'cta',
        textos: ['Comenta', keyword, `y te mando ${analisis.queEntrega || 'el material'}`, '@iacondante'],
        acento: keyword, chip: null,
        foto: 'trabajando frente a su pantalla, luz de monitor en la cara',
      };
    }
    return {
      idx: l.idx,
      accion: l.marcaDetectada ? 'limpiar' : 'copiar',
      rol: 'imagen', textos: [], acento: null, chip: null, foto: null,
    };
  });
}

// Elige la variante de foto de CTA que no se haya usado en los carruseles recientes.
async function elegirVarianteCta() {
  try {
    const recientes = await getCtaVariantesRecientes(3);
    return VARIANTES_CTA.find((v) => !recientes.includes(v)) || VARIANTES_CTA[0];
  } catch {
    return VARIANTES_CTA[0];
  }
}

// Convierte la salida del guionista en el contrato de ig_reels.regen (aditivo sobre el v1).
function aPlan(laminas, slides, analisis, keyword, variante, refs) {
  const ctaRefs = refs.filter((r) => r.tipo === 'cta');
  const estiloRefs = refs.filter((r) => r.tipo !== 'cta');
  const porIdx = new Map(laminas.map((l) => [l.idx, l]));

  return slides.map((s, idx) => {
    const esVideo = s.tipo === 'video';
    const l = porIdx.get(idx) || {};
    // Los videos se copian tal cual (v1 de esta decisión: no se recomponen).
    const accion = esVideo ? 'copiar' : l.accion || 'regenerar';
    const rol = esVideo ? 'imagen' : l.rol || 'statement';
    const textos = accion === 'regenerar' ? (l.textos || []).filter(Boolean) : [];
    const esCta = rol === 'cta';

    const base = {
      idx,
      tipoMedia: esVideo ? 'video' : 'image',
      accion,
      rol,
      tipoSlide: rol, // alias legado para la v1 (⚙️ detalle, zip)
      textos,
      textoNuevo: textos.join('\n') || null,
      textoOriginal: analisis.laminas[idx]?.textoOriginal || null,
      foto: accion === 'regenerar' ? l.foto || null : null,
      acento: l.acento || null,
      chip: l.chip || null,
      variante: esCta ? variante : null,
      // El CTA usa la foto de Dante como imagen base; el resto, una ancla de estilo.
      refId: accion === 'regenerar' ? (esCta ? ctaRefs[0]?.id : estiloRefs[0]?.id) || null : null,
      nota: null,
      estado: accion === 'copiar' ? 'listo' : 'pendiente',
      outputUrl: accion === 'copiar' ? s.url : null,
      error: null,
      modelo: null,
      qa: null,
    };

    base.prompt =
      accion === 'regenerar'
        ? esCta
          ? buildCtaImagenPrompt({ textos, foto: base.foto, keyword, variante })
          : buildImagenPrompt({ rol, textos, foto: base.foto, acento: base.acento, chip: base.chip })
        : null;
    return base;
  });
}

export function estimarCosto(plan) {
  const n = (a) => plan.filter((s) => s.accion === a).length;
  return Math.round((n('regenerar') * 0.07 + n('limpiar') * 0.02) * 100) / 100;
}

// Etapa B completa. Devuelve el plan listo para generar (no lo persiste: eso lo hace el job).
export async function escribirGuion(shortcode, { gancho, brief = null } = {}) {
  const item = await getRowByField(config.igReelsTable, 'shortcode', shortcode, 'imagenes, regen_meta');
  const meta = item?.regen_meta;
  if (!meta?.analisis) return { ok: false, error: 'Este carrusel aún no se ha leído' };

  const analisis = meta.analisis;
  const slides = normalizeSlides(item.imagenes);
  const variante = await elegirVarianteCta();
  const refs = await getRegenRefs();
  const avisos = [];

  const promptBase = buildGuionPrompt({ analisis, gancho, brief, variantesCta: [variante] });
  let laminas = null;
  let keyword = analisis.keyword;

  for (let intento = 1; intento <= 2; intento++) {
    try {
      const mensajes = [{ role: 'user', content: promptBase }];
      if (intento === 2 && laminas) {
        mensajes.push({ role: 'assistant', content: JSON.stringify({ keyword, laminas }) });
        mensajes.push({
          role: 'user',
          content: `El guion tiene estos errores. Corrígelos y devuelve el JSON completo otra vez:\n- ${validarGuion(laminas, analisis, gancho).join('\n- ')}`,
        });
      }
      const out = await chatJSON({
        model: config.regenWriterModel,
        temperature: 0.7,
        maxTokens: 16000,
        avisos,
        messages: mensajes,
      });
      keyword = sinTildes(out.keyword || analisis.keyword || 'PROMPTS').toUpperCase().replace(/[^A-Z0-9]/g, '');
      laminas = out.laminas;
      const errores = validarGuion(laminas, analisis, gancho);
      if (!errores.length) break;
      console.warn(`[regen] guion intento ${intento}: ${errores.join(' | ')}`);
      if (intento === 2) {
        avisos.push(`El guion no cumplió del todo (${errores[0]}); se armó una versión mínima.`);
        laminas = planDeEmergencia(analisis, gancho, keyword);
      }
    } catch (e) {
      console.warn(`[regen] guion intento ${intento} falló: ${e.message}`);
      if (intento === 2) {
        avisos.push(`El guionista falló (${e.message}); se armó una versión mínima.`);
        laminas = planDeEmergencia(analisis, gancho, keyword);
      }
    }
  }

  const plan = aPlan(laminas, slides, analisis, keyword, variante, refs);
  return { ok: true, plan, keyword, variante, costoEstimado: estimarCosto(plan), avisos };
}

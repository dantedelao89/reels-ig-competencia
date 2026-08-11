// Etapa A del regenerador: leer el carrusel ajeno y proponer titulares.
//
// A1 (lectura) es visión y trabajo de EXTRACCIÓN: temperatura baja, en lotes de 6 imágenes
// (Gemini corta la respuesta de forma no-determinista con más). A2 (ganchos) es trabajo
// CREATIVO: texto puro, sin imágenes, temperatura alta — así se puede repetir por céntimos.

import { config } from './config.js';
import { getRowByField, setRegen, setMeta } from './supabase.js';
import { chatJSON, imgContent } from './llm.js';
import { buildLecturaPrompt, buildGanchosPrompt } from './regenPrompts.js';

const VISION_BATCH = 6;

export function normalizeSlides(imagenes) {
  if (!Array.isArray(imagenes)) return [];
  return imagenes.map((x) => (typeof x === 'string' ? { tipo: 'image', url: x } : x));
}

// A1 · Lectura por lotes. Devuelve {laminas: Map por idx, global: {tema, queEntrega, …}, avisos}.
async function leerLaminas(imageSlides, avisos) {
  const porIdx = new Map();
  const globales = [];

  for (let from = 0; from < imageSlides.length; from += VISION_BATCH) {
    const batch = imageSlides.slice(from, from + VISION_BATCH);
    try {
      const out = await chatJSON({
        model: config.regenVisionModel,
        temperature: 0.1,
        maxTokens: 20000,
        avisos,
        messages: [
          { role: 'user', content: imgContent(buildLecturaPrompt(batch.length), batch.map((s) => s.url)) },
        ],
      });
      if (!Array.isArray(out.laminas)) throw new Error('no devolvió laminas[]');
      // El modelo numera dentro del lote; se mapea por posición.
      out.laminas.forEach((l, i) => {
        const original = batch[Number.isInteger(l.idx) && batch[l.idx] ? l.idx : i];
        if (original) porIdx.set(original.idx, { ...l, idx: original.idx });
      });
      globales.push(out);
    } catch (e) {
      const nums = batch.map((s) => s.idx + 1).join(', ');
      avisos.push(`No se pudieron leer las láminas ${nums} (${e.message}).`);
      console.warn(`[regen] lectura lote ${from}: ${e.message}`);
    }
  }

  // Los campos globales los reporta cada lote; gana el del primer lote que los traiga
  // (el primer lote incluye la portada, que es donde vive el tema).
  const global = {};
  for (const k of ['tema', 'queEntrega', 'argumento', 'dolor', 'publico']) {
    global[k] = globales.map((g) => g[k]).find(Boolean) || null;
  }
  // Las piezas se SUMAN entre lotes: cada lote solo ve su trozo del carrusel.
  const piezas = globales.map((g) => g.piezas).filter((n) => Number.isFinite(n) && n > 0);
  global.piezas = piezas.length ? piezas.reduce((a, b) => a + b, 0) : null;
  return { porIdx, global };
}

// Deriva una keyword de CTA a partir de lo que entrega el carrusel: palabra real, mayúsculas,
// sin tildes (el filtro de comentarios se rompe con tildes).
function keywordDesde(queEntrega, tema) {
  const fuente = `${queEntrega || ''} ${tema || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  const stop = new Set(['LOS', 'LAS', 'DEL', 'PARA', 'CON', 'UNA', 'UNO', 'QUE', 'POR', 'SIN', 'MAS']);
  const palabra = (fuente.match(/[A-Z]{4,}/g) || []).find((w) => !stop.has(w));
  return palabra || 'PROMPTS';
}

// Etapa A completa: lee el carrusel y propone los 5 primeros ganchos.
export async function leerCarrusel(shortcode, { brief = null } = {}) {
  if (!config.openrouterApiKey) return { ok: false, error: 'Falta OPENROUTER_API_KEY' };

  const item = await getRowByField(
    config.igReelsTable,
    'shortcode',
    shortcode,
    'id, shortcode, creador, imagenes, regen_estado'
  );
  if (!item) return { ok: false, error: `No existe el carrusel ${shortcode}` };

  const slides = normalizeSlides(item.imagenes);
  if (slides.length < 2) return { ok: false, error: 'Este contenido no es un carrusel (menos de 2 láminas)' };
  if (slides.length > config.regenMaxLaminas) {
    return { ok: false, error: `El carrusel tiene ${slides.length} láminas; el máximo es ${config.regenMaxLaminas}` };
  }

  const marcado = await setRegen(shortcode, { regen_estado: 'leyendo' }, { guard: true });
  if (!marcado) return { ok: false, error: 'Este carrusel ya se está procesando; espera a que termine' };

  const avisos = [];
  try {
    const imageSlides = slides.map((s, idx) => ({ ...s, idx })).filter((s) => s.tipo !== 'video');
    const { porIdx, global } = await leerLaminas(imageSlides, avisos);
    if (!porIdx.size) {
      await setRegen(shortcode, { regen_estado: null });
      return { ok: false, error: `No se pudo leer ninguna lámina: ${avisos[0] || 'sin detalle'}` };
    }

    const analisis = {
      ...global,
      keyword: keywordDesde(global.queEntrega, global.tema),
      numLaminas: slides.length,
      laminas: slides.map((s, idx) => {
        if (s.tipo === 'video') {
          return { idx, rolDetectado: 'foto', textoOriginal: null, descripcionVisual: 'video del carrusel original', marcaDetectada: null, esSoloFoto: true };
        }
        const l = porIdx.get(idx) || {};
        return {
          idx,
          rolDetectado: l.rolDetectado || 'contenido',
          textoOriginal: l.textoOriginal || null,
          descripcionVisual: l.descripcionVisual || null,
          marcaDetectada: l.marcaDetectada || null,
          esSoloFoto: l.esSoloFoto === true,
        };
      }),
    };

    const { ganchos } = await generarGanchos({ analisis, brief, excluir: [], avisos });

    await setMeta(shortcode, { v: 2, brief, analisis, ganchos, ganchoElegido: null, historial: [] });
    await setRegen(shortcode, { regen_estado: 'ganchos' });

    return { ok: true, shortcode, analisis, ganchos, numLaminas: slides.length, avisos };
  } catch (e) {
    await setRegen(shortcode, { regen_estado: null }).catch(() => {});
    return { ok: false, error: e.message };
  }
}

// Validación determinista de un titular contra las reglas de Dante. Devuelve los fallos.
// Se aplica por código porque el modelo cuenta caracteres mal y porque inventar un número
// (REGLA de "nada que no se pueda sostener") es la falta más cara.
export function fallosDelTitular(titular, analisis) {
  const t = (titular || '').trim();
  const lineas = t.split('\n');
  const fallos = [];
  if (!t) return ['está vacío'];
  if (lineas.length > 3) fallos.push(`tiene ${lineas.length} líneas (máximo 3)`);
  const largas = lineas.filter((l) => l.length > 16);
  if (largas.length) {
    fallos.push(`estas líneas pasan de 16 caracteres: ${largas.map((l) => `"${l}" (${l.length})`).join(', ')}`);
  }
  const palabras = t.split(/\s+/).filter(Boolean).length;
  if (palabras > 8) fallos.push(`tiene ${palabras} palabras (máximo 8)`);

  // Números: solo se admite el conteo real de piezas (REGLA: nada que no se pueda sostener).
  const numeros = (t.match(/\d+/g) || []).map(Number);
  const piezas = analisis?.piezas;
  const inventados = numeros.filter((n) => n !== piezas);
  if (inventados.length) {
    fallos.push(
      piezas
        ? `usa el número ${inventados.join(', ')} y el carrusel entrega ${piezas}: solo se puede nombrar ${piezas}`
        : `usa el número ${inventados.join(', ')} pero no sabemos cuántas piezas entrega el carrusel: quita la cantidad`
    );
  }
  return fallos;
}

// A2 aislada: pide 5 titulares y repara por código los que rompan las reglas.
async function generarGanchos({ analisis, brief, excluir, avisos }) {
  const pedir = (mensajes) =>
    chatJSON({ model: config.regenWriterModel, temperature: 0.9, maxTokens: 4000, avisos, messages: mensajes });

  const promptBase = buildGanchosPrompt({ analisis, brief, excluir });
  const out = await pedir([{ role: 'user', content: promptBase }]);
  let ganchos = (out.ganchos || []).map((g, i) => ({
    id: g.id || `g${i + 1}`,
    formula: g.formula || '',
    titular: (g.titular || '').trim(),
    porque: g.porque || '',
  }));
  if (!ganchos.length) throw new Error('el director de ganchos no devolvió titulares');

  // Una sola pasada de reparación con los fallos concretos (cuesta céntimos y evita que a
  // Dante le lleguen titulares que su propia regla rechaza).
  const malos = ganchos
    .map((g) => ({ g, fallos: fallosDelTitular(g.titular, analisis) }))
    .filter((x) => x.fallos.length);

  if (malos.length) {
    console.log(`[regen] reparando ${malos.length} titular(es): ${malos.map((m) => m.fallos[0]).join(' | ')}`);
    try {
      const rep = await pedir([
        { role: 'user', content: promptBase },
        { role: 'assistant', content: JSON.stringify({ ganchos }) },
        {
          role: 'user',
          content:
            `Estos titulares rompen las reglas. Reescríbelos conservando su fórmula y su idea, ` +
            `corrigiendo SOLO lo señalado:\n\n` +
            malos.map((m) => `[${m.g.formula}] "${m.g.titular.replace(/\n/g, ' / ')}"\n  → ${m.fallos.join('; ')}`).join('\n\n') +
            `\n\nDevuelve los 5 titulares completos (los buenos igual que estaban) en el mismo formato JSON.`,
        },
      ]);
      const reparados = (rep.ganchos || []).map((g, i) => ({
        id: g.id || `g${i + 1}`,
        formula: g.formula || '',
        titular: (g.titular || '').trim(),
        porque: g.porque || '',
      }));
      // Se acepta la reparación solo si mejora: nunca se empeora lo que ya estaba bien.
      if (reparados.length) {
        const antes = ganchos.filter((g) => !fallosDelTitular(g.titular, analisis).length).length;
        const despues = reparados.filter((g) => !fallosDelTitular(g.titular, analisis).length).length;
        if (despues >= antes) ganchos = reparados;
      }
    } catch (e) {
      console.warn(`[regen] la reparación de titulares falló: ${e.message}`);
    }
  }

  // Lo que siga roto se marca, para que la UI lo muestre en vez de esconderlo.
  return {
    ganchos: ganchos.map((g) => {
      const fallos = fallosDelTitular(g.titular, analisis);
      return fallos.length ? { ...g, avisos: fallos } : g;
    }),
  };
}

// "Otros 5 titulares": reusa el análisis guardado, no vuelve a mirar imágenes.
export async function proponerGanchos(shortcode, { brief = null, excluir = [] } = {}) {
  if (!config.openrouterApiKey) return { ok: false, error: 'Falta OPENROUTER_API_KEY' };

  const item = await getRowByField(config.igReelsTable, 'shortcode', shortcode, 'regen_meta');
  const meta = item?.regen_meta;
  if (!meta?.analisis) return { ok: false, error: 'Este carrusel aún no se ha leído' };

  const avisos = [];
  try {
    const previos = excluir.length ? excluir : (meta.ganchos || []).map((g) => g.titular);
    const { ganchos } = await generarGanchos({
      analisis: meta.analisis,
      brief: brief ?? meta.brief,
      excluir: previos,
      avisos,
    });
    await setMeta(shortcode, { ...meta, ganchos, brief: brief ?? meta.brief });
    return { ok: true, ganchos, avisos };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Radar de X: corre las consultas guardadas (hashtags o palabras clave con operadores) y guarda
// lo que traen, sin curar y sin archivar media.
//
// Por qué consultas y no solo hashtags: medido el 7 sep 2026 con los seis hashtags que pidió Dante
// (#ia #ai #chatgpt #inteligenciaartificial #prompt #prompts), 40 de 40 resultados tenían menos de
// 10 likes — noticias en coreano y spam. Con `min_faves:100` la mediana subió a 193 likes pero el
// contenido era fan art: **`#ia` en X es IA, un personaje de Vocaloid**, y `#prompt` lo dominan los
// que generan imágenes. Una consulta de palabras clave equivalente
// (`"just released" (AI OR LLM) min_faves:300`) dio mediana 773 y contenido real.
// Los hashtags se pueden guardar igual: la UI muestra la señal de cada consulta para que se vea
// cuál rinde. Lo que NO se puede es asumir que un hashtag equivale a un tema.

import { config } from './config.js';
import { getActiveXBusquedas, getXBusquedaById, updateXBusquedaLastRun } from './sources.js';
import { scrapeXQuery, agruparHilos } from './xApify.js';
import { syncXRadar, getExistingRadarIds } from './supabase.js';

async function correrUna(busqueda, existing, startedAt) {
  const posts = agruparHilos(
    await scrapeXQuery(busqueda.consulta, { maxPosts: busqueda.maxPosts })
  );
  // Dedup contra lo ya descubierto: el actor cobra por resultado devuelto, pero al menos no se
  // reescribe la base entera en cada corrida.
  const nuevos = posts.filter((p) => !existing.has(String(p.id)));
  if (nuevos.length) {
    await syncXRadar(nuevos, { busqueda, scrapedAtIso: startedAt });
    nuevos.forEach((p) => existing.add(String(p.id)));
  }

  // Señal de la consulta: es lo que deja ver, con datos, cuáles se ganan el sitio. Sin esto el
  // radar se convierte en un vertedero al que se le van sumando consultas malas.
  const likes = posts.map((p) => p.likes || 0).sort((a, b) => a - b);
  const mediana = likes.length ? likes[Math.floor(likes.length / 2)] : 0;
  const flojos = likes.filter((l) => l < 10).length;

  console.log(
    `[radar] "${busqueda.etiqueta}": ${posts.length} traídos, ${nuevos.length} nuevos` +
      ` · mediana ${mediana} likes · ${flojos} con menos de 10`
  );
  return {
    busqueda: busqueda.etiqueta,
    traidos: posts.length,
    nuevos: nuevos.length,
    medianaLikes: mediana,
    flojos,
  };
}

// Todas las consultas activas. Una que falle no tumba a las demás.
export async function runRadarX() {
  const startedAt = new Date().toISOString();

  let busquedas;
  let existing;
  try {
    busquedas = await getActiveXBusquedas();
    existing = await getExistingRadarIds();
  } catch (err) {
    console.error('[radar] no se pudieron leer las consultas:', err.message);
    return { ok: false, error: err.message, consultas: 0, nuevos: 0, details: [] };
  }
  if (!busquedas.length) return { ok: true, consultas: 0, nuevos: 0, details: [] };

  const details = [];
  let nuevos = 0;
  for (const b of busquedas) {
    try {
      const r = await correrUna(b, existing, startedAt);
      nuevos += r.nuevos;
      details.push(r);
    } catch (err) {
      console.error(`[radar "${b.etiqueta}"] ERROR:`, err.message);
      details.push({ busqueda: b.etiqueta, error: err.message });
    }
    try {
      await updateXBusquedaLastRun(b.recordId, startedAt);
    } catch (e) {
      console.error(`[radar lastRun] ${e.message}`);
    }
  }
  return { ok: true, consultas: busquedas.length, nuevos, details };
}

// UNA consulta (botón de Fuentes / prueba antes de guardarla).
export async function runRadarXBusqueda(id) {
  const startedAt = new Date().toISOString();
  let busqueda;
  let existing;
  try {
    busqueda = await getXBusquedaById(id);
    existing = await getExistingRadarIds();
  } catch (err) {
    return { ok: false, error: err.message, nuevos: 0 };
  }
  if (!busqueda) return { ok: false, error: 'No se encontró esa consulta', nuevos: 0 };

  try {
    const r = await correrUna(busqueda, existing, startedAt);
    try {
      await updateXBusquedaLastRun(busqueda.recordId, startedAt);
    } catch (e) {
      console.error(`[radar lastRun] ${e.message}`);
    }
    return { ok: true, ...r };
  } catch (err) {
    console.error(`[radar "${busqueda.etiqueta}"] ERROR:`, err.message);
    return { ok: false, error: err.message, nuevos: 0 };
  }
}

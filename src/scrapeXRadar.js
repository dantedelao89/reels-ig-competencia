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
//
// Desde el 19 oct 2026 escribe en la tabla `radar` (común a X, YouTube y LinkedIn) y lee sus
// consultas de `radar_busquedas`.

import {
  getActiveRadarBusquedas,
  getRadarTemas,
  updateRadarBusquedaLastRun,
} from './sources.js';
import { scrapeXQuery, agruparHilos } from './xApify.js';
import { clasificar, velocidadPorHora } from './radarTemas.js';
import { syncRadar, getExistingRadarIds } from './supabase.js';
import { puedeCorrerRadar } from './apifyPresupuesto.js';
import { elegirParaResumen, formatearResumenX, enviarSlack } from './radarAvisoX.js';
import { config } from './config.js';

async function correrUna(busqueda, existing, temas, startedAt) {
  // El freno va AQUÍ y no en el runner: así protege los tres caminos (cron, botón de rastrear y
  // prueba de una consulta) y además corta a mitad de corrida si el presupuesto se agota con las
  // primeras consultas, en vez de gastarlo todo porque al empezar había margen.
  const presupuesto = await puedeCorrerRadar();
  if (!presupuesto.puede) {
    return {
      busqueda: busqueda.etiqueta,
      detenido: 'presupuesto',
      gastado: presupuesto.gastado,
      tope: presupuesto.tope,
      traidos: 0,
      nuevos: 0,
    };
  }

  const posts = agruparHilos(
    await scrapeXQuery(busqueda.consulta, {
      maxPosts: busqueda.maxPorCorrida,
      maxUsd: config.radarMaxUsdPorCorrida,
    })
  );
  // En X la señal son los LIKES por hora: es la métrica que todo post tiene y la que se mueve
  // primero. Las vistas las esconde la mitad de las cuentas.
  posts.forEach((p) => {
    p.velocidad = velocidadPorHora(p.likes, p.fecha ? new Date(p.fecha).getTime() : null, startedAt);
  });

  // Dedup contra lo ya descubierto: el actor cobra por resultado devuelto, pero al menos no se
  // reescribe la base entera en cada corrida.
  const nuevos = posts.filter((p) => !existing.has(String(p.id)));
  if (nuevos.length) {
    await syncRadar(nuevos, {
      plataforma: 'x',
      busqueda,
      scrapedAtIso: startedAt,
      clasificar: (texto) => clasificar(texto, temas),
    });
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
    // Los hallazgos NUEVOS viajan aparte del resumen numérico. Son los nuevos y no todos porque el
    // mensaje de Slack se arma con ellos: con todos, los mismos tweets saldrían cada día. Y suben
    // juntos al final en vez de mandarse por consulta porque el mismo lanzamiento aparece en varias.
    nuevosPosts: nuevos.map((p) => ({ ...p, busquedaEtiqueta: busqueda.etiqueta })),
  };
}

// Todas las consultas activas. Una que falle no tumba a las demás.
//
// `avisar`: manda a Slack lo que CRUZA el umbral de likes/hora. Por defecto false, como todo lo que
// escribe en un canal — el cron lo pide explícitamente, y así el botón de rastrear y las pruebas de
// una consulta no llenan el canal mientras se calibra.
export async function runRadarX({ avisar = false } = {}) {
  const startedAt = new Date().toISOString();

  let busquedas;
  let existing;
  let temas;
  try {
    busquedas = await getActiveRadarBusquedas('x');
    existing = await getExistingRadarIds('x');
    temas = await getRadarTemas();
  } catch (err) {
    console.error('[radar] no se pudieron leer las consultas:', err.message);
    return { ok: false, error: err.message, consultas: 0, nuevos: 0, details: [] };
  }
  if (!busquedas.length) {
    // Dicho en voz alta porque el silencio engaña: medido el 27 oct 2026, el cron llevaba días
    // devolviendo `consultas: 0` y eso se lee igual que "hoy no hubo nada" cuando en realidad
    // significa "nadie activó ninguna consulta".
    console.warn('[radar] X no tiene NINGUNA consulta activa: no hay nada que buscar');
    return { ok: true, consultas: 0, nuevos: 0, details: [], aviso: 'sin consultas activas' };
  }

  const details = [];
  const todosNuevos = [];
  let nuevos = 0;
  for (const b of busquedas) {
    try {
      const { nuevosPosts, ...resumen } = await correrUna(b, existing, temas, startedAt);
      nuevos += resumen.nuevos;
      details.push(resumen);
      if (nuevosPosts?.length) todosNuevos.push(...nuevosPosts);
    } catch (err) {
      console.error(`[radar "${b.etiqueta}"] ERROR:`, err.message);
      details.push({ busqueda: b.etiqueta, error: err.message });
    }
    try {
      await updateRadarBusquedaLastRun(b.recordId, startedAt);
    } catch (e) {
      console.error(`[radar lastRun] ${e.message}`);
    }
  }

  let aviso = null;
  if (avisar) {
    const ahoraMs = new Date(startedAt).getTime();
    const elegidos = elegirParaResumen(todosNuevos, {
      maxHoras: config.radarXResumenMaxHoras,
      cuantos: config.radarXResumenCuantos,
      ahoraMs,
    });
    // Si no hay nada nuevo no se manda nada. Un «0 hallazgos» diario es el camino más corto a que
    // el canal se silencie, que es la única forma de que un aviso falle del todo.
    // Un fallo del envío NO tumba la corrida: los hallazgos ya están guardados y la pantalla los
    // enseña igual. Lo que no puede pasar es que el fallo sea invisible, así que se devuelve.
    aviso = elegidos.length
      ? {
          mostrados: elegidos.length,
          ...(await enviarSlack(
            formatearResumenX(elegidos, {
              consultas: busquedas.length,
              nuevos,
              vacias: details.filter((d) => d.traidos === 0 && !d.detenido && !d.error).length,
              ahoraMs,
            })
          )),
        }
      : { mostrados: 0, motivo: nuevos ? 'nada dentro de la ventana de edad' : 'sin hallazgos nuevos' };
  }

  return { ok: true, consultas: busquedas.length, nuevos, aviso, details };
}

// UNA consulta (botón de Fuentes / prueba antes de guardarla).
export async function runRadarXBusqueda(id) {
  const startedAt = new Date().toISOString();
  let busqueda;
  let existing;
  let temas;
  try {
    const todas = await getActiveRadarBusquedas('x');
    busqueda = todas.find((b) => b.recordId === id);
    existing = await getExistingRadarIds('x');
    temas = await getRadarTemas();
  } catch (err) {
    return { ok: false, error: err.message, nuevos: 0 };
  }
  if (!busqueda) return { ok: false, error: 'No se encontró esa consulta', nuevos: 0 };

  try {
    const { posts, ...r } = await correrUna(busqueda, existing, temas, startedAt);
    try {
      await updateRadarBusquedaLastRun(busqueda.recordId, startedAt);
    } catch (e) {
      console.error(`[radar lastRun] ${e.message}`);
    }
    return { ok: true, ...r };
  } catch (err) {
    console.error(`[radar "${busqueda.etiqueta}"] ERROR:`, err.message);
    return { ok: false, error: err.message, nuevos: 0 };
  }
}

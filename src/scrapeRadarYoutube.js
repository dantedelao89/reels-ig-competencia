// Radar de YouTube: corre las consultas guardadas y deja los hallazgos en `radar`.
//
// Por qué existe aparte del pipeline orgánico: las búsquedas de YouTube ya existían, pero metían
// los videos directo en `yt_videos`, o sea en la MISMA galería que el contenido curado. Eso tenía
// dos problemas — el descubrimiento ensuciaba la galería, y cada video descubierto se archivaba
// (miniatura a R2, subtítulos) aunque Dante fuera a descartarlo. Aquí no se archiva nada: solo
// URL, texto, métricas y la miniatura enlazada. Lo que valga la pena se guarda después y entra por
// el pipeline orgánico, que sí archiva.
//
// ## Los tres idiomas
//
// Las consultas van en inglés, español y portugués, y eso NO es un parámetro del actor: es el
// texto de cada consulta. Medido el 21 oct 2026, porque el radar se perdió un video que Dante
// encontró a mano («NUEVO Claude Duet…», Juan Pe Navarro) publicado 56 minutos ANTES de que el
// radar corriera, con la consulta `claude` activa:
//
//   - `streamers/youtube-scraper` no tiene parámetro de idioma ni de país.
//   - Pasarle `startUrls` con `&hl=es&gl=MX` NO sirve: devolvió los 6 resultados en inglés.
//   - `proxyConfiguration.apifyProxyCountry: MX` / `BR` tampoco: el actor pide los resultados en
//     inglés por dentro, así que la IP no manda.
//   - Lo que SÍ sirve es el idioma del TEXTO: `"claude duet en español"` trajo justo el video de
//     Juan Pe, y `"claude duet em português"` uno brasileño.
//
// Por eso cada tema vive como tres filas en `radar_busquedas`, una por idioma, editables en
// Fuentes. No hay columna de idioma: la consulta ya dice en qué idioma busca, y una columna más
// sería un estado que hay que mantener de acuerdo con el texto.

import { config } from './config.js';
import {
  getActiveRadarBusquedas,
  getRadarTemas,
  updateRadarBusquedaLastRun,
} from './sources.js';
import { scrapeSearches } from './youtubeApify.js';
import { clasificar, velocidadPorHora } from './radarTemas.js';
import { getExistingRadarIds, syncRadar } from './supabase.js';
import { puedeCorrerRadar } from './apifyPresupuesto.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "12:20:10" → 44410 · "01:05" → 65. El actor devuelve la duración como texto.
function duracionASegundos(txt) {
  if (!txt) return null;
  const partes = String(txt).split(':').map((p) => Number(p));
  if (partes.some((p) => !Number.isFinite(p))) return null;
  return partes.reduce((acc, p) => acc * 60 + p, 0);
}

// Normaliza un item del actor a la forma común del radar, la misma que produce xApify.
function normalizar(it, scrapedAtIso) {
  const fechaMs = it.date ? new Date(it.date).getTime() : null;
  const views = num(it.viewCount);
  return {
    id: it.id,
    handle: it.channelName || null,
    nombre: it.channelName || null,
    creadorUrl: it.channelUrl || null,
    // Lecturas defensivas: el actor cambia de nombre estos campos entre builds, y un `null` aquí
    // solo deja la columna vacía en vez de tumbar la corrida.
    seguidores: num(it.numberOfSubscribers ?? it.channelTotalSubscribers ?? it.subscriberCount),
    url: it.url || null,
    texto: it.title || null,
    fecha: it.date || null,
    views,
    likes: num(it.likes),
    comentarios: num(it.commentsCount ?? it.numberOfComments),
    duracionSeg: duracionASegundos(it.duration),
    tipo: 'Video',
    hashtags: Array.isArray(it.hashtags) ? it.hashtags : [],
    videoThumb: it.thumbnailUrl || null,
    // El radar no archiva: el video se ve en YouTube. Por eso no hay `videoUrl`.
    videoUrl: null,
    // En YouTube la señal son las VISTAS por hora. Los likes llegan tarde y muy filtrados, así que
    // ordenar por ellos esconde justo lo que está explotando ahora.
    velocidad: velocidadPorHora(views, fechaMs, scrapedAtIso),
  };
}

// Un LOTE de consultas que comparten el mismo `max_por_corrida`, en UNA sola corrida de Apify.
//
// Por qué en lote y no una por una: con los tres idiomas son 21 consultas, y 21 corridas
// secuenciales tardan minutos — el botón de rastrear del panel se moría en el límite del proxy
// mientras el trabajo seguía por detrás. `maxResults` del actor es POR término de búsqueda
// (medido: 3 startUrls × maxResults 2 → 6 items), así que un lote devuelve lo mismo que las
// corridas sueltas. Se agrupa por `max_por_corrida` porque es un solo número para todo el lote:
// mezclar consultas con topes distintos le aplicaría a todas el más alto.
async function correrLote(busquedas, maxResults, existing, temas, startedAt) {
  // El freno va AQUÍ y no en el runner: protege los tres caminos (cron, botón de rastrear y prueba
  // de una consulta) y corta entre lotes si el presupuesto se agota, en vez de gastarlo entero
  // porque al empezar había margen.
  const presupuesto = await puedeCorrerRadar();
  if (!presupuesto.puede) {
    return busquedas.map((b) => ({
      busqueda: b.etiqueta,
      detenido: 'presupuesto',
      gastado: presupuesto.gastado,
      tope: presupuesto.tope,
      traidos: 0,
      nuevos: 0,
    }));
  }

  const crudos = await scrapeSearches({
    queries: busquedas.map((b) => b.consulta),
    maxResults,
    maxShorts: 0,
    dateFilter: config.radarYoutubeDateFilter,
    maxUsd: config.radarYoutubeMaxUsdPorCorrida,
    sinSubtitulos: true,
  });

  // `input` trae el término de búsqueda que produjo cada item: es lo que permite guardar cada
  // hallazgo con SU consulta en vez de con una sola etiqueta para todo el lote.
  const porConsulta = new Map(busquedas.map((b) => [b.consulta, b]));
  const agrupados = new Map(busquedas.map((b) => [b.consulta, []]));
  const huerfanos = [];
  for (const it of crudos) {
    const b = porConsulta.get(it.input);
    if (b) agrupados.get(b.consulta).push(it);
    else huerfanos.push(it);
  }
  if (huerfanos.length) {
    // No se tira nada: si el actor cambia cómo reporta `input`, el radar sigue guardando los
    // hallazgos (sin consulta) en vez de perderlos en silencio.
    console.warn(`[radar-yt] ${huerfanos.length} items sin consulta reconocible: ${[...new Set(huerfanos.map((h) => h.input))].join(' | ')}`);
  }

  const detalles = [];
  for (const b of busquedas) {
    const posts = agrupados.get(b.consulta).map((it) => normalizar(it, startedAt));
    const nuevos = posts.filter((p) => !existing.has(String(p.id)));
    if (nuevos.length) {
      await syncRadar(nuevos, {
        plataforma: 'yt',
        busqueda: b,
        scrapedAtIso: startedAt,
        clasificar: (texto) => clasificar(texto, temas),
      });
      nuevos.forEach((p) => existing.add(String(p.id)));
    }

    // Señal de la consulta: con datos se ve cuáles se ganan el sitio. Sin esto el radar se
    // convierte en un vertedero al que se le van sumando consultas malas.
    const vels = posts.map((p) => p.velocidad || 0).sort((a, c) => a - c);
    const mediana = vels.length ? vels[Math.floor(vels.length / 2)] : 0;
    const sinTema = posts.filter((p) => !clasificar(`${p.texto || ''}`, temas).length).length;
    console.log(
      `[radar-yt] "${b.etiqueta}": ${posts.length} traídos, ${nuevos.length} nuevos` +
        ` · mediana ${mediana} vistas/h · ${sinTema} sin tema`
    );
    detalles.push({
      busqueda: b.etiqueta,
      traidos: posts.length,
      nuevos: nuevos.length,
      medianaVelocidad: mediana,
      sinTema,
    });
  }
  return detalles;
}

// Corre las consultas en lotes por `max_por_corrida`. Un lote que falle no tumba a los demás.
async function correrTodas(busquedas, existing, temas, startedAt) {
  const porMax = new Map();
  for (const b of busquedas) {
    const max = b.maxPorCorrida || config.radarYoutubeMaxResults;
    if (!porMax.has(max)) porMax.set(max, []);
    porMax.get(max).push(b);
  }

  const details = [];
  for (const [max, lote] of porMax) {
    try {
      details.push(...(await correrLote(lote, max, existing, temas, startedAt)));
    } catch (err) {
      console.error(`[radar-yt lote max=${max}] ERROR:`, err.message);
      lote.forEach((b) => details.push({ busqueda: b.etiqueta, error: err.message }));
    }
    for (const b of lote) {
      try {
        await updateRadarBusquedaLastRun(b.recordId, startedAt);
      } catch (e) {
        console.error(`[radar-yt lastRun] ${e.message}`);
      }
    }
  }
  return details;
}

// Todas las consultas activas de YouTube.
export async function runRadarYoutube() {
  const startedAt = new Date().toISOString();

  let busquedas;
  let existing;
  let temas;
  try {
    busquedas = await getActiveRadarBusquedas('yt');
    existing = await getExistingRadarIds('yt');
    temas = await getRadarTemas();
  } catch (err) {
    console.error('[radar-yt] no se pudo leer la configuración:', err.message);
    return { ok: false, error: err.message, consultas: 0, nuevos: 0, details: [] };
  }
  if (!busquedas.length) return { ok: true, consultas: 0, nuevos: 0, details: [] };

  const details = await correrTodas(busquedas, existing, temas, startedAt);
  const nuevos = details.reduce((acc, d) => acc + (d.nuevos || 0), 0);
  return { ok: true, consultas: busquedas.length, nuevos, details };
}

// UNA consulta, para probar antes de dejarla activa.
export async function runRadarYoutubeBusqueda(id) {
  const startedAt = new Date().toISOString();
  let busqueda;
  let existing;
  let temas;
  try {
    const todas = await getActiveRadarBusquedas();
    busqueda = todas.find((b) => b.recordId === id && b.plataforma === 'yt');
    existing = await getExistingRadarIds('yt');
    temas = await getRadarTemas();
  } catch (err) {
    return { ok: false, error: err.message, nuevos: 0 };
  }
  if (!busqueda) return { ok: false, error: 'No se encontró esa consulta de YouTube', nuevos: 0 };

  const details = await correrTodas([busqueda], existing, temas, startedAt);
  const d = details[0] || { nuevos: 0 };
  return d.error ? { ok: false, error: d.error, nuevos: 0 } : { ok: true, ...d };
}

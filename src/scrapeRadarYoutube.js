// Radar de YouTube: corre las consultas guardadas y deja los hallazgos en `radar`.
//
// Por qué existe aparte del pipeline orgánico: las búsquedas de YouTube ya existían, pero metían
// los videos directo en `yt_videos`, o sea en la MISMA galería que el contenido curado. Eso tenía
// dos problemas — el descubrimiento ensuciaba la galería, y cada video descubierto se archivaba
// (miniatura a R2, subtítulos) aunque Dante fuera a descartarlo. Aquí no se archiva nada: solo
// URL, texto, métricas y la miniatura enlazada. Lo que valga la pena se guarda después y entra por
// el pipeline orgánico, que sí archiva.

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

async function correrUna(busqueda, existing, temas, startedAt) {
  // El freno va AQUÍ y no en el runner: protege los tres caminos (cron, botón de rastrear y prueba
  // de una consulta) y corta a mitad de corrida si el presupuesto se agota con las primeras
  // consultas, en vez de gastarlo entero porque al empezar había margen.
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

  const crudos = await scrapeSearches({
    queries: [busqueda.consulta],
    maxResults: busqueda.maxPorCorrida || config.radarYoutubeMaxResults,
    maxShorts: 0,
    dateFilter: config.radarYoutubeDateFilter,
    maxUsd: config.radarMaxUsdPorCorrida,
  });
  const posts = crudos.map((it) => normalizar(it, startedAt));

  // Dedup contra lo ya descubierto: el actor cobra por resultado devuelto, pero al menos no se
  // reescribe la base entera en cada corrida.
  const nuevos = posts.filter((p) => !existing.has(String(p.id)));
  if (nuevos.length) {
    await syncRadar(nuevos, {
      plataforma: 'yt',
      busqueda,
      scrapedAtIso: startedAt,
      clasificar: (texto) => clasificar(texto, temas),
    });
    nuevos.forEach((p) => existing.add(String(p.id)));
  }

  // Señal de la consulta: con datos se ve cuáles se ganan el sitio. Sin esto el radar se convierte
  // en un vertedero al que se le van sumando consultas malas.
  const vels = posts.map((p) => p.velocidad || 0).sort((a, b) => a - b);
  const mediana = vels.length ? vels[Math.floor(vels.length / 2)] : 0;
  const sinTema = posts.filter((p) => !clasificar(`${p.texto || ''}`, temas).length).length;

  console.log(
    `[radar-yt] "${busqueda.etiqueta}": ${posts.length} traídos, ${nuevos.length} nuevos` +
      ` · mediana ${mediana} vistas/h · ${sinTema} sin tema`
  );
  return {
    busqueda: busqueda.etiqueta,
    traidos: posts.length,
    nuevos: nuevos.length,
    medianaVelocidad: mediana,
    sinTema,
  };
}

// Todas las consultas activas de YouTube. Una que falle no tumba a las demás.
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

  const details = [];
  let nuevos = 0;
  for (const b of busquedas) {
    try {
      const r = await correrUna(b, existing, temas, startedAt);
      nuevos += r.nuevos;
      details.push(r);
    } catch (err) {
      console.error(`[radar-yt "${b.etiqueta}"] ERROR:`, err.message);
      details.push({ busqueda: b.etiqueta, error: err.message });
    }
    try {
      await updateRadarBusquedaLastRun(b.recordId, startedAt);
    } catch (e) {
      console.error(`[radar-yt lastRun] ${e.message}`);
    }
  }
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

  try {
    const r = await correrUna(busqueda, existing, temas, startedAt);
    try {
      await updateRadarBusquedaLastRun(busqueda.recordId, startedAt);
    } catch (e) {
      console.error(`[radar-yt lastRun] ${e.message}`);
    }
    return { ok: true, ...r };
  } catch (err) {
    console.error(`[radar-yt "${busqueda.etiqueta}"] ERROR:`, err.message);
    return { ok: false, error: err.message, nuevos: 0 };
  }
}

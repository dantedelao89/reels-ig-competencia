// Barrido: mira qué han publicado los canales que Dante tiene en Fuentes, por RSS y gratis.
//
// ## Por qué existe
//
// Dante lo estaba haciendo A MANO. Medido el 23 oct 2026: 99 corridas de Apify, canal por canal,
// pulsando «rescrapear» en Fuentes — **$3.88**, el 71% de su gasto del periodo. No era una
// comodidad que faltaba; era un trabajo caro y repetitivo que el sistema podía hacer solo.
//
// Por RSS cuesta **$0.00** frente a los ~$3-4 de barrer los 124 por Apify. Esa diferencia es lo que
// permite barrerlos TODOS: por Apify habría que elegir a cuáles renunciar.
//
// ## Por qué no avisa de todo
//
// 124 creadores publican entre 30 y 80 videos al día. Mandarlos a Slack sería garantizar que el
// canal quede silenciado en tres días, que es la única forma de que un sistema de avisos falle del
// todo. Lo que entra se guarda y se ordena en la pantalla; solo escribe si algo cruza el mismo
// umbral que el resto del radar.
//
// ## El id que no está en la base
//
// `yt_channels` guarda `@handles` y el RSS necesita el id `UC…`. Hay una caché en
// `datos/canales-yt.json` y, para los que no estén en ella, se resuelve al vuelo: así añadir un
// canal desde Fuentes sigue funcionando sin que nadie despliegue nada.

import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { getActiveChannels, getRadarTemas } from './sources.js';
import { getExistingRadarIds, syncRadar } from './supabase.js';
import { clasificar, velocidadPorHora } from './radarTemas.js';
import { leerFeed } from './centinela.js';
import { elegirAvisos, formatearAviso, enviarSlack } from './radarAviso.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let cacheIds = null;
function cache() {
  if (cacheIds) return cacheIds;
  try {
    cacheIds = JSON.parse(readFileSync(new URL('../datos/canales-yt.json', import.meta.url), 'utf8'));
  } catch {
    // Sin caché se resuelve todo al vuelo: más lento, pero funciona. Peor sería no barrer.
    cacheIds = {};
  }
  return cacheIds;
}

export function handleDe(url) {
  const m = /@([^/?#]+)/.exec(String(url || ''));
  return m ? m[1] : null;
}

// Resuelve un @handle a su id de canal leyendo el enlace canónico de su página. Es la única forma:
// el feed RSS solo acepta `channel_id`, no el handle.
export async function resolverId(handle) {
  const res = await fetch(`https://www.youtube.com/@${handle}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new Error('el canal ya no existe');
  const html = await res.text();
  const m = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/.exec(html);
  if (!m) throw new Error('no se pudo leer el id del canal');
  const nom = /<meta property="og:title" content="([^"]*)"/.exec(html);
  return { id: m[1], nombre: nom ? nom[1] : handle };
}

async function feed(id) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, {
    headers: { 'User-Agent': 'disecta-barrido/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`feed devolvió ${res.status}`);
  return leerFeed(await res.text());
}

// De 3 en 3 con pausa. Es el ritmo con el que YouTube deja de cortar conexiones: medido el 22 oct
// 2026, con 6 a la vez murieron 18 de 51 peticiones con `fetch failed` y se perdió el 35% de la
// cobertura sin un solo error visible. Con 124 canales esa forma de fallar sería invisible.
async function enTandas(items, limite, fn, pausaMs = 700) {
  const salida = [];
  for (let i = 0; i < items.length; i += limite) {
    if (i && pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
    salida.push(...(await Promise.all(items.slice(i, i + limite).map(fn))));
  }
  return salida;
}

function aHallazgo(v, canal, refIso) {
  const fechaMs = v.publicado ? new Date(v.publicado).getTime() : null;
  return {
    id: v.id,
    handle: canal.handle,
    nombre: canal.nombre,
    creadorUrl: `https://www.youtube.com/channel/${canal.id}`,
    seguidores: null,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    texto: v.titulo,
    fecha: v.publicado,
    // El feed no trae vistas. Se guarda sin ellas y el radar las completa cuando ese video salga
    // en alguna búsqueda; forzar una ficha por video sería volver al 429.
    views: null,
    likes: null,
    comentarios: null,
    duracionSeg: null,
    tipo: 'Video',
    hashtags: [],
    videoThumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    videoUrl: null,
    velocidad: velocidadPorHora(null, fechaMs, refIso),
  };
}

// Una pasada: lee el feed de cada canal activo de Fuentes, guarda lo nuevo y avisa solo de lo que
// cruce el umbral.
export async function barrerCanales({ maxHoras = 48, avisar = true, soloConTema = true } = {}) {
  const refMs = Date.now();
  const refIso = new Date(refMs).toISOString();
  const problemas = [];

  const canales = await getActiveChannels();
  const temas = await getRadarTemas();
  const yaEstaban = await getExistingRadarIds('yt');
  const ids = cache();

  // 1. Cada canal a su id, de la caché o resolviéndolo.
  const resueltos = [];
  const porResolver = [];
  for (const c of canales) {
    const handle = handleDe(c.channelUrl);
    if (!handle) {
      problemas.push({ canal: c.channelUrl, error: 'sin @handle en la URL' });
      continue;
    }
    if (ids[handle]) resueltos.push({ handle, ...ids[handle] });
    else porResolver.push(handle);
  }
  await enTandas(porResolver, 3, async (handle) => {
    try {
      const r = await resolverId(handle);
      ids[handle] = r;
      resueltos.push({ handle, ...r });
    } catch (e) {
      problemas.push({ canal: handle, error: e.message });
    }
  });

  // 2. El feed de cada uno, y lo publicado dentro de la ventana que no se hubiera visto.
  const nuevos = [];
  await enTandas(resueltos, 3, async (canal) => {
    try {
      for (const v of await feed(canal.id)) {
        const horas = (refMs - new Date(v.publicado).getTime()) / 3_600_000;
        if (!(horas >= 0 && horas <= maxHoras)) continue;
        if (yaEstaban.has(String(v.id))) continue;
        yaEstaban.add(String(v.id));
        const h = aHallazgo(v, canal, refIso);
        h.temas = clasificar(`${h.texto || ''}`, temas);
        if (soloConTema && !h.temas.length) continue;
        nuevos.push({ h, canal });
      }
    } catch (e) {
      problemas.push({ canal: canal.nombre || canal.handle, error: e.message });
    }
  });

  // 3. Guardar, con el canal como «consulta» para poder filtrar por él en la pantalla.
  for (const { h, canal } of nuevos) {
    try {
      await syncRadar([h], {
        plataforma: 'yt',
        busqueda: { etiqueta: `canal · ${canal.nombre || canal.handle}` },
        scrapedAtIso: refIso,
        clasificar: (texto) => clasificar(texto, temas),
      });
    } catch (e) {
      problemas.push({ video: h.id, error: e.message });
    }
  }

  // 4. Avisar solo de lo que cruce el umbral. Sin vistas en el feed, la velocidad sale nula y casi
  // nada cruzará: es lo correcto, porque un video recién salido de un creador cualquiera no es
  // noticia hasta que demuestra algo.
  let aviso = null;
  if (avisar) {
    const candidatos = nuevos.map(({ h }) => h);
    const elegidos = elegirAvisos(candidatos, new Map());
    if (elegidos.length) {
      const r = await enviarSlack(formatearAviso(elegidos, candidatos, refMs, '🔥 De los canales que sigues'));
      aviso = { enviados: elegidos.length, ok: r.ok };
    } else {
      aviso = { enviados: 0, ok: true };
    }
  }

  return {
    ok: true,
    canales: canales.length,
    resueltos: resueltos.length,
    resueltosAlVuelo: porResolver.length - problemas.filter((p) => p.canal && !p.video).length,
    nuevos: nuevos.length,
    titulos: nuevos.slice(0, 20).map(({ h, canal }) => `${canal.nombre || canal.handle}: ${h.texto}`),
    aviso,
    problemas,
  };
}

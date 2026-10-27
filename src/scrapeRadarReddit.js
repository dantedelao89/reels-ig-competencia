// Radar de Reddit: corre las búsquedas guardadas y deja los hallazgos en `radar` con
// `plataforma: 'rd'`.
//
// ## Qué pregunta responde, y por qué no la responde nada de lo que ya había
//
// El resto del sistema responde «qué videos existen ya»: el centinela vigila diez canales
// oficiales, el barrido los 124 de Fuentes y las consultas buscan en YouTube. Las tres miran
// resultados, así que las tres llegan DESPUÉS de que alguien publicó. Reddit responde «de qué se
// está hablando antes de que haya videos».
//
// Medido el 27 oct 2026, en una sola corrida: «Halloween 🎃 Wan 3.0 vs Kling 4.0» y «Kling 4.0 is
// quite a good cheaper alternative to Seedance 2.5». Números de versión y comparaciones hechas,
// que el centinela no ve porque ningún canal oficial había publicado nada. Y aparecieron
// subreddits dedicados por modelo que el sistema no miraba: r/HiggsfieldAI, r/KlingAI_Videos,
// r/Seedance_AI, r/Akool_Official.
//
// ## Una corrida, no una por consulta (y lo que cuesta cada decisión)
//
// A diferencia del radar de X, aquí el freno de presupuesto se comprueba UNA vez, porque toda la
// pasada es una sola corrida de Apify. No es un descuido: el actor cobra sobre todo por arranque
// —una corrida vacía cuesta $0.04— así que seis consultas en una corrida salen por lo que cuesta
// una, y partirlas en seis multiplicaría el gasto por seis sin traer nada más. El tope duro por
// corrida sigue puesto, así que el peor caso está acotado igual.
//
// La contrapartida es la ATRIBUCIÓN: el actor no dice qué búsqueda trajo cada item. Se resuelve
// buscando el término en el texto del post, y eso acierta casi siempre porque las búsquedas son
// nombres de modelos y el nombre aparece en el título. Cuando no se puede decidir, el hallazgo se
// queda sin consulta en vez de atribuirse a la primera: una atribución inventada es peor que
// ninguna, porque la pantalla agrupa por consulta.

import { config } from './config.js';
import {
  getActiveRadarBusquedas,
  getRadarTemas,
  updateRadarBusquedaLastRun,
} from './sources.js';
import { scrapeRedditSearches } from './redditApify.js';
import { clasificar, velocidadPorHora } from './radarTemas.js';
import { syncRadar, getExistingRadarIds } from './supabase.js';
import { puedeCorrerRadar } from './apifyPresupuesto.js';
import { elegirParaResumenReddit, formatearResumenReddit, enviarSlack } from './radarAvisoReddit.js';

// Qué búsqueda trajo este post. Se compara contra título, cuerpo y nombre del subreddit, en
// minúsculas, y gana la coincidencia más LARGA: con las consultas «sora 2» y «sora», un post que
// diga «sora 2» debe atribuirse a la específica, no a la genérica.
export function atribuir(post, busquedas) {
  const heno = `${post.texto || ''} ${post.nombre || ''}`.toLowerCase();
  let mejor = null;
  for (const b of busquedas) {
    const aguja = String(b.consulta || '').toLowerCase().trim();
    if (!aguja || !heno.includes(aguja)) continue;
    if (!mejor || aguja.length > String(mejor.consulta).length) mejor = b;
  }
  return mejor;
}

export async function runRadarReddit({ avisar = false } = {}) {
  const startedAt = new Date().toISOString();
  const ahoraMs = new Date(startedAt).getTime();

  let busquedas;
  let existing;
  let temas;
  try {
    busquedas = await getActiveRadarBusquedas('rd');
    existing = await getExistingRadarIds('rd');
    temas = await getRadarTemas();
  } catch (err) {
    console.error('[radar-rd] no se pudieron leer las consultas:', err.message);
    return { ok: false, error: err.message, consultas: 0, nuevos: 0 };
  }
  if (!busquedas.length) {
    // En voz alta, como en X: un «0 consultas» silencioso se lee igual que «hoy no hubo nada».
    console.warn('[radar-rd] Reddit no tiene NINGUNA consulta activa: no hay nada que buscar');
    return { ok: true, consultas: 0, nuevos: 0, aviso: 'sin consultas activas' };
  }

  const presupuesto = await puedeCorrerRadar();
  if (!presupuesto.puede) {
    return {
      ok: true,
      detenido: 'presupuesto',
      gastado: presupuesto.gastado,
      tope: presupuesto.tope,
      consultas: busquedas.length,
      nuevos: 0,
    };
  }

  // `max_por_corrida` es por consulta en las otras plataformas; aquí la corrida es una sola, así
  // que se suma. Si nadie lo puso, 5 por consulta.
  const maxItems = busquedas.reduce((acc, b) => acc + (b.maxPorCorrida || 5), 0);

  let posts;
  try {
    posts = await scrapeRedditSearches({
      consultas: busquedas.map((b) => b.consulta),
      maxItems,
      maxUsd: config.radarRedditMaxUsdPorCorrida,
      sort: config.radarRedditSort,
      time: config.radarRedditTime,
    });
  } catch (err) {
    console.error('[radar-rd] la corrida falló:', err.message);
    return { ok: false, error: err.message, consultas: busquedas.length, nuevos: 0 };
  }

  // El cero NO se traga en silencio. Desde el 27 oct 2026 una corrida FALLIDA ya lanza
  // (`apifyRun.js` mira `run.status`), así que llegar aquí con cero significa de verdad «hoy no
  // había nada», no «el actor se rompió». Se avisa igual porque cero en seis consultas de `rising`
  // es raro y conviene verlo en el log si empieza a repetirse.
  if (!posts.length) {
    console.warn(`[radar-rd] cero resultados para ${busquedas.length} consultas activas`);
  }

  posts.forEach((p) => {
    p.velocidad = velocidadPorHora(p.likes, p.fecha ? new Date(p.fecha).getTime() : null, ahoraMs);
  });

  // Piso de calidad ANTES de guardar: en Reddit la propia comunidad ya votó, y un post que va
  // hundido no mejora porque lo guardemos. Medido el 27 oct 2026, el filtro se lleva 14 de 30 y
  // casi todo lo que se lleva es ruido que las búsquedas no pueden evitar (Reddit no tiene
  // operadores, así que `veo 3` trae «a VEO from Microsoft» de r/hyderabad y no hay forma de
  // excluirlo en la consulta).
  //
  // `ratio == null` PASA: sin `includeMediaLinks` no hay proporción, y en ese caso el filtro no
  // debe tragarse todo en silencio.
  const minRatio = config.radarRedditRatioMinimo;
  const hundidos = posts.filter((p) => p.ratio != null && p.ratio < minRatio);
  const buenos = posts.filter((p) => !(p.ratio != null && p.ratio < minRatio));
  if (hundidos.length) {
    console.log(
      `[radar-rd] ${hundidos.length} de ${posts.length} descartados por ir hundidos ` +
        `(menos de ${Math.round(minRatio * 100)}% a favor)`
    );
  }

  const nuevos = buenos.filter((p) => !existing.has(String(p.id)));

  // Se agrupa por consulta porque `syncRadar` escribe `busqueda_id` y `busqueda_etiqueta` para
  // todas las filas del lote: con una sola llamada, todos los hallazgos quedarían atribuidos a la
  // misma consulta.
  const porBusqueda = new Map();
  const huerfanos = [];
  for (const p of nuevos) {
    const b = atribuir(p, busquedas);
    if (!b) {
      huerfanos.push(p);
      continue;
    }
    if (!porBusqueda.has(b.recordId)) porBusqueda.set(b.recordId, { busqueda: b, posts: [] });
    porBusqueda.get(b.recordId).posts.push(p);
  }

  const details = [];
  for (const { busqueda, posts: suyos } of porBusqueda.values()) {
    try {
      await syncRadar(suyos, {
        plataforma: 'rd',
        busqueda,
        scrapedAtIso: startedAt,
        clasificar: (texto) => clasificar(texto, temas),
      });
      suyos.forEach((p) => {
        p.busquedaEtiqueta = busqueda.etiqueta;
        existing.add(String(p.id));
      });
      details.push({ busqueda: busqueda.etiqueta, nuevos: suyos.length });
    } catch (err) {
      console.error(`[radar-rd "${busqueda.etiqueta}"] ERROR al guardar:`, err.message);
      details.push({ busqueda: busqueda.etiqueta, error: err.message });
    }
  }
  if (huerfanos.length) {
    try {
      await syncRadar(huerfanos, {
        plataforma: 'rd',
        scrapedAtIso: startedAt,
        clasificar: (texto) => clasificar(texto, temas),
      });
      huerfanos.forEach((p) => existing.add(String(p.id)));
    } catch (err) {
      console.error('[radar-rd] ERROR al guardar los no atribuidos:', err.message);
    }
  }

  for (const b of busquedas) {
    try {
      await updateRadarBusquedaLastRun(b.recordId, startedAt);
    } catch (e) {
      console.error(`[radar-rd lastRun] ${e.message}`);
    }
  }

  const porComunidad = [...new Set(buenos.map((p) => p.nombre).filter(Boolean))];
  console.log(
    `[radar-rd] ${busquedas.length} consultas · ${posts.length} traídos · ${hundidos.length} hundidos` +
      ` · ${nuevos.length} nuevos · ${porComunidad.length} subreddits · ${huerfanos.length} sin atribuir`
  );

  let aviso = null;
  if (avisar) {
    const elegidos = elegirParaResumenReddit(nuevos, {
      maxHoras: config.radarRedditResumenMaxHoras,
      cuantos: config.radarRedditResumenCuantos,
      ahoraMs,
    });
    aviso = elegidos.length
      ? {
          mostrados: elegidos.length,
          ...(await enviarSlack(
            formatearResumenReddit(elegidos, {
              consultas: busquedas.length,
              nuevos: nuevos.length,
              subreddits: porComunidad.length,
              ahoraMs,
            })
          )),
        }
      : { mostrados: 0, motivo: nuevos.length ? 'nada dentro de la ventana de edad' : 'sin hallazgos nuevos' };
  }

  return {
    ok: true,
    consultas: busquedas.length,
    traidos: posts.length,
    hundidos: hundidos.length,
    nuevos: nuevos.length,
    sinAtribuir: huerfanos.length,
    subreddits: porComunidad,
    aviso,
    details,
  };
}

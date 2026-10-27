// Reddit para el radar, con `trudax/reddit-scraper-lite`.
//
// ## Las tres cosas que hay que saber de este actor, todas medidas el 27 oct 2026
//
// 1. **El tope por corrida tiene que librar el costo de ARRANQUE, o la corrida muere al nacer.**
//    Cuatro corridas seguidas con `maxTotalChargeUsd: 0.05` fallaron en el segundo 2 con
//    `Maximum cost per run is lower then actor start cost` / `Not enough funds`, **y cobraron $0.04
//    cada una**. El actor es PAY_PER_EVENT y cobra `actor-start-gb` a $0.02 por GB; arranca con
//    2 GB, así que el arranque solo son $0.04. El tope de aquí (`radarRedditMaxUsdPorCorrida`,
//    $0.20) está puesto para librarlo con margen: bajarlo a la zona de los centavos no ahorra, hace
//    que todas las corridas fallen pagando.
// 2. **`includeMediaLinks` decide si vienen los upvotes, y NO es lo que cuesta.** El nombre
//    engaña: sin él no hay `upVotes`, `upVoteRatio`, `numberOfComments` ni `videoUrls`, o sea
//    ninguna métrica — y sin `upVoteRatio` se pierde el único filtro de ruido que funciona en
//    Reddit (ver `radarRedditRatioMinimo`). Su descripción avisa de que «may affect performance», y
//    por eso di por hecho que era el motivo de que la pasada tardara 11 minutos. **Es falso,
//    medido**: la misma pasada con `includeMediaLinks: false` iba a $0.1122 en 8 minutos, el mismo
//    ritmo (~$0.014/minuto) que con él en true. Lo que cuesta es rastrear las páginas de resultados
//    de Reddit, que responden 403 y hay que reintentar. Así que va siempre en true: las métricas
//    salen gratis.
// 3. **Una corrida por TODAS las búsquedas, no una por búsqueda.** `searches` es un array, y con un
//    arranque de $0.04 por corrida, seis búsquedas en seis corridas pagan el arranque seis veces.
//    Medido: tres búsquedas en una corrida, $0.0742. El arranque es la mitad del costo.
//
// El `proxy` va en RESIDENTIAL porque es lo que usaba la corrida que funcionó, y Reddit es conocido
// por bloquear datacenter. **No está comprobado que haga falta**: cuando los ceros se explicaron por
// el tope de gasto, no quedó ninguna prueba de que el proxy normal falle. Si algún día el costo
// molesta, ese es el primer sitio donde mirar — pero hay que medirlo antes de cambiarlo.
//
// ## Por qué `rising` y qué significa eso para las métricas
//
// `sort: 'rising'` es lo que coge un post ANTES de que explote, que es el punto de tener Reddit:
// el centinela vigila canales y por eso no ve un lanzamiento hasta que alguien publica un video.
// En una sola corrida salieron «Wan 3.0 vs Kling 4.0» y «Kling 4.0 is quite a good cheaper
// alternative to Seedance 2.5» — números de versión y comparaciones listas para usar.
//
// La contrapartida: un post en `rising` tiene 1, 3 o 5 upvotes, no mil. Así que **en Reddit la
// velocidad no ordena nada útil** y el valor está en el TÍTULO. Se guarda igual por coherencia con
// las otras plataformas, pero quien lea esto no debería construir un umbral encima.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// `videoUrls` viene ordenado de menor a mayor resolución, así que la última es la mejor. El radar
// no archiva nada: se guarda la URL por si el post se promueve después.
function mejorVideo(urls) {
  return Array.isArray(urls) && urls.length ? urls[urls.length - 1] : null;
}

export function normalizeRedditPost(raw) {
  if (!raw || raw.dataType !== 'post') return null;
  const titulo = String(raw.title || '').trim();
  const cuerpo = String(raw.body || '').trim();
  return {
    id: raw.id || raw.parsedId || null,
    // `url` es el permalink de Reddit y `link` el medio o el enlace externo. Para el radar manda el
    // permalink: es donde están los comentarios, que en Reddit suelen valer más que el post.
    url: raw.url || null,
    // Título Y cuerpo. El título es la señal —ahí van los números de versión— pero el cuerpo trae
    // el contexto y es lo que hace que el clasificador por alias acierte más.
    texto: [titulo, cuerpo].filter(Boolean).join('\n\n'),
    titulo,
    handle: raw.username || null,
    // El "quién" que importa en Reddit es el SUBREDDIT, no el autor: es lo que se sigue y lo que
    // dice de qué va el hallazgo. r/HiggsfieldAI y r/Seedance_AI no los miraba nada del sistema.
    nombre: raw.communityName || null,
    comunidad: raw.parsedCommunityName || null,
    creadorUrl: raw.username ? `https://www.reddit.com/user/${raw.username}` : null,
    // Reddit no tiene seguidores. Se deja explícito en null para que nadie calcule una proporción
    // por tamaño de cuenta como en X: aquí no existe ese dato.
    seguidores: null,
    views: null,
    likes: num(raw.upVotes),
    // La proporción de votos positivos es la señal de calidad propia de Reddit, y hace el papel que
    // en X hacen los seguidores: 1.0 es consenso, 0.6 es polémica.
    ratio: num(raw.upVoteRatio),
    comentarios: num(raw.numberOfComments),
    fecha: raw.createdAt || null,
    tipo: raw.contentType === 'video' ? 'Video' : raw.contentType === 'image' ? 'Imagen' : 'Texto',
    videoUrl: mejorVideo(raw.videoUrls),
    videoThumb: null,
    hashtags: [],
    // El `link` solo es "externo" si sale de Reddit: cuando el post es un video, `link` apunta al
    // v.redd.it del propio Reddit y guardarlo como enlace externo sería mentir.
    linksExternos:
      raw.link && !/(^https?:\/\/(www\.)?reddit\.com|\.redd\.it)/i.test(raw.link) ? [raw.link] : [],
    idioma: null,
    conversationId: null,
  };
}

// Una sola corrida para todas las consultas. Cada item NO dice qué búsqueda lo trajo, así que la
// atribución se hace por texto en el runner; ver el comentario de `atribuir` allí.
export async function scrapeRedditSearches({ consultas, maxItems, maxUsd, sort = 'rising', time = 'day' }) {
  const searches = (consultas || []).map((c) => String(c).trim()).filter(Boolean);
  if (!searches.length) return [];

  const items = await runActorItems(
    config.redditActorId,
    {
      searches,
      sort,
      time,
      searchPosts: true,
      searchComments: false,
      searchCommunities: false,
      searchUsers: false,
      searchMedia: false,
      skipComments: true,
      maxComments: 0,
      // Ver la nota 2 de arriba: sin esto no hay ni una métrica.
      includeMediaLinks: true,
      maxItems: maxItems || 30,
      // Tope por página de resultados, para que una búsqueda popular no se coma el `maxItems` de
      // todas las demás.
      maxPostCount: 10,
      startUrls: [],
      ignoreStartUrls: true,
      skipUserPosts: false,
      skipCommunity: false,
      includeNSFW: true,
      // Ver la nota 1: sin RESIDENTIAL devuelve 0 items en silencio y cobra igual.
      proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    },
    { maxTotalChargeUsd: maxUsd || undefined }
  );

  return items.map(normalizeRedditPost).filter((p) => p && p.id && p.url);
}

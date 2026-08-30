// Actor de X/Twitter (danek) y normalización de sus dos formas de salida.
//
// UN solo actor cubre las dos rutas —`username` para una cuenta, `lookup_post_ids` para un post
// suelto— pero DEVUELVE DOS SHAPES DISTINTOS, y ahí está la trampa: la ruta de perfil usa
// `tweet_id`/`favorites` y deja el autor casi vacío, mientras la de lookup usa `id`/`likes` y sí
// trae el autor completo. Leer `it.id` sin más en la ruta de perfil da undefined, o sea que se
// pierde el identificador y el dedup deja de funcionar. Por eso todo pasa por normalizeXPost.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

export function normalizeXHandle(v) {
  const s = (v || '').trim();
  const deUrl = s.match(/(?:twitter|x)\.com\/([^/?\s]+)/i);
  return (deUrl ? deUrl[1] : s).replace(/^@/, '').toLowerCase();
}

export function xPostIdFromUrl(url) {
  const m = (url || '').match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

// ¿Es un retweet? Vienen con el texto recortado a 140 caracteres y son contenido de otro:
// se descartan antes de gastar en rehospedar nada.
function esRetweet(raw) {
  return /^RT @\w+:/.test(String(raw.text || ''));
}

// La mejor variante MP4: la de mayor bitrate. El actor también devuelve un .m3u8 (HLS) que no
// sirve ni para descargar ni para transcribir, así que se filtra por content_type.
function mejorMp4(variants) {
  const mp4 = (variants || []).filter((v) => v && v.content_type === 'video/mp4' && v.url);
  if (!mp4.length) return null;
  return mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0].url;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Aplana los dos shapes del actor a uno solo. `handleFallback` es el handle de la cuenta que se
// pidió: hace falta porque en la ruta de perfil `author.screen_name` viene null.
export function normalizeXPost(raw, handleFallback = '') {
  if (!raw) return null;
  const id = String(raw.id || raw.tweet_id || '');
  if (!id) return null;

  const autor = raw.author || {};
  const handle = normalizeXHandle(autor.screen_name || handleFallback);
  const videos = raw.media?.video || [];
  const fotos = raw.media?.photo || [];
  const gifs = raw.media?.animated_gif || [];
  const video = videos[0] || gifs[0] || null;

  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
    handle,
    nombre: autor.name || null,
    // El texto completo: es la razón de haber elegido este actor sobre el más popular.
    texto: raw.text || raw.display_text || '',
    fecha: raw.created_at || null,
    // num(): las métricas llegan como número en la ruta de perfil y como STRING en la de lookup
    // (medido: views '5346'). Sin normalizar, la columna bigint recibe texto y el orden por vistas
    // compararía como cadena.
    views: num(raw.views),
    likes: num(raw.favorites ?? raw.likes),
    respuestas: num(raw.replies),
    retweets: num(raw.retweets),
    citas: num(raw.quotes),
    guardados: num(raw.bookmarks),
    idioma: raw.lang || null,
    conversationId: raw.conversation_id ? String(raw.conversation_id) : null,
    esRespuesta: !!(raw.reply_to || raw.in_reply_to_status_id_str),
    videoUrl: video ? mejorMp4(video.variants) : null,
    videoThumb: video?.media_url_https || null,
    duracionSeg: video?.duration ? Math.round(video.duration / 1000) : null,
    fotos: fotos.map((f) => f.media_url_https).filter(Boolean),
    hashtags: (raw.entities?.hashtags || []).map((h) => h.text || h).filter(Boolean),
    linksExternos: (raw.entities?.urls || [])
      .map((u) => u.expanded_url || u.url)
      .filter((u) => u && !/(?:twitter|x)\.com\//i.test(u)),
  };
}

function normalizarLista(items, handleFallback) {
  return (items || [])
    .filter((it) => it && !esRetweet(it))
    .map((it) => normalizeXPost(it, handleFallback))
    .filter(Boolean);
}

// Posts recientes de UNA cuenta.
// OJO: el actor IGNORA `max_posts` a la baja — pidiendo 8 devolvió 20 (medido). Se manda igual
// por si lo respeta hacia arriba, pero el gasto real se acota con el dedup por post_id, no aquí.
export async function scrapeXProfile(username, { maxPosts } = {}) {
  const handle = normalizeXHandle(username);
  const items = await runActorItems(config.xActorId, {
    username: handle,
    search_type: 'Latest', // cronológico: 'Top' devuelve los virales viejos de siempre
    max_posts: maxPosts || config.xDefaultMaxResults,
  });
  return normalizarLista(items, handle);
}

// Uno o varios posts por su id (para "＋Agregar por URL" y Slack).
export async function scrapeXPosts(postIds) {
  const ids = (postIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];
  const items = await runActorItems(config.xActorId, {
    lookup_post_ids: ids,
    max_posts: ids.length,
  });
  return normalizarLista(items, '');
}

// La CONTINUACIÓN del autor sobre su propio post. Hace falta porque en las cuentas de prompts el
// gancho va con el video y el prompt entero en un tweet aparte: sin esto se guarda justo la mitad
// que no sirve (medido en @CharaspowerAI: el post de 255 caracteres con el video, y el prompt
// completo de 1417 en el siguiente).
//
// El actor NO dice a qué tweet responde cada uno: por `post_id` devuelve toda la conversación con
// `conversation_id` igual para todos, sin campo de destino. La señal que sí distingue es el texto:
// una respuesta a un comentarista EMPIEZA con @handle ("@Leo_ideatorx Thanks"), y una continuación
// del hilo no. Se exige además que sea larga, porque lo que interesa es el prompt, no un "gracias".
const MIN_CONTINUACION = 200;

export async function scrapeXThread(postId, handle) {
  const items = await runActorItems(config.xActorId, {
    post_id: String(postId),
    max_posts: config.xDefaultMaxResults,
  });
  const propio = normalizeXHandle(handle);
  return normalizarLista(items, handle)
    .filter(
      (p) =>
        p.id !== String(postId) &&
        p.handle === propio &&
        !/^@\w/.test(p.texto.trim()) &&
        p.texto.trim().length >= MIN_CONTINUACION
    )
    .sort((a, b) => Number(a.id) - Number(b.id));
}

// Une el gancho con sus continuaciones en UN solo post. En la ruta de perfil las continuaciones
// llegan en la misma corrida (comparten conversation_id), así que agrupar aquí sale gratis: no
// hace falta la corrida extra de scrapeXThread.
//
// El representante es el post que ABRE la conversación (id == conversation_id) o, si no vino, el
// que trae el video. Las continuaciones se anexan a su texto y desaparecen como filas propias:
// guardarlas sueltas llenaría la galería de tarjetas sin miniatura.
export function agruparHilos(posts) {
  const porConv = new Map();
  for (const p of posts) {
    const k = p.conversationId || p.id;
    if (!porConv.has(k)) porConv.set(k, []);
    porConv.get(k).push(p);
  }
  const out = [];
  for (const [conv, grupo] of porConv) {
    if (grupo.length === 1) {
      out.push(grupo[0]);
      continue;
    }
    grupo.sort((a, b) => Number(a.id) - Number(b.id));
    const cabeza = grupo.find((p) => p.id === conv) || grupo.find((p) => p.videoUrl) || grupo[0];
    const resto = grupo.filter((p) => p !== cabeza);
    out.push({
      ...cabeza,
      texto: [cabeza.texto, ...resto.map((p) => p.texto)].filter(Boolean).join('\n\n'),
      // Si el gancho no traía media, se hereda la del hilo (a veces el video va en el segundo).
      videoUrl: cabeza.videoUrl || resto.find((p) => p.videoUrl)?.videoUrl || null,
      videoThumb: cabeza.videoThumb || resto.find((p) => p.videoThumb)?.videoThumb || null,
      duracionSeg: cabeza.duracionSeg ?? resto.find((p) => p.duracionSeg != null)?.duracionSeg ?? null,
      fotos: cabeza.fotos.length ? cabeza.fotos : resto.flatMap((p) => p.fotos),
      partesHilo: grupo.length,
    });
  }
  return out;
}

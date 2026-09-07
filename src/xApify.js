// Actor de X/Twitter (danek) y normalización de sus dos formas de salida.
//
// UN solo actor cubre TRES rutas —`username` (cuenta), `lookup_post_ids` (post suelto) y `query`
// (búsqueda del radar)— y cada una DEVUELVE UN SHAPE DISTINTO. Ahí está la trampa:
//   * perfil    → `tweet_id` / `favorites`, y el autor casi vacío (`author.screen_name` null).
//   * lookup    → `id` / `likes`, con `author` completo.
//   * búsqueda  → `tweet_id` / `favorites`, SIN `author`: el handle va en `screen_name` al nivel
//                 raíz y los datos de la cuenta en `user_info` (que además trae followers_count,
//                 el único de los tres que lo da).
// Leer `it.id` o `it.author` sin más falla en dos de las tres. Por eso todo pasa por
// normalizeXPost: se descubrió con el radar guardando 80 hallazgos con el autor en null.

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

  // Las tres procedencias del autor, en orden de fiabilidad. `user_info` es el de la búsqueda.
  const autor = raw.author || raw.user_info || {};
  const handle = normalizeXHandle(autor.screen_name || raw.screen_name || handleFallback);
  const videos = raw.media?.video || [];
  const fotos = raw.media?.photo || [];
  const gifs = raw.media?.animated_gif || [];
  const video = videos[0] || gifs[0] || null;

  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
    handle,
    nombre: autor.name || null,
    // Solo lo da la ruta de búsqueda, y en el radar vale oro: una cuenta de 900 seguidores que
    // hace 3000 likes es un hallazgo; una de 900 mil es rutina.
    seguidores: num(autor.followers_count ?? autor.followers ?? autor.sub_count),
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

// Búsqueda de X con toda su sintaxis avanzada. El actor la pasa tal cual, y eso es lo que hace
// útil al radar: `min_faves:300`, `lang:es`, `-filter:replies`, `since:`… Comprobado que SÍ se
// aplican (con `min_faves:500`, 20 de 20 resultados lo cumplían).
//
// `search_type: 'Latest'` y no 'Top': el radar quiere lo que está saliendo AHORA. Con 'Top' salen
// los virales de siempre, que ya se vieron.
export async function scrapeXQuery(consulta, { maxPosts } = {}) {
  const items = await runActorItems(config.xActorId, {
    query: consulta,
    search_type: 'Latest',
    max_posts: maxPosts || config.xRadarMaxPosts,
  });
  return normalizarLista(items, '');
}

// Todo lo que el AUTOR escribió dentro de su propia conversación, además del post original.
// Son dos cosas distintas y en X se ven parecido:
//
//   * continuación — el autor se responde a sí mismo para seguir el hilo. NO empieza con @.
//     X la muestra pegada al post, así que se une al copy.
//   * respuesta    — el autor contesta a un comentarista, casi siempre a quien preguntó
//     "prompt?". SÍ empieza con @handle. Aquí es donde muchas cuentas sueltan el prompt, así
//     que se guardan aparte y se ven en el detalle. Antes se descartaban con el mismo filtro
//     que quitaba los "gracias", y con ellas se iba el prompt.
//
// Se usa la ruta `post_id` y no la búsqueda `conversation_id:`: medido, la búsqueda devuelve las
// respuestas de terceros pero NINGUNA del autor, mientras que post_id sí las trae.
//
// Sin filtro por largo: una respuesta corta ("Prompt: wide shot, 35mm") puede ser justo lo que
// interesa. La UI las muestra en una sección aparte, así que un "gracias" de más no estorba;
// un prompt de menos, sí.
export async function scrapeXAutorEnConversacion(postId, handle) {
  const items = await runActorItems(config.xActorId, {
    post_id: String(postId),
    max_posts: config.xConversacionMaxPosts,
  });
  const propio = normalizeXHandle(handle);
  return normalizarLista(items, handle)
    .filter((p) => p.id !== String(postId) && p.handle === propio && p.texto.trim())
    .map((p) => ({ ...p, esRespuestaAComentario: /^@\w/.test(p.texto.trim()) }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

// El texto que se guarda como "respuestas del autor" y se indexa para la búsqueda.
export function textoDeRespuestas(respuestas) {
  return (respuestas || []).map((r) => r.texto).filter(Boolean).join('\n\n') || null;
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

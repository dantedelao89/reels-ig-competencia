// Actores de TikTok (clockworks) y extracción de subtítulos.
//
// Dos actores, igual que Instagram: uno para las cuentas (exige `profiles`) y otro para una URL
// de video suelta (`postURLs`). Devuelven EL MISMO shape, así que el mapper es uno solo.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export function normalizeTiktokHandle(v) {
  const s = (v || '').trim();
  const deUrl = s.match(/tiktok\.com\/@([^/?\s]+)/i);
  return (deUrl ? deUrl[1] : s).replace(/^@/, '').toLowerCase();
}

export function tiktokVideoIdFromUrl(url) {
  const m = (url || '').match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

// Resuelve cualquier link de TikTok a su URL canónica (@usuario/video/id).
//
// Hace falta porque el botón Compartir del móvil da un link corto (vt.tiktok.com / vm.tiktok.com)
// y NINGÚN actor lo resuelve: responden "Post not found or private". El redirect da el id del
// video pero con el handle vacío (`/@/video/id`), y el actor exige el handle real.
//
// De paso detecta ANTES de gastar en el actor si el video no es accesible. El caso que se vio en
// producción: un "dark post" (statusCode 10240), o sea un anuncio que no está publicado en el
// perfil del creador y por eso no existe en la API pública.
export async function resolveTiktokUrl(url) {
  const limpio = (url || '').trim();
  let videoId = tiktokVideoIdFromUrl(limpio);
  let handle = (limpio.match(/tiktok\.com\/@([^/?\s]+)/i) || [])[1] || '';

  // Link corto: se sigue la redirección para sacar el id.
  if (!videoId) {
    try {
      const res = await fetch(limpio, {
        redirect: 'follow',
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20000),
      });
      videoId = tiktokVideoIdFromUrl(res.url);
      handle = (res.url.match(/tiktok\.com\/@([^/?\s]+)/i) || [])[1] || '';
    } catch (e) {
      return { error: `No se pudo abrir el link de TikTok (${e.message})` };
    }
  }
  if (!videoId) return { error: 'No pude sacar el id del video de ese link de TikTok' };

  // Con el handle vacío la página igual trae el autor real, así que sirve para completar la URL
  // y de paso para saber si el video está disponible.
  // Con reintentos porque TikTok devuelve la página SIN el bloque de datos de forma intermitente
  // (medido: 1 de cada 3 intentos): con un solo intento el link corto fallaba a ratos.
  for (let intento = 1; intento <= 3 && !handle; intento++) {
    try {
      const res = await fetch(`https://www.tiktok.com/@/video/${videoId}`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' },
        signal: AbortSignal.timeout(20000),
      });
      const html = await res.text();
      const m = html.match(/id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        const data = JSON.parse(m[1]);
        const det = data?.__DEFAULT_SCOPE__?.['webapp.video-detail'] || {};
        const status = det.statusCode;
        if (status && status !== 0) {
          const motivo =
            status === 10240
              ? 'es un anuncio (dark post): no está publicado en el perfil del creador, así que no existe en la API pública de TikTok'
              : `TikTok lo marca como no disponible (${det.statusMsg || 'privado o borrado'})`;
          return { error: `Ese video no se puede scrapear: ${motivo}`, videoId, status };
        }
        handle = det?.itemInfo?.itemStruct?.author?.uniqueId || '';
      }
    } catch (e) {
      console.warn(`[TT resolve] intento ${intento}: ${e.message}`);
    }
    if (!handle && intento < 3) await new Promise((r) => setTimeout(r, 1500 * intento));
  }
  if (!handle) {
    return {
      error:
        'No pude identificar la cuenta de ese video (TikTok no devolvió los datos). ' +
        'Prueba pegando el link completo de la app de escritorio: tiktok.com/@usuario/video/…',
      videoId,
    };
  }
  return { url: `https://www.tiktok.com/@${handle}/video/${videoId}`, videoId, handle };
}

// Videos de una o varias cuentas. `oldestPostDateUnified` acepta una fecha o un NÚMERO DE DÍAS
// como string ('1' = solo hoy) — no el formato "2 days" que usa YouTube.
export async function scrapeTiktokProfiles({ usernames, resultsPerPage, oldestPostDateUnified }) {
  const input = {
    profiles: usernames.map(normalizeTiktokHandle).filter(Boolean),
    profileScrapeSections: ['videos'],
    profileSorting: 'latest',
    resultsPerPage,
    // Los fijados van SIEMPRE primero en el perfil y suelen ser de hace años. Sin excluirlos, con
    // resultsPerPage bajo se llevan todos los cupos y no llega nunca contenido nuevo (medido:
    // pidiendo 3 videos "latest" de @luisitocomunica salían 3 de 2021). Un fijado concreto que
    // interese se agrega por URL.
    excludePinnedPosts: true,
    shouldDownloadVideos: false, // el video se enlaza a TikTok; solo archivamos la portada
    shouldDownloadCovers: false, // la portada la rehospedamos nosotros a R2
    shouldDownloadSlideshowImages: false,
    commentsPerPost: 0,
    downloadSubtitlesOptions: config.tiktokDownloadSubtitles
      ? 'DOWNLOAD_SUBTITLES' // los que TikTok ya trae, gratis. Transcribir con IA se hace a pedido.
      : 'NEVER_DOWNLOAD_SUBTITLES',
  };
  if (oldestPostDateUnified) input.oldestPostDateUnified = String(oldestPostDateUnified);

  const items = await runActorItems(config.tiktokActorId, input);
  return items.filter((it) => it && it.id && !it.error);
}

// Un video suelto por su URL (para "＋Agregar por URL" y Slack).
export async function scrapeTiktokUrls(urls, { downloadVideo = false } = {}) {
  const items = await runActorItems(config.tiktokUrlActorId, {
    postURLs: urls,
    resultsPerPage: urls.length,
    shouldDownloadVideos: downloadVideo,
    shouldDownloadCovers: false,
    commentsPerPost: 0,
    downloadSubtitlesOptions: downloadVideo ? 'NEVER_DOWNLOAD_SUBTITLES' : 'DOWNLOAD_SUBTITLES',
  });
  return items.filter((it) => it && it.id && !it.error);
}

// URL de un MEDIO reproducible del video, para transcribirlo con IA.
// Hace falta una corrida aparte porque sin `shouldDownloadVideos` el actor no devuelve ninguna
// URL de video (medido: `videoMeta.downloadAddr` ni siquiera existe como campo). La URL pública
// de TikTok es una página HTML, así que pasársela a la transcripción no funciona.
export async function getTiktokMediaUrl(videoUrl) {
  const items = await scrapeTiktokUrls([videoUrl], { downloadVideo: true });
  const it = items[0];
  if (!it) return null;
  return it.mediaUrls?.[0] || it.videoMeta?.downloadAddr || null;
}

// --- Subtítulos ---

const MAX_SUBTITLE_CHARS = 1_000_000;

// Convierte un VTT (o SRT, que algunos enlaces devuelven) a texto plano.
// Lo importante: TikTok manda subtítulos "rolling", que repiten la línea anterior en cada cue.
// Sin deduplicar líneas consecutivas, el texto sale al doble o al triple.
export function vttToText(raw) {
  if (!raw) return '';
  const lineas = String(raw).split(/\r?\n/);
  const out = [];
  for (let l of lineas) {
    l = l.trim();
    if (!l) continue;
    if (/^WEBVTT/i.test(l) || /^(NOTE|STYLE|Kind:|Language:)/i.test(l)) continue;
    if (l.includes('-->')) continue;
    if (/^\d+$/.test(l)) continue; // índice de cue en SRT
    l = l
      .replace(/<[^>]+>/g, '') // <c>, <00:00:01.000>
      .replace(/\{\\[^}]+\}/g, '') // {\an8}
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
    if (!l) continue;
    if (out.length && out[out.length - 1] === l) continue; // el rolling de TikTok
    out.push(l);
  }
  let texto = out.join(' ').replace(/\s+/g, ' ').trim();
  if (texto.length > MAX_SUBTITLE_CHARS) texto = texto.slice(0, MAX_SUBTITLE_CHARS) + '… [recortado]';
  return texto;
}

// Elige la mejor pista: español si existe, y entre iguales la que no sea traducción automática.
function mejorPista(subtitleLinks) {
  const conLink = (subtitleLinks || [])
    .map((e) => ({
      e,
      lang: String(e?.language ?? e?.languageCodeName ?? e?.lang ?? e?.languageID ?? ''),
      link: e?.downloadLink ?? e?.link ?? e?.url ?? e?.tiktokLink ?? '',
    }))
    .filter((x) => x.link);
  if (!conLink.length) return null;
  const puntos = (x) => {
    const auto = /MT|translat/i.test(String(x.e?.source ?? x.e?.sourceUnabbreviated ?? ''));
    return (/^es/i.test(x.lang) ? 2 : 0) + (auto ? 0 : 1);
  };
  return conLink.sort((a, b) => puntos(b) - puntos(a))[0].link;
}

// Baja los subtítulos gratis y los devuelve como texto plano.
// NUNCA lanza: un enlace caído no puede tumbar la corrida entera, el video simplemente queda
// sin texto y se transcribe a pedido desde el detalle.
export async function fetchSubtitles(subtitleLinks) {
  const link = mejorPista(subtitleLinks);
  if (!link) return '';
  try {
    const res = await fetch(link, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return '';
    return vttToText(await res.text());
  } catch (e) {
    console.warn(`[TT subtítulos] no se pudieron bajar: ${e.message}`);
    return '';
  }
}

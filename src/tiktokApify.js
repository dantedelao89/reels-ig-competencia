// Actores de TikTok (clockworks) y extracción de subtítulos.
//
// Dos actores, igual que Instagram: uno para las cuentas (exige `profiles`) y otro para una URL
// de video suelta (`postURLs`). Devuelven EL MISMO shape, así que el mapper es uno solo.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

export function normalizeTiktokHandle(v) {
  const s = (v || '').trim();
  const deUrl = s.match(/tiktok\.com\/@([^/?\s]+)/i);
  return (deUrl ? deUrl[1] : s).replace(/^@/, '').toLowerCase();
}

export function tiktokVideoIdFromUrl(url) {
  const m = (url || '').match(/\/video\/(\d+)/);
  return m ? m[1] : null;
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
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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

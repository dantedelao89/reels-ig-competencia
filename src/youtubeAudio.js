// Obtiene la URL de audio de un video de YouTube vía epicscrapers/youtube-audio-downloader.
// Este actor DESCARGA el audio a un archivo con link permanente (audio_url), descargable desde
// cualquier IP — a diferencia de los actores que devuelven URLs de googlevideo firmadas por IP
// (que dan 403 al bajarlas desde otro servidor). Lo usa la transcripción manual bajo demanda.

import { runActorItems } from './apifyRun.js';

const AUDIO_ACTOR = 'epicscrapers/youtube-audio-downloader';

// Devuelve un link descargable al audio (m4a) de un video de YouTube. Reintenta si falla
// (el actor reporta ~90% de éxito y escala a proxies residenciales solo en algunos intentos).
export async function getYoutubeAudioUrl(videoUrl) {
  let lastDetail = 'sin audio';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const items = await runActorItems(AUDIO_ACTOR, {
      videoUrls: [videoUrl],
      audioFormat: 'mp3',
      audioBitrate: '128',
      embedMetadata: false,
    });
    const item = (items || [])[0];
    if (item?.audio_url) return item.audio_url;
    lastDetail = item?.error || item?.status || 'audio_url vacío';
    console.warn(`[youtubeAudio] intento ${attempt}/3 sin audio (${lastDetail}); reintento`);
  }
  throw new Error(`el actor no devolvió audio tras 3 intentos (${lastDetail})`);
}

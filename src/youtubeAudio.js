// Obtiene la URL de audio directo de un video de YouTube vía el actor apple_yang
// (devuelve audioUrl por video). Lo usa la transcripción manual bajo demanda.

import { runActorItems } from './apifyRun.js';

const AUDIO_ACTOR = 'apple_yang/youtube-video-audio-downloader';

// Devuelve la URL de audio-only de un video de YouTube. El actor a veces regresa audioUrl vacío
// de forma transitoria (sin error), así que reintentamos un par de veces.
export async function getYoutubeAudioUrl(videoUrl) {
  let lastDetail = 'sin audio';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const items = await runActorItems(AUDIO_ACTOR, { videoUrls: [videoUrl] });
    const item = (items || [])[0];
    if (item?.audioUrl) return item.audioUrl;
    lastDetail = item?.errMsg || 'audioUrl vacío';
    console.warn(`[youtubeAudio] intento ${attempt}/3 sin audio (${lastDetail}); reintento`);
  }
  throw new Error(`el actor no devolvió audio tras 3 intentos (${lastDetail})`);
}

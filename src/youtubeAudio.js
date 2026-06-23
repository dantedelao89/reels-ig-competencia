// Obtiene la URL de audio directo de un video de YouTube vía el actor apple_yang
// (devuelve audioUrl por video). Lo usa la transcripción manual bajo demanda.

import { runActorItems } from './apifyRun.js';

const AUDIO_ACTOR = 'apple_yang/youtube-video-audio-downloader';

// Devuelve la URL de audio-only de un video de YouTube, o null si no se pudo.
export async function getYoutubeAudioUrl(videoUrl) {
  const items = await runActorItems(AUDIO_ACTOR, { videoUrls: [videoUrl] });
  const item = (items || [])[0];
  if (!item || item.errMsg) {
    throw new Error(item?.errMsg || 'el actor no devolvió audio');
  }
  return item.audioUrl || null;
}

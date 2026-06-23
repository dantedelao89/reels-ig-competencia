// Obtiene la URL de audio de un video de YouTube vía dami_studio/youtube-video-downloader
// (yt-dlp + proxies residenciales, ~$0.02/video, más confiable que el gratuito). Descarga el
// audio como MP3 a un archivo con link permanente (mediaUrl) descargable desde cualquier IP.
// Lo usa la transcripción manual bajo demanda.

import { runActorItems } from './apifyRun.js';

const AUDIO_ACTOR = 'dami_studio/youtube-video-downloader';

// Devuelve un link descargable al audio (mp3) de un video de YouTube. Reintenta si falla.
export async function getYoutubeAudioUrl(videoUrl) {
  let lastDetail = 'sin audio';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const items = await runActorItems(AUDIO_ACTOR, {
      urls: [videoUrl],
      audioOnly: true,
      includeMetadata: false,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    });
    const item = (items || [])[0];
    if (item?.ok && item?.mediaUrl) return item.mediaUrl;
    lastDetail = item?.error || (item?.ok === false ? 'ok=false' : 'mediaUrl vacío');
    console.warn(`[youtubeAudio] intento ${attempt}/2 sin audio (${lastDetail}); reintento`);
  }
  throw new Error(`el actor no devolvió audio tras 2 intentos (${lastDetail})`);
}

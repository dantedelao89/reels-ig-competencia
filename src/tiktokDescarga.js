// Descarga el MP4 de un video de TikTok, SIN la marca de agua.
//
// ## Por qué no se resuelve con Apify, que ya lo scrapea
//
// El actor de TikTok solo devuelve el MP4 si se le pide `shouldDownloadVideos`, y el scrape normal
// lo lleva apagado a propósito (`tiktokApify.js`: «el video se enlaza a TikTok; solo archivamos la
// portada»). Así que bajar un video por Apify significa una corrida EXTRA por video, con su costo.
//
// La API de RapidAPI que Dante ya paga para YouTube acepta URLs de TikTok —comprobado el 10 nov
// 2026 sobre un video real de la base, responde `"source":"tiktok"`— así que el mismo servicio que
// ya está montado cubre esto sin gasto adicional por descarga.
//
// Y da algo que Apify no da: **las pistas vienen sin marca de agua**.
//
// ## En qué se diferencia de YouTube, que es lo que obliga a tener este archivo
//
// `elegirPistas()` de `youtubeDescarga.js` NO sirve aquí, y no por estilo: filtra por
// `m.ext === 'mp4'` y por `m.height`, y en TikTok la API devuelve `ext: null` y la calidad como
// NOMBRE (`hd_no_watermark`, `no_watermark`), no como altura. Con esa función, TikTok daría cero
// pistas y fallaría siempre.
//
// Además, y esto ahorra todo el trabajo pesado: el MP4 de TikTok **ya trae el audio dentro**
// (medido: `aac` + `hevc` en el mismo archivo), así que no hay que bajar dos pistas ni unirlas con
// ffmpeg. Se reenvía el archivo tal cual.
//
// ## El compromiso de calidad, medido
//
//   hd_no_watermark   720×1280   HEVC (H.265)   ← se prefiere
//   no_watermark      576×1024   H.264
//
// Se prefiere la HD aunque sea HEVC porque la diferencia de resolución es real y ffmpeg, CapCut y
// los editores modernos lo abren sin problema. Si algún día un destino no traga H.265, la pista
// H.264 está ahí y basta con invertir el orden de PREFERENCIAS.

import { resolver } from './youtubeDescarga.js';

// Orden de preferencia por NOMBRE de calidad. Lo que no esté aquí se usa solo como último recurso.
const PREFERENCIAS = ['hd_no_watermark', 'no_watermark'];

// Elige la mejor pista de video de lo que devolvió la API.
export function elegirPistaTiktok(medios) {
  const videos = (medios || []).filter((m) => m?.url && m.type === 'video');
  if (!videos.length) return null;
  for (const q of PREFERENCIAS) {
    const hit = videos.find((m) => m.quality === q);
    if (hit) return hit;
  }
  // Ninguna conocida: la de mayor altura, y si tampoco hay altura, la primera. Es mejor entregar
  // algo con marca de agua que fallar, pero quien llame puede verlo en `quality`.
  return videos.reduce((a, b) => ((a.height || 0) >= (b.height || 0) ? a : b));
}

// Nombre del archivo. El título que da la API para TikTok es literalmente «Tiktok» (medido), así
// que no sirve de nada: el nombre se arma con el @handle y el id del video, que son lo que
// identifica el video y lo que Dante reconoce al verlo en Descargas.
export function nombreDeArchivo(urlVideo) {
  const m = /tiktok\.com\/@([^/?#]+)\/video\/(\d+)/i.exec(String(urlVideo || ''));
  if (m) return `tiktok_${m[1]}_${m[2]}.mp4`;
  const id = /(\d{8,})/.exec(String(urlVideo || ''))?.[1];
  return `tiktok_${id || 'video'}.mp4`;
}

// Resuelve el video y devuelve el cuerpo listo para reenviar, sin bufferizarlo: un reel son varios
// MB y leerlos en memoria multiplicaría el consumo por cada descarga simultánea.
export async function flujoDeDescargaTiktok(urlVideo) {
  const { medios } = await resolver(urlVideo);
  const pista = elegirPistaTiktok(medios);
  if (!pista) throw new Error('La API no devolvió ninguna pista de video para este TikTok');

  const res = await fetch(pista.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`El CDN de TikTok devolvió ${res.status}`);

  return {
    cuerpo: res.body,
    nombre: nombreDeArchivo(urlVideo),
    calidad: pista.quality || null,
    altura: pista.height || null,
    // Se pasa para poder mandarlo como Content-Length: a diferencia de YouTube aquí no se
    // recodifica nada, así que el tamaño SÍ se sabe de antemano y el navegador puede enseñar la
    // barra de progreso en vez de un spinner indefinido.
    tamano: res.headers.get('content-length') || null,
  };
}

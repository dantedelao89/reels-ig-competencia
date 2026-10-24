// Descarga el MP4 de un video de YouTube, que es lo único que el pipeline de YouTube NO tenía.
//
// Por qué hace falta un servicio aparte: `streamers/youtube-scraper` devuelve metadatos,
// miniatura y subtítulos, pero ningún enlace al archivo — comprobado sobre un item real, sus
// únicas URLs son la de la página, la de la miniatura y la del canal. En Instagram, TikTok,
// Facebook y X el actor sí entrega el MP4 del CDN y por eso allí la descarga ya existía.
//
// Se usa la API de RapidAPI que Dante ya tenía montada en AGENTE_TRADUCTOR_VIDEOS.
//
// ## El detalle que decide la calidad
//
// YouTube sirve el video y el audio por SEPARADO salvo en una pista "progresiva" de baja
// resolución. Medido sobre un video real: 42 medios, de los cuales el único mp4 con audio
// incluido era de **360p**, mientras que sin audio llegaba a 2160p. Así que bajar "el mp4 con
// audio" y ya, condena cada descarga a 360p. Por eso se bajan las dos pistas y se unen con
// ffmpeg copiando los flujos (`-c copy`), que no recodifica: es casi instantáneo y no pierde
// calidad.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, readFileSync } from 'node:fs';
import { rm, stat, mkdtemp, open as abrir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ejecutar = promisify(execFile);

const HOST = 'auto-download-all-in-one.p.rapidapi.com';
const URL_API = `https://${HOST}/v1/social/autolink`;

// Lee RAPIDAPI_KEY del entorno y, si no está, del `.env` del proyecto. El respaldo existe porque
// pedirle a alguien que escriba la llave en cada comando garantiza que un día pegue el ejemplo tal
// cual: pasó el 22 oct 2026, con `RAPIDAPI_KEY=tu-llave`, y RapidAPI devolvió un 403 que parecía un
// bloqueo cuando en realidad era la palabra «tu-llave» viajando como credencial.
function llave() {
  if (process.env.RAPIDAPI_KEY) return process.env.RAPIDAPI_KEY;
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = /^\s*RAPIDAPI_KEY\s*=\s*(.+)$/m.exec(env);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* sin .env: se cae al error de abajo, que explica qué hacer */
  }
  // Se comprueba AQUÍ y no al arrancar: sin esta variable el resto del scraper funciona igual, y
  // tumbar el arranque entero por una función opcional sería peor que fallar al usarla.
  throw new Error('Falta RAPIDAPI_KEY: ponla en el .env del proyecto o en el entorno');
}

// Pregunta a la API por las pistas disponibles. Devuelve { titulo, duracion, medios }.
export async function resolver(urlVideo) {
  const res = await fetch(URL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': HOST,
      'x-rapidapi-key': llave(),
    },
    body: JSON.stringify({ url: urlVideo }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) {
    // Se distingue a propósito: un 403 de RapidAPI es la llave, y un 403 de googlevideo es la IP.
    // Dicho así, el mensaje no manda a nadie a buscar un bloqueo que no existe.
    throw new Error(`RapidAPI rechazó la llave (${res.status}). Revisa RAPIDAPI_KEY, no es un bloqueo de red`);
  }
  if (!res.ok) throw new Error(`RapidAPI devolvió ${res.status}`);
  const d = await res.json();
  if (d?.error || !Array.isArray(d?.medias) || !d.medias.length) {
    throw new Error(`La API no devolvió medios${d?.error ? `: ${d.error}` : ''}`);
  }
  return { titulo: d.title || null, duracion: d.duration ?? null, medios: d.medias };
}

// Elige qué bajar. `altura` es un TECHO, no una petición: si el video no llega a 1080 se coge la
// mayor que haya, en vez de fallar o traer la más pequeña.
export function elegirPistas(medios, altura = 1080) {
  const conUrl = medios.filter((m) => m?.url);
  const videos = conUrl.filter((m) => m.type === 'video' && m.ext === 'mp4' && m.height);
  const soloVideo = videos.filter((m) => !m.audioQuality);
  const progresivos = videos.filter((m) => m.audioQuality);
  const audios = conUrl.filter((m) => m.type === 'audio' && m.ext === 'm4a');

  const bajoTecho = (lista) => {
    const cabe = lista.filter((m) => m.height <= altura);
    return cabe.length
      ? cabe.reduce((a, b) => (a.height >= b.height ? a : b))
      : lista.reduce((a, b) => (a.height <= b.height ? a : b), lista[0]);
  };

  if (soloVideo.length && audios.length) {
    return {
      modo: 'unir',
      video: bajoTecho(soloVideo),
      audio: audios.reduce((a, b) => ((a.bitrate || 0) >= (b.bitrate || 0) ? a : b)),
    };
  }
  // Sin pistas separadas solo queda el progresivo, con su resolución baja. Se dice en `modo` para
  // que quien llame pueda avisar en vez de entregar 360p como si fuera lo mejor disponible.
  if (progresivos.length) return { modo: 'progresivo', video: bajoTecho(progresivos), audio: null };
  throw new Error('La API no devolvió ninguna pista de video utilizable');
}

// El User-Agent que exige cada URL firmada.
//
// RapidAPI firma las URLs de googlevideo con `c=<cliente>` y **el CDN comprueba que el User-Agent
// corresponda a ese cliente**: si no coincide, responde 403. Esto se dio por un bloqueo por IP
// durante un día entero —«googlevideo bloquea los datacenter»— y era falso: desde la Mac colaba
// sin cabeceras por casualidad, y desde Railway no. Lo correcto estaba en el descargador que Dante
// ya tenía en LAFRAGUA_STUDIO, que descarga desde Railway sin problema.
const UA_POR_CLIENTE = {
  ANDROID_VR: 'com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12; GB) gzip',
  ANDROID: 'com.google.android.youtube/19.09.37 (Linux; U; Android 12) gzip',
  ANDROID_EMBEDDED_PLAYER: 'com.google.android.youtube/19.09.37 (Linux; U; Android 12) gzip',
  IOS: 'com.google.ios.youtube/19.09.3 (iPhone15,2; U; CPU iOS 17_3 like Mac OS X)',
  IOS_MUSIC: 'com.google.ios.youtube/19.09.3 (iPhone15,2; U; CPU iOS 17_3 like Mac OS X)',
};
const UA_NAVEGADOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function cabecerasDe(url) {
  const esGoogle = /googlevideo\.com|youtube\.com/i.test(url);
  const cliente = (/[?&]c=([^&]+)/.exec(url) || [])[1];
  return {
    'User-Agent': (esGoogle && UA_POR_CLIENTE[decodeURIComponent(cliente || '')]) || UA_NAVEGADOR,
    Referer: esGoogle ? 'https://www.youtube.com/' : new URL(url).origin,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

async function bajarA(url, destino) {
  const res = await fetch(url, { headers: cabecerasDe(url), signal: AbortSignal.timeout(600_000) });
  if (res.status === 403) {
    throw new Error(
      `googlevideo devolvió 403 pese a mandar el User-Agent del cliente c=${(/[?&]c=([^&]+)/.exec(url) || [])[1] || '?'}`
    );
  }
  if (!res.ok || !res.body) throw new Error(`el CDN devolvió ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destino));
  const { size } = await stat(destino);
  // Un "archivo" de 10 KB es una página de error, no un video.
  if (size < 10_000) throw new Error(`la descarga salió vacía (${size} bytes)`);
  return size;
}

// ## Por qué la red NO la hace ffmpeg
//
// ffmpeg sabe leer HTTP, y mi primera versión le pasaba las dos URL del CDN para que uniera al
// vuelo. Funcionaba, pero medido el 24 oct 2026 sobre el mismo video: ffmpeg leyendo esas URL da
// 95 KB/s en la Mac y 77 KB/s desde Railway, mientras que `fetch` sobre LA MISMA URL da
// 2 504 KB/s. Veintiséis veces más. Probé `-seekable 0`, `-multiple_requests 1` y
// `-http_persistent`: las tres variantes dieron 95 KB/s clavados, así que no es una bandera que
// me falte, es que su cliente HTTP no sirve para esto.
//
// Eso importa porque el borde de Railway corta cualquier petición a los 15 minutos. A 77 KB/s un
// archivo de 42 MB tarda 9 minutos y uno de media hora de duración no cabe; a 2.5 MB/s el mismo
// archivo tarda 17 segundos y el techo deja de existir en la práctica.
//
// Así que la red la hace fetch con peticiones de rango en paralelo, y ffmpeg se queda con lo que
// sí hace rápido: pegar dos archivos locales sin recodificar.
const TROZO = 4 * 1024 * 1024;
const EN_PARALELO = 6;

// El tamaño viene en el propio enlace firmado (`clen`). Si algún día no viniera, se pregunta con
// un rango de un byte, que responde con el total en Content-Range.
export function tamanoEnEnlace(url) {
  const m = /[?&]clen=(\d+)/.exec(url);
  return m ? Number(m[1]) : null;
}

async function tamanoDe(url) {
  const enEnlace = tamanoEnEnlace(url);
  if (enEnlace) return enEnlace;
  const res = await fetch(url, { headers: { ...cabecerasDe(url), Range: 'bytes=0-0' } });
  const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]);
  if (!total) throw new Error(`no pude averiguar el tamaño de la pista (HTTP ${res.status})`);
  return total;
}

export function repartirTrozos(total, trozo = TROZO) {
  const partes = [];
  for (let d = 0; d < total; d += trozo) partes.push([d, Math.min(d + trozo, total) - 1]);
  return partes;
}

// Baja una pista a `destino` pidiendo varios rangos a la vez y escribiéndolos en su sitio.
async function bajarPista(url, destino, { paralelo = EN_PARALELO } = {}) {
  const total = await tamanoDe(url);
  const partes = repartirTrozos(total);
  const fh = await abrir(destino, 'w');
  try {
    let siguiente = 0;
    const obrero = async () => {
      for (let i = siguiente++; i < partes.length; i = siguiente++) {
        const [desde, hasta] = partes[i];
        let ultimo;
        for (let intento = 1; intento <= 3; intento++) {
          try {
            const res = await fetch(url, {
              headers: { ...cabecerasDe(url), Range: `bytes=${desde}-${hasta}` },
              signal: AbortSignal.timeout(120_000),
            });
            if (res.status === 403) {
              throw new Error(
                `googlevideo devolvió 403 pese a mandar el User-Agent del cliente c=${(/[?&]c=([^&]+)/.exec(url) || [])[1] || '?'}`
              );
            }
            if (res.status !== 206 && res.status !== 200) throw new Error(`el CDN devolvió ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await fh.write(buf, 0, buf.length, desde);
            ultimo = null;
            break;
          } catch (e) {
            ultimo = e;
            if (intento < 3) await new Promise((r) => setTimeout(r, 500 * 2 ** (intento - 1)));
          }
        }
        if (ultimo) throw ultimo;
      }
    };
    await Promise.all(Array.from({ length: Math.min(paralelo, partes.length) }, obrero));
  } finally {
    await fh.close();
  }
  const { size } = await stat(destino);
  // Un "archivo" de 10 KB es una página de error, no una pista.
  if (size < 10_000) throw new Error(`la descarga salió vacía (${size} bytes)`);
  return size;
}

// Pega dos archivos YA bajados. `-c copy` no recodifica, así que esto va a cientos de MB/s.
// El MP4 sale fragmentado porque se emite a una tubería y el tamaño final no se sabe de
// antemano; `+faststart` no sirve aquí porque necesita rebobinar la salida.
export function argsDeUnion(rutaVideo, rutaAudio) {
  return [
    '-loglevel', 'error',
    '-i', rutaVideo,
    '-i', rutaAudio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c', 'copy',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ];
}

// Resuelve y devuelve un flujo listo para volcar en una respuesta HTTP, junto con lo que hace
// falta para nombrarlo y para limpiar después.
//
// Las dos pistas se bajan A LA VEZ y cada una por trozos en paralelo, así que el tiempo total es
// el de la pista más grande, no la suma. Durante esos segundos la respuesta no emite nada: eso es
// seguro porque Railway solo corta a los 5 minutos SIN datos, y aquí hablamos de decenas de
// segundos. A cambio, cuando empieza a emitir va a la velocidad del disco.
export async function flujoDeDescarga(urlVideo, { altura = 1080 } = {}) {
  const { titulo, duracion, medios } = await resolver(urlVideo);
  const pistas = elegirPistas(medios, altura);

  if (pistas.modo === 'progresivo') {
    // Una sola pista que ya trae audio: se pasa tal cual, sin ffmpeg ni disco de por medio.
    const res = await fetch(pistas.video.url, { headers: cabecerasDe(pistas.video.url) });
    if (!res.ok || !res.body) throw new Error(`el CDN devolvió ${res.status}`);
    return {
      titulo, duracion, altura: pistas.video.height, modo: 'progresivo',
      cuerpo: res.body, proceso: null, limpiar: async () => {},
    };
  }

  const carpeta = await mkdtemp(path.join(tmpdir(), 'yt-'));
  const rutaVideo = path.join(carpeta, 'v.mp4');
  const rutaAudio = path.join(carpeta, 'a.m4a');
  const limpiar = () => rm(carpeta, { recursive: true, force: true }).catch(() => {});

  let bytes;
  try {
    bytes = await Promise.all([
      bajarPista(pistas.video.url, rutaVideo),
      bajarPista(pistas.audio.url, rutaAudio),
    ]);
  } catch (e) {
    await limpiar();
    throw e;
  }

  const ff = spawn('ffmpeg', argsDeUnion(rutaVideo, rutaAudio), { stdio: ['ignore', 'pipe', 'pipe'] });
  // El stderr se guarda pero no se vuelca: si ffmpeg muere, su última línea explica por qué, y sin
  // esto el fallo llega como «el flujo se cortó» sin más.
  let err = '';
  ff.stderr.on('data', (d) => {
    err = (err + d.toString()).slice(-600);
  });
  ff.on('close', (code) => {
    if (code) console.error(`[descargar-yt] ffmpeg salió con ${code}: ${err.trim().slice(0, 300)}`);
    limpiar();
  });
  return {
    titulo, duracion, altura: pistas.video.height, modo: 'unido',
    bytes: bytes[0] + bytes[1], cuerpo: ff.stdout, proceso: ff, limpiar,
  };
}

// Baja el video a `destino` (.mp4). Devuelve qué se hizo, para poder reportarlo con honestidad.
export async function descargarYoutube(urlVideo, destino, { altura = 1080 } = {}) {
  const { titulo, duracion, medios } = await resolver(urlVideo);
  const pistas = elegirPistas(medios, altura);
  const temp = await mkdtemp(path.join(tmpdir(), 'yt-'));
  try {
    if (pistas.modo === 'progresivo') {
      const bytes = await bajarA(pistas.video.url, destino);
      return { ok: true, titulo, duracion, altura: pistas.video.height, modo: 'progresivo', bytes };
    }
    const v = path.join(temp, 'v.m4v');
    const a = path.join(temp, 'a.m4a');
    // Las dos a la vez y cada una por trozos: mismo motor que la descarga por HTTP, para que la
    // consola y el frontend no tengan dos velocidades distintas.
    await Promise.all([bajarPista(pistas.video.url, v), bajarPista(pistas.audio.url, a)]);
    // `-c copy` no recodifica: une los dos flujos tal cual. `+faststart` mueve el índice al
    // principio para que el archivo se pueda reproducir sin haberlo descargado entero.
    await ejecutar('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', v, '-i', a,
      '-c', 'copy', '-movflags', '+faststart',
      destino,
    ]);
    const { size } = await stat(destino);
    return { ok: true, titulo, duracion, altura: pistas.video.height, modo: 'unido', bytes: size };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

// Cloudflare R2 (S3-compatible): rehospeda thumbnails para que no expiren.
// Se activa solo si están las credenciales + la URL pública del bucket; si no, todo es no-op
// (rehostImage devuelve null y el dashboard cae a thumbnail_original).
// El SDK de AWS se importa de forma perezosa para no requerir la dependencia si R2 no se usa.

import { config } from './config.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const enabled = !!(
  config.r2AccountId &&
  config.r2AccessKeyId &&
  config.r2SecretAccessKey &&
  config.r2Bucket &&
  config.r2PublicBaseUrl
);

let client = null;

export function r2Enabled() {
  return enabled;
}

async function getClient() {
  if (client) return client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
  return client;
}

// Descarga con reintentos. El CDN de Meta corta conexiones de forma intermitente ("fetch
// failed" a nivel de red) y rechaza peticiones sin User-Agent; sin reintentar, un solo
// tropiezo dejaba el item con la URL efímera de Instagram, que caduca en horas y lo rompe
// para siempre (miniaturas grises y el zip fallando).
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function descargar(sourceUrl, { tries = 3, timeoutMs = 45000 } = {}) {
  let ultimo;
  for (let intento = 1; intento <= tries; intento++) {
    try {
      const res = await fetch(sourceUrl, {
        headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`descarga ${res.status}`);
      return res;
    } catch (e) {
      ultimo = e;
      // Un 404/410 no se arregla reintentando: la URL ya murió.
      if (/descarga 4(04|10)/.test(e.message)) break;
      if (intento < tries) await new Promise((r) => setTimeout(r, 1500 * intento));
    }
  }
  throw ultimo;
}

// Descarga una imagen remota y la sube a R2 bajo `key`. Devuelve la URL pública permanente,
// o null si R2 está deshabilitado o algo falla (nunca lanza: el sync no debe romperse por esto).
export async function rehostImage(sourceUrl, key) {
  if (!enabled || !sourceUrl) return null;
  try {
    const res = await descargar(sourceUrl);
    const body = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await getClient();
    await c.send(
      new PutObjectCommand({ Bucket: config.r2Bucket, Key: key, Body: body, ContentType: contentType })
    );
    return `${config.r2PublicBaseUrl.replace(/\/$/, '')}/${key}`;
  } catch (e) {
    console.error(`[R2 rehost ${key}] ${e.message}`);
    return null;
  }
}

// Sube un buffer ya en memoria a R2 bajo `key` (lo usa el regenerador para los slides generados).
// Devuelve la URL pública o null si R2 está deshabilitado o falla (nunca lanza).
export async function uploadBuffer(buffer, key, contentType = 'image/png') {
  if (!enabled || !buffer?.length) return null;
  try {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await getClient();
    await c.send(
      new PutObjectCommand({ Bucket: config.r2Bucket, Key: key, Body: buffer, ContentType: contentType })
    );
    return `${config.r2PublicBaseUrl.replace(/\/$/, '')}/${key}`;
  } catch (e) {
    console.error(`[R2 upload ${key}] ${e.message}`);
    return null;
  }
}

const MAX_VIDEO_BYTES = Number(process.env.R2_MAX_VIDEO_BYTES || 60 * 1024 * 1024); // 60 MB

// Qué trae realmente el mp4 que bajamos: códec de video y si tiene pista de audio.
// Hace falta preguntarlo porque Instagram sirve DASH y lo que entrega varía por reel (medido en
// una muestra: 3 de 4 en h264 con audio, 1 en VP9 y mudo).
function inspeccionar(ruta) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', ruta],
      { encoding: 'utf8' }
    );
    const lineas = out.trim().split('\n').map((l) => l.split(','));
    return {
      codecVideo: lineas.find((c) => c[1] === 'video')?.[0] || null,
      tieneAudio: lineas.some((c) => c[1] === 'audio'),
    };
  } catch {
    return null; // sin ffprobe no se toca nada
  }
}

// Deja el video listo para usar: con sonido y en un códec que abra en cualquier lado.
//
// Dos arreglos, los dos medidos con reels reales:
//   1. AUDIO — varios reels vienen mudos porque Instagram manda la pista aparte. Se pega con
//      `-c copy`: instantáneo y sin pérdida.
//   2. VP9 → H.264 — QuickTime no reproduce VP9, así que un reel así se descargaba y no abría en
//      el Mac. Recodificar cuesta ~1 s por cada 10 s de video y solo le toca a la minoría VP9;
//      el resto se copia tal cual y no pierde nada de calidad.
//
// Devuelve el buffer nuevo, o null si el original ya estaba bien (y entonces se sube tal cual).
function normalizarVideo(bufVideo, bufAudio) {
  const dir = mkdtempSync(join(tmpdir(), 'mux-'));
  try {
    const v = join(dir, 'v.mp4');
    writeFileSync(v, bufVideo);
    const info = inspeccionar(v);
    if (!info) return null;

    const esVp9 = info.codecVideo === 'vp9';
    const faltaAudio = !info.tieneAudio && bufAudio?.length;
    if (!esVp9 && !faltaAudio) return null; // ya estaba bien

    const out = join(dir, 'out.mp4');
    const args = ['-y', '-i', v];
    if (faltaAudio) {
      const a = join(dir, 'a.mp4');
      writeFileSync(a, bufAudio);
      args.push('-i', a, '-map', '0:v:0', '-map', '1:a:0');
    }
    args.push(
      '-c:v', esVp9 ? 'libx264' : 'copy',
      ...(esVp9 ? ['-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'] : []),
      '-c:a', 'copy',
      '-shortest',
      // faststart deja el índice al principio: el navegador reproduce sin bajar el archivo entero.
      '-movflags', '+faststart',
      out
    );
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    return { buffer: readFileSync(out), motivo: [esVp9 ? 'vp9→h264' : null, faltaAudio ? 'audio unido' : null].filter(Boolean).join(' + ') };
  } catch (e) {
    console.warn(`[R2 video] no se pudo normalizar: ${(e.stderr?.toString() || e.message).slice(0, 200)}`);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Descarga un video remoto y lo sube a R2. Devuelve la URL pública permanente, o null si falla,
// está deshabilitado, o el video excede el límite de tamaño.
export async function rehostVideo(sourceUrl, key, { audioUrl = null } = {}) {
  if (!enabled || !sourceUrl) return null;
  try {
    const res = await descargar(sourceUrl, { timeoutMs: 120000 });
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_VIDEO_BYTES) throw new Error(`video de ${len} bytes excede el límite`);
    let body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_VIDEO_BYTES) throw new Error(`video de ${body.length} bytes excede el límite`);
    const contentType = res.headers.get('content-type') || 'video/mp4';

    // Se baja la pista de audio ANTES de inspeccionar porque solo mirando el archivo se sabe si
    // hace falta; bajarla cuesta poco (~100 KB) y evita una segunda pasada.
    let bufAudio = null;
    if (audioUrl) {
      try {
        const ra = await descargar(audioUrl, { timeoutMs: 120000 });
        bufAudio = Buffer.from(await ra.arrayBuffer());
      } catch (e) {
        console.warn(`[R2 video ${key}] no se pudo bajar el audio: ${e.message}`);
      }
    }
    const normalizado = normalizarVideo(body, bufAudio);
    if (normalizado) {
      console.log(`[R2 video] ${key}: ${normalizado.motivo} (${Math.round(normalizado.buffer.length / 1024)} KB)`);
      body = normalizado.buffer;
      if (body.length > MAX_VIDEO_BYTES) throw new Error(`video normalizado de ${body.length} bytes excede el límite`);
    }
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const c = await getClient();
    await c.send(
      new PutObjectCommand({ Bucket: config.r2Bucket, Key: key, Body: body, ContentType: contentType })
    );
    return `${config.r2PublicBaseUrl.replace(/\/$/, '')}/${key}`;
  } catch (e) {
    console.error(`[R2 rehost video ${key}] ${e.message}`);
    return null;
  }
}

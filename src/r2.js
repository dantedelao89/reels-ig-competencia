// Cloudflare R2 (S3-compatible): rehospeda thumbnails para que no expiren.
// Se activa solo si están las credenciales + la URL pública del bucket; si no, todo es no-op
// (rehostImage devuelve null y el dashboard cae a thumbnail_original).
// El SDK de AWS se importa de forma perezosa para no requerir la dependencia si R2 no se usa.

import { config } from './config.js';

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

// Descarga una imagen remota y la sube a R2 bajo `key`. Devuelve la URL pública permanente,
// o null si R2 está deshabilitado o algo falla (nunca lanza: el sync no debe romperse por esto).
export async function rehostImage(sourceUrl, key) {
  if (!enabled || !sourceUrl) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`descarga ${res.status}`);
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

const MAX_VIDEO_BYTES = Number(process.env.R2_MAX_VIDEO_BYTES || 60 * 1024 * 1024); // 60 MB

// Descarga un video remoto y lo sube a R2. Devuelve la URL pública permanente, o null si falla,
// está deshabilitado, o el video excede el límite de tamaño.
export async function rehostVideo(sourceUrl, key) {
  if (!enabled || !sourceUrl) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`descarga ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_VIDEO_BYTES) throw new Error(`video de ${len} bytes excede el límite`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_VIDEO_BYTES) throw new Error(`video de ${body.length} bytes excede el límite`);
    const contentType = res.headers.get('content-type') || 'video/mp4';
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

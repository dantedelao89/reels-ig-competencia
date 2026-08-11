// Seed one-shot (local) de la biblioteca de referencias del Regenerador de carruseles.
// Sube las anclas del branding cuaderno + fotos de CTA de Dante a R2 (regen/refs/) e inserta
// las filas en disecta.regen_refs. Idempotente: si ya existe una fila con la misma key en R2, la salta.
//
// Uso (desde la raíz del repo):
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_SCHEMA=disecta \
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... R2_PUBLIC_BASE_URL=... \
//   node scripts/seed-regen-refs.mjs
//
// Las fotos de CTA (1:1) se recortan centradas a 4:5 con `sips` (macOS) antes de subir:
// el fallback de Qwen hereda el aspecto de la imagen única, así que deben ir ya en 4:5.

import { readFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, basename } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Falta env ${k}`);
  return v;
};

const HOME = homedir();
const CUADERNO = join(HOME, '.claude/skills/branding-cuaderno/assets/referencias/carrusel');
const DANTE = join(HOME, 'Pictures/recursos-videos/personajes/dante');

const REFS = [
  { file: join(CUADERNO, 'carrusel-01.png'), tipo: 'portada', nombre: 'Ancla portada (cuaderno)', notas: 'Ancla oficial del branding cuaderno para portadas', crop45: false },
  { file: join(CUADERNO, 'carrusel-02.png'), tipo: 'contenido', nombre: 'Ancla contenido (cuaderno)', notas: 'Ancla oficial del branding cuaderno para láminas de contenido/lista/quote', crop45: false },
  { file: join(DANTE, 'brazos-cruzados.png'), tipo: 'cta', nombre: 'Dante brazos cruzados', notas: 'Foto CTA por defecto', crop45: true },
  { file: join(DANTE, 'retrato-cerrado.png'), tipo: 'cta', nombre: 'Dante retrato cerrado', notas: 'Para polaroid / firma al pie', crop45: true },
  { file: join(DANTE, 'sonriendo.png'), tipo: 'cta', nombre: 'Dante sonriendo', notas: 'Para nota manuscrita / tono cálido', crop45: true },
  { file: join(DANTE, 'senalando.png'), tipo: 'cta', nombre: 'Dante señalando', notas: 'Para "señala el texto"', crop45: true },
  { file: join(DANTE, 'sorprendido.png'), tipo: 'cta', nombre: 'Dante sorprendido', notas: 'Para reacción', crop45: true },
];

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
});
const bucket = env('R2_BUCKET');
const publicBase = env('R2_PUBLIC_BASE_URL').replace(/\/$/, '');

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_KEY'), {
  db: { schema: process.env.SUPABASE_SCHEMA || 'disecta' },
  auth: { persistSession: false },
});

// Recorta centrado a 4:5 con sips (solo macOS). Devuelve la ruta del archivo recortado.
function crop45(file) {
  const out = join(mkdtempSync(join(tmpdir(), 'regen-ref-')), basename(file));
  copyFileSync(file, out);
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out]).toString();
  const w = Number(dims.match(/pixelWidth: (\d+)/)[1]);
  const h = Number(dims.match(/pixelHeight: (\d+)/)[1]);
  // objetivo: w/h = 4/5. Recorta el lado que sobre.
  let tw = w, th = h;
  if (w / h > 4 / 5) tw = Math.round((h * 4) / 5);
  else th = Math.round((w * 5) / 4);
  execFileSync('sips', ['-c', String(th), String(tw), out]);
  return out;
}

const slug = (s) => basename(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-');

for (const ref of REFS) {
  const key = `regen/refs/${slug(ref.file)}.png`;
  const url = `${publicBase}/${key}`;

  const { data: existing, error: selErr } = await supabase.from('regen_refs').select('id').eq('url', url).limit(1);
  if (selErr) throw new Error(selErr.message);
  if (existing?.length) {
    console.log(`= ya existe: ${ref.nombre}`);
    continue;
  }

  const src = ref.crop45 ? crop45(ref.file) : ref.file;
  const body = readFileSync(src);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/png' }));
  const { error } = await supabase.from('regen_refs').insert({ tipo: ref.tipo, nombre: ref.nombre, url, notas: ref.notas });
  if (error) throw new Error(error.message);
  console.log(`+ subida: ${ref.nombre} → ${url}${ref.crop45 ? ' (recortada 4:5)' : ''}`);
}

console.log('Seed listo.');

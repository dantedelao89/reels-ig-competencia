#!/usr/bin/env node
// Baja un video de YouTube a ~/Descargas con la mejor calidad que haya.
//
//   RAPIDAPI_KEY=... node scripts/bajar-youtube.mjs <url> [altura]
//
// Corre DESDE LA MAC a propósito: el CDN de YouTube (googlevideo.com) responde 403 a muchas IP de
// datacenter, así que una IP residencial es lo que hace que esto funcione sin más.

import { homedir } from 'node:os';
import path from 'node:path';
import { descargarYoutube, resolver } from '../src/youtubeDescarga.js';

const [url, alturaArg] = process.argv.slice(2);
if (!url) {
  console.error('Uso: node scripts/bajar-youtube.mjs <url de YouTube> [altura máxima, por defecto 1080]');
  process.exit(1);
}
const altura = Number(alturaArg) || 1080;

// El nombre sale del título real, no del id: un archivo llamado `nv1aaP3dHzs.mp4` no se encuentra
// en Descargas tres días después.
function nombreSeguro(titulo, respaldo) {
  const limpio = (titulo || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return `${limpio || respaldo}.mp4`;
}

const { titulo } = await resolver(url);
const destino = path.join(homedir(), 'Downloads', nombreSeguro(titulo, 'video-youtube'));
console.log(`Bajando: ${titulo || url}`);
const r = await descargarYoutube(url, destino, { altura });
const mb = (r.bytes / 1e6).toFixed(1);
console.log(`Listo: ${r.altura}p (${r.modo}) · ${mb} MB · ${r.duracion}s`);
console.log(destino);
if (r.modo === 'progresivo') {
  console.log('Aviso: solo había pista con audio incluido, que en YouTube es de baja resolución.');
}

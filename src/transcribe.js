// Transcribe el audio de un reel/video usando el endpoint de OpenRouter.
// Reels IG = audio corto (m4a) → una sola llamada. Videos largos de YouTube → se trocean con
// ffmpeg en segmentos de ~10 min (OpenRouter devuelve 502 con audios muy largos de una sola vez)
// y se concatenan las transcripciones.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from './config.js';

// Mapea el content-type del audio al "format" que espera OpenRouter.
function formatFromContentType(ct) {
  const t = (ct || '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
  if (t.includes('webm') || t.includes('opus')) return 'webm';
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('ogg')) return 'ogg';
  return null;
}

// Envía un buffer de audio a OpenRouter y devuelve el texto transcrito.
async function transcribeBuffer(buf, format) {
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.transcribeModel,
      input_audio: { data: buf.toString('base64'), format },
    }),
    signal: AbortSignal.timeout(config.transcribeTimeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.text || '').trim();
}

// Trocea el audio con ffmpeg (re-encode a mp3 uniforme) y transcribe cada segmento en orden.
async function transcribeByChunks(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
  try {
    const input = path.join(dir, 'audio.input');
    fs.writeFileSync(input, buf);
    const pattern = path.join(dir, 'chunk_%03d.mp3');
    try {
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner', '-loglevel', 'error',
          '-i', input,
          '-vn', '-acodec', 'libmp3lame', '-q:a', '5',
          '-f', 'segment', '-segment_time', String(config.transcribeChunkSeconds),
          pattern,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('ffmpeg no está instalado en el contenedor');
      const stderr = err.stderr ? err.stderr.toString().slice(0, 200) : err.message;
      throw new Error(`ffmpeg falló al trocear: ${stderr}`);
    }
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
    if (files.length === 0) throw new Error('ffmpeg no produjo segmentos');

    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const chunkBuf = fs.readFileSync(path.join(dir, files[i]));
      const text = await transcribeBuffer(chunkBuf, 'mp3');
      parts.push(text);
      console.log(`[transcribe] trozo ${i + 1}/${files.length}: ${text.length} chars`);
    }
    return parts.join('\n').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function transcribeAudio(audioUrl) {
  // 1) Descargar el audio.
  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(config.transcribeTimeoutMs) });
  if (!audioRes.ok) throw new Error(`descarga de audio falló (${audioRes.status})`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  if (buf.length > config.maxTranscribeBytes) {
    throw new Error(`audio de ${buf.length} bytes excede el límite (${config.maxTranscribeBytes})`);
  }

  // 2) Audio corto/mediano → una sola llamada (camino original, intacto para reels IG).
  //    Audio largo → trocear con ffmpeg y transcribir por partes.
  if (buf.length <= config.transcribeChunkThresholdBytes) {
    const format = formatFromContentType(audioRes.headers.get('content-type')) || config.transcribeFormat;
    return transcribeBuffer(buf, format);
  }
  console.log(`[transcribe] audio grande (${(buf.length / 1024 / 1024).toFixed(1)} MB) → troceando`);
  return transcribeByChunks(buf);
}

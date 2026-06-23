// Transcribe el audio de un reel usando el endpoint de OpenRouter.
// El audioUrl de Instagram es una pista solo-audio (AAC en contenedor mp4 → formato "m4a").

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

export async function transcribeAudio(audioUrl) {
  // 1) Descargar el audio.
  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(config.transcribeTimeoutMs) });
  if (!audioRes.ok) throw new Error(`descarga de audio falló (${audioRes.status})`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  if (buf.length > config.maxTranscribeBytes) {
    throw new Error(`audio de ${buf.length} bytes excede el límite (${config.maxTranscribeBytes})`);
  }
  const base64 = buf.toString('base64');
  // Detecta el formato real (IG = m4a; YouTube puede ser webm/opus o mp4). Cae al default.
  const format = formatFromContentType(audioRes.headers.get('content-type')) || config.transcribeFormat;

  // 2) Enviar a OpenRouter.
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.transcribeModel,
      input_audio: { data: base64, format },
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

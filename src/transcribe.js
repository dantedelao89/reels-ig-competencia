// Transcribe el audio de un reel usando el endpoint de OpenRouter.
// El audioUrl de Instagram es una pista solo-audio (AAC en contenedor mp4 → formato "m4a").

import { config } from './config.js';

export async function transcribeAudio(audioUrl) {
  // 1) Descargar el audio.
  const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(config.transcribeTimeoutMs) });
  if (!audioRes.ok) throw new Error(`descarga de audio falló (${audioRes.status})`);
  const buf = Buffer.from(await audioRes.arrayBuffer());
  if (buf.length > config.maxTranscribeBytes) {
    throw new Error(`audio de ${buf.length} bytes excede el límite (${config.maxTranscribeBytes})`);
  }
  const base64 = buf.toString('base64');

  // 2) Enviar a OpenRouter.
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.transcribeModel,
      input_audio: { data: base64, format: config.transcribeFormat },
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

// Cliente de Wavespeed.ai para el Regenerador de carruseles.
// - gptImageEdit: openai/gpt-image-2/edit (calidad medium, 4:5) — regeneración de láminas.
//   Acepta imágenes como data URLs base64. Tarda 3-6 min → siempre async con polling.
// - qwenEdit: wavespeed-ai/qwen-image-2.0-pro/edit — limpieza de marcas de agua y fallback
//   cuando gpt-image rechaza por filtro de contenido. Solo URLs públicas, prompt ≤800 chars,
//   con UNA imagen hereda su aspect ratio.

import { config } from './config.js';

const BASE = 'https://api.wavespeed.ai/api/v3';
const POLL_MS = 3000;
const MAX_POLL_MS = 10 * 60 * 1000; // 10 min duros por generación

export function wavespeedEnabled() {
  return !!config.wavespeedApiKey;
}

function headers() {
  return { Authorization: `Bearer ${config.wavespeedApiKey}`, 'Content-Type': 'application/json' };
}

// ¿El error es el filtro de contenido de gpt-image? (cae a Qwen automático, ya aprobado)
function isFlagged(msg) {
  return /flagged|sensitive|content.policy|moderation/i.test(msg || '');
}

// ¿Error transitorio de Wavespeed? (code 1405 u otros 5xx) → reintentar.
function isTransient(msg) {
  return /1405|"code"\s*:\s*5\d\d|timeout|ECONNRESET|fetch failed/i.test(msg || '');
}

// Somete la tarea y pollea hasta completed/failed. Devuelve la URL del output.
async function submitAndPoll(modelPath, body) {
  const res = await fetch(`${BASE}/${modelPath}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Wavespeed ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new Error(`Wavespeed ${json.code || res.status}: ${(json.message || text).slice(0, 300)}`);
  }
  const data = json.data || {};

  // Puede venir resuelto de una (sync) o con URL de polling.
  if (data.status === 'completed' && data.outputs?.length) return data.outputs[0];
  const pollUrl = data.urls?.get || (data.id ? `${BASE}/predictions/${data.id}/result` : null);
  if (!pollUrl) throw new Error('Wavespeed no devolvió id ni URL de polling');

  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const pr = await fetch(pollUrl, { headers: headers(), signal: AbortSignal.timeout(60000) });
    const pj = await pr.json().catch(() => ({}));
    const d = pj.data || {};
    if (d.status === 'completed') {
      if (!d.outputs?.length) throw new Error('Wavespeed completó sin outputs');
      return d.outputs[0];
    }
    if (d.status === 'failed') {
      throw new Error(`Wavespeed failed: ${(d.error || pj.message || 'sin detalle').slice(0, 300)}`);
    }
  }
  throw new Error('Wavespeed: timeout de 10 min esperando la generación');
}

// Con reintentos para errores transitorios (1405, 5xx). Los errores de contenido no se reintentan:
// se marcan con err.flagged = true para que el caller caiga a Qwen.
async function withRetries(fn) {
  const waits = [5000, 15000, 30000];
  let lastErr;
  for (let i = 0; i <= waits.length; i++) {
    try {
      return await fn();
    } catch (e) {
      if (isFlagged(e.message)) {
        e.flagged = true;
        throw e;
      }
      lastErr = e;
      if (i === waits.length || !isTransient(e.message)) throw e;
      console.log(`[wavespeed] transitorio (${e.message.slice(0, 80)}), reintento en ${waits[i] / 1000}s`);
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
  throw lastErr;
}

// Regeneración de lámina. images = data URLs base64 (la primera es la base, la segunda la
// referencia de estilo). Devuelve la URL del PNG generado.
export async function gptImageEdit({ prompt, images, aspectRatio = '4:5' }) {
  if (!wavespeedEnabled()) throw new Error('Falta WAVESPEED_API_KEY');
  return withRetries(() =>
    submitAndPoll('openai/gpt-image-2/edit', {
      prompt,
      images,
      aspect_ratio: aspectRatio,
      resolution: '1k',
      quality: 'medium',
      output_format: 'png',
    })
  );
}

// Edición con Qwen (limpieza de marca de agua / fallback de filtro). imageUrls = URLs públicas.
export async function qwenEdit({ prompt, imageUrls }) {
  if (!wavespeedEnabled()) throw new Error('Falta WAVESPEED_API_KEY');
  let p = (prompt || '').trim();
  if (p.length > 800) {
    console.log(`[wavespeed] prompt de ${p.length} chars truncado a 800 para Qwen`);
    p = p.slice(0, 797) + '…';
  }
  return withRetries(() =>
    submitAndPoll('wavespeed-ai/qwen-image-2.0-pro/edit', { prompt: p, images: imageUrls })
  );
}

// Descarga un output de Wavespeed a buffer (para re-subirlo a R2, las URLs de Wavespeed expiran).
export async function downloadOutput(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`descarga del output ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

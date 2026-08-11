// Cliente único de OpenRouter para las llamadas del regenerador (texto y visión).
// Centraliza lo que antes estaba inline y repetido: JSON estricto, limpieza de fences,
// distinción entre "se quedó sin tokens" y "llegó cortada", y reintentos.
//
// GOTCHA medido: Gemini corta la respuesta de forma no-determinista cuando se le mandan
// muchas imágenes en una llamada (con 9 falló ~1 de cada 2-3; con 6 va bien). Por eso las
// etapas con visión trocean en lotes y las etapas creativas no llevan imágenes.

import { config } from './config.js';

const URL = 'https://openrouter.ai/api/v1/chat/completions';

// Construye el `content` multimodal de un mensaje: un texto + N imágenes por URL pública.
export function imgContent(text, urls = []) {
  const content = [{ type: 'text', text }];
  for (const url of urls) content.push({ type: 'image_url', image_url: { url } });
  return content;
}

// Llama al modelo pidiendo JSON y devuelve el objeto ya parseado.
// Reintenta ante corte/parseo roto/errores transitorios; si el modelo no existe (404),
// cae al modelo de visión y lo deja anotado en `avisos`.
export async function chatJSON({
  model,
  messages,
  maxTokens = 8000,
  temperature = 0.3,
  timeoutMs = 240000,
  tries = 3,
  avisos = null,
}) {
  let modelo = model || config.regenVisionModel;
  let ultimoError = '';

  for (let intento = 1; intento <= tries; intento++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouterApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: maxTokens,
          temperature,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        // Modelo inexistente/no disponible: caer al de visión una sola vez y seguir.
        if (res.status === 404 && modelo !== config.regenVisionModel) {
          const aviso = `El modelo ${modelo} no está disponible en OpenRouter; se usó ${config.regenVisionModel}.`;
          console.warn(`[llm] ${aviso}`);
          if (avisos) avisos.push(aviso);
          modelo = config.regenVisionModel;
          continue;
        }
        throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 200)}`);
      }

      const json = await res.json();
      const choice = json.choices?.[0];
      let text = (choice?.message?.content || '').trim();
      if (!text) throw new Error('respuesta vacía');
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try {
        return JSON.parse(text);
      } catch (e) {
        const motivo = choice?.finish_reason === 'length' ? 'se quedó sin tokens' : 'llegó cortada';
        throw new Error(`la respuesta ${motivo} (${e.message})`);
      }
    } catch (e) {
      ultimoError = e.message;
      console.warn(`[llm ${modelo}] intento ${intento}/${tries}: ${e.message}`);
      if (intento < tries) await new Promise((r) => setTimeout(r, 2000 * intento));
    }
  }
  throw new Error(ultimoError);
}

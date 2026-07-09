// Traduce una transcripción a español con un modelo barato vía OpenRouter (Gemini 2.5 Flash).
// Trocea textos largos para no truncar la salida del modelo y une los resultados.

import { config } from './config.js';

const CHUNK_CHARS = 8000; // ~2.7k tokens de salida por trozo; seguro para el límite del modelo.

// Parte el texto en trozos, cortando en saltos de línea/espacios para no romper frases.
function splitText(text, size) {
  if (text.length <= size) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      const sp = text.lastIndexOf(' ', end);
      const min = i + Math.floor(size * 0.5);
      if (nl > min) end = nl;
      else if (sp > min) end = sp;
    }
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts;
}

async function translateChunk(text) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.translateModel,
      max_tokens: 20000,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'Eres un traductor profesional especializado en contenido tech/IA. Traduce el texto del ' +
            'usuario al español neutro. ' +
            'NO traduzcas nombres propios ni términos técnicos: nombres de herramientas, productos, ' +
            'librerías, modelos de IA, comandos, nombres de archivo, extensiones (ej. "design.md", ' +
            '"ClaudeCode", "GitHub", "design system"), marcas ni handles/usuarios (@algo). Déjalos ' +
            'exactamente como aparecen en el original, integrados en la frase en español. ' +
            'Devuelve SOLO la traducción: sin notas, sin comillas, sin explicaciones ni encabezados. ' +
            'Conserva los saltos de línea. Si el texto ya está en español, devuélvelo igual.',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(config.transcribeTimeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

export async function translateToSpanish(text) {
  const clean = (text || '').trim();
  if (!clean) throw new Error('No hay texto para traducir');
  const chunks = splitText(clean, CHUNK_CHARS);
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const t = await translateChunk(chunks[i]);
    out.push(t);
    if (chunks.length > 1) console.log(`[translate] trozo ${i + 1}/${chunks.length}: ${t.length} chars`);
  }
  return out.join('\n').trim();
}

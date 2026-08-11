// Etapa D: auto-revisión de cada lámina generada.
//
// Diseñado contra el fallo histórico del revisor anterior de Dante, que se retiró por falsos
// positivos: revisaba las láminas ampliadas al 4x y cazaba defectos que nadie ve en el feed.
// Aquí el prompt obliga a juzgar a tamaño de feed, es estricto solo en texto y marca ajena,
// e indulgente en lo estético. Ante la duda, aprueba.

import { config } from './config.js';
import { chatJSON, imgContent } from './llm.js';
import { buildQaPrompt } from './regenPrompts.js';

export async function revisarLamina({ url, slide }) {
  try {
    const out = await chatJSON({
      model: config.regenQaModel,
      temperature: 0.1,
      maxTokens: 2000,
      tries: 2,
      messages: [{ role: 'user', content: imgContent(buildQaPrompt({ slide }), [url]) }],
    });
    const problemas = Array.isArray(out.problemas) ? out.problemas.filter(Boolean) : [];
    const ok = out.ok === true || problemas.length === 0;
    return {
      ok,
      problemas: ok ? [] : problemas,
      instruccion: ok ? null : out.instruccion || null,
    };
  } catch (e) {
    // Si el revisor falla, la lámina pasa: no vale la pena tirar dinero por un fallo del QA.
    console.warn(`[regen QA] no se pudo revisar: ${e.message}`);
    return { ok: true, problemas: [], instruccion: null };
  }
}

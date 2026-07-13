// Helpers de texto compartidos por el dashboard y el bot de Slack: ordenar una transcripción
// "corrida" en párrafos legibles, y detectar si ya está en español (para no traducir de más).

// Convierte una transcripción en párrafos agrupando por oraciones. Ignora a propósito los saltos
// de línea originales: los subtítulos traen un salto por línea de caption, no por párrafo real.
// Espejo de dashboard/lib/format.ts.
export function toParagraphs(text, sentencesPerPara = 3) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  const clean = trimmed.replace(/\s+/g, ' ');
  const sentences = clean.match(/[^.!?…]+[.!?…]+["'”’)\]]*|\S.*$/g) || [clean];
  const paras = [];
  for (let i = 0; i < sentences.length; i += sentencesPerPara) {
    const p = sentences.slice(i, i + sentencesPerPara).map((s) => s.trim()).join(' ').trim();
    if (p) paras.push(p);
  }
  return paras;
}

// Heurística barata: cuenta stopwords típicas de español vs inglés para no gastar en traducir
// texto que ya está en español. No es detección de idioma real, pero basta para este caso de uso.
const ES_STOPWORDS = /\b(que|de|la|el|en|es|un|una|para|con|no|se|su|por|más|como|los|las|del|pero|muy|así|también|porque|esto|esta)\b/gi;
const EN_STOPWORDS = /\b(the|and|is|are|you|your|this|that|with|for|to|of|it|on|be|as|but|have|has|not)\b/gi;

// Empaqueta párrafos en mensajes de hasta maxLen caracteres (límite práctico de Slack), sin
// partir un párrafo a la mitad salvo que uno solo ya exceda el límite.
export function chunkParagraphs(paragraphs, maxLen = 3500) {
  const chunks = [];
  let cur = '';
  for (const p of paragraphs) {
    if (p.length > maxLen) {
      if (cur) { chunks.push(cur); cur = ''; }
      for (let i = 0; i < p.length; i += maxLen) chunks.push(p.slice(i, i + maxLen));
      continue;
    }
    const next = cur ? cur + '\n\n' + p : p;
    if (next.length > maxLen) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function looksSpanish(text) {
  const t = (text || '').slice(0, 2000);
  const es = (t.match(ES_STOPWORDS) || []).length;
  const en = (t.match(EN_STOPWORDS) || []).length;
  if (es === 0 && en === 0) return true; // sin señales claras, no traducir de más
  return es >= en;
}

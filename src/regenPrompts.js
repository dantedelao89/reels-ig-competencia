// Plantillas de prompts del Regenerador de carruseles. Aquí vive el conocimiento del branding
// "cuaderno/bitácora" de Dante (portado de la skill rehacer-carruseles): qué se conserva del
// original, cómo se ve el estilo, y las reglas no negociables (handle → @iacondante, prompts
// copiables VERBATIM, texto en una columna, cara de Dante intacta en el CTA).

// Cierre fijo de toda lámina regenerada (regla de oro del branding).
export const CIERRE_BRANDING =
  'Quita TODO el texto en inglés y cualquier color de acento del original; los únicos acentos son ' +
  'el amarillo lima #faff69 (rellenos) y el oliva #4f5100 (texto/trazo manuscrito). Todo el texto ' +
  'visible en español perfecto, sin errores ortográficos ni palabras cortadas. Formato vertical 4:5.';

// Descripción base del estilo cuaderno (se inyecta en todo prompt de regeneración).
const ESTILO_CUADERNO =
  'Estilo "bitácora de laboratorio" hecha a mano: fondo de hoja de cuaderno de papel crema #F4F1E8 ' +
  'con retícula sutil, espiral metálica en el borde izquierdo y línea de margen. Las fotos van ' +
  '"pegadas" al papel: marco polaroid blanco, sombra dura offset 2-3px sin difuminar, leve rotación ' +
  'y un trozo de cinta washi color lima #faff69. Arriba un chip de etiqueta en tipografía ' +
  'monoespaciada con el tema en mayúsculas; el titular en tipografía ultra bold negra, con UNA sola ' +
  'palabra clave escrita a mano (estilo Caveat) en tinta oliva #4f5100 o resaltada con marcador ' +
  'lima #faff69. Se admiten anotaciones manuscritas, flechas y subrayados hechos a mano en oliva.';

const REGLA_SEGUNDA_IMAGEN =
  'La SEGUNDA imagen es SOLO referencia del ESTILO visual (papel, tipografías, chips, sombras, ' +
  'acentos): NO copies su contenido, NO copies su layout exacto, NO la pegues dentro de la lámina.';

const REGLA_UNA_COLUMNA =
  'Todo el texto de la lámina va en UNA sola columna, de preferencia alineada a la izquierda. ' +
  'Nunca repartas texto en esquinas opuestas.';

// Prompt para REGENERAR un slide de diseño/texto. La primera imagen es el slide original
// (composición/fotos a conservar), la segunda es la referencia de estilo.
export function buildRegenPrompt({ tipoSlide, textoNuevo, nota }) {
  const partes = [
    'Rediseña esta lámina de carrusel de Instagram conservando su INTENCIÓN y su jerarquía: si la ' +
      'lámina original tiene fotografías o personas, consérvalas EXACTAMENTE (misma persona, misma ' +
      'cara, mismos colores, mismo recorte); solo cambia el diseño gráfico alrededor.',
    ESTILO_CUADERNO,
    REGLA_SEGUNDA_IMAGEN,
    textoNuevo
      ? `El texto de la lámina debe decir EXACTAMENTE (respeta saltos de línea y jerarquía):\n${textoNuevo}`
      : 'Conserva el mensaje del texto original, traducido a español natural.',
    REGLA_UNA_COLUMNA,
    'Si el original muestra un handle o marca de otro creador, sustitúyelo por @iacondante. ' +
      'Elimina cualquier mención a productos, cursos o códigos promocionales del creador original.',
    tipoSlide === 'portada'
      ? 'Es la PORTADA del carrusel: el titular debe dominar la lámina y obligar a deslizar.'
      : null,
    nota ? `Instrucción adicional del autor (prioritaria): ${nota}` : null,
    CIERRE_BRANDING,
  ];
  return partes.filter(Boolean).join('\n\n');
}

// Prompt para el slide de CTA: la PRIMERA imagen es la foto real de Dante (base), la segunda la
// referencia de estilo. La identidad se preserva a toda costa.
export function buildCtaPrompt({ textoNuevo, nota }) {
  const partes = [
    'Crea la lámina de CTA (cierre) de un carrusel de Instagram usando la fotografía del hombre de ' +
      'la PRIMERA imagen. CRITICAL: PRESERVE the man\'s face, identity, features, skin, hair, posture ' +
      'and clothing EXACTLY as in the photo — do not alter his features, do not generate a different ' +
      'person, do not beautify him. Recorta y DESCARTA el fondo de color de estudio de la foto: el ' +
      'fondo de la lámina es el papel del cuaderno.',
    ESTILO_CUADERNO,
    REGLA_SEGUNDA_IMAGEN,
    textoNuevo
      ? `El texto del CTA debe decir EXACTAMENTE:\n${textoNuevo}`
      : 'El CTA invita a seguir a @iacondante.',
    'Incluye el handle @iacondante visible.',
    REGLA_UNA_COLUMNA,
    nota ? `Instrucción adicional del autor (prioritaria): ${nota}` : null,
    CIERRE_BRANDING,
  ];
  return partes.filter(Boolean).join('\n\n');
}

// Prompt corto para LIMPIAR una foto con marca de agua (Qwen edit, ≤800 chars, una sola imagen:
// hereda el aspect ratio de la foto). No rediseña nada.
export function buildCleanPrompt() {
  return (
    'Remove every watermark, username, handle, logo or text overlay from this photo. ' +
    'Keep absolutely everything else identical: same people, same faces, same colors, same ' +
    'framing, same background. Reconstruct the area behind the removed marks naturally. ' +
    'Do not add any new text or elements.'
  );
}

// Comprime un prompt de regeneración al límite de Qwen (≤800 chars) conservando las reglas clave.
// Se usa solo como fallback cuando gpt-image-2 rechaza la lámina por filtro de contenido.
export function buildQwenFallbackPrompt({ tipoSlide, textoNuevo, nota }) {
  const texto = (textoNuevo || '').slice(0, 320);
  const partes = [
    'Redesign this Instagram carousel slide. Keep any people/photos EXACTLY identical.',
    'Style: handmade lab-notebook, cream paper #F4F1E8 with subtle grid and left spiral; photos as ' +
      'polaroids with hard 2-3px offset shadow and lime #faff69 washi tape; mono label chip; ultra ' +
      'bold black headline with ONE handwritten word in olive #4f5100.',
    texto ? `Text (exact, in Spanish): ${texto}` : 'Translate the original text to Spanish.',
    'Replace any creator handle with @iacondante. Single text column. Vertical 4:5.',
    nota ? `Note: ${nota.slice(0, 120)}` : null,
  ];
  let out = partes.filter(Boolean).join(' ');
  if (out.length > 800) out = out.slice(0, 797) + '…';
  return out;
}

// Prompt de la llamada de visión que arma el plan: clasifica cada slide, extrae y traduce el texto.
export function buildVisionPrompt(numSlides) {
  return (
    `Analiza los ${numSlides} slides (en orden) de un carrusel de Instagram de otro creador. ` +
    'Voy a rehacerlo con mi propio branding. Para CADA slide devuelve un objeto JSON con:\n' +
    '- "idx": índice del slide (0-based, en el orden dado)\n' +
    '- "clasificacion": "foto" (solo fotografías/capturas SIN texto de diseño ni marcas encima), ' +
    '"foto_marca" (fotografía cuyo único problema es una marca de agua, handle o logo del creador ' +
    'encima) o "diseno" (lámina diseñada: titulares, listas, texto, portada, CTA, infografía)\n' +
    '- "tipoSlide": "portada" (primer slide con titular gancho), "lista" (bullets/checks), "quote" ' +
    '(cita o definición destacada), "numero" (un número grande protagonista), "cta" (cierre que pide ' +
    'seguir/comentar/guardar), "contenido" (cualquier otra lámina de diseño) o "foto" (si la ' +
    'clasificación es foto/foto_marca)\n' +
    '- "textoOriginal": TODO el texto visible del slide, transcrito fiel (null si no hay texto)\n' +
    '- "textoNuevo": mi versión en español natural del texto, lista para la nueva lámina. Reglas: ' +
    'traduce al español neutro; sustituye el handle/marca del creador por @iacondante; ELIMINA ' +
    'menciones a su producto/curso/código promocional; si el slide contiene un PROMPT largo de IA ' +
    'que el lector va a copiar, consérvalo VERBATIM sin traducir (los prompts van en su idioma ' +
    'original) y traduce solo el texto alrededor. (null si no hay texto)\n' +
    '- "marcaDetectada": texto/handle/logo del creador visible en el slide, si lo hay (null si no)\n\n' +
    'Responde SOLO con JSON válido: {"slides": [ ... ]} con exactamente un objeto por slide.'
  );
}

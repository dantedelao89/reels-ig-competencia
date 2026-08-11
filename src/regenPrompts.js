// Conocimiento de marca de @iacondante, empaquetado como bloques de prompt reutilizables.
// Extraído de sus skills (rehacer-carruseles, carruseles-ig-dante, captions-ig-dante) y de
// sus memorias de feedback real. Cada bloque vive UNA sola vez; los builders los componen.
//
// Regla de determinismo del sistema: el LLM NUNCA escribe prompts de imagen crudos. Escribe
// solo lo creativo (textos literales, foto, rol, acento) y los builders de aquí ensamblan el
// estilo. Así el estilo se cambia en un sitio y ningún prompt puede "olvidarlo".

// ---------------------------------------------------------------------------
// BLOQUES
// ---------------------------------------------------------------------------

export const VOZ_DANTE = `Escribes carruseles de Instagram para @iacondante (Dante), en español de México.

VOZ — 12 reglas no negociables:
1. Frase corta. Una idea por línea. Nunca párrafos densos.
2. Tensión presente vs futuro: dónde está hoy el lector y dónde puede estar.
3. Mayúsculas estratégicas en 1-3 palabras por lámina (NO, AHORA, AÚN, YA). Son la negrita hablada.
4. Léxico aspiracional y bélico: dominar, arma secreta, ventaja, adelantarse.
   Prohibido lo tibio: "podrías", "tal vez", "quizá".
5. Números concretos y verificables, nunca adjetivos vagos. Los números dan credibilidad; los adjetivos no.
6. Nada que no se pueda sostener. Si no se puede probar, se convierte en pregunta.
7. Natural, como se habla. Español de México, ni traducido ni acartonado.
8. PROHIBIDO el guion largo (—) de inciso. Usa comas, puntos o dos puntos.
9. Cero metáforas-acertijo. Cero juegos de palabras. Cero ironía.
10. Confronta sin acusar. El dolor se nombra SIN SUJETO.
11. Abre bucles: "la 4 te va a doler".
12. Cierra con una frase-martillo aislada en su propia línea.

Cero emojis dentro de las láminas. Sin humor, sin autodeprecación, sin anécdota en primera persona.`;

export const REGLAS_TITULAR = `REGLAS DEL TITULAR DE PORTADA (en orden de importancia):

REGLA Nº1 — EL TITULAR NOMBRA LO QUE SE REGALA. Si el carrusel entrega prompts, la palabra
PROMPT o PROMPTS va en el titular. Si entrega una plantilla, va "plantilla". Si entrega una
guía, va "guía". No es negociable y es lo primero que se comprueba. El gancho psicológico es
CÓMO lo dices; el lector tiene que saber QUÉ se lleva si desliza.

REGLA Nº2 — NO LE ECHES LA CULPA AL LECTOR. Diagnosticar un dolor no es lo mismo que decirle
a alguien que lo hizo mal. El dolor se nombra SIN SUJETO.
"LO QUE DELATA A UNA FOTO DE IA" sí. "LO QUE TÚ HACES MAL" no.
Prohibido: "pusiste", "bajaste", "le pusiste", "iluminaste".

REGLA Nº3 — SE TIENE QUE ENTENDER EN FRÍO. Quien ve la portada no sabe nada de ti, no leyó el
caption, no conoce la cuenta y tiene un segundo. Palabras que todo el mundo usa. Sustantivos
concretos, no conceptos ("fotos" y "retratos" sí; "la luz", "el encuadre" y "la composición" no).
Lo ingenioso va DENTRO del carrusel. La portada es un letrero.

REGLA Nº4 — LONGITUD: máximo 16 caracteres por línea, máximo 3 líneas, máximo 8 palabras.
Si no cabe, se ACORTA LA FRASE. La letra nunca se encoge. Debe leerse en una miniatura del
tamaño de una uña.

Puede ser controversial: que discuta con el lector, que suene atrevido. Lo que no puede ser es vago.

RECHAZO automático si: describe o resume el carrusel en vez de obligar a abrirlo; no nombra lo
que se regala; culpa al lector; solo se entiende si ya conoces el contenido; usa jerga de nicho
(fotograma, cine negro, editorial, encuadre, composición, "la luz"); usa juegos de palabras.

Titulares reales aprobados por Dante:
"CAMBIAS EL ÁNGULO\\nY TE CAMBIA LA CARA.\\n7 PROMPTS."
"ESTA HAMBURGUESA\\nNO EXISTE.\\n6 PROMPTS."
"NO NECESITAS MODELO.\\nNECESITAS EL PROMPT."
"COPIA ESTE PROMPT\\nY PONTE LAS ALAS."`;

export const ESTRUCTURA_CARRUSEL = `ESTRUCTURA DEL CARRUSEL:
- Lámina 1 (portada): se lleva el 80% del resultado. 6-10 palabras.
- Lámina 2: CREDIBILIDAD, no presentación. El error clásico es usarla para presentarse. Su
  trabajo es bajar el escepticismo y ABRIR UN BUCLE que sostenga la caída de atención.
- Láminas intermedias: UNA idea por lámina. Máximo 15-20 palabras. Titular de lámina ≤6
  palabras. Listas de ≤5 ítems.
- Penúltima: el dato o el costo oculto. Corta el ritmo visual.
- Última: CTA SIEMPRE. Nunca se recorta por el final.
- Al rehacer un carrusel ajeno se CONSERVA el número de láminas del original.
- Todo el texto de una lámina en UNA sola columna, de preferencia a la izquierda. Nunca
  repartido en esquinas opuestas: nadie lee un carrusel en zigzag.
- Los prompts largos NO van dentro de las láminas: para eso el lector comenta la keyword.
  Menos texto = mejor diseño y menos erratas.`;

export const ESTILO_FOTO_SANGRE = `ESTILO VISUAL — obligatorio, es la identidad de @iacondante:
- La fotografía ocupa el 100% del lienzo, a sangre. Sin marco, sin borde, sin margen.
  La lámina ES la foto.
- Oscuro. Si la escena no es oscura, se le funde un degradado negro SOLO en la franja donde va
  el texto. NUNCA un panel opaco, una caja de color ni una banda sólida.
- Texto mínimo encima: tipografía grotesca pesada, blanco puro, mayúsculas, tracking cerrado.
- El amarillo lima #faff69 es UN acento, no un tema: una barra de marcador pintada a mano
  detrás de UNA sola línea o UNA sola palabra. Nunca lima repartido por la lámina.
- PROHIBIDO: papel, cuaderno, retícula, espiral, marco polaroid, cinta washi, sombra dura
  offset, stickers, fondo crema o claro, cualquier plantilla de diseño.
- PROHIBIDO en la fotografía: hora dorada, fondo desenfocado de estudio, piel perfecta. Se
  piden los defectos por su nombre: poros abiertos, brillo en la frente, vello en los
  antebrazos, textura real de la piel.
- Todo el texto en UNA sola columna, de preferencia a la izquierda.
- Todo el texto en español perfecto, con tildes, sin palabras cortadas, sin inventar ni una
  palabra que no esté en la lista dada.
- Formato vertical 4:5.`;

export const REGLAS_CTA = `REGLAS DEL CTA (última lámina, siempre):
- Fórmula: "Comenta <KEYWORD> y te mando <lo que se entrega>".
- La KEYWORD va en mayúsculas y SIN TILDES (MENU, no MENÚ: el filtro de comentarios se rompe
  con tildes). Una palabra real que nombre el objeto que se entrega (HOJA, PROMPTS, ANGULO)
  es mejor que un código con número.
- La keyword es el elemento de texto MÁS GRANDE de la lámina, más que la palabra "Comenta".
- Sin la keyword el carrusel no convierte: es lo que liga el carrusel con la entrega.`;

export const PROHIBICIONES_MARCA = `MARCA AJENA — borrado obligatorio:
El handle del creador original se sustituye por @iacondante. Se ELIMINAN por completo: su logo,
su tipografía, su paleta de color, sus marcas de agua, su producto, curso o masterclass, su
código promocional, y cualquier texto suyo quemado en las fotos.
De una referencia se toma la ESTRUCTURA, nunca la marca.`;

export const TAXONOMIA_ROLES = `ROLES DE LÁMINA (elige uno por lámina):
portada — la primera, titular gancho que obliga a deslizar.
credibilidad — baja el escepticismo y abre un bucle. Va en la lámina 2.
paso — un paso numerado de un proceso.
statement — una sola afirmación grande que derriba o afirma una idea de un golpe.
checklist — una lista corta de requisitos o ítems.
comparacion — antes/ahora, error/acierto, dos columnas.
cita — una frase personal o manifiesto.
imagen — una captura o foto real que es la prueba, con un pie corto.
prompt — la ficha de un prompt copiable, con su resultado.
antes-despues — entrada y resultado, uno junto al otro.
dato — el dato o el costo oculto. Corta el ritmo visual.
cta — el cierre con la keyword. Es siempre la última.`;

// ---------------------------------------------------------------------------
// BUILDERS
// ---------------------------------------------------------------------------

// A1 · Lectura: la visión extrae qué hay en cada lámina. Trabajo de extracción, no creativo.
export function buildLecturaPrompt(numSlides) {
  return `Te paso ${numSlides} láminas (en orden) de un carrusel de Instagram de otro creador.
Tu trabajo es EXTRAER lo que hay, sin opinar ni reescribir nada.

Por cada lámina devuelve:
- "idx": su posición (0-based, en el orden dado)
- "textoOriginal": TODO el texto visible, transcrito fiel y completo (null si no hay texto)
- "descripcionVisual": qué se ve, en una frase (la fotografía, el sujeto, el ambiente, la luz)
- "rolDetectado": qué función cumple — "portada" | "contenido" | "cta" | "foto"
- "marcaDetectada": SOLO la marca del CREADOR de este carrusel — su handle (@algo), su logo,
  su marca de agua, su curso, su producto o su código promocional. NO es marca ajena el tema
  del que habla el carrusel (una película, una serie, una marca comercial que se menciona como
  ejemplo, un modelo de IA). null si no hay.
- "esSoloFoto": true si es una fotografía o captura SIN texto de diseño encima (una marca de
  agua no cuenta como texto de diseño), false si es una lámina diseñada

Además, del conjunto:
- "tema": de qué va el carrusel, en una frase
- "queEntrega": qué se lleva el lector si interactúa, SIN número (ej. "prompts para pósters",
  "una plantilla"). Si el carrusel no regala nada explícito, deduce el objeto de valor que enseña.
- "piezas": CUÁNTAS piezas de ese objeto entrega realmente el carrusel, contadas en las láminas
  (ej. si hay 6 láminas cada una con un prompt distinto, son 6). Cuenta, no estimes. Si no se
  puede contar con certeza, null. NUNCA inventes este número.
- "argumento": la tesis del carrusel, en una frase
- "dolor": el problema del lector que el carrusel toca, en una frase, SIN SUJETO
- "publico": a quién le habla, en una frase

Responde SOLO con JSON válido:
{"tema":"…","queEntrega":"…","piezas":6,"argumento":"…","dolor":"…","publico":"…","laminas":[{…}]}`;
}

// A2 · Director de ganchos. Texto puro, sin imágenes, temperatura alta.
export function buildGanchosPrompt({ analisis, brief, excluir = [] }) {
  const laminas = (analisis.laminas || [])
    .map((l) => `${l.idx + 1}. ${l.rolDetectado}: ${(l.textoOriginal || l.descripcionVisual || '').slice(0, 120)}`)
    .join('\n');

  return `${VOZ_DANTE}

${REGLAS_TITULAR}

Este es el carrusel de otro creador que voy a rehacer como mío:

TEMA: ${analisis.tema}
QUÉ ENTREGA: ${analisis.queEntrega}
DOLOR: ${analisis.dolor}
ARGUMENTO: ${analisis.argumento}
PÚBLICO: ${analisis.publico}
LÁMINAS:
${laminas}

CANTIDAD: ${
    analisis.piezas
      ? `el carrusel entrega ${analisis.piezas}. Si nombras una cantidad en el titular, tiene que ser EXACTAMENTE ${analisis.piezas}. Ningún otro número.`
      : 'no se pudo contar cuántas piezas entrega. NO pongas ninguna cantidad en los titulares: inventar un número es la falta más grave.'
  }
${brief ? `\nINSTRUCCIÓN DE DANTE PARA ESTE CARRUSEL (mándala sobre todo lo demás): ${brief}` : ''}
${excluir.length ? `\nYA PROPUSISTE ESTOS Y LOS DESCARTÓ. No los repitas ni los parafrasees:\n${excluir.join('\n---\n')}` : ''}

Escribe 5 TITULARES DE PORTADA, uno por cada fórmula, en este orden exacto:
1. DOLOR YA VIVIDO — nombra algo que al lector YA le pasó. Sin sujeto, sin culpa.
2. INCREDULIDAD — una afirmación que cuesta creer y por eso se abre.
3. REFRAME / LA PIEZA QUE FALTA — no es lo que crees que es, es esto otro.
4. ERROR SEÑALADO — señala el error, sin sujeto, sin regañar.
5. ADVERTENCIA — lo que va a pasar si no lo sabes.

Cinco IDEAS DISTINTAS, no cinco variantes de la misma frase.
Cada titular en 1 a 3 líneas separadas por \\n, respetando la REGLA Nº4 (≤16 caracteres por
línea, ≤3 líneas, ≤8 palabras). Todo en mayúsculas.
Comprueba la REGLA Nº1 en los cinco antes de responder.

Responde SOLO con JSON:
{"ganchos":[{"id":"g1","formula":"dolor ya vivido","titular":"LÍNEA 1\\nLÍNEA 2","porque":"por qué funciona, una frase"}]}`;
}

// B · Guionista: escribe el carrusel completo. Texto puro, sin imágenes.
export function buildGuionPrompt({ analisis, gancho, brief, variantesCta = [] }) {
  const laminas = (analisis.laminas || [])
    .map(
      (l) =>
        `idx ${l.idx} | rol original: ${l.rolDetectado} | solo foto: ${l.esSoloFoto ? 'sí' : 'no'}` +
        `${l.marcaDetectada ? ` | marca ajena: ${l.marcaDetectada}` : ''}\n` +
        `   texto: ${(l.textoOriginal || '—').slice(0, 200)}\n` +
        `   visual: ${l.descripcionVisual || '—'}`
    )
    .join('\n');

  return `${VOZ_DANTE}

${ESTRUCTURA_CARRUSEL}

${PROHIBICIONES_MARCA}

${TAXONOMIA_ROLES}

${REGLAS_CTA}

CARRUSEL DE REFERENCIA (de otro creador). Te sirve SOLO como referencia de ESTRUCTURA: qué
orden de argumentos usó y cuántas láminas. NO traduzcas su texto. Reescribe todo en mi voz.

${laminas}

TEMA: ${analisis.tema}
QUÉ ENTREGA: ${analisis.queEntrega}
KEYWORD SUGERIDA: ${analisis.keyword || '(elige una palabra real, en mayúsculas, sin tildes)'}
DOLOR: ${analisis.dolor}

PORTADA YA DECIDIDA. Cópiala literal como primer elemento de "textos" en la lámina 0, sin
cambiarle ni una letra:
${gancho.titular}
${brief ? `\nINSTRUCCIÓN DE DANTE (manda sobre todo lo demás): ${brief}` : ''}
${variantesCta.length ? `\nVARIANTE DE CTA A USAR: ${variantesCta[0]}` : ''}

Escribe el carrusel completo: EXACTAMENTE ${analisis.numLaminas} láminas, con los mismos índices.

Por cada lámina decides:
- "accion": "copiar" si es solo una foto sin texto ni marca ajena (no se gasta en ella);
  "limpiar" si es una foto buena cuyo único problema es una marca de agua o un handle ajeno;
  "regenerar" en cualquier otro caso.
- "rol": uno de la taxonomía.
- "textos": las cadenas LITERALES que van impresas en la lámina, en orden. No se escribirá
  nada más que esto. Sin emojis.
- "acento": la ÚNICA línea o palabra que lleva barra de marcador lima. null si ninguna.
- "chip": etiqueta corta de esquina, en mayúsculas (ej. "PROMPT GRATIS"), o null.
- "foto": qué fotografía ocupa la lámina, descrita como una foto real con defectos por su
  nombre (poros abiertos, brillo en la frente, vello en los antebrazos). Prohibido: hora
  dorada, fondo desenfocado de estudio, piel perfecta.
  Si accion es "copiar" o "limpiar", foto = null (se usa la del original).

  MUY IMPORTANTE, según la lámina:
  · Láminas normales: la fotografía PARTE DE LA DEL ORIGINAL. Si en esa lámina ya sale una
    persona, SE CONSERVA tal cual (misma cara, misma ropa, mismo encuadre) y solo describes
    cómo tratar la imagen: luz, fondo, recorte, atmósfera. NUNCA menciones a Dante ni metas
    a otra persona: la cara que hay es la que se queda.
  · Lámina de CTA (y solo esa): ahí sí aparece Dante, porque su foto real se pasa aparte.
    Describe SOLO la ESCENA (dónde está, qué hace, cómo es la luz), no a la persona: su cara
    no se toca. Nunca papel, polaroid, cinta ni cuaderno.

NO INVENTES NADA que no se pueda sostener: ni cifras de seguidores, ni resultados, ni precios,
ni marcas de terceros, ni menciones a personas reales. Si quieres dar una cifra y no la tienes
del carrusel de referencia, conviértela en pregunta o quítala.

La lámina 0 es la portada con el titular ya decidido. La última es el CTA con la fórmula
"Comenta <KEYWORD> y te mando <lo que se entrega>". Nunca cambies el número de láminas.

Responde SOLO con JSON:
{"keyword":"ANIME","laminas":[{"idx":0,"accion":"regenerar","rol":"portada","textos":["…"],"acento":"…","chip":"…","foto":"…"}]}`;
}

// C · Prompt de imagen de una lámina normal. Ensambla lo creativo con el estilo fijo.
export function buildImagenPrompt({ rol, textos = [], foto, acento, chip, correccion }) {
  const lista = textos.map((t, i) => `${i + 1}) "${t}"`).join('\n');
  const esPortada = rol === 'portada';

  const disposicion = esPortada
    ? `- El titular va ABAJO, de borde a borde, sin márgenes laterales. Es el elemento MÁS GRANDE
  de toda la imagen: la altura de cada letra mayúscula es aproximadamente 1/10 de la altura de
  la lámina. Tiene que leerse en una miniatura del tamaño de una uña.
- "@iacondante" pequeño abajo a la izquierda. Sello "DESLIZA →" pequeño abajo a la derecha.`
    : `- El texto va abajo a la izquierda, en UNA columna. El titular de la lámina es el elemento
  de texto más grande. "@iacondante" pequeño abajo.`;

  return [
    `Crea una lámina de carrusel de Instagram${esPortada ? ' — es la PORTADA' : ''}.`,
    `FOTOGRAFÍA, ocupa toda la lámina: ${foto}`,
    `TEXTO — escribe EXACTAMENTE estas cadenas, en este orden, sin traducir, sin parafrasear,
sin añadir ni una palabra:\n${lista}`,
    `DISPOSICIÓN:\n${disposicion}${
      acento
        ? `\n- Barra de marcador lima #faff69 pintada a mano detrás de "${acento}" y de nada más.`
        : ''
    }${chip ? `\n- Chip arriba a la izquierda: cuadradito lima con "${chip}" en monoespaciada corta.` : ''}`,
    ESTILO_FOTO_SANGRE,
    `La SEGUNDA imagen, si la hay, es SOLO referencia de tipografía, peso y color. No copies su
contenido, no copies su layout, no la pegues dentro de la lámina.`,
    correccion ? `CORRECCIÓN OBLIGATORIA — el intento anterior falló por esto: ${correccion}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// C · Prompt de imagen del CTA. La PRIMERA imagen es la foto real de Dante.
export function buildCtaImagenPrompt({ textos = [], foto, keyword, variante, correccion }) {
  const lista = textos.map((t, i) => `${i + 1}) "${t}"`).join('\n');
  return [
    `Crea la lámina de CIERRE (CTA) de un carrusel de Instagram usando al hombre de la PRIMERA imagen.`,
    `CRITICAL: PRESERVE the man's face, identity, features, skin texture, hair and build EXACTLY
as in the photo. Do not generate a different person. Do not beautify him.
Encuadre de medio cuerpo o 3/4, NUNCA cuerpo completo. Descarta por completo el fondo plano de
estudio de la foto original.`,
    `ESCENA — recréalo dentro del tema del carrusel: ${foto || 'trabajando frente a su pantalla, luz de monitor en la cara'}
La escena es una fotografía real a sangre. Nada de papel, polaroid, cinta, cuaderno ni marcos.
La cara va limpia: ninguna línea, trazo, texto ni elemento gráfico encima de su rostro.`,
    variante ? `ENCUADRE: ${variante}` : null,
    `TEXTO — exactamente estas cadenas, en este orden:\n${lista}`,
    `DISPOSICIÓN:
- "${keyword}" va DENTRO de un recuadro de marcador lima #faff69 pintado a mano, con bordes
  irregulares como de plumón real, y el texto en negro dentro. Es EL ELEMENTO DE TEXTO MÁS
  GRANDE de toda la lámina, más grande que la palabra "Comenta".
- El resto del texto en blanco, en una columna, sobre un degradado negro.`,
    ESTILO_FOTO_SANGRE,
    correccion ? `CORRECCIÓN OBLIGATORIA — el intento anterior falló por esto: ${correccion}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// D · Auto-QA. Diseñado contra el fallo histórico de revisar ampliado (falsos positivos).
export function buildQaPrompt({ slide }) {
  const lista = (slide.textos || []).map((t, i) => `${i + 1}) "${t}"`).join('\n');
  const esPortada = slide.rol === 'portada';
  const esCta = slide.rol === 'cta';

  return `Eres el revisor de calidad de un carrusel de Instagram. Te paso UNA lámina generada.

JÚZGALA AL TAMAÑO EN QUE LA GENTE LA VE EN EL FEED (unos 430 px de ancho), NO ampliada.
Si un defecto solo se nota al 4x, NO es un defecto: nadie amplía un carrusel al deslizar.

Esta lámina debía decir EXACTAMENTE:
${lista}

Su rol es: ${slide.rol}.

Revisa en este orden:
1. TEXTO: ¿dice exactamente eso? ¿Erratas, tildes faltantes, palabras cortadas o partidas,
   palabras inventadas, texto en inglés que debería estar en español, texto duplicado?
2. MARCA AJENA: ¿se coló un handle, logo, marca de agua, nombre de curso, producto o código
   promocional que no sea @iacondante?
3. LEGIBILIDAD EN MINIATURA: ¿el titular se lee a tamaño de uña?${
    esPortada
      ? ' ¿Va de borde a borde y la altura de sus mayúsculas es aproximadamente 1/10 de la lámina?'
      : ''
  }
   ¿Algún texto queda sobre una zona clara que lo vuelve ilegible, o cortado por el borde?
4. ESTILO: ¿la foto ocupa el 100% del lienzo? ¿Aparece algo PROHIBIDO: papel, cuaderno,
   retícula, espiral, marco polaroid, cinta washi, fondo claro, un panel opaco de color detrás
   del texto, o lima repartido por toda la lámina en vez de un solo acento?${
     esCta
       ? `\n5. CTA: ¿la keyword está dentro de un recuadro de marcador lima y es el texto MÁS GRANDE de
   la lámina? ¿La cara es fotográfica y no tiene líneas ni texto encima?`
       : ''
   }

Sé ESTRICTO con el texto (punto 1) y con la marca ajena (punto 2).
Sé INDULGENTE con lo estético: un encuadre que no te encanta NO es un problema.
Ante la duda, ok = true.

Responde SOLO con JSON:
{"ok": true, "problemas": ["frases cortas, una por defecto real"], "instruccion": "UNA sola orden imperativa y concreta para el generador de imágenes, o null"}`;
}

// E · Intérprete de instrucciones en lenguaje natural.
export function buildInstruccionPrompt({ plan, texto }) {
  const resumen = plan
    .map(
      (s) =>
        `${s.idx + 1}. [idx ${s.idx}] rol=${s.rol || s.tipoSlide} accion=${s.accion}` +
        ` | textos=${JSON.stringify((s.textos || []).slice(0, 3))}` +
        ` | foto=${(s.foto || '—').slice(0, 80)}`
    )
    .join('\n');

  return `${VOZ_DANTE}

Dante te da una instrucción en lenguaje natural sobre un carrusel ya generado.
Tradúcela a cambios concretos por lámina.

PLAN ACTUAL (él las numera desde 1; la "5" es idx 4):
${resumen}

INSTRUCCIÓN: "${texto}"

Reglas:
- Devuelve SOLO las láminas que realmente cambian.
- "todos" o "todas" = todas las láminas con accion "regenerar".
- "sin la foto" significa cambiar la fotografía, no borrar la lámina.
- Si cambia la keyword del CTA y el titular la nombraba, actualiza también el titular.
- Nunca cambies el número de láminas.
- Si la instrucción es ambigua o no la entiendes, devuelve cambios vacío y explica por qué.

Responde SOLO con JSON:
{"mensaje":"lo que vas a hacer, una frase en español","cambios":[{"idx":4,"textos":["…"],"foto":"…","acento":"…","motivo":"…"}]}`;
}

// Limpieza de marca de agua (Qwen, una sola imagen, ≤800 chars). Se conserva de la v1.
export function buildCleanPrompt() {
  return (
    'Remove every watermark, username, handle, logo or text overlay from this photo. ' +
    'Keep absolutely everything else identical: same people, same faces, same colors, same ' +
    'framing, same background. Reconstruct the area behind the removed marks naturally. ' +
    'Do not add any new text or elements.'
  );
}

// Fallback comprimido para Qwen cuando gpt-image rechaza por filtro de contenido (≤800 chars).
export function buildQwenFallbackPrompt({ textos = [], foto, acento }) {
  const texto = textos.join(' / ').slice(0, 300);
  let out = [
    'Redesign this Instagram carousel slide. Full-bleed photo covering 100% of the canvas, dark.',
    foto ? `Photo: ${foto.slice(0, 160)}.` : '',
    'Black gradient only where the text sits, never an opaque panel.',
    `Text (exact, in Spanish, heavy grotesque white uppercase): ${texto}`,
    acento ? `Lime #faff69 marker bar behind "${acento.slice(0, 40)}" only.` : '',
    'No paper, no notebook, no polaroid, no tape, no light background. Handle @iacondante. Vertical 4:5.',
  ]
    .filter(Boolean)
    .join(' ');
  if (out.length > 800) out = out.slice(0, 797) + '…';
  return out;
}

// Detecta BROTES: una palabra que nunca había aparecido y de pronto sale en varios títulos a la
// vez. Es la firma de un lanzamiento.
//
// ## Por qué esto y no solo la velocidad
//
// La velocidad dice «este video está volando». El brote dice «está pasando algo que se llama
// Duet». Y esa palabra es lo que va en el título, en la miniatura y en la búsqueda del video que
// Dante va a grabar, así que es más accionable que un enlace.
//
// Medido sobre todo el histórico del radar (22 oct 2026): en total han ocurrido TRES brotes, y dos
// son lanzamientos de verdad — `duet` (Claude Duet, 4 títulos desde las 13:05) y `opus` (Claude
// Opus 5.5, 3 títulos). El tercero era `here`, una palabra común que se coló por no estar en la
// lista de vacías. Dos aciertos de tres en todo el archivo es una relación señal/ruido que un
// umbral de velocidad no alcanza.
//
// Honestidad sobre lo que NO aporta: en esos dos casos la regla de velocidad también habría
// saltado, porque el video oficial se puso en decenas de miles de vistas/hora enseguida. El brote
// no llega antes; llega con el nombre del suceso, y caza los eventos donde aparecen cinco videos
// sin que ninguno explote por su cuenta.

// Palabras que no significan nada por sí solas. La lista incluye las que de verdad se colaron —
// `here` produjo el único falso positivo del histórico— y no una lista teórica.
const VACIAS = new Set(
  (
    'the a an and or of to for in on with my your this that is are was were how i you we it at ' +
    'from new best free ai get make made can will not now but all out about why what when who ' +
    'here there just like more most very much too also only even still back into over under ' +
    'una uno los las del por con para que como mas es son fue este esta eso ese sus sin sobre ' +
    'hace ya muy todo todos cada otro otra desde entre hasta donde cuando quien cual asi ' +
    'nao mais seu sua isso esse pelo pela dos das aos nas num numa ser estar tem ter ' +
    'video videos tutorial guia guide completo complete paso step vs usar use using'
  ).split(/\s+/)
);

// Las palabras con peso de un título. Se parte por lo que no sea letra o número para que
// «Claude-Duet» y «Claude Duet» den lo mismo.
export function palabrasDe(titulo) {
  const limpio = String(titulo || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const fuera = new Set();
  for (const w of limpio.match(/[a-z0-9]+/g) || []) {
    // Las de 1-2 letras no dicen nada y los números sueltos («2026», «5») tampoco: la versión de
    // un modelo viene pegada al nombre en la práctica («opus 5.5» da «opus» y «5»).
    if (w.length > 2 && !VACIAS.has(w) && !/^\d+$/.test(w)) fuera.add(w);
  }
  return fuera;
}

// Las palabras que aparecen en `minTitulos` o más de los hallazgos recientes. Son CANDIDATAS: para
// ser brote hace falta además que no existieran antes, y eso lo comprueba quien llama contra el
// archivo, porque es una consulta a la base.
export function candidatas(hallazgos, { minTitulos = 3, ventanaHoras = 3, ahoraMs = Date.now() } = {}) {
  const cuenta = new Map();
  const ejemplos = new Map();
  for (const h of hallazgos) {
    if (!h.fecha) continue;
    const horas = (ahoraMs - new Date(h.fecha).getTime()) / 3_600_000;
    if (!(horas >= 0 && horas <= ventanaHoras)) continue;
    for (const w of palabrasDe(h.texto)) {
      cuenta.set(w, (cuenta.get(w) || 0) + 1);
      if (!ejemplos.has(w)) ejemplos.set(w, []);
      if (ejemplos.get(w).length < 4) ejemplos.get(w).push(h);
    }
  }
  return [...cuenta.entries()]
    .filter(([, n]) => n >= minTitulos)
    .map(([palabra, n]) => ({ palabra, titulos: n, hallazgos: ejemplos.get(palabra) }))
    .sort((a, b) => b.titulos - a.titulos);
}

export function formatearBrote(brotes, ahoraMs = Date.now()) {
  const bloques = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: brotes.length === 1 ? '🌱 Palabra nueva en el aire' : `🌱 ${brotes.length} palabras nuevas en el aire`,
        emoji: true,
      },
    },
  ];
  for (const b of brotes) {
    const masRapido = [...b.hallazgos].sort((x, y) => (y.velocidad || 0) - (x.velocidad || 0))[0];
    const horas = masRapido?.fecha ? (ahoraMs - new Date(masRapido.fecha).getTime()) / 3_600_000 : null;
    bloques.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        // La palabra va primero y en grande: es el dato accionable, lo demás es el respaldo.
        text:
          `*${b.palabra.toUpperCase()}* — ${b.titulos} títulos en 3 h, y antes no existía\n` +
          b.hallazgos
            .slice(0, 3)
            .map((h) => `• <${h.url}|${(h.texto || '').replace(/[<>&]/g, ' ').slice(0, 70)}>`)
            .join('\n'),
      },
    });
    bloques.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `⚡ el más rápido va a *${Math.round(masRapido?.velocidad || 0).toLocaleString('es-MX')} vistas/h*${
            horas != null ? ` · el primero salió hace ${horas.toFixed(1)} h` : ''
          }`,
        },
      ],
    });
    bloques.push({ type: 'divider' });
  }
  bloques.pop();
  return {
    text: `🌱 Palabra nueva: ${brotes.map((b) => b.palabra).join(', ')}`,
    blocks: bloques,
    unfurl_links: false,
    unfurl_media: false,
  };
}

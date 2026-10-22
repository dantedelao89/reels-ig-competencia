// Clasificación de hallazgos del radar por TEMA.
//
// Un tema es una etiqueta más una lista de alias ("Nano Banana" → nano banana, nano-banana), y
// clasificar es buscar esos alias en el texto. Deliberadamente SIN IA: los temas de Dante son
// nombres de modelos y herramientas, no categorías abstractas, así que "nano banana" aparece o no
// aparece. Es determinista, gratis y explicable — si una fila quedó mal etiquetada se ve qué alias
// la metió. La IA se reserva para lo que un `LIKE` no puede: agrupar posts del mismo suceso y
// escribir el ángulo de contenido.
//
// Función pura a propósito: se prueba sin base de datos y sin gastar en actores.

// Minúsculas, sin acentos, y todo lo que no sea letra o número pasa a ser un espacio. Así
// "GPT‑5", "gpt-5" y "GPT 5" terminan siendo el mismo texto, que es justo lo que hace falta con
// nombres de modelos. Se devuelve con espacios a los lados para poder exigir límite de palabra:
// sin eso, "claude" encontraría "claudette".
function normalizar(s) {
  return ` ${String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

// Un alias de varias palabras se busca también PEGADO: los hashtags se escriben así y "nano banana"
// no encontraba "#nanobanana", que es justo como se etiqueta en redes. Se conservan los espacios a
// los lados, así que sigue exigiendo límite de palabra y no aparecen falsos positivos dentro de
// palabras más largas.
function variantes(alias) {
  const n = normalizar(alias);
  if (!n.trim()) return [];
  const pegado = ` ${n.trim().replace(/ /g, '')} `;
  const base = pegado === n ? [n] : [n, pegado];
  // Y en PLURAL. Exigir límite de palabra es lo que evita que "claude" encuentre "claudette", pero
  // de paso tira los plurales: el alias ` ai influencer ` no está dentro de ` ai influencers `.
  // Medido el 21 oct 2026: «EXACTLY How AI Influencers Are Getting INSANELY Rich» quedó sin tema
  // teniendo el alias. Una `s` al final es suficiente — los temas son nombres de modelos y
  // herramientas, no verbos, así que no hay plurales irregulares que perseguir.
  return [...new Set(base.flatMap((v) => [v, `${v.slice(0, -1)}s `]))];
}

// Devuelve las etiquetas de los temas que aparecen en el texto. Un hallazgo puede llevar varios:
// un video de "Seedance vs Veo" es de `Seedance` y de `AI videos`, y forzarlo a uno solo perdería
// la mitad de su utilidad al filtrar.
// Un alias que empieza con `-` es una EXCLUSIÓN: se borra del texto antes de buscar los demás.
// Hace falta porque el límite de palabra no alcanza cuando el alias es parte de un nombre propio.
// Medido el 22 oct 2026: dos películas completas de **Jean-Claude** Van Damme («Until Death»,
// «6 balas») entraron al top 5 del nicho de IA porque ` claude ` SÍ es una palabra entera dentro de
// ` jean claude `. Con `-jean claude` en el tema Claude dejan de colarse.
//
// Se borra la exclusión del texto en vez de descartar el tema entero, que es la diferencia entre
// filtrar ruido y perder señal: un video de «Claude Duet» que de paso mencione a Jean-Claude sigue
// siendo del tema, porque después de quitar el nombre todavía queda el `claude` bueno.
// Va en la MISMA columna `alias` a propósito: no hace falta migrar la tabla ni tocar la UI, y las
// exclusiones se editan donde se editan los temas.
function partirAlias(alias) {
  const positivos = [];
  const negativos = [];
  for (const a of alias || []) {
    const s = String(a ?? '').trim();
    if (s.startsWith('-')) negativos.push(...variantes(s.slice(1)));
    else positivos.push(...variantes(s));
  }
  return { positivos, negativos };
}

export function clasificar(texto, temas) {
  const t = normalizar(texto);
  if (t.trim() === '') return [];
  const out = [];
  for (const tema of temas || []) {
    if (!tema?.etiqueta) continue;
    const { positivos, negativos } = partirAlias(tema.alias);
    // Un tema sin alias positivos no puede coincidir con nada: se salta en vez de etiquetar todo.
    if (!positivos.length) continue;
    // Las exclusiones se reemplazan por UN espacio, no por nada: pegar las palabras vecinas
    // inventaría coincidencias que el texto no tenía.
    const limpio = negativos.reduce((acc, n) => acc.split(n).join(' '), t);
    if (positivos.some((a) => limpio.includes(a))) out.push(tema.etiqueta);
  }
  return out;
}

// Velocidad: la métrica que de verdad ordena un radar. Un video con 40k vistas en 6 h vale más que
// uno con 2 M en dos años, y el total absoluto no distingue entre los dos.
//
// El piso de 1 hora evita que un post de hace 3 minutos salga con una velocidad absurda y se
// quede clavado arriba para siempre.
export function velocidadPorHora(metrica, fechaMs, refIso) {
  const m = Number(metrica);
  if (!Number.isFinite(m) || m < 0 || !fechaMs) return null;
  const ref = refIso ? new Date(refIso).getTime() : Date.now();
  const horas = Math.max((ref - fechaMs) / 3_600_000, 1);
  return Math.round((m / horas) * 100) / 100;
}

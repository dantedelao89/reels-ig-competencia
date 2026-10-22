// Radar de YouTube SIN Apify: lee la página de resultados de YouTube y guarda los hallazgos en
// `radar`, la misma tabla y la misma forma de fila que el camino de Apify.
//
// Por qué existe (DESIGN.md 5.8, decidido por Dante el 22 oct 2026: «no lo quiero automático»):
// el radar dejó de llenarse solo. Dante pide los hallazgos por chat, se le entregan, y la misma
// pasada los guarda para que la pantalla los lea después.
//
// Y por qué sin Apify: medido el 22 oct 2026, esta vía trajo **186 videos por $0.00** contra los 60
// que trae el cron por $0.18 al día. No hay tope de resultados por consulta porque no se paga por
// resultado. La contrapartida es que YouTube puede bloquear o pedir consentimiento según desde
// dónde se pida, así que esto NO es un reemplazo probado del actor: es la vía a pedido. Si un día
// corre desde un servidor, hay que medirlo ahí antes de confiar en ello.
//
// El idioma NO es un parámetro de búsqueda sino el texto de la consulta (ver DESIGN.md 5.7), pero
// `hl`/`gl` sí deciden qué conjunto de resultados devuelve YouTube, así que cada consulta se pide
// con el locale que le toca. Sin eso, una consulta en inglés pedida desde una IP mexicana vuelve
// sesgada al español.

import { clasificar, velocidadPorHora } from './radarTemas.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Filtros `sp` de YouTube, en protobuf a mano: campo1 = orden, campo2{campo1 = antigüedad}.
// Medido: el filtro de antigüedad SÍ se respeta (tope de 144 h con 'semana'); el orden no siempre,
// y da igual porque el radar ordena por velocidad.
const SP = {
  hoy: Buffer.from([0x08, 0x02, 0x12, 0x02, 0x08, 0x02]).toString('base64'),
  semana: Buffer.from([0x08, 0x02, 0x12, 0x02, 0x08, 0x03]).toString('base64'),
  mes: Buffer.from([0x08, 0x02, 0x12, 0x02, 0x08, 0x04]).toString('base64'),
};

const LOCALES = {
  en: { hl: 'en', gl: 'US', accept: 'en-US,en;q=0.9' },
  es: { hl: 'es', gl: 'MX', accept: 'es-MX,es;q=0.9' },
  pt: { hl: 'pt', gl: 'BR', accept: 'pt-BR,pt;q=0.9' },
};

// El idioma sale del sufijo de la etiqueta (`claude · es`), que es la convención con la que
// quedaron nombradas las 20 consultas. Se lee AQUÍ y en ningún otro sitio, y solo para elegir el
// locale de la petición: no se guarda, así que no hay un estado que mantener de acuerdo con el
// texto. Sin sufijo reconocible se usa inglés, que es el locale propio de YouTube.
export function idiomaDeEtiqueta(etiqueta) {
  const m = /·\s*(en|es|pt)\s*$/i.exec(String(etiqueta || ''));
  return m ? m[1].toLowerCase() : 'en';
}

function textoDe(nodo) {
  if (!nodo || typeof nodo !== 'object') return '';
  if (nodo.simpleText) return nodo.simpleText;
  return (nodo.runs || []).map((r) => r.text || '').join('');
}

// Camina el JSON de la página buscando cada `videoRenderer`, que es donde vive cada resultado.
function* recorrer(nodo) {
  if (Array.isArray(nodo)) {
    for (const v of nodo) yield* recorrer(v);
  } else if (nodo && typeof nodo === 'object') {
    if (nodo.videoRenderer) yield nodo.videoRenderer;
    for (const v of Object.values(nodo)) yield* recorrer(v);
  }
}

function vistasDe(txt) {
  const m = /([\d.,]+)/.exec(String(txt || '').replace(/ /g, ' '));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function pedir(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': accept },
  });
  if (!res.ok) throw new Error(`YouTube devolvió ${res.status}`);
  return res.text();
}

// Los IDs de video que devuelve una consulta, en el orden en que YouTube los pone.
export async function buscarIds({ consulta, idioma = 'en', ventana = 'hoy' }) {
  const loc = LOCALES[idioma] || LOCALES.en;
  const url =
    `https://www.youtube.com/results?search_query=${encodeURIComponent(consulta)}` +
    `&sp=${encodeURIComponent(SP[ventana] || SP.hoy)}&hl=${loc.hl}&gl=${loc.gl}`;
  const html = await pedir(url, loc.accept);
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  // Sin `ytInitialData` no hay resultados que leer: casi siempre es un muro de consentimiento o un
  // bloqueo. Se avisa en vez de devolver una lista vacía, que parecería «no hay nada hoy».
  if (!m) throw new Error(`sin ytInitialData para "${consulta}" (¿bloqueo o consentimiento?)`);
  const ids = [];
  for (const v of recorrer(JSON.parse(m[1]))) {
    if (v.videoId && !ids.includes(v.videoId)) ids.push(v.videoId);
  }
  return ids;
}

// La ficha de UN video, desde su página. De aquí salen la fecha y las vistas EXACTAS, que la página
// de resultados solo da redondeadas y en relativo («hace 4 h», «4.5 K»). Guardar una fecha
// aproximada envenenaría `dia` y `velocidad`, que es justo lo que ordena la pantalla.
export async function ficha(id) {
  const html = await pedir(`https://www.youtube.com/watch?v=${id}`, 'en-US,en;q=0.9');
  const uno = (re) => {
    const m = re.exec(html);
    return m ? m[1] : null;
  };
  const crudo = (s) => {
    if (!s) return null;
    try {
      return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
    } catch {
      return s;
    }
  };
  const fecha = uno(/"publishDate":"([^"]+)"/) || uno(/"uploadDate":"([^"]+)"/);
  const subsTxt = uno(/"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"/);
  return {
    id,
    titulo: crudo(uno(/"title":"(.*?)","lengthSeconds"/)),
    descripcion: crudo(uno(/"shortDescription":"(.*?)","isCrawlable"/)),
    canal: crudo(uno(/"ownerChannelName":"([^"]+)"/)),
    canalId: uno(/"channelId":"([^"]+)"/),
    vistas: vistasDe(uno(/"viewCount":"(\d+)"/)),
    fecha,
    duracionSeg: Number(uno(/"lengthSeconds":"(\d+)"/)) || null,
    seguidores: subsTxt,
    keywords: (() => {
      const m = /"keywords":\[(.*?)\]/s.exec(html);
      if (!m) return [];
      try {
        return JSON.parse(`[${m[1]}]`);
      } catch {
        return [];
      }
    })(),
  };
}

// "93.8 mil suscriptores" / "2.21 millones de suscriptores" / "660K subscribers" → número.
export function seguidoresANumero(txt) {
  const s = String(txt || '').toLowerCase().replace(/ /g, ' ');
  // Las alternativas largas van PRIMERO: con `mil` delante, "2.21 millones" casaba el prefijo
  // `mil` y devolvía 2.210 en vez de 2.210.000.
  const m = /([\d.,]+)\s*(millones|milh[õo]es|mill[oó]n|milh[ãa]o|mil|k|m|b)?/.exec(s);
  if (!m) return null;
  // Separador decimal: "93.8 mil" y "2,21 milhões" usan punto o coma para decimales cuando hay
  // sufijo; sin sufijo, la coma es de miles ("4,575").
  const factor = { mil: 1e3, k: 1e3, millones: 1e6, 'milhões': 1e6, milhoes: 1e6, millon: 1e6, 'millón': 1e6, 'milhão': 1e6, milhao: 1e6, m: 1e6, b: 1e9 }[m[2]] || 1;
  const bruto = factor === 1 ? m[1].replace(/[.,]/g, '') : m[1].replace(',', '.');
  const n = Number(bruto);
  return Number.isFinite(n) ? Math.round(n * factor) : null;
}

// Un hallazgo con la forma que espera `radarRow` (la misma que produce el camino de Apify).
export function aHallazgo(f, refIso) {
  const fechaMs = f.fecha ? new Date(f.fecha).getTime() : null;
  return {
    id: f.id,
    handle: f.canal || null,
    nombre: f.canal || null,
    creadorUrl: f.canalId ? `https://www.youtube.com/channel/${f.canalId}` : null,
    seguidores: seguidoresANumero(f.seguidores),
    url: `https://www.youtube.com/watch?v=${f.id}`,
    texto: f.titulo || null,
    fecha: f.fecha || null,
    views: f.vistas ?? null,
    likes: null,
    comentarios: null,
    duracionSeg: f.duracionSeg ?? null,
    tipo: 'Video',
    hashtags: (f.keywords || []).slice(0, 12),
    videoThumb: `https://i.ytimg.com/vi/${f.id}/hqdefault.jpg`,
    // El radar no archiva: el video se ve en YouTube.
    videoUrl: null,
    velocidad: velocidadPorHora(f.vistas, fechaMs, refIso),
  };
}

export { clasificar };

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
import { getRadarBusquedas, getRadarTemas } from './sources.js';
import { getExistingRadarIds, getRadarVelocidades, getCaptionsAnteriores, syncRadar } from './supabase.js';
import { candidatas, palabrasDe, formatearBrote } from './radarBrote.js';
import { elegirAvisos, formatearAviso, enviarSlack } from './radarAviso.js';

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

// Los idiomas en los que correr una consulta, sacados del sufijo de su etiqueta: `claude · es`
// corre solo en español y `seedance · en,es` corre en los dos.
//
// Varios idiomas por FILA y no una fila por idioma porque la tabla tiene una restricción única
// sobre (plataforma, consulta): `seedance` no puede existir dos veces. Y duplicar el texto para
// esquivarla —«seedance español»— resultó poco fiable al medirlo: a `nano banana` le añade
// resultados, pero `runway ai` pasa de 13 a 3. Lo que trae contenido en español es el LOCALE de la
// petición, no la palabra: pidiendo «seedance» con hl=es&gl=MX ya salen creadores hispanos.
//
// Se lee AQUÍ y en ningún otro sitio, y solo para elegir el locale: no se guarda, así que no hay
// un estado que mantener de acuerdo con el texto. Sin sufijo reconocible se usa inglés, que es el
// locale propio de YouTube.
export function idiomasDeEtiqueta(etiqueta) {
  const m = /·\s*([a-z,\s]+)$/i.exec(String(etiqueta || ''));
  if (!m) return ['en'];
  const pedidos = m[1]
    .toLowerCase()
    .split(',')
    .map((x) => x.trim())
    .filter((x) => LOCALES[x]);
  return pedidos.length ? pedidos : ['en'];
}

// Compatible con quien espere uno solo (el primero manda para atribuir el hallazgo).
export function idiomaDeEtiqueta(etiqueta) {
  return idiomasDeEtiqueta(etiqueta)[0];
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
// Edad en horas a partir del texto relativo de YouTube, en los tres idiomas. Hay que cubrirlos
// porque la página se pide con el locale de cada consulta: "hace 4 h" (es), "há 4 horas" (pt) y
// "4 hours ago" (en). Ojo con el español, que ABREVIA: escribe «hace 4 h», no «hace 4 horas», y un
// parser que solo espere la palabra completa tira justo los videos frescos, que son los únicos que
// importan aquí.
const UNIDADES = [
  [/^min/i, 1 / 60],
  [/^h(ora|our)?s?$/i, 1],
  [/^d([ií]a|ay)s?$/i, 24],
  [/^(sem|week)/i, 168],
  [/^(mes|m[êe]s|month)/i, 720],
  [/^(a[ñn]o|year)/i, 8760],
];
export function horasDeTexto(txt) {
  const m = /(\d+)\s*([a-zà-ÿ]+)/i.exec(String(txt || ''));
  if (!m) return null;
  const n = Number(m[1]);
  for (const [re, mult] of UNIDADES) if (re.test(m[2])) return n * mult;
  return null;
}

// "507,481 vistas" / "4.575 visualizações" / "507,481 views" → número. Se usa SOLO el contador
// largo y nunca el abreviado: en el corto, "4.5 K" se convertiría en 45 al quitar los separadores.
export function vistasDeTexto(txt) {
  const s = String(txt || '');
  if (!/\d/.test(s)) return null;
  const n = Number(s.replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Los resultados de una consulta, con lo que la propia página de búsqueda ya trae: título, canal,
// vistas y antigüedad. Aproximados —YouTube redondea la edad a «hace 1 día»— pero GRATIS y en una
// sola petición por consulta.
//
// Esto existe porque pedir la ficha de los ~85 videos de una corrida hace que YouTube devuelva
// 429 desde un datacenter. Medido el 22 oct 2026 en tres corridas seguidas desde Railway: la
// primera trajo 82 fichas de 82, la segunda 1 de 87, y la tercera 0 de 83. El límite no es por
// corrida, se va apretando con el uso — justo la forma de romper un cron horario sin que se note.
export async function buscarResultados({ consulta, idioma = 'en', ventana = 'hoy' }) {
  const loc = LOCALES[idioma] || LOCALES.en;
  const url =
    `https://www.youtube.com/results?search_query=${encodeURIComponent(consulta)}` +
    `&sp=${encodeURIComponent(SP[ventana] || SP.hoy)}&hl=${loc.hl}&gl=${loc.gl}`;
  // Se reintenta porque la respuesta vacía es INTERMITENTE, no determinista: medido, una corrida de
  // 20 consultas devolvió 19 buenas y 1 sin `ytInitialData`. Con una sola oportunidad, un cron
  // cada hora acumularía ~1 hueco por pasada en una consulta distinta cada vez, y eso no se
  // distingue de "hoy no hubo nada" en ese tema.
  let m = null;
  for (let intento = 1; intento <= 3 && !m; intento++) {
    if (intento > 1) await new Promise((r) => setTimeout(r, 1500 * intento));
    const html = await pedir(url, loc.accept);
    m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  }
  // Sin `ytInitialData` tras tres intentos ya no es un parpadeo: es un muro de consentimiento o un
  // bloqueo. Se avisa en vez de devolver una lista vacía, que parecería «no hay nada hoy».
  if (!m) throw new Error(`sin ytInitialData para "${consulta}" tras 3 intentos (¿bloqueo o consentimiento?)`);

  const salida = [];
  const vistos = new Set();
  for (const v of recorrer(JSON.parse(m[1]))) {
    if (!v.videoId || vistos.has(v.videoId)) continue;
    vistos.add(v.videoId);
    const horas = horasDeTexto(textoDe(v.publishedTimeText));
    const vistas = vistasDeTexto(textoDe(v.viewCountText));
    salida.push({
      id: v.videoId,
      titulo: textoDe(v.title) || null,
      canal: textoDe(v.longBylineText) || null,
      horasAprox: horas,
      vistasAprox: vistas,
      // El orden del radar. Aproximado, pero suficiente para decidir de CUÁLES vale la pena pedir
      // la ficha exacta: equivocarse por un 10% no cambia quién va arriba.
      velocidadAprox: horas != null && vistas != null ? vistas / Math.max(horas, 1) : null,
    });
  }
  return salida;
}

// La ficha de UN video// La ficha de UN video, desde su página. De aquí salen la fecha y las vistas EXACTAS, que la página
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
  // `million` va ANTES que `mil` porque empieza por "mil" y si no se lo come el prefijo. Las
  // palabras en INGLÉS hacen falta porque la ficha del video se pide con Accept-Language en-US,
  // donde la etiqueta dice "665 thousand subscribers" y no "665K": sin ellas el multiplicador se
  // perdía y 665 mil quedaban guardados como 665. Medido el 22 oct 2026 sobre el canal de Claude.
  const m = /([\d.,]+)\s*(millones|milh[õo]es|mill[oó]n|milh[ãa]o|million|billion|thousand|mil|k|m|b)?/.exec(s);
  if (!m) return null;
  // Separador decimal: "93.8 mil" y "2,21 milhões" usan punto o coma para decimales cuando hay
  // sufijo; sin sufijo, la coma es de miles ("4,575").
  const factor = { mil: 1e3, k: 1e3, thousand: 1e3, millones: 1e6, 'milhões': 1e6, milhoes: 1e6, millon: 1e6, 'millón': 1e6, 'milhão': 1e6, milhao: 1e6, million: 1e6, m: 1e6, b: 1e9, billion: 1e9 }[m[2]] || 1;
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

// Corre N tareas en paralelo con un tope, para no abrir 200 peticiones a YouTube de golpe.
async function enTandas(items, limite, fn, pausaMs = 0) {
  const salida = [];
  for (let i = 0; i < items.length; i += limite) {
    if (i && pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
    salida.push(...(await Promise.all(items.slice(i, i + limite).map(fn))));
  }
  return salida;
}

// UNA pasada completa: busca con todas las consultas, pide la ficha de cada video, clasifica por
// tema y guarda en `radar`. Devuelve los hallazgos para poder enseñárselos a Dante en el chat, que
// es la mitad del trato del MVP (DESIGN.md 5.8): se entrega Y se guarda.
//
// `porConsulta` acota cuántos resultados se miran de cada consulta. No es un tope de gasto —aquí no
// se paga— sino de tiempo y de ruido: más abajo de los primeros, YouTube empieza a rellenar con
// cosas que no tienen que ver.
export async function correrRadarLibre({
  ventana = 'hoy',
  porConsulta = 10,
  avisar = false,
  maxFichas = 15,
} = {}) {
  const refMs = Date.now();
  const refIso = new Date(refMs).toISOString();

  const busquedas = (await getRadarBusquedas('yt')).sort((a, b) =>
    a.etiqueta.localeCompare(b.etiqueta)
  );
  const temas = await getRadarTemas();
  const yaEstaban = await getExistingRadarIds('yt');
  // ANTES de sincronizar: `syncRadar` pisa la velocidad, y sin el valor anterior no se puede saber
  // si un video acaba de CRUZAR el umbral o si ya estaba arriba desde la pasada pasada.
  const velocidadesPrevias = avisar ? await getRadarVelocidades('yt') : new Map();

  // 1. Lo que devuelve cada consulta, con lo aproximado que la propia búsqueda ya trae.
  const porId = new Map();
  const problemas = [];
  // Una tarea por (consulta × idioma): una consulta en dos idiomas son dos peticiones, y así el
  // reparto en tandas sigue controlando cuántas van a la vez contra YouTube.
  const tareas = busquedas.flatMap((b) => idiomasDeEtiqueta(b.etiqueta).map((idioma) => ({ b, idioma })));
  await enTandas(tareas, 6, async ({ b, idioma }) => {
    try {
      const res = await buscarResultados({ consulta: b.consulta, idioma, ventana });
      for (const r of res.slice(0, porConsulta)) {
        // El primero que lo encuentra se queda con la autoría: así un video que sale en la consulta
        // en español no se reetiqueta como inglés por aparecer también allí.
        if (!porId.has(r.id)) porId.set(r.id, { ...r, busqueda: b, idioma });
      }
    } catch (e) {
      problemas.push({ busqueda: `${b.etiqueta} [${idioma}]`, error: e.message });
    }
  });

  // 2. La ficha EXACTA, pero solo de los candidatos. Pedirla de los ~85 hace que YouTube devuelva
  // 429 desde un datacenter, y el límite se aprieta con el uso: tres corridas seguidas dieron 82
  // fichas de 82, luego 1 de 87, luego 0 de 83. Con los de arriba basta, porque la fecha y las
  // vistas exactas solo cambian una decisión en los que pueden disparar un aviso; para el resto,
  // el redondeo de la búsqueda ya ordena igual de bien.
  const candidatos = [...porId.values()]
    .filter((r) => r.velocidadAprox != null)
    .sort((a, b) => b.velocidadAprox - a.velocidadAprox)
    .slice(0, maxFichas)
    .map((r) => r.id);
  const exactas = new Map();
  // Menos a la vez y con pausa entre tandas: lo que disparó el 429 fue el ritmo, no el total.
  await enTandas(candidatos, 3, async (id) => {
    try {
      exactas.set(id, await ficha(id));
    } catch (e) {
      problemas.push({ video: id, error: e.message });
    }
  }, 400);

  // Cada hallazgo con lo mejor que se tenga: exacto si se pudo pedir la ficha, aproximado si no.
  // Un aproximado es mejor que una ausencia: el video igual se descubre y se puede abrir.
  const fichas = [...porId.values()].map((r) => {
    const f = exactas.get(r.id);
    if (f && f.fecha) return { ...f, aprox: false };
    if (r.horasAprox == null || r.vistasAprox == null) return null;
    return {
      id: r.id,
      titulo: r.titulo,
      canal: r.canal,
      canalId: null,
      vistas: r.vistasAprox,
      // La fecha se reconstruye desde el «hace N h» de la búsqueda. Es aproximada —YouTube redondea
      // a «hace 1 día» todo lo de 24 a 47 h— y por eso solo se usa cuando no hay ficha.
      fecha: new Date(refMs - r.horasAprox * 3_600_000).toISOString(),
      duracionSeg: null,
      seguidores: null,
      keywords: [],
      aprox: true,
    };
  }).filter(Boolean);

  // 3. Clasificar y quedarse con lo que cae en algún tema de Dante. Lo que no tiene tema no entra:
  // el radar es para decidir qué publicar, y una lista con películas de Jean-Claude Van Damme
  // dentro no sirve para eso.
  const conTema = [];
  for (const f of fichas) {
    const h = aHallazgo(f, refIso);
    const temasDe = clasificar(`${h.texto || ''} ${(h.hashtags || []).join(' ')}`, temas);
    if (!temasDe.length) continue;
    h.temas = temasDe;
    h.busqueda = porId.get(f.id);
    h.nuevo = !yaEstaban.has(String(f.id));
    conTema.push(h);
  }

  // 4. Guardar, agrupando por consulta para que cada fila lleve SU `busqueda_id`.
  const grupos = new Map();
  for (const h of conTema) {
    const k = h.busqueda.recordId;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(h);
  }
  for (const [, grupo] of grupos) {
    await syncRadar(grupo, {
      plataforma: 'yt',
      busqueda: grupo[0].busqueda,
      scrapedAtIso: refIso,
      clasificar: (texto) => clasificar(texto, temas),
    });
  }

  conTema.sort((a, b) => (b.velocidad || 0) - (a.velocidad || 0));

  // 5. Avisar, si toca. Va al final y con su propio try: los hallazgos ya están guardados, y que
  // WhatsApp falle no debe convertir una corrida buena en una corrida fallida.
  let aviso = null;
  let brote = null;
  if (avisar) {
    try {
      const elegidos = elegirAvisos(conTema, velocidadesPrevias);
      if (elegidos.length) {
        const r = await enviarSlack(formatearAviso(elegidos, conTema));
        aviso = { enviados: elegidos.length, ok: r.ok, motivo: r.motivo || null };
      } else {
        aviso = { enviados: 0, ok: true };
      }
    } catch (e) {
      aviso = { enviados: 0, ok: false, motivo: e.message };
    }

    // 6. Los BROTES, que son otra señal y van en su propio mensaje: la velocidad apunta a UN
    // video, el brote nombra el SUCESO. Mezclarlos en un aviso obligaría a leer para distinguir
    // cuál es cuál.
    try {
      const cands = candidatas(conTema, { ahoraMs: refMs });
      if (cands.length) {
        const corte = new Date(refMs - 3 * 3_600_000).toISOString();
        const previos = new Set();
        for (const c of await getCaptionsAnteriores('yt', corte)) {
          for (const w of palabrasDe(c)) previos.add(w);
        }
        const nuevasPalabras = cands.filter((c) => !previos.has(c.palabra));
        if (nuevasPalabras.length) {
          const r = await enviarSlack(formatearBrote(nuevasPalabras, refMs));
          brote = { palabras: nuevasPalabras.map((c) => c.palabra), ok: r.ok };
        }
      }
    } catch (e) {
      brote = { palabras: [], ok: false, motivo: e.message };
    }
  }

  return {
    ok: true,
    ventana,
    aviso,
    brote,
    consultas: busquedas.length,
    peticiones: tareas.length,
    vistos: porId.size,
    conFicha: exactas.size,
    aproximados: fichas.filter((f) => f.aprox).length,
    guardados: conTema.length,
    nuevos: conTema.filter((h) => h.nuevo).length,
    problemas,
    hallazgos: conTema,
  };
}

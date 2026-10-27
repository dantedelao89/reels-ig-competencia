// Centinela: vigila los canales OFICIALES y avisa en cuanto publican, sin esperar a que el video
// acumule vistas.
//
// ## Por qué existe, además del radar
//
// El radar ordena por velocidad, así que un video necesita vistas para salir. Un anuncio oficial
// recién publicado tiene CERO, y es justo el momento en que vale más. Reconstruida la ola de
// Claude Duet (21 oct 2026): el canal oficial publicó a las 13:35 y el primero en español salió a
// las 16:36 con 22 mil vistas, mientras que los que publicaron a las 04:48 del día siguiente se
// quedaron en dos dígitos. La ventana son horas, y empieza a contar cuando publica la fuente.
//
// Vigilar la FUENTE y no a los canales de referencia es deliberado: los que reaccionan publicaron
// a las +2.1 y +2.3 h, así que reaccionar a ellos te deja estructuralmente detrás.
//
// ## Por qué RSS y no raspar la página del canal
//
// Pedir páginas de YouTube desde Railway acaba en 429 — medido: 15 de 15 fallos al pedir la ficha
// de videos. El feed RSS de un canal está hecho para consultarse cada pocos minutos, pesa unos
// pocos KB y devuelve los 15 últimos videos. Una petición por canal, así que diez canales cada
// quince minutos son 960 peticiones diarias repartidas entre diez destinos distintos.

import { config } from './config.js';
import { getExistingRadarIds, syncRadar } from './supabase.js';
import { getRadarTemas } from './sources.js';
import { clasificar, velocidadPorHora } from './radarTemas.js';
import { enviarSlack } from './radarAviso.js';

// Los canales, VERIFICADOS uno a uno el 22 oct 2026 leyendo su feed. La verificación no es un
// formalismo: buscando «Seedance» YouTube devuelve un canal de festivales de danza de 2013, y lo
// que llama «BytePLUS» son reseñas de altavoces. Ninguno tiene que ver con ByteDance.
export const CANALES = [
  // `soloAnuncios` sale de MEDIR cuánto publica cada canal (22 oct 2026, leyendo sus 15 últimas
  // entradas). Entre los diez salen 5.1 videos al día, y la mayoría no son lanzamientos: de HeyGen
  // salió «Dental Practice Marketing» y de OpenAI «Uber rolls out ChatGPT Work». Avisar de todo
  // sería enterrar los dos que importan bajo los que no.
  //
  // Los canales de poco volumen avisan SIEMPRE, porque cuando publican suele ser noticia. Los que
  // publican a diario pasan por el filtro de título. Si a uno de esos se le escapa un lanzamiento
  // con un título raro, el radar lo recoge igual dentro de la hora en cuanto coja vistas: el filtro
  // cuesta minutos de ventaja, no cobertura.

  // Anthropic tiene DOS canales y los lanzamientos van en el de «Claude», no en el corporativo.
  // Claude Duet se publicó en este; en «Anthropic» va lo institucional. Quedarse con el obvio
  // habría hecho que el centinela se perdiera justo el lanzamiento más grande del mes.
  { id: 'UCV03SRZXJEz-hchIAogeJOg', nombre: 'Claude', empresa: 'Anthropic' },
  { id: 'UCrDwWp7EBBv4NwvScIpBDOA', nombre: 'Anthropic', empresa: 'Anthropic' },
  { id: 'UCP7jMXSY2xbc3KCAE0MHQ-A', nombre: 'Google DeepMind', empresa: 'Google' },
  // Google Labs es donde salen Flow y Veo, que es lo que a Dante le toca de cerca.
  { id: 'UCB5ofLXaAv_a1QopZ801K7A', nombre: 'Google Labs', empresa: 'Google' },
  { id: 'UC0SclYU4iiQRihtmDnak-gQ', nombre: 'Pika Labs', empresa: 'Pika' },
  { id: 'UCldFPBqAVrok5DPUQeSMEqQ', nombre: 'Midjourney', empresa: 'Midjourney' },

  // 2.1 al día, casi todo casos de clientes y eventos.
  { id: 'UCXZCJLdBC09xxGZ6gcdrc6A', nombre: 'OpenAI', empresa: 'OpenAI', soloAnuncios: true },
  { id: 'UCUBqu_z5uP0AZhYtuyFZB3g', nombre: 'Runway', empresa: 'Runway', soloAnuncios: true },
  { id: 'UCV0FmNF3iM-022BF1KbVtxA', nombre: 'HeyGen', empresa: 'HeyGen', soloAnuncios: true },
  { id: 'UC1i21joJVJVVRUGUOGFEdVQ', nombre: 'Kling AI', empresa: 'Kuaishou', soloAnuncios: true },
];

// Cómo se anuncia algo. Son las palabras con las que estos canales titulan de verdad sus
// lanzamientos —«Introducing Claude Duet», «Meet Claude Fable 5.1»— y no una lista inventada.
const ANUNCIO = /\b(introducing|announc\w*|unveil\w*|meet |launch\w*|now available|available now|presenting|new model|presentamos|lanzamos|ya disponible)/i;

export function pareceAnuncio(titulo) {
  return ANUNCIO.test(String(titulo || ''));
}

export const SIN_CANAL = ['Seedance (ByteDance)', 'Wan (Alibaba)', 'Black Forest Labs', 'Luma'];

const FEED = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

// Memoria del estado "ciego", para avisar del CAMBIO y no del estado.
//
// Medido el 27 oct 2026 leyendo el canal: el centinela llevaba desde el 23 de octubre mandando
// «está ciego» en CADA corrida, y corre cada 15 minutos — unos 96 mensajes al día, cuatro días
// seguidos. Es el fallo que este mismo sistema se había prometido evitar en `radarAviso.js`:
// «avisar de todo son 115 mensajes y, al tercer día, un chat silenciado, que es la única forma de
// que un sistema de alertas falle del todo». Un aviso repetido 400 veces no informa de nada; lo
// que informa es que EMPEZÓ y que TERMINÓ.
//
// Vive en memoria del proceso a propósito: no merece una tabla, y lo único que cuesta un reinicio
// es un aviso repetido, que es justo lo que un despliegue debería poder contar.
const RECORDATORIO_CIEGO_MS = 6 * 3_600_000;
let cegueraDesdeMs = null;
let ultimoAvisoCiegoMs = null;

function entre(txt, abre, cierra, desde = 0) {
  const i = txt.indexOf(abre, desde);
  if (i < 0) return null;
  const j = txt.indexOf(cierra, i + abre.length);
  return j < 0 ? null : txt.slice(i + abre.length, j);
}

function desescaparXml(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Las entradas de un feed. Se parte por `<entry>` en vez de usar un parser de XML: el feed de
// YouTube tiene una forma fija y conocida, y añadir una dependencia para leer diez campos sería
// pagar de más.
export function leerFeed(xml) {
  const salida = [];
  let desde = 0;
  for (;;) {
    const i = xml.indexOf('<entry>', desde);
    if (i < 0) break;
    const fin = xml.indexOf('</entry>', i);
    const bloque = xml.slice(i, fin < 0 ? undefined : fin);
    desde = fin < 0 ? xml.length : fin + 8;
    const id = entre(bloque, '<yt:videoId>', '</yt:videoId>');
    const titulo = entre(bloque, '<media:title>', '</media:title>');
    const publicado = entre(bloque, '<published>', '</published>');
    if (id && publicado) {
      salida.push({ id, titulo: desescaparXml(titulo), publicado });
    }
  }
  return salida;
}

async function feedDe(canal) {
  const res = await fetch(FEED(canal.id), {
    headers: { 'User-Agent': 'disecta-centinela/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`feed devolvió ${res.status}`);
  return leerFeed(await res.text());
}

// Un hallazgo con la forma que espera `radarRow`.
function aHallazgo(v, canal, refIso) {
  return {
    id: v.id,
    handle: canal.nombre,
    nombre: canal.nombre,
    creadorUrl: `https://www.youtube.com/channel/${canal.id}`,
    seguidores: null,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    texto: v.titulo,
    fecha: v.publicado,
    // El feed no trae vistas, y es lo correcto: un anuncio recién publicado tiene cero y el aviso
    // salta igual. Aquí la señal no es la velocidad, es QUIÉN publicó.
    views: null,
    likes: null,
    comentarios: null,
    duracionSeg: null,
    tipo: 'Video',
    hashtags: [],
    videoThumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    videoUrl: null,
    velocidad: velocidadPorHora(null, null, refIso),
  };
}

export function formatearAvisoCentinela(nuevos, ahoraMs = Date.now()) {
  const bloques = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: nuevos.length === 1 ? '🚨 Publicó un canal oficial' : `🚨 ${nuevos.length} canales oficiales publicaron`,
        emoji: true,
      },
    },
  ];
  for (const { hallazgo: h, canal } of nuevos) {
    const min = Math.max(0, Math.round((ahoraMs - new Date(h.fecha).getTime()) / 60_000));
    bloques.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${h.url}|${(h.texto || 'sin título').replace(/[<>&]/g, ' ')}>*\n${canal.nombre} · ${canal.empresa}`,
      },
    });
    bloques.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          // Los minutos en vez de la velocidad: lo que importa de un anuncio oficial no es cuánto
          // corre, es cuánto hace que salió y cuánta ventaja te queda.
          text: `⏱ *hace ${min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`}* · aún nadie ha reaccionado si te das prisa`,
        },
      ],
    });
    bloques.push({ type: 'divider' });
  }
  bloques.pop();
  const resumen = nuevos.map(({ hallazgo }) => (hallazgo.texto || '').slice(0, 70)).join(' · ');
  return { text: `🚨 ${resumen}`, blocks: bloques, unfurl_links: false, unfurl_media: false };
}

// Una pasada: lee los feeds, se queda con lo publicado en las últimas `maxHoras` que no hubiera
// visto antes, lo guarda y avisa.
// `soloNuevos`: el cron quiere lo que no ha visto; una consulta a mano quiere ver lo que HAY,
// aunque ya se haya guardado. Sin esta distinción, preguntar dos veces seguidas devolvería vacío
// la segunda y parecería que los canales no han publicado nada.
export async function correrCentinela({ maxHoras = 6, avisar = true, soloNuevos = true } = {}) {
  const refMs = Date.now();
  const refIso = new Date(refMs).toISOString();
  const problemas = [];

  const yaEstaban = await getExistingRadarIds('yt');
  let temas = [];
  try {
    temas = await getRadarTemas();
  } catch (e) {
    problemas.push({ paso: 'temas', error: e.message });
  }

  const nuevos = [];
  // En serie y no en paralelo: son diez peticiones pequeñas cada quince minutos, no hay prisa, y
  // diez a la vez contra el mismo dominio es justo el patrón que acabó en 429 en la otra vía.
  for (const canal of CANALES) {
    try {
      for (const v of await feedDe(canal)) {
        const horas = (refMs - new Date(v.publicado).getTime()) / 3_600_000;
        // La ventana evita que un reinicio del servicio avise de los 15 videos del feed: sin
        // ella, cada despliegue dispararía una ráfaga de avisos viejos.
        if (!(horas >= 0 && horas <= maxHoras)) continue;
        if (soloNuevos && yaEstaban.has(String(v.id))) continue;
        const yaLoTenia = yaEstaban.has(String(v.id));
        yaEstaban.add(String(v.id));
        const hallazgo = aHallazgo(v, canal, refIso);
        // Se GUARDA siempre, se AVISA según el canal: que algo no merezca un mensaje no quiere
        // decir que no merezca estar en el radar cuando Dante lo mire.
        const avisable = !canal.soloAnuncios || pareceAnuncio(v.titulo);
        nuevos.push({ hallazgo, canal, avisable, yaLoTenia });
      }
    } catch (e) {
      problemas.push({ canal: canal.nombre, error: e.message });
    }
  }

  for (const { hallazgo, canal, yaLoTenia } of nuevos) {
    if (yaLoTenia) continue;
    try {
      await syncRadar([hallazgo], {
        plataforma: 'yt',
        busqueda: { etiqueta: `centinela · ${canal.nombre}` },
        scrapedAtIso: refIso,
        clasificar: (texto) => clasificar(texto, temas),
      });
    } catch (e) {
      problemas.push({ video: hallazgo.id, error: e.message });
    }
  }

  const avisables = nuevos.filter((x) => x.avisable);
  // Si fallaron TODOS los canales, el centinela no está «tranquilo»: está roto, y hay que decirlo.
  //
  // Medido el 23 oct 2026: YouTube dejó de servir `/feeds/videos.xml` y los 10 feeds empezaron a
  // devolver 404 desde dos IP distintas. El centinela siguió respondiendo «0 nuevos», que se lee
  // igual que «nadie ha publicado», y habría seguido así durante días. Un vigilante que no avisa de
  // su propia muerte es peor que no tener vigilante, porque da una falsa sensación de cobertura.
  const todosFallaron = CANALES.length > 0 && problemas.filter((p) => p.canal).length >= CANALES.length;
  if (todosFallaron) {
    const motivo = problemas.find((p) => p.canal)?.error || 'desconocido';
    const ahora = Date.now();
    const esNuevo = cegueraDesdeMs == null;
    if (esNuevo) cegueraDesdeMs = ahora;
    // Se avisa cuando EMPIEZA, y después como mucho cada seis horas. Ver la nota de
    // RECORDATORIO_CIEGO_MS: avisarlo en cada corrida son 96 mensajes al día.
    const toca = esNuevo || ultimoAvisoCiegoMs == null || ahora - ultimoAvisoCiegoMs >= RECORDATORIO_CIEGO_MS;
    if (avisar && toca) {
      ultimoAvisoCiegoMs = ahora;
      const horas = (ahora - cegueraDesdeMs) / 3_600_000;
      const desdeCuando = esNuevo
        ? 'Acaba de empezar.'
        : `Lleva así ${horas < 24 ? `${horas.toFixed(1)} h` : `${Math.round(horas / 24)} días`}; se repite cada 6 h.`;
      await enviarSlack({
        text: `⚠️ El centinela no puede leer ningún canal: ${motivo}`,
        unfurl_links: false,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `⚠️ *El centinela está ciego*\nLos ${CANALES.length} canales oficiales fallaron: \`${motivo}\`\n` +
                `Esto NO quiere decir que nadie haya publicado: quiere decir que no se puede mirar.\n${desdeCuando}`,
            },
          },
        ],
      });
    }
    return {
      ok: false,
      canales: CANALES.length,
      nuevos: 0,
      avisables: 0,
      ciego: true,
      // Que el estado se vea sin tener que leer Slack: desde cuándo, y si este paso avisó o calló.
      ciegoDesde: new Date(cegueraDesdeMs).toISOString(),
      aviso: avisar ? (toca ? 'enviado' : 'callado para no repetir') : null,
      problemas,
    };
  }
  // Vuelve a ver. Se dice UNA vez, porque sin esto Dante se queda sin saber si sigue roto: el
  // último mensaje del canal seguiría siendo «está ciego» aunque llevara un día funcionando.
  if (cegueraDesdeMs != null) {
    const horas = (Date.now() - cegueraDesdeMs) / 3_600_000;
    cegueraDesdeMs = null;
    ultimoAvisoCiegoMs = null;
    if (avisar) {
      await enviarSlack({
        text: '✅ El centinela vuelve a ver',
        unfurl_links: false,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *El centinela vuelve a ver*\nEstuvo ciego ${horas < 24 ? `${horas.toFixed(1)} h` : `${Math.round(horas / 24)} días`}. Lo que se publicó mientras tanto no se vio.`,
            },
          },
        ],
      });
    }
  }

  let aviso = null;
  if (avisar && avisables.length) {
    const r = await enviarSlack(formatearAvisoCentinela(avisables, refMs));
    aviso = { enviados: avisables.length, ok: r.ok, motivo: r.motivo || null };
  }

  return {
    ok: true,
    canales: CANALES.length,
    nuevos: nuevos.length,
    avisables: avisables.length,
    titulos: nuevos.map(({ hallazgo, avisable }) => `${avisable ? '🔔' : '  '} ${hallazgo.texto}`),
    // Los objetos completos, para que quien consulte a mano pueda formatearlos igual que el aviso
    // automático en vez de recibir una lista de títulos sueltos.
    detalle: nuevos,
    aviso,
    problemas,
  };
}

// Resuelve UN contenido de Instagram usando una SESIÓN con cuenta, que es lo único que puede ver lo
// que el actor anónimo no: los reels limitados por edad (`failure_reason: "MA"`). Medido el 11 nov
// 2026 sobre DcbaKviRYAT y DGELlRbySGR: sin sesión no hay forma, ni cambiando el país del proxy.
//
// ## Por qué la cookie NO se le pasa a RapidAPI, aunque sea menos código
//
// La API de RapidAPI que ya pagamos ofrece un campo `cookie` justo para esto; su propio error lo
// pide: «transfer your account cookies to receive video information». Sería un campo y listo.
//
// No se hace. Una `sessionid` de Instagram no es una llave de lectura: es la sesión entera. Quien la
// tenga puede publicar, borrar, mandar mensajes y leer el buzón de esa cuenta. Mandarla a una API de
// terceros es regalarle eso a una empresa que no conocemos, de forma permanente y sin poder
// revocársela a ella sola. Hablar nosotros directo con Instagram cuesta ~60 líneas (esto) y la
// cookie no sale de Railway.
//
// ## El riesgo que SÍ queda, y cómo se baja
//
// Una sesión usada desde una IP de centro de datos (Railway) es el patrón que Instagram marca. La
// cuenta puede acabar con un «checkpoint» o cerrada. Por eso esto está pensado para una cuenta
// DESECHABLE mayor de edad, no para la cuenta real de Dante: lo único que necesita el contenido
// limitado por edad es una cuenta adulta, no la suya. Si la tumban, se pone otra y no se perdió
// nada. `estadoDeLaSesion()` existe para que eso se vea en el panel el día que pase, en vez de
// aparecer como «el scraper dejó de funcionar».
//
// ## El id numérico
//
// La API de Instagram pide el id numérico del medio, no el shortcode. La conversión es base64 con
// el alfabeto URL-safe y vive en `instagramCodigo.js`, con su prueba en `pruebas/shortcode.test.js`.

import { config } from './config.js';
// Las dos funciones del shortcode viven en su propio módulo, sin dependencias, para que el test
// pueda importarlas sin arrancar `config.js`. Se re-exportan porque son parte de esta ruta.
import { mediaIdDesdeShortcode, shortcodeDeUrl } from './instagramCodigo.js';

export { mediaIdDesdeShortcode, shortcodeDeUrl };

// El id público de la app web de Instagram. No es un secreto ni una credencial: es el mismo valor
// que manda cualquier navegador y está a la vista en el JS de instagram.com. Se deja fijo aquí para
// que no parezca algo que haya que configurar.
const APP_ID_WEB = '936619743392459';

const UA_NAVEGADOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

export function sesionMontada() {
  return Boolean(config.igSessionId);
}

// Lo último que se supo de la sesión, para pintarlo en el panel. Vive en memoria a propósito: si el
// servicio reinicia se vuelve a «sin usar todavía», que es la verdad.
let ultimoEstado = { estado: 'sin_usar', cuando: null, detalle: null };

export function estadoDeLaSesion() {
  return {
    montada: sesionMontada(),
    // Distingue «no la puse» de «la puse en el servicio equivocado»: desde fuera se ven igual.
    variableRecibida: process.env.IG_SESSIONID ? 'sí (no se muestra el valor)' : null,
    ...ultimoEstado,
  };
}

function anotar(estado, detalle) {
  ultimoEstado = { estado, cuando: new Date().toISOString(), detalle: detalle || null };
}

// Elige la pista de video de mayor ancho. Instagram ordena de mejor a peor casi siempre, pero
// «casi» no es «siempre», así que se elige por el número en vez de confiar en el orden.
function mejorPorAncho(lista) {
  if (!Array.isArray(lista) || !lista.length) return null;
  return [...lista].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
}

function hashtagsDe(texto) {
  return [...String(texto || '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);
}

function mencionesDe(texto) {
  return [...String(texto || '').matchAll(/@([A-Za-z0-9._]+)/g)].map((m) => m[1]);
}

// Traduce la respuesta de Instagram al MISMO shape que devuelve el actor de Apify, para que el
// resto del pipeline (mapeo a Supabase, R2, transcripción) no sepa de dónde salió el reel.
function aNuestroShape(medio) {
  const caption = medio.caption?.text || '';
  const video = mejorPorAncho(medio.video_versions);
  const imagen = mejorPorAncho(medio.image_versions2?.candidates);
  const musica =
    medio.clips_metadata?.music_info?.music_asset_info ||
    medio.clips_metadata?.original_sound_info ||
    null;

  return {
    shortCode: medio.code,
    id: String(medio.pk ?? medio.id ?? ''),
    inputUrl: `https://www.instagram.com/reel/${medio.code}/`,
    url: `https://www.instagram.com/reel/${medio.code}/`,
    ownerUsername: medio.user?.username || null,
    ownerFullName: medio.user?.full_name || null,
    ownerId: medio.user?.pk ? String(medio.user.pk) : null,
    caption,
    hashtags: hashtagsDe(caption),
    mentions: mencionesDe(caption),
    // `taken_at` viene en segundos; el resto del pipeline espera ISO.
    timestamp: medio.taken_at ? new Date(medio.taken_at * 1000).toISOString() : null,
    likesCount: medio.like_count ?? null,
    commentsCount: medio.comment_count ?? null,
    videoViewCount: medio.play_count ?? medio.view_count ?? null,
    videoPlayCount: medio.play_count ?? null,
    videoDuration: medio.video_duration ?? null,
    dimensionsWidth: video?.width ?? imagen?.width ?? null,
    dimensionsHeight: video?.height ?? imagen?.height ?? null,
    videoUrl: video?.url || null,
    // Instagram NO sirve el audio aparte, como sí hace el actor: el mp4 ya lo trae dentro. Se apunta
    // al mismo mp4 porque `transcribe.js` manda el archivo tal cual y su `formatFromContentType`
    // ya mapea mp4 → m4a, que es lo que espera OpenRouter.
    audioUrl: video?.url || null,
    displayUrl: imagen?.url || null,
    type: video ? 'Video' : 'Image',
    productType: medio.product_type || (video ? 'clips' : null),
    musicInfo: musica
      ? {
          song_name: musica.title || musica.original_audio_title || null,
          artist_name: musica.display_artist || musica.ig_artist?.username || null,
          audio_id: musica.audio_id ? String(musica.audio_id) : null,
          uses_original_audio: Boolean(medio.clips_metadata?.original_sound_info),
        }
      : null,
    // Marca de dónde salió, para poder distinguirlo después en los logs y en el panel.
    fuente: 'sesion',
  };
}

// Traduce los NO de Instagram. Son distintos entre sí y la diferencia importa: una sesión caducada
// se arregla pegando otra, un «challenge» significa que marcaron la cuenta, y un 429 solo pide
// esperar. Si los tres dijeran «no se pudo», Dante acabaría pegando cookies nuevas para nada.
function porQueDijoNo(status, cuerpo) {
  const txt = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo || {});
  const bajo = txt.toLowerCase();

  if (bajo.includes('challenge_required') || bajo.includes('checkpoint')) {
    anotar('cuenta_marcada', 'Instagram pide verificación (challenge/checkpoint)');
    return (
      'Instagram marcó la cuenta de la sesión y le pide verificación. Hay que entrar a esa cuenta ' +
      'desde el teléfono, pasar la verificación y sacar una sessionid nueva. Si es una cuenta ' +
      'desechable, sale más rápido crear otra.'
    );
  }
  if (status === 401 || status === 403 || bajo.includes('login_required') || bajo.includes('require_login')) {
    anotar('caducada', `Instagram respondió ${status}`);
    return (
      'La sesión de Instagram ya no vale (caducó o se cerró desde la app). Saca una sessionid nueva ' +
      'y pégala en Railway, en IG_SESSIONID del servicio reels-ig-competencia.'
    );
  }
  if (status === 429 || bajo.includes('please wait a few minutes')) {
    anotar('frenada', 'Instagram pidió esperar (429)');
    return 'Instagram frenó a la cuenta por ritmo. No es un error del scraper: espera unos minutos y reintenta.';
  }
  if (status === 404) {
    anotar('ok', 'la sesión respondió, pero ese medio no existe');
    return 'Ese post ya no existe en Instagram, ni con sesión. Lo borraron.';
  }
  anotar('error', `Instagram respondió ${status}`);
  return `Instagram respondió ${status} a la petición con sesión. Detalle: ${txt.slice(0, 200)}`;
}

// Pide UN medio a Instagram con la sesión montada. Devuelve { items, motivoDelFallo } con el mismo
// contrato que `scrapeInstagramUrl`, para que el llamador no tenga que ramificar.
export async function resolverConSesion(url) {
  if (!sesionMontada()) {
    return {
      items: [],
      motivoDelFallo:
        'No hay sesión de Instagram montada, así que el contenido limitado por edad no se puede ' +
        'ver. Para montarla: IG_SESSIONID en Railway, en el servicio reels-ig-competencia.',
    };
  }
  const shortcode = shortcodeDeUrl(url);
  const mediaId = shortcode && mediaIdDesdeShortcode(shortcode);
  if (!mediaId) {
    return { items: [], motivoDelFallo: `No pude sacar el código del post de ese link: ${url}` };
  }

  let res;
  let cuerpo;
  try {
    res = await fetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
      headers: {
        'User-Agent': UA_NAVEGADOR,
        'x-ig-app-id': APP_ID_WEB,
        'x-requested-with': 'XMLHttpRequest',
        Accept: '*/*',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        Referer: `https://www.instagram.com/reel/${shortcode}/`,
        Cookie: `sessionid=${config.igSessionId}`,
      },
      // Un timeout corto a propósito: esto corre dentro de una petición del panel o de Slack, y
      // colgarse 2 minutos se ve igual que una caída.
      signal: AbortSignal.timeout(config.igSesionTimeoutMs),
    });
    cuerpo = await res.text();
  } catch (err) {
    anotar('error', err.message);
    return {
      items: [],
      motivoDelFallo: `No pude hablar con Instagram con la sesión montada: ${err.message}`,
    };
  }

  if (!res.ok) {
    return { items: [], motivoDelFallo: porQueDijoNo(res.status, cuerpo) };
  }

  let datos;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    // Instagram contesta 200 con HTML cuando en realidad quiere que inicies sesión: el muro de
    // login no es un error HTTP. Tratarlo como JSON roto diría «error raro» en vez de la verdad.
    const pareceLogin = /login|accounts\/login/i.test(cuerpo.slice(0, 2000));
    return { items: [], motivoDelFallo: porQueDijoNo(pareceLogin ? 401 : 502, cuerpo.slice(0, 300)) };
  }

  const medio = datos?.items?.[0];
  if (!medio) {
    return { items: [], motivoDelFallo: porQueDijoNo(res.status, datos) };
  }

  anotar('ok', `resolvió ${medio.code} con la sesión`);
  const item = aNuestroShape(medio);
  if (!item.videoUrl && !item.displayUrl) {
    return {
      items: [],
      motivoDelFallo:
        'La sesión abrió el post, pero Instagram no entregó ni video ni imagen. Suele ser un post ' +
        'de solo texto o un formato que no manejamos.',
    };
  }
  return { items: [item], motivoDelFallo: null };
}

// Comprobación barata para el panel: pregunta quién soy. No gasta Apify y dice si la sesión vive.
export async function comprobarSesion() {
  if (!sesionMontada()) return estadoDeLaSesion();
  try {
    const res = await fetch('https://www.instagram.com/api/v1/accounts/current_user/', {
      headers: {
        'User-Agent': UA_NAVEGADOR,
        'x-ig-app-id': APP_ID_WEB,
        Cookie: `sessionid=${config.igSessionId}`,
      },
      signal: AbortSignal.timeout(config.igSesionTimeoutMs),
    });
    const txt = await res.text();
    if (!res.ok) {
      porQueDijoNo(res.status, txt);
      return estadoDeLaSesion();
    }
    let usuario = null;
    try {
      usuario = JSON.parse(txt)?.user?.username || null;
    } catch {
      /* si no es JSON, el muro de login: lo dice el bloque de abajo */
    }
    if (!usuario) {
      porQueDijoNo(401, txt.slice(0, 300));
      return estadoDeLaSesion();
    }
    // Se guarda el NOMBRE de la cuenta, no la cookie: sirve para notar de un vistazo que la sesión
    // montada es la desechable y no la cuenta real de Dante.
    anotar('ok', `sesión viva, cuenta @${usuario}`);
    return estadoDeLaSesion();
  } catch (err) {
    anotar('error', err.message);
    return estadoDeLaSesion();
  }
}

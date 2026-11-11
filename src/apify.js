// Dispara el actor apify/instagram-reel-scraper para varios creadores en UNA sola corrida.

import { config } from './config.js';
import { runActorItems } from './apifyRun.js';

// Corre el actor para una lista de usernames a la vez (el actor procesa cada uno por separado,
// aplicando resultsLimit por perfil). onlyPostsNewerThan es global para toda la corrida.
export async function scrapeCreators({ usernames, resultsLimit, onlyPostsNewerThan }) {
  const input = {
    username: usernames,
    resultsLimit,
    skipPinnedPosts: false,
  };
  if (onlyPostsNewerThan) input.onlyPostsNewerThan = onlyPostsNewerThan;

  const items = await runActorItems(config.actorId, input);
  return items.filter((it) => it && it.shortCode && !it.error);
}

// Bandeja de historias de 24h de una o varias cuentas.
//
// DOS actores, uno barato y uno de respaldo, porque el barato se rompe:
//   * primario  goat255/… — ~$0.008 por cuenta, plano (da igual 3 historias o 30).
//   * respaldo  datavoyantlab/… — ~$0.10 por cuenta, 13x más caro, así que SOLO se usa cuando el
//     primario no devuelve nada útil.
// El 1 de septiembre de 2026 el primario empezó a fallar con
// `HTTP 401 REQUEST_SIGNATURE_EXPIRED_BUILD_TIMESTAMP` en sus 8 orígenes: la firma de su build
// caducó y su autor no ha publicado uno nuevo. Sin respaldo, capturar historias quedaba muerto —
// y las historias no se recuperan al día siguiente.
//
// Los dos entregan el MISMO `story_id` (`<pk>_<userId>`), así que el dedup y todo lo ya archivado
// siguen valiendo sin migrar nada.
//
// OJO: el primario NO está roto si lo ves fallar al instante con
// `ValidationError: meta.origin ... input_value='MCP'`. Su SDK de Python no conoce el origen 'MCP',
// así que truena si se lanza desde el conector MCP. Desde apify-client (como aquí) funciona.

// ¿El registro que devolvió el primario trae historias de verdad?
// `isAccessible:false` con `status:'fetch_failed'` NO significa que la cuenta no se pueda ver:
// significa que el actor no pudo con ninguno de sus orígenes. Confundir las dos cosas es lo que
// hacía que un scraper roto se reportara como "la cuenta no es accesible".
export function fallóElActor(rec) {
  if (!rec) return true;
  return rec.isAccessible === false && rec.status === 'fetch_failed';
}

async function historiasPrimario(usernames) {
  const items = await runActorItems(config.storiesActorId, {
    usernames,
    includeStories: true,
    includeHighlights: false,
    expandHighlightItems: false,
    compactOutput: true,
  });
  // El dataset incluye un registro recordType:'summary' que no es una cuenta.
  return items.filter((it) => it && it.recordType !== 'summary' && it.username);
}

// El respaldo devuelve las historias PLANAS y crudas de Instagram (taken_at, media_type,
// image_versions2…), no agrupadas por cuenta: aquí se traducen al shape del primario para que
// nada río abajo tenga que enterarse de cuál de los dos corrió.
function historiaDesdeCruda(s) {
  const esVideo = s.media_type === 2;
  const imagen = (s.image_versions2?.candidates || [])[0]?.url || null;
  const video =
    (s.video_versions || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
  return {
    // `id` y no `pk`: uno de los actores manda pk como número y pierde precisión.
    id: String(s.id || s.pk || ''),
    takenAt: s.taken_at,
    expiringAt: s.expiring_at ?? null,
    mediaType: esVideo ? 'video' : 'image',
    videoUrl: esVideo ? video : null,
    imageUrl: imagen,
    originalWidth: s.original_width ?? null,
    originalHeight: s.original_height ?? null,
    hasAudio: s.has_audio ?? null,
    videoDuration: s.video_duration ?? null,
  };
}

async function historiasRespaldo(usernames) {
  const items = await runActorItems(config.storiesFallbackActorId, { usernames });
  const porCuenta = new Map();
  for (const s of items || []) {
    if (!s?.id || !s.taken_at) continue;
    const usuario = (s.user?.username || '').toLowerCase();
    if (!usuario) continue;
    if (!porCuenta.has(usuario)) {
      porCuenta.set(usuario, { username: usuario, userId: s.user?.pk ? String(s.user.pk) : null, isAccessible: true, isPrivate: false, stories: [] });
    }
    porCuenta.get(usuario).stories.push(historiaDesdeCruda(s));
  }
  // Una cuenta pedida que no aparece: puede ser que no tenga historias activas, que sea privada o
  // que no exista. Este actor no lo distingue, así que se dice tal cual en vez de inventarlo.
  for (const u of usernames) {
    const k = String(u).replace(/^@/, '').toLowerCase();
    if (!porCuenta.has(k)) {
      porCuenta.set(k, { username: k, userId: null, isAccessible: true, isPrivate: false, stories: [], indeterminado: true });
    }
  }
  return [...porCuenta.values()];
}

export async function scrapeStories(usernames) {
  const primarios = await historiasPrimario(usernames);
  const utiles = primarios.filter((r) => !fallóElActor(r));
  if (utiles.length === usernames.length) return primarios.map((r) => ({ ...r, actor: 'primario' }));

  if (!config.storiesFallbackActorId) {
    console.warn('[historias] el actor primario falló y no hay respaldo configurado');
    return primarios.map((r) => ({ ...r, actor: 'primario' }));
  }

  const rotas = usernames.filter(
    (u) => !utiles.some((r) => r.username?.toLowerCase() === String(u).replace(/^@/, '').toLowerCase())
  );
  console.warn(
    `[historias] el actor primario no pudo con ${rotas.join(', ')} — cayendo al respaldo (${config.storiesFallbackActorId}, ~$0.10 por cuenta)`
  );
  try {
    const respaldo = await historiasRespaldo(rotas);
    return [...utiles.map((r) => ({ ...r, actor: 'primario' })), ...respaldo.map((r) => ({ ...r, actor: 'respaldo' }))];
  } catch (e) {
    console.error(`[historias] el respaldo también falló: ${e.message}`);
    return primarios.map((r) => ({ ...r, actor: 'primario' }));
  }
}

// Traduce el item de FALLO que devuelve el actor de Instagram. Esto existe porque hasta el 11 nov
// 2026 tirábamos ese item a la basura (`.filter(!it.error)`) y luego decíamos un mensaje genérico
// inventado por nosotros: «suele ser un post borrado, de una cuenta privada o con restricción por
// región». Medido ese día: la causa real era OTRA y el actor la decía con nombre y apellido.
//
// El item de fallo trae `error`, `errorDescription`, `failure_reason` y a veces `restricted_age`.
// Lo que vimos en producción:
//   - `failure_reason: "MA"` + `restricted_age: 24` → el reel está limitado por EDAD. Instagram solo
//     lo sirve a una sesión con cuenta mayor de edad, y el actor navega anónimo, así que no hay
//     reintento que lo arregle: ni otro día, ni otro país (probado con el proxy forzado a MX: el
//     mismo error). Es el caso de DcbaKviRYAT y DGELlRbySGR.
//   - `MEDIA_UNRESOLVED` → el medio no resolvió: post borrado o error de Instagram. Ese sí puede
//     valer la pena reintentarlo.
// Si aparece un código que no conocemos, se pasa la descripción del actor tal cual en vez de
// elegirle una causa: es el error que ya cometimos una vez.
function porQueFalloInstagram(fallo) {
  if (!fallo) return null;
  const razon = String(fallo.failure_reason || '').toUpperCase();
  const codigo = String(fallo.error || '').toLowerCase();
  const edad = fallo.restricted_age;

  // `porEdad` lo lee `scrape.js` para decidir si vale la pena gastar una petición con sesión. Se
  // devuelve como bandera y no se adivina releyendo el texto: el texto es para un humano.
  if (razon === 'MA' || codigo === 'restricted_page') {
    return {
      porEdad: true,
      texto:
        `Ese contenido está limitado por EDAD${edad ? ` (+${edad})` : ''}: Instagram solo lo muestra ` +
        'a una cuenta con sesión abierta y mayor de edad, y el actor navega sin cuenta. No es que ' +
        'esté borrado ni privado, y reintentar no sirve (probado con proxy de México: mismo ' +
        'resultado). Se arregla montando una sesión de Instagram: IG_SESSIONID en Railway.',
    };
  }
  if (razon.includes('MEDIA_UNRESOLVED') || codigo.includes('media_unresolved')) {
    return {
      porEdad: false,
      texto:
        'Instagram no resolvió el video de ese post: o lo borraron, o fue un error pasajero de su ' +
        'lado. Este es el único caso en que vale la pena reintentar en un rato.',
    };
  }
  if (razon === 'NOT_FOUND' || codigo.includes('not_found') || fallo.show_lox_redesigned_404_page) {
    return { porEdad: false, texto: 'Ese post ya no existe en Instagram (404). Lo borraron o cambió de cuenta.' };
  }
  if (razon === 'PRIVATE' || codigo.includes('private')) {
    return {
      porEdad: false,
      texto: 'Esa cuenta es privada, así que Instagram no sirve el post a nadie de fuera.',
    };
  }
  // Código desconocido: se dice lo que dijo el actor, sin interpretarlo.
  const crudo = fallo.errorDescription || fallo.error || fallo.failure_reason;
  return crudo
    ? { porEdad: false, texto: `Instagram rechazó ese contenido y la razón que dio es: «${crudo}».` }
    : null;
}

// Scrapea UN contenido de Instagram por su URL directa (reel, post o carrusel). Usa el actor general
// que soporta los 3 tipos y devuelve el mismo shape (shortCode, caption, videoUrl, audioUrl, etc.).
// Devuelve { items, motivoDelFallo }: `items` son los buenos y `motivoDelFallo` explica el vacío.
export async function scrapeInstagramUrl(url) {
  const isReel = /\/reels?\//i.test(url);
  const input = {
    directUrls: [url],
    resultsType: isReel ? 'reels' : 'posts',
    resultsLimit: 1,
  };
  const crudos = await runActorItems(config.igUrlActorId, input);
  const items = crudos.filter((it) => it && it.shortCode && !it.error);
  if (items.length) return { items, motivoDelFallo: null, porEdad: false };

  const fallo = crudos.find((it) => it && (it.error || it.failure_reason));
  if (fallo) {
    console.warn(`[IG url] el actor devolvió un fallo para ${url}: ${JSON.stringify(fallo)}`);
  }
  const razon = porQueFalloInstagram(fallo);
  return { items, motivoDelFallo: razon?.texto || null, porEdad: Boolean(razon?.porEdad) };
}

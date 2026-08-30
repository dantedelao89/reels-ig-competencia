// Orquestación de X/Twitter: trae los posts de las cuentas activas, une los hilos, deduplica por
// post_id e inserta solo lo nuevo, asignando Proyecto. Molde: scrapeTiktok.js.
//
// Dos diferencias con TikTok, las dos por cómo se comporta el actor:
//   * NO hay ventana de fecha, así que el dedup por post_id es la única defensa contra volver a
//     pagar por lo mismo. Por eso el Set de existentes se consulta SIEMPRE antes de ingerir.
//   * Los tweets de continuación llegan en la misma corrida del perfil, así que el hilo se une
//     gratis; solo la ruta de "un post por su link" necesita una corrida extra, y únicamente
//     cuando el post se ve incompleto.

import { config } from './config.js';
import {
  getActiveXCreators,
  getXCreatorByUsername,
  createXCreator,
  updateXCreatorLastRun,
} from './sources.js';
import {
  scrapeXProfile,
  scrapeXPosts,
  scrapeXAutorEnConversacion,
  agruparHilos,
  xPostIdFromUrl,
} from './xApify.js';
import { syncX, getExistingXIds } from './supabase.js';

// Adjunta a un post lo que su autor escribió en los comentarios. Cuesta una corrida del actor,
// así que quien llama decide a cuáles posts se lo aplica. Nunca lanza: si falla, el post se
// guarda igual sin esa parte.
async function conRespuestasDelAutor(post) {
  if (!config.xFetchRespuestas) return post;
  try {
    const mensajes = await scrapeXAutorEnConversacion(post.id, post.handle);
    if (!mensajes.length) return post;

    // Las continuaciones (sin @) son parte del post: X las muestra pegadas, así que se unen al
    // copy. Las respuestas a comentaristas van aparte, que es donde suele estar el prompt.
    const continuaciones = mensajes.filter((m) => !m.esRespuestaAComentario);
    // OJO con el nombre: `respuestas` YA existe en el post normalizado y es el NÚMERO de replies
    // que va a la columna bigint `comentarios`. Llamar así al array lo pisaba y Postgres rechazaba
    // la fila entera con "invalid input syntax for type bigint".
    const respuestasAutor = mensajes.filter((m) => m.esRespuestaAComentario);
    const texto = [post.texto, ...continuaciones.map((m) => m.texto)].filter(Boolean).join('\n\n');
    console.log(
      `[X hilo] ${post.id}: ${continuaciones.length} continuación(es), ${respuestasAutor.length} respuesta(s) del autor`
    );
    return { ...post, texto, respuestasAutor };
  } catch (e) {
    console.warn(`[X hilo] no se pudo leer la conversación de ${post.id}: ${e.message}`);
    return post;
  }
}

// ¿Vale la pena pagar la corrida extra por este post? Un post con media y poco texto es la firma
// de "el prompt está en otro lado".
function pareceIncompleto(p) {
  return (p.videoUrl || p.fotos.length) && p.texto.trim().length < config.xLargoCompleto;
}

// Inserta los posts nuevos. resolve(post) → { project }. Devuelve cuántos insertó.
async function ingestX(posts, existing, startedAt, resolve) {
  const fresh = posts.filter((p) => p.id && !existing.has(String(p.id)));
  if (fresh.length === 0) return 0;
  const { synced, rehosted, videos } = await syncX(fresh, { scrapedAtIso: startedAt, resolve });
  fresh.forEach((p) => existing.add(String(p.id)));
  console.log(`[X supabase] sincronizados=${synced} portadas=${rehosted} videos_archivados=${videos}`);
  return synced;
}

// Corrida de todas las cuentas activas. El actor solo acepta UNA cuenta por corrida (no hay
// `usernames` en plural), así que se itera; un fallo en una no tumba a las demás.
export async function runScrapeX() {
  const startedAt = new Date().toISOString();

  // Leer fuentes y existentes va dentro del try a propósito: runAll encadena las cuatro
  // plataformas, así que si esto lanzara (p. ej. las tablas de X todavía no creadas) se llevaría
  // por delante la corrida de Instagram, YouTube y TikTok. X falla sola y las demás siguen.
  let creators;
  let existing;
  try {
    creators = await getActiveXCreators();
    existing = await getExistingXIds();
  } catch (err) {
    console.error('[X] no se pudo leer las fuentes/ids:', err.message);
    return { ok: false, cuentas: 0, inserted: 0, error: err.message, details: [] };
  }
  if (!creators.length) return { ok: true, cuentas: 0, inserted: 0, details: [] };
  const details = [];
  let inserted = 0;

  for (const c of creators) {
    try {
      let posts = agruparHilos(
        await scrapeXProfile(c.username, { maxPosts: c.resultsLimit || config.xBatchMaxResults })
      );
      // Solo se paga la corrida extra por los que aún se ven incompletos, y solo si son nuevos:
      // pedir la conversación de algo que ya está en la base sería tirar el dinero.
      posts = await Promise.all(
        posts.map((p) => (!existing.has(String(p.id)) && pareceIncompleto(p) ? conRespuestasDelAutor(p) : p))
      );
      const n = await ingestX(posts, existing, startedAt, () => ({ project: c.project }));
      inserted += n;
      details.push({ cuenta: c.username, scraped: posts.length, inserted: n });
      console.log(`[X ${c.username}] scrapeados=${posts.length} nuevos=${n}`);
    } catch (err) {
      console.error(`[X ${c.username}] ERROR:`, err.message);
      details.push({ cuenta: c.username, error: err.message });
    }
    try {
      await updateXCreatorLastRun(c.recordId, startedAt);
    } catch (e) {
      console.error(`[X lastRun ${c.username}] ${e.message}`);
    }
  }
  return { ok: true, cuentas: creators.length, inserted, details };
}

// Re-scrape manual de UNA cuenta (botón de Fuentes).
export async function runScrapeXCreator(usernameOrUrl) {
  const startedAt = new Date().toISOString();
  let creator;
  let existing;
  try {
    creator = await getXCreatorByUsername(usernameOrUrl);
    existing = await getExistingXIds();
  } catch (err) {
    return { ok: false, error: err.message, inserted: 0 };
  }
  if (!creator) {
    return { ok: false, error: `No se encontró la cuenta de X: ${usernameOrUrl}`, inserted: 0 };
  }
  try {
    let posts = agruparHilos(
      await scrapeXProfile(creator.username, {
        maxPosts: Math.max(creator.resultsLimit || config.xDefaultMaxResults, 20),
      })
    );
    posts = await Promise.all(
      posts.map((p) => (!existing.has(String(p.id)) && pareceIncompleto(p) ? conRespuestasDelAutor(p) : p))
    );
    const inserted = await ingestX(posts, existing, startedAt, () => ({ project: creator.project }));
    console.log(`[X manual] ${creator.username} scrapeados=${posts.length} nuevos=${inserted}`);
    try {
      await updateXCreatorLastRun(creator.recordId, startedAt);
    } catch (e) {
      console.error(`[X manual lastRun] ${e.message}`);
    }
    return { ok: true, cuenta: creator.username, inserted };
  } catch (err) {
    console.error(`[X manual ${creator.username}] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
}

// UN post por su URL. Da de alta la cuenta como fuente si no la teníamos, y fuerza upsert
// (Set vacío) para que re-pegar el mismo link siempre actualice.
export async function runScrapeXUrl(url) {
  const startedAt = new Date().toISOString();
  const limpio = (url || '').trim();
  if (!/(?:twitter|x)\.com\//i.test(limpio)) {
    return { ok: false, error: 'La URL no es de X/Twitter', inserted: 0 };
  }
  const postId = xPostIdFromUrl(limpio);
  if (!postId) {
    return {
      ok: false,
      error: 'De ese link no sale el id del post. Usa uno con /status/… (el que da "Copiar enlace").',
      inserted: 0,
    };
  }

  try {
    const encontrados = await scrapeXPosts([postId]);
    let post = encontrados[0];
    if (!post) {
      return {
        ok: false,
        error: 'No se pudo leer ese post de X (puede ser de una cuenta protegida o estar borrado)',
        inserted: 0,
      };
    }

    // Aquí SIEMPRE se pide la conversación, sin importar el largo del post: es un solo post, es
    // la vía que Dante usa a mano, y el prompt puede estar en una respuesta aunque el post ya
    // traiga bastante texto.
    post = await conRespuestasDelAutor(post);

    const handle = post.handle;
    let creator = handle ? await getXCreatorByUsername(handle) : null;
    let cuentaNueva = false;
    if (!creator && handle) {
      try {
        creator = await createXCreator(handle);
        cuentaNueva = true;
        console.log(`[X url] cuenta nueva agregada a Fuentes: ${handle}`);
      } catch (e) {
        console.error(`[X url] no se pudo dar de alta ${handle}: ${e.message}`);
      }
    }

    const inserted = await ingestX([post], new Set(), startedAt, () => ({ project: creator?.project }));
    console.log(`[X url] ${limpio} post_id=${post.id} actualizado/nuevo=${inserted}`);
    return {
      ok: true,
      inserted,
      postId: post.id,
      creador: handle,
      caption: post.texto?.slice(0, 200) || null,
      respuestasAutor: (post.respuestasAutor || []).length,
      cuentaNueva,
    };
  } catch (err) {
    console.error(`[X url] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
}

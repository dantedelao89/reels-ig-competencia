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
  scrapeXThread,
  agruparHilos,
  xPostIdFromUrl,
} from './xApify.js';
import { syncX, getExistingXIds } from './supabase.js';

// Debajo de esto se asume que el prompt vive en un tweet de continuación y vale la pena la
// corrida extra. Arriba, el post ya se explica solo y no se gasta.
const LARGO_COMPLETO = 600;

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
      const posts = agruparHilos(
        await scrapeXProfile(c.username, { maxPosts: c.resultsLimit || config.xBatchMaxResults })
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
    const posts = agruparHilos(
      await scrapeXProfile(creator.username, {
        maxPosts: Math.max(creator.resultsLimit || config.xDefaultMaxResults, 20),
      })
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

    // El gancho corto con el video suele traer el prompt en un tweet aparte. Solo se paga la
    // corrida extra cuando el post se ve incompleto.
    if (post.texto.trim().length < LARGO_COMPLETO) {
      try {
        const cont = await scrapeXThread(postId, post.handle);
        if (cont.length) {
          post = agruparHilos([post, ...cont]).find((p) => p.id === post.id) || post;
          console.log(`[X url] hilo unido: ${cont.length} continuación(es), ${post.texto.length} caracteres`);
        }
      } catch (e) {
        console.warn(`[X url] no se pudo traer el hilo de ${postId}: ${e.message}`);
      }
    }

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
      cuentaNueva,
    };
  } catch (err) {
    console.error(`[X url] ERROR:`, err.message);
    return { ok: false, error: err.message, inserted: 0 };
  }
}

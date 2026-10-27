// Cliente Apify compartido + ejecución de actores con reintentos.
// Las corridas pueden dispararse EN PARALELO (varios scrapes simultáneos desde DISECTA). El único
// techo es el cupo de memoria de la cuenta Apify (32 GB): si Apify rechaza una corrida porque el
// cupo está lleno, esperamos y reintentamos con backoff en vez de fallar. Así se aprovecha la
// concurrencia sin nunca exceder la memoria.

import { ApifyClient } from 'apify-client';
import { config } from './config.js';

const client = new ApifyClient({ token: config.apifyToken });

// Acumulador de gasto real (USD) reportado por Apify por cada corrida del actor.
let spendUsd = 0;
export function resetApifySpend() {
  spendUsd = 0;
}
export function getApifySpend() {
  return Math.round(spendUsd * 10000) / 10000;
}

function isMemoryError(err) {
  const msg = ((err && err.message) || '').toLowerCase();
  return (
    msg.includes('memory') ||
    msg.includes('memory limit') ||
    msg.includes('exceed') ||
    msg.includes('not enough') ||
    err?.statusCode === 429
  );
}

// Corre un actor, espera a que termine y devuelve los items del dataset.
// Reintenta con espera si Apify rechaza por falta de memoria disponible en la cuenta.
export async function runActorItems(actorId, input, opts = {}) {
  const callOpts = {};
  if (config.apifyRunMemoryMb) callOpts.memory = config.apifyRunMemoryMb;
  // Tope DURO de gasto por corrida, impuesto por Apify del lado del servidor.
  //
  // Hace falta porque el número que se le pide a un actor es una PETICIÓN, no una garantía, y está
  // medido en este proyecto: `danek/twitter-scraper` IGNORA `max_posts` (pedimos 8 y devolvió 20) y
  // el buscador de X redondea hacia arriba de 20 en 20. Con esto, pase lo que pase dentro del
  // actor, Apify corta la corrida al llegar al monto.
  //
  // `maxTotalChargeUsd` aplica a los actores PAY_PER_EVENT (los tres del radar lo son) y `maxItems`
  // a los de pago por resultado. Se mandan solo si quien llama los pide: el resto del pipeline
  // sigue corriendo sin tope, igual que antes.
  if (opts.maxTotalChargeUsd) callOpts.maxTotalChargeUsd = opts.maxTotalChargeUsd;
  if (opts.maxItems) callOpts.maxItems = opts.maxItems;

  let lastErr;
  for (let attempt = 1; attempt <= config.apifyMaxRetries; attempt++) {
    try {
      const run = await client.actor(actorId).call(input, callOpts);
      spendUsd += run.usageTotalUsd || 0;
      const { items } = await client.dataset(run.defaultDatasetId).listItems();

      // Una corrida FALLIDA no lanza: `.call()` espera a que termine y devuelve el objeto pase lo
      // que pase, así que el dataset sale vacío y quien llama lee «no hubo resultados».
      //
      // Descubierto el 27 oct 2026 montando Reddit: cuatro corridas seguidas devolvieron 0 items y
      // me pasé un rato ajustando la ENTRADA, convencido de que mis parámetros estaban mal. En
      // Apify estaban las cuatro como FAILED, y cobradas a $0.04 cada una. Es el mismo disfraz que
      // ya nos costó dos diagnósticos —el 429 de YouTube devolviendo 0 hallazgos y el feed del
      // centinela con 404 falsos— y la lección es la misma: un cero hay que saber de qué es.
      //
      // Si la corrida trajo items se devuelven igual, solo con un aviso: un actor que se queda sin
      // tiempo a mitad suele dejar datos buenos, y tirarlos por el estado sería perder lo que ya
      // se pagó.
      if (run.status !== 'SUCCEEDED') {
        if (!items.length) {
          throw new Error(
            `la corrida de ${actorId} terminó en ${run.status} sin resultados ` +
              `(run ${run.id}, $${(run.usageTotalUsd || 0).toFixed(4)})`
          );
        }
        console.warn(
          `[apify] ${actorId} terminó en ${run.status} pero trajo ${items.length} items; se usan (run ${run.id})`
        );
      }
      return items;
    } catch (err) {
      lastErr = err;
      if (!isMemoryError(err) || attempt === config.apifyMaxRetries) throw err;
      const waitMs = config.apifyRetryBaseMs * attempt;
      console.warn(
        `[apify] intento ${attempt}/${config.apifyMaxRetries} rechazado por memoria (${err.message}); espero ${Math.round(
          waitMs / 1000
        )}s y reintento`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

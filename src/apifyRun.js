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
export async function runActorItems(actorId, input) {
  const callOpts = {};
  if (config.apifyRunMemoryMb) callOpts.memory = config.apifyRunMemoryMb;

  let lastErr;
  for (let attempt = 1; attempt <= config.apifyMaxRetries; attempt++) {
    try {
      const run = await client.actor(actorId).call(input, callOpts);
      spendUsd += run.usageTotalUsd || 0;
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
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

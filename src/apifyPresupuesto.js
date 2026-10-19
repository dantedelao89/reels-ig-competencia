// Presupuesto del radar: el freno que impide que el descubrimiento se coma el saldo del mes.
//
// El gasto se lee de APIFY, no se calcula sumando lo nuestro. Es deliberado: `usageTotalUsd` leído
// justo después de una corrida devuelve 0 (medido en este proyecto varias veces), así que una suma
// propia mentiría por debajo justo en la dirección peligrosa. La cuenta de Apify es la única que
// sabe cuánto se gastó de verdad.

import { config } from './config.js';

// Gasto del ciclo de facturación en curso, en USD. Devuelve null si no se pudo leer.
export async function gastoMensualUsd() {
  if (!config.apifyToken) return null;
  try {
    const res = await fetch(
      `https://api.apify.com/v2/users/me/usage/monthly?token=${config.apifyToken}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`Apify respondió ${res.status}`);
    const { data } = await res.json();
    const usd =
      data?.totalUsageCreditsUsdAfterVolumeDiscount ?? data?.totalUsageCreditsUsd ?? null;
    return typeof usd === 'number' ? Math.round(usd * 10000) / 10000 : null;
  } catch (e) {
    console.warn(`[presupuesto] no se pudo leer el gasto de Apify: ${e.message}`);
    return null;
  }
}

// ¿Se puede correr el radar? Si el gasto del mes ya pasó el presupuesto, NO.
//
// Si no se puede leer el gasto se deja correr, y es una decisión consciente: cada corrida ya tiene
// un tope duro por consulta (`radarMaxUsdPorCorrida`) y la cuenta de Apify tiene su propio techo
// mensual, así que lo peor que pasa es gastar unos centavos de más. Bloquear por un fallo de red
// apagaría el descubrimiento sin que nadie se enterara, que es peor.
export async function puedeCorrerRadar() {
  const tope = config.radarPresupuestoMensualUsd;
  if (!tope) return { puede: true, gastado: null, tope: null };

  const gastado = await gastoMensualUsd();
  if (gastado == null) {
    return { puede: true, gastado: null, tope, aviso: 'no se pudo leer el gasto; se corre igual' };
  }
  const puede = gastado < tope;
  if (!puede) {
    console.warn(
      `[presupuesto] radar DETENIDO: $${gastado} gastados este mes, tope $${tope}. ` +
        'Sube RADAR_PRESUPUESTO_USD o espera el próximo ciclo.'
    );
  }
  return { puede, gastado, tope };
}

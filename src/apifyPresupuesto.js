// Presupuesto del radar: el freno que impide que el descubrimiento se coma el saldo del mes.
//
// ## Por qué ya no se mira el gasto de la CUENTA (27 oct 2026)
//
// Hasta hoy este freno leía `users/me/usage/monthly`, que es el gasto de la cuenta COMPLETA, y lo
// comparaba contra el presupuesto del radar. O sea que el cron de historias de Instagram y el de
// ads consumían el presupuesto del radar sin tener nada que ver con él. Medido el 27 oct: $7.798 de
// un tope de $8, de los cuales el radar de X había gastado $0.033 — el freno estaba a veinte
// centavos de apagar el descubrimiento por culpa de otros crons.
//
// Ahora se suma solo el gasto de los ACTORES que el radar paga. La lista es corta a propósito
// (`radarActoresDePago`): el radar de YouTube ya no corre en cron porque `radarYoutubeLibre.js`
// hace lo mismo gratis y 13 veces al día, así que su actor —que comparten el barrido y el pipeline
// orgánico, $4.74 este ciclo— no tiene por qué pesar aquí.
//
// Lo que esto SÍ cuenta de más: una corrida orgánica del mismo actor (cuando Dante guarda un post
// de X con 💾) entra en la suma. Son $0.0003 por corrida y el error va hacia el lado seguro —
// frenar un poco antes, nunca después—, así que no vale un mecanismo aparte para distinguirlas.
//
// El gasto se lee de APIFY, no se calcula sumando lo nuestro: `usageTotalUsd` leído justo después
// de una corrida devuelve 0 (medido varias veces en este proyecto), así que una suma propia
// mentiría por debajo justo en la dirección peligrosa. La contrapartida es que la corrida en curso
// puede no estar contada todavía; la cubre el tope DURO por corrida, que impone Apify.

import { config } from './config.js';

// Normaliza `usuario/actor` a la forma con la que Apify responde en los listados de corridas, que
// usa el id opaco. Se resuelve una vez y se recuerda: son dos actores y no cambian en caliente.
const idsResueltos = new Map();

async function idDeActor(nombre) {
  if (idsResueltos.has(nombre)) return idsResueltos.get(nombre);
  const slug = nombre.replace('/', '~');
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${slug}?token=${config.apifyToken}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`Apify respondió ${res.status}`);
    const { data } = await res.json();
    idsResueltos.set(nombre, data?.id || null);
    return data?.id || null;
  } catch (e) {
    console.warn(`[presupuesto] no se pudo resolver el actor "${nombre}": ${e.message}`);
    return null;
  }
}

// Inicio del ciclo de facturación en curso, que NO es el día 1 del mes: la cuenta de Dante va del
// 15 al 14. Sumar "lo que va del mes natural" dejaría fuera medio ciclo.
async function inicioDelCiclo() {
  const res = await fetch(
    `https://api.apify.com/v2/users/me/usage/monthly?token=${config.apifyToken}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Apify respondió ${res.status}`);
  const { data } = await res.json();
  return {
    desde: data?.usageCycle?.startAt || null,
    cuenta:
      typeof data?.totalUsageCreditsUsdAfterVolumeDiscount === 'number'
        ? Math.round(data.totalUsageCreditsUsdAfterVolumeDiscount * 10000) / 10000
        : null,
  };
}

// Gasto del RADAR en el ciclo en curso, en USD. Devuelve null si no se pudo leer.
// `cuentaUsd` es, además, el gasto de la cuenta completa: se devuelve para poder enseñar los dos
// números juntos en `/crons`, que es donde se ve si el tope del radar sigue teniendo sentido.
export async function gastoRadarUsd() {
  if (!config.apifyToken) return { radar: null, cuenta: null, desde: null };
  try {
    const { desde, cuenta } = await inicioDelCiclo();
    const ids = (await Promise.all(config.radarActoresDePago.map(idDeActor))).filter(Boolean);
    if (!ids.length) return { radar: null, cuenta, desde };

    const res = await fetch(
      `https://api.apify.com/v2/actor-runs?token=${config.apifyToken}&desc=1&limit=1000`,
      { signal: AbortSignal.timeout(20000) }
    );
    if (!res.ok) throw new Error(`Apify respondió ${res.status}`);
    const { data } = await res.json();
    // El listado NO trae `options`, así que no se puede filtrar por `isMaxTotalChargeUsdSetByUser`
    // (que sería el discriminador exacto, porque solo el radar pone tope por corrida) sin pedir el
    // detalle de cada corrida. Con 231 corridas en el ciclo serían 231 peticiones antes de CADA
    // consulta del radar: el filtro por actor cuesta una.
    const suma = (data?.items || [])
      .filter((r) => ids.includes(r.actId))
      .filter((r) => !desde || r.startedAt >= desde)
      .reduce((acc, r) => acc + (r.usageTotalUsd || 0), 0);
    return { radar: Math.round(suma * 10000) / 10000, cuenta, desde };
  } catch (e) {
    console.warn(`[presupuesto] no se pudo leer el gasto de Apify: ${e.message}`);
    return { radar: null, cuenta: null, desde: null };
  }
}

// ¿Se puede correr el radar? Si el gasto del radar en el ciclo ya pasó el presupuesto, NO.
//
// Si no se puede leer el gasto se deja correr, y es una decisión consciente: cada corrida ya tiene
// un tope duro por consulta (`radarMaxUsdPorCorrida`) y la cuenta de Apify tiene su propio techo
// mensual, así que lo peor que pasa es gastar unos centavos de más. Bloquear por un fallo de red
// apagaría el descubrimiento sin que nadie se enterara, que es peor.
export async function puedeCorrerRadar() {
  const tope = config.radarPresupuestoMensualUsd;
  if (!tope) return { puede: true, gastado: null, tope: null };

  const { radar: gastado, cuenta } = await gastoRadarUsd();
  if (gastado == null) {
    return { puede: true, gastado: null, tope, aviso: 'no se pudo leer el gasto; se corre igual' };
  }
  const puede = gastado < tope;
  if (!puede) {
    console.warn(
      `[presupuesto] radar DETENIDO: $${gastado} gastados por el radar en este ciclo, tope $${tope} ` +
        `(la cuenta entera va en $${cuenta}). Sube RADAR_PRESUPUESTO_USD o espera el próximo ciclo.`
    );
  }
  return { puede, gastado, tope, cuenta };
}

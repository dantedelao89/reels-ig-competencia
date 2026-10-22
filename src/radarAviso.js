// Avisa por WhatsApp cuando algo del nicho despega, para poder grabar dentro de la ventana.
//
// ## Por qué hay un umbral y no "avísame de todo"
//
// Medido el 22 oct 2026 sobre los 115 hallazgos reales de un día: 88 iban por debajo de 300
// vistas/hora. Avisar de todo son 115 mensajes y, al tercer día, un chat silenciado — que es la
// única forma de que un sistema de alertas falle del todo. Con el filtro de abajo salieron 2.
//
// ## Por qué la ventana es de horas y no de días
//
// Reconstruida la ola del lanzamiento de Claude Duet (21 oct 2026, 13:35 CDMX) desde la base:
//
//   −0.5 h  EN  Peter Yang        113k subs   51.838 vistas   (publicó ANTES del anuncio oficial)
//   +0.0 h  EN  Claude oficial    665k        507.481
//   +2.1 h  EN  Chase AI          181k         50.536
//   +2.3 h  EN  Brock Mesarich    151k        137.508
//   +3.0 h  ES  Juan Pe Navarro    94k         22.159   ← el primero en español
//  +15.2 h  ES  Adrià Estévez    12.7k             76
//  +15.9 h  ES  Marco Sotos       1.3k             25
//
// Quien publicó a las 3 horas tiene 22 mil vistas; quienes publicaron a las 15, dos dígitos. Y
// Viegas Estudio, con 233 mil suscriptores —dos veces y media los de Juan Pe— publicó a las 15 h y
// va a la novena parte de su velocidad. Las doce horas de retraso pesaron más que la audiencia.
//
// ## Por qué el aviso cuenta cuántos hay YA en español
//
// Los cinco primeros de esa lista son en inglés. El español no aparece hasta la hora 3. Así que
// saber "esto explotó" no basta: lo que decide si vale la pena grabar es si el hueco sigue
// abierto. Por eso cada aviso dice cuántos videos hay ya del mismo tema en español.

import { config } from './config.js';

// Un hallazgo "cruza" cuando antes estaba por debajo del umbral (o no existía) y ahora está por
// encima. Avisar por estar por encima a secas repetiría el mismo video en cada pasada del cron.
export function elegirAvisos(hallazgos, velocidadesPrevias, opciones = {}) {
  const maxHoras = opciones.maxHoras ?? config.radarAvisoMaxHoras;
  const minVelocidad = opciones.minVelocidad ?? config.radarAvisoMinVelocidad;
  const ahora = opciones.ahoraMs ?? Date.now();

  return hallazgos
    .filter((h) => {
      if (!h.fecha || !h.velocidad) return false;
      const horas = (ahora - new Date(h.fecha).getTime()) / 3_600_000;
      // La ventana de edad es lo que hace que el umbral signifique algo: sin ella, un video de
      // ayer con 2.000 vistas/h avisaría hoy, cuando ya no hay nada que hacer con él.
      if (!(horas >= 0 && horas <= maxHoras)) return false;
      if (h.velocidad < minVelocidad) return false;
      const antes = velocidadesPrevias.get(String(h.id));
      return antes == null || antes < minVelocidad;
    })
    .sort((a, b) => (b.velocidad || 0) - (a.velocidad || 0));
}

// Cuántos videos hay YA de cada tema, por idioma de la consulta que los encontró. Es la señal de
// si el hueco sigue abierto.
export function conteoPorIdioma(hallazgos) {
  const porTema = new Map();
  for (const h of hallazgos) {
    const idi = idiomaDe(h);
    for (const t of h.temas || []) {
      if (!porTema.has(t)) porTema.set(t, { en: 0, es: 0, pt: 0 });
      if (porTema.get(t)[idi] !== undefined) porTema.get(t)[idi] += 1;
    }
  }
  return porTema;
}

function idiomaDe(h) {
  const m = /·\s*(en|es|pt)\s*$/i.exec(h.busqueda?.etiqueta || h.busquedaEtiqueta || '');
  return m ? m[1].toLowerCase() : 'en';
}

function miles(n) {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function edad(h, ahoraMs) {
  const horas = (ahoraMs - new Date(h.fecha).getTime()) / 3_600_000;
  return horas < 1 ? `${Math.round(horas * 60)} min` : `${horas.toFixed(1)} h`;
}

// El mensaje. Corto a propósito: se lee en el teléfono, de pie, para decidir en cinco segundos si
// se graba. Todo lo que no ayude a esa decisión sobra.
export function formatearAviso(avisos, todos, ahoraMs = Date.now()) {
  const conteos = conteoPorIdioma(todos);
  const partes = avisos.map((h) => {
    const idi = idiomaDe(h).toUpperCase();
    const tema = (h.temas || [])[0];
    const c = tema ? conteos.get(tema) : null;
    const hueco = c
      ? c.es === 0
        ? `nadie lo ha hecho en español todavía (${c.en} en inglés)`
        : `ya hay ${c.es} en español y ${c.en} en inglés`
      : null;
    return [
      `*${Math.round(h.velocidad).toLocaleString('es-MX')} vistas/h* · hace ${edad(h, ahoraMs)} · ${idi}`,
      h.texto,
      `${h.nombre || '?'} · ${miles(h.seguidores)} subs · ${(h.views || 0).toLocaleString('es-MX')} vistas`,
      hueco ? `→ ${hueco}` : null,
      h.url,
    ]
      .filter(Boolean)
      .join('\n');
  });
  const cabecera = avisos.length === 1 ? '🔥 Despegando ahora' : `🔥 ${avisos.length} despegando ahora`;
  return [cabecera, ...partes].join('\n\n');
}

// Manda el mensaje por Whapi. Devuelve si Whapi lo aceptó, sin lanzar: un fallo del aviso NO debe
// tumbar la corrida del radar, que ya hizo su trabajo guardando los hallazgos.
export async function enviarWhatsapp(texto) {
  const token = config.whapiToken;
  const to = config.whapiDestino;
  if (!token || !to) {
    console.warn('[aviso] falta WHAPI_TOKEN o WHAPI_TO: el hallazgo se guardó, pero no se avisó');
    return { ok: false, motivo: 'sin configurar' };
  }
  try {
    const res = await fetch('https://gate.whapi.cloud/messages/text', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ to, body: texto }),
      signal: AbortSignal.timeout(30_000),
    });
    const d = await res.json().catch(() => ({}));
    // Se mira el cuerpo y no solo el código: Whapi responde 200 con `sent:false` cuando el número
    // no está conectado, y dar eso por enviado es el mismo error que dar un push por desplegado.
    const ok = res.ok && d?.sent !== false;
    if (!ok) console.error(`[aviso] Whapi no lo mandó: ${res.status} ${JSON.stringify(d).slice(0, 200)}`);
    return { ok, estado: res.status, respuesta: d };
  } catch (e) {
    console.error(`[aviso] no se pudo llamar a Whapi: ${e.message}`);
    return { ok: false, motivo: e.message };
  }
}

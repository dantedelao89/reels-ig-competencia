// Avisa por Slack cuando algo del nicho despega, para poder grabar dentro de la ventana.
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

// El mensaje, en bloques de Slack.
//
// Va a Slack y no a WhatsApp por decisión de Dante (22 oct 2026): «es mucha información para que
// vaya en un whatsapp». Tiene razón y no es solo estética — en WhatsApp todo acaba siendo un
// párrafo de texto plano, mientras que aquí cada hallazgo es su propio bloque, el título es un
// enlace y la métrica se puede barrer con la vista en vertical. Además deja comentar en hilo sin
// perder el aviso original.
export function formatearAviso(avisos, todos, ahoraMs = Date.now()) {
  const conteos = conteoPorIdioma(todos);
  const bloques = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: avisos.length === 1 ? '🔥 Despegando ahora' : `🔥 ${avisos.length} despegando ahora`,
        emoji: true,
      },
    },
  ];

  for (const h of avisos) {
    const idi = idiomaDe(h).toUpperCase();
    const tema = (h.temas || [])[0];
    const c = tema ? conteos.get(tema) : null;
    // La línea que convierte el dato en decisión: no es "esto explotó", es "el hueco sigue
    // abierto". En la ola de Claude Duet los cinco primeros fueron en inglés y el español no
    // apareció hasta la hora 3.
    const hueco = c
      ? c.es === 0
        ? `🟢 *Nadie lo ha hecho en español todavía* · ${c.en} en inglés`
        : `🟡 Ya hay ${c.es} en español · ${c.en} en inglés`
      : null;
    // Los suscriptores pueden faltar: desde Railway, YouTube devuelve 429 al pedir la página del
    // video, así que ese dato solo está cuando se pudo. Se omite en vez de escribir "? subs".
    const ficha = [
      h.nombre,
      h.seguidores ? `${miles(h.seguidores)} subs` : null,
      `${(h.views || 0).toLocaleString('es-MX')} vistas`,
    ]
      .filter(Boolean)
      .join(' · ');

    bloques.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${h.url}|${(h.texto || 'sin título').replace(/[<>&]/g, ' ')}>*\n${ficha}`,
      },
    });
    bloques.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            `⚡ *${Math.round(h.velocidad).toLocaleString('es-MX')} vistas/h*`,
            `hace ${edad(h, ahoraMs)}`,
            idi,
            tema || null,
            hueco,
          ]
            .filter(Boolean)
            .join('  ·  '),
        },
      ],
    });
    bloques.push({ type: 'divider' });
  }
  bloques.pop(); // el último divider sobra

  // `text` es lo que Slack enseña en la notificación del teléfono y en la lista de canales. Sin
  // esto el aviso llegaría como "mensaje sin texto" justo donde más falta hace leerlo de un vistazo.
  const resumen = avisos
    .slice(0, 2)
    .map((h) => `${Math.round(h.velocidad).toLocaleString('es-MX')}/h ${h.texto || ''}`.slice(0, 80))
    .join(' · ');
  return { text: `🔥 ${resumen}`, blocks: bloques };
}

// Manda el aviso a Slack por un webhook entrante. Devuelve si Slack lo aceptó, sin lanzar: un fallo
// del aviso NO debe tumbar la corrida del radar, que ya hizo su trabajo guardando los hallazgos.
//
// Webhook y no token de bot a propósito: es una URL que solo sabe escribir en UN canal, así que si
// se filtra no se puede hacer nada más con ella. Para un aviso de una sola dirección, los permisos
// de un bot serían pagar de más.
export async function enviarSlack(mensaje) {
  const url = config.slackWebhookUrl;
  if (!url) {
    console.warn('[aviso] falta SLACK_WEBHOOK_URL: el hallazgo se guardó, pero no se avisó');
    return { ok: false, motivo: 'sin configurar' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mensaje),
      signal: AbortSignal.timeout(30_000),
    });
    // Un webhook de Slack responde el texto "ok" en crudo, no JSON. Cualquier otra cosa
    // ("invalid_payload", "channel_not_found") viene con 400 y explica qué pasó.
    const cuerpo = (await res.text()).trim();
    const ok = res.ok && cuerpo === 'ok';
    if (!ok) console.error(`[aviso] Slack no lo aceptó: ${res.status} ${cuerpo.slice(0, 200)}`);
    return { ok, estado: res.status, respuesta: cuerpo.slice(0, 200) };
  } catch (e) {
    console.error(`[aviso] no se pudo llamar a Slack: ${e.message}`);
    return { ok: false, motivo: e.message };
  }
}

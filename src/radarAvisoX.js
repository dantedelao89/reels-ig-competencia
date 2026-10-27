// El mensaje diario del radar de X a Slack. Mismo canal y mismo webhook que el de YouTube, mensaje
// distinto porque la decisión que hay que tomar es otra.
//
// ## Por qué es un RESUMEN y no una alerta por umbral (medido el 27 oct 2026)
//
// El aviso de YouTube solo habla cuando algo cruza 1.000 vistas/h, y está bien: ahí hay 13 pasadas
// al día y lo que importa es llegar dentro de la ventana de 3 horas. En X ese diseño no funciona, y
// las seis consultas medidas dicen por qué:
//
//   - Un LANZAMIENTO de verdad no corre. «Introducing Topview T1» (@topviewaihq, 12.8k seguidores)
//     y «Introducing FLUX 3 Max» (@fal) van a 8 likes/hora. Son justo la información que Dante
//     quiere y ningún umbral de velocidad los dejaría pasar.
//   - Lo que SÍ corre casi nunca es del nicho. Lo más rápido del día fue @gdb (OpenAI) a 771
//     likes/h y un tweet de ElevenLabs a 949, y por debajo de 200 likes/h está el contenido
//     rutinario de los creadores de IA.
//
// Así que el cron manda lo que encontró, ordenado por velocidad, y MARCA con 🔥 lo que además
// despegó. Un umbral como filtro de entrada escondería los lanzamientos; como marca, los ordena.
//
// ## Qué decide en X, y no es lo mismo que en YouTube
//
// El aviso de YouTube cuenta cuántos videos del tema hay ya en español, porque ahí la pregunta es
// «¿sigue abierto el hueco?». En X nadie compite por publicar el mismo tweet. Lo que decide es el
// tamaño de la cuenta: medido el 7 sep 2026, el actor solo da `followers_count` en la ruta de
// búsqueda, y ahí está la señal — **3.000 likes con 900 seguidores es un hallazgo; con 900 mil es
// rutina**. Por eso cada línea lleva los likes por cada mil seguidores.

import { config } from './config.js';
import { enviarSlack, repartirPorTema } from './radarAviso.js';

function miles(n) {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function edad(h, ahoraMs) {
  if (!h.fecha) return null;
  const horas = (ahoraMs - new Date(h.fecha).getTime()) / 3_600_000;
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 48) return `${horas.toFixed(1)} h`;
  return `${Math.round(horas / 24)} d`;
}

// Likes por cada mil seguidores: la corrección por tamaño de cuenta. Sin ella el resumen se llena
// de cuentas enormes con su rendimiento habitual y entierra al desconocido que dio la noticia.
export function porMilSeguidores(likes, seguidores) {
  if (!likes || !seguidores) return null;
  return Math.round((likes / seguidores) * 1000);
}

// Un tweet puede traer 2.700 caracteres (los hilos se unen al `caption`), y en Slack eso convierte
// cada línea en un muro que esconde la métrica.
export function unaLinea(texto, max = 170) {
  const limpio = String(texto || 'sin texto')
    .replace(/\s+/g, ' ')
    .replace(/[<>&]/g, ' ')
    .trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

// Lo que entra en el resumen: hallazgos nuevos, lo bastante recientes, repartidos entre temas.
//
// `repartirPorTema` se reusa del aviso de YouTube y resuelve aquí el mismo problema que allí: sin
// él un lanzamiento caliente se come la lista entera y los demás temas no aparecen. Dante lo dijo
// antes que nadie: «siempre me entrega de los mismos temas».
export function elegirParaResumen(nuevos, { maxHoras, cuantos, ahoraMs = Date.now() } = {}) {
  const frescos = nuevos
    .filter((h) => h.url)
    .filter((h) => {
      if (!h.fecha) return false;
      const horas = (ahoraMs - new Date(h.fecha).getTime()) / 3_600_000;
      // La cota de edad existe porque las consultas van con `min_faves`, y eso le pide a X los
      // resultados TOP, no los últimos: sin ella un tweet de hace una semana con muchos likes
      // entraría en el resumen de hoy como si fuera de hoy.
      return horas >= 0 && horas <= (maxHoras ?? 48);
    })
    .sort((a, b) => (b.velocidad || 0) - (a.velocidad || 0));
  return repartirPorTema(frescos, cuantos ?? 8, 2);
}

// `vacias`: cuántas consultas volvieron sin un solo resultado. Se dice en el mensaje porque el
// actor falla EN SILENCIO — medido el 27 oct 2026, «Avatares, voz y anuncios IA» devolvió 0 en una
// corrida y 20 en las dos siguientes con la misma consulta, sin lanzar ningún error. Un cero que no
// se nombra se lee igual que «hoy no hubo nada de eso», y así un tema puede quedarse ciego durante
// días sin que nadie lo note. Es el mismo fallo que el 429 de YouTube, con otro disfraz.
export function formatearResumenX(elegidos, { consultas, nuevos, vacias = 0, ahoraMs = Date.now() } = {}) {
  const pico = config.radarXAvisoMinVelocidad;
  const calientes = elegidos.filter((h) => (h.velocidad || 0) >= pico).length;

  const bloques = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: calientes
          ? `𝕏 Radar de X · ${calientes} despegando`
          : `𝕏 Radar de X · ${nuevos} hallazgos nuevos`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            `${consultas} consultas · ${nuevos} nuevos · se muestran ${elegidos.length}`,
            `🔥 = más de ${pico} likes/h`,
            vacias ? `⚠️ ${vacias} ${vacias === 1 ? 'consulta volvió' : 'consultas volvieron'} vacía${vacias === 1 ? '' : 's'}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        },
      ],
    },
    { type: 'divider' },
  ];

  let n = 0;
  for (const h of elegidos) {
    n += 1;
    const ratio = porMilSeguidores(h.likes, h.seguidores);
    const caliente = (h.velocidad || 0) >= pico;
    const ficha = [
      h.handle ? `@${h.handle}` : h.nombre,
      h.seguidores ? `${miles(h.seguidores)} seg.` : null,
      `${(h.likes || 0).toLocaleString('es-MX')} likes`,
    ]
      .filter(Boolean)
      .join(' · ');

    bloques.push({
      type: 'section',
      // El número delante porque el orden por velocidad no se ve: dos bloques seguidos parecen una
      // lista cualquiera, y lo que decide cuál mirar primero es justo el orden.
      text: {
        type: 'mrkdwn',
        text: `*${caliente ? '🔥 ' : ''}${n}. <${h.url}|${unaLinea(h.texto)}>*\n${ficha}`,
      },
    });
    bloques.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            h.velocidad ? `⚡ *${Math.round(h.velocidad).toLocaleString('es-MX')} likes/h*` : null,
            edad(h, ahoraMs) ? `hace ${edad(h, ahoraMs)}` : null,
            // La línea que convierte el dato en decisión: no es "esto tiene likes", es "esto tiene
            // más likes de los que esta cuenta suele tener".
            ratio != null ? `${ratio >= 10 ? '🟢' : '🟡'} ${ratio} likes/mil seg.` : null,
            (h.temas || [])[0] || null,
            h.busquedaEtiqueta || null,
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
  // esto el mensaje llega como "mensaje sin texto" justo donde más falta hace leerlo de un vistazo.
  const resumen = elegidos
    .slice(0, 2)
    .map((h) => unaLinea(h.texto, 60))
    .join(' · ');

  return {
    text: `𝕏 Radar de X: ${nuevos} nuevos${resumen ? ` · ${resumen}` : ''}`,
    blocks: bloques,
    // Sin vista previa: Slack despliega una tarjeta con miniatura por cada enlace y con dos
    // hallazgos ocupan más pantalla que el mensaje entero. El texto ya es el enlace.
    unfurl_links: false,
    unfurl_media: false,
  };
}

export { enviarSlack };

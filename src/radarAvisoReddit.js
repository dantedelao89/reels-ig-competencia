// El mensaje diario del radar de Reddit a Slack. Mismo canal y mismo webhook que los otros dos.
//
// ## Por qué este NO ordena por velocidad, y los otros sí
//
// En YouTube ordena vistas/hora y en X likes/hora, porque ahí la velocidad separa lo que despega
// de lo que no. En Reddit no, y es consecuencia directa de buscar en `rising`: medido el 27 oct
// 2026, los posts que trae tienen **1, 3 o 5 upvotes**, porque los coge antes de que exploten. Una
// velocidad calculada sobre 3 upvotes es ruido con decimales, y ordenar por ella pondría arriba al
// que lleva veinte minutos publicado en vez de al que importa.
//
// Lo que importa en Reddit es el TÍTULO. «Halloween 🎃 Wan 3.0 vs Kling 4.0» y «Kling 4.0 is quite
// a good cheaper alternative to Seedance 2.5» valen por lo que DICEN —un número de versión, una
// comparación ya hecha— y eso no se mide en upvotes por hora. Así que el resumen va agrupado por
// SUBREDDIT, que es la otra mitad de la información: r/Seedance_AI diciendo algo de Seedance no es
// lo mismo que r/aivideo diciéndolo.
//
// Se guarda la velocidad en la base igual, por coherencia con las otras plataformas, pero nadie
// debería construir un umbral de aviso encima.

import { enviarSlack } from './radarAviso.js';

function edad(h, ahoraMs) {
  if (!h.fecha) return null;
  const horas = (ahoraMs - new Date(h.fecha).getTime()) / 3_600_000;
  if (horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas < 48) return `${horas.toFixed(1)} h`;
  return `${Math.round(horas / 24)} d`;
}

export function unaLinea(texto, max = 150) {
  const limpio = String(texto || 'sin título')
    .replace(/\s+/g, ' ')
    .replace(/[<>&]/g, ' ')
    .trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

// Lo que entra: hallazgos nuevos, recientes, y REPARTIDOS ENTRE SUBREDDITS.
//
// El reparto es el mismo truco que `repartirPorTema` en YouTube y por el mismo motivo, solo que
// aquí el eje es la comunidad: sin él, un subreddit activo (r/StableDiffusion publica decenas de
// posts al día) se come la lista entera y los subreddits dedicados por modelo —que son el hallazgo
// que justificó meter Reddit— no aparecerían nunca.
export function elegirParaResumenReddit(nuevos, { maxHoras = 48, cuantos = 10, ahoraMs = Date.now() } = {}) {
  const frescos = (nuevos || [])
    .filter((h) => h.url)
    .filter((h) => {
      if (!h.fecha) return false;
      const horas = (ahoraMs - new Date(h.fecha).getTime()) / 3_600_000;
      return horas >= 0 && horas <= maxHoras;
    })
    // Dentro de cada comunidad manda el que más votos tiene; entre comunidades manda el reparto.
    .sort((a, b) => (b.likes || 0) - (a.likes || 0));

  const colas = new Map();
  for (const h of frescos) {
    const k = h.nombre || '—';
    if (!colas.has(k)) colas.set(k, []);
    colas.get(k).push(h);
  }
  const salida = [];
  const usados = new Set();
  // Dos vueltas: primero el mejor de cada subreddit, después el segundo de cada uno.
  for (let vuelta = 0; vuelta < 2 && salida.length < cuantos; vuelta += 1) {
    for (const cola of colas.values()) {
      if (salida.length >= cuantos) break;
      const h = cola[vuelta];
      if (h && !usados.has(h.id)) {
        usados.add(h.id);
        salida.push(h);
      }
    }
  }
  // Relleno: una lista corta es peor que una algo repetida.
  for (const h of frescos) {
    if (salida.length >= cuantos) break;
    if (!usados.has(h.id)) {
      usados.add(h.id);
      salida.push(h);
    }
  }
  return salida;
}

export function formatearResumenReddit(elegidos, { consultas, nuevos, subreddits, ahoraMs = Date.now() } = {}) {
  const bloques = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `👽 Reddit · ${nuevos} posts nuevos`, emoji: true },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            `${consultas} consultas · ${nuevos} nuevos · se muestran ${elegidos.length}`,
            subreddits ? `${subreddits} subreddits` : null,
            // Se dice en el mensaje para que nadie espere métricas grandes y piense que falla:
            // `rising` coge los posts temprano, y temprano significa pocos votos.
            'de lo que está SUBIENDO, no de lo más votado',
          ]
            .filter(Boolean)
            .join(' · '),
        },
      ],
    },
    { type: 'divider' },
  ];

  // Agrupado por subreddit, conservando el orden del reparto: así se lee «qué dice cada comunidad»
  // en vez de una lista plana donde el subreddit es un dato más al final de la línea.
  const porComunidad = new Map();
  for (const h of elegidos) {
    const k = h.nombre || '—';
    if (!porComunidad.has(k)) porComunidad.set(k, []);
    porComunidad.get(k).push(h);
  }

  for (const [comunidad, posts] of porComunidad) {
    bloques.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${comunidad}*\n${posts
          .map((h) => {
            const metricas = [
              `↑${(h.likes || 0).toLocaleString('es-MX')}`,
              h.comentarios != null ? `${h.comentarios} cm` : null,
              // 1.0 es consenso y 0.6 es polémica. Es la señal de calidad propia de Reddit y hace
              // el papel que en X hacen los seguidores; solo se enseña cuando dice algo (<1).
              h.ratio != null && h.ratio < 1 ? `${Math.round(h.ratio * 100)}% a favor` : null,
              edad(h, ahoraMs) ? `hace ${edad(h, ahoraMs)}` : null,
              (h.temas || [])[0] || null,
            ]
              .filter(Boolean)
              .join(' · ');
            return `• <${h.url}|${unaLinea(h.titulo || h.texto)}>\n   _${metricas}_`;
          })
          .join('\n')}`,
      },
    });
    bloques.push({ type: 'divider' });
  }
  bloques.pop();

  const resumen = elegidos
    .slice(0, 2)
    .map((h) => unaLinea(h.titulo || h.texto, 60))
    .join(' · ');

  return {
    text: `👽 Reddit: ${nuevos} nuevos${resumen ? ` · ${resumen}` : ''}`,
    blocks: bloques,
    unfurl_links: false,
    unfurl_media: false,
  };
}

export { enviarSlack };

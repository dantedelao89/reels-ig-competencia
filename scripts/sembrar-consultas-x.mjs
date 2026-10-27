// Siembra (o actualiza) las consultas del radar de X y las deja encendidas.
//
// Por qué un script y no escribirlas a mano en Supabase: las consultas son el radar. Dejarlas en un
// archivo versionado hace que se pueda ver POR QUÉ está cada una, volver a sembrarlas si alguien
// las borra, y discutir un cambio en un diff en vez de en la memoria de nadie.
//
//   node scripts/sembrar-consultas-x.mjs            # enseña qué haría, sin escribir
//   node scripts/sembrar-consultas-x.mjs --escribir # lo aplica
//
// Las consultas van en el dialecto de búsqueda de X (el mismo de la caja de búsqueda), que es lo
// que `danek/twitter-scraper` recibe tal cual en su ruta `query`.
//
// ## Dos cosas medidas que explican la forma de todo esto
//
// 1. **Nada de hashtags.** Medido el 7 sep 2026 con los seis hashtags obvios del nicho: 40 de 40
//    resultados por debajo de 10 likes, y con `min_faves:100` la mediana subía a 193 pero el
//    contenido era fan art — **`#ia` en X es IA, un personaje de Vocaloid**, y `#prompt` lo dominan
//    los que generan imágenes. La fila «Hashtags IA» se queda en la base y APAGADA: es el registro
//    de algo que se probó y no funcionó, y borrarla invitaría a volver a intentarlo.
// 2. **Un `min_faves` por consulta, no uno global.** El umbral no mide calidad, mide el tamaño de la
//    conversación de ESE tema. 300 likes es ruido de fondo en un lanzamiento de OpenAI y es un éxito
//    en español, donde el nicho es mucho más pequeño.
//
// ## Por qué los modelos van agrupados con OR y no una consulta por modelo
//
// Cada consulta es una corrida de Apify y el actor redondea de 20 en 20 resultados, así que once
// modelos en once consultas cuestan once veces lo mismo que once modelos en tres. Agrupados, el
// radar cuesta ~$0.033 por pasada (≈$1/mes a una pasada diaria). Cada hallazgo guarda igual de qué
// consulta salió, y el TEMA lo pone el clasificador por alias, no la consulta, así que agrupar no
// pierde información.

import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';

// `alias` no se escribe en la base: documenta contra qué alias de `radar_temas` casa cada consulta,
// que es lo que hace que el hallazgo llegue con tema y no en blanco.
const CONSULTAS = [
  {
    etiqueta: 'Claude y OpenAI (EN)',
    consulta:
      '(anthropic OR "claude code" OR openai OR chatgpt) (launch OR release OR update OR "new model" OR announcing) min_faves:400 -filter:replies -filter:retweets lang:en',
    maxPorCorrida: 20,
    // La mejor de las seis, medida: mediana 52 likes/h y máximo 771 (@gdb, el presidente de OpenAI,
    // «Announcing three major scientific discoveries»), con «OpenAI has released GPT-6.1 Terra» de
    // @artificialanlys dentro de los primeros. `min_faves` más alto justo aquí porque son las
    // cuentas más grandes del nicho: con 200 la consulta se llena de conversación rutinaria.
    porQue: 'los dos laboratorios cuyos lanzamientos mueven todo lo demás; la de mejor señal medida',
    alias: ['anthropic', 'claude code', 'openai', 'chatgpt'],
  },
  {
    etiqueta: 'Video IA · modelos (EN)',
    consulta:
      '(seedance OR higgsfield OR hailuo OR "kling ai" OR "veo 3" OR "sora 2" OR "openai sora" OR runwayml) min_faves:150 -filter:replies -filter:retweets lang:en',
    maxPorCorrida: 20,
    // Los nombres van DESAMBIGUADOS, y eso no es estilo: con `sora` y `runway` a secas, medido el
    // 27 oct 2026, 17 de 20 resultados eran basura — cinco tweets de una actriz llamada Charlotte,
    // «kazui will find his uncle sora» (Sora es un personaje de anime) y «the runway is calling»
    // (una pasarela de moda). Es el mismo fallo que los hashtags, con otro disfraz. Con los nombres
    // calificados, 18 de 20 pasaron a ser del nicho.
    porQue: 'los modelos de video, que es donde salen las versiones nuevas',
    alias: ['sora', 'veo 3', 'kling', 'runway', 'higgsfield', 'seedance'],
  },
  {
    etiqueta: 'Avatares, voz y anuncios IA (EN)',
    consulta:
      '(heygen OR elevenlabs OR arcads OR "ai avatar" OR "ai ugc" OR "ai ads") min_faves:100 -filter:replies -filter:retweets lang:en',
    maxPorCorrida: 20,
    // Medida: máximo 949 likes/h y «Maya-2 voice model weights are officially live» entre los
    // primeros. Umbral más bajo porque es un nicho dentro del nicho: herramientas de marketing, no
    // modelos de los que hable todo el mundo.
    porQue: 'la parte del nicho que se monetiza: avatares, voz y UGC con IA',
    alias: ['heygen', 'ai ugc', 'ugc ai', 'ai ads', 'avatar ai'],
  },
  {
    etiqueta: 'Lanzamientos IA (EN)',
    consulta:
      '("just released" OR "just launched" OR "introducing") ("AI model" OR LLM OR "AI video" OR "video model" OR "image model" OR "open source model") min_faves:200 -filter:replies -filter:retweets lang:en',
    maxPorCorrida: 20,
    // Reescrita el 27 oct 2026. La versión vieja pedía `(AI OR LLM OR model)`, y medida traía
    // mitad cripto: infraestructura de opciones en Injective, 20.000 satélites, Lightning Labs.
    // «model» casa con cualquier cosa y los proyectos de cripto dicen «AI» todo el tiempo. Pidiendo
    // la frase completa («AI model», «video model») desapareció el ruido y aparecieron lanzamientos
    // de verdad: «Introducing Topview T1» y «Introducing FLUX 3 Max» de @fal.
    //
    // OJO: es la consulta más valiosa y la más LENTA. Esos dos lanzamientos van a 8 likes/hora,
    // así que nunca cruzan el umbral del 🔥. Por eso el resumen de Slack no filtra por velocidad.
    porQue: 'lanzamientos de herramientas del nicho, aunque no despeguen',
    alias: ['—  (el tema lo pone el nombre del modelo que aparezca en el texto)'],
  },
  {
    etiqueta: 'Imagen IA · modelos (EN)',
    consulta:
      '("nano banana" OR "gpt image" OR midjourney OR "flux kontext") min_faves:150 -filter:replies -filter:retweets lang:en',
    maxPorCorrida: 20,
    // `flux` a secas se descartó sin medirlo: hay un proyecto de cripto con ese nombre y la lección
    // de `sora` ya estaba aprendida. `flux kontext` es el modelo.
    porQue: 'los modelos de imagen; «nano banana» y «gpt image» son temas suyos',
    alias: ['nano banana', 'gpt image'],
  },
  {
    etiqueta: 'IA en español',
    consulta:
      '(seedance OR "kling ai" OR "nano banana" OR "veo 3" OR "gpt image" OR "anuncios con ia") min_faves:100 -filter:replies -filter:retweets lang:es',
    maxPorCorrida: 20,
    // La más floja de las seis, y conviene saberlo antes de esperar nada de ella. Medido el 27 oct
    // 2026, dos intentos:
    //   - Con `"inteligencia artificial"` dentro trajo POLÍTICA: «LA BACANAL DE PETRO», «Trump
    //     falló en todo». En X en español ese término es comentario de noticias, no nicho.
    //   - Con `"video con ia"` dentro trajo BURLA: «gastarían menos agua si hicieran un video con
    //     IA», «ese video con ia es lo peor». La frase ya es coloquial.
    // Lo que quedó —nombres de modelos y `min_faves:100`— sí rinde, pero poco: el hallazgo bueno
    // del día fue uno (@raul_ia_prod, 3.468 likes) más un lanzamiento (@nicogarcia_ia, «Google
    // acaba de LIBERAR la generación de video»). La señal fuerte en español vive en YouTube, que
    // ya se cubre gratis y cada hora.
    porQue: 'su idioma, aunque en X el nicho hispanohablante es delgado',
    alias: ['seedance', 'kling', 'nano banana', 'veo 3', 'gpt image', 'anuncios con ia'],
  },
];

// Se queda en la base y apagada a propósito. Ver la nota 1 de arriba.
const DEJAR_APAGADAS = ['Hashtags IA'];

const escribir = process.argv.includes('--escribir');

const c = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  db: { schema: process.env.SUPABASE_SCHEMA || 'public' },
});

const { data: existentes, error } = await c
  .from(config.radarBusquedasTable)
  .select('id,etiqueta,consulta,activo,max_por_corrida')
  .eq('plataforma', 'x');
if (error) throw new Error(error.message);

const porEtiqueta = new Map((existentes || []).map((r) => [r.etiqueta, r]));
const plan = [];

for (const q of CONSULTAS) {
  const ya = porEtiqueta.get(q.etiqueta);
  if (!ya) {
    plan.push({ accion: 'CREAR', etiqueta: q.etiqueta, q });
  } else if (ya.consulta !== q.consulta || ya.activo !== true || ya.max_por_corrida !== q.maxPorCorrida) {
    plan.push({ accion: 'ACTUALIZAR', etiqueta: q.etiqueta, id: ya.id, q, antes: ya });
  } else {
    plan.push({ accion: 'ya está igual', etiqueta: q.etiqueta });
  }
}
for (const etiqueta of DEJAR_APAGADAS) {
  const ya = porEtiqueta.get(etiqueta);
  if (ya && ya.activo) plan.push({ accion: 'APAGAR', etiqueta, id: ya.id });
}

for (const p of plan) console.log(`${p.accion.padEnd(13)} ${p.etiqueta}`);

if (!escribir) {
  console.log('\n(ensayo: nada escrito. Añade --escribir para aplicarlo)');
  process.exit(0);
}

for (const p of plan) {
  if (p.accion === 'CREAR') {
    const { error: e } = await c.from(config.radarBusquedasTable).insert({
      plataforma: 'x',
      consulta: p.q.consulta,
      etiqueta: p.q.etiqueta,
      max_por_corrida: p.q.maxPorCorrida,
      activo: true,
    });
    if (e) throw new Error(`${p.etiqueta}: ${e.message}`);
  } else if (p.accion === 'ACTUALIZAR') {
    const { error: e } = await c
      .from(config.radarBusquedasTable)
      .update({ consulta: p.q.consulta, max_por_corrida: p.q.maxPorCorrida, activo: true })
      .eq('id', p.id);
    if (e) throw new Error(`${p.etiqueta}: ${e.message}`);
  } else if (p.accion === 'APAGAR') {
    const { error: e } = await c
      .from(config.radarBusquedasTable)
      .update({ activo: false })
      .eq('id', p.id);
    if (e) throw new Error(`${p.etiqueta}: ${e.message}`);
  }
}

const { data: finales } = await c
  .from(config.radarBusquedasTable)
  .select('etiqueta,activo')
  .eq('plataforma', 'x')
  .order('etiqueta');
console.log('\nEstado final de las consultas de X:');
for (const r of finales || []) console.log(`  ${r.activo ? '[ON ]' : '[off]'} ${r.etiqueta}`);

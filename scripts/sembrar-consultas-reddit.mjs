// Siembra las búsquedas del radar de Reddit y las deja encendidas.
//
//   node scripts/sembrar-consultas-reddit.mjs            # ensayo
//   node scripts/sembrar-consultas-reddit.mjs --escribir # lo aplica
//
// ⚠️ ANTES hay que correr `artefactos/radar-reddit.sql` en Supabase. Las dos tablas del radar
// tienen un CHECK que enumera las plataformas permitidas y rechaza 'rd'; sin eso, el insert falla
// con `violates check constraint "radar_busquedas_plataforma_check"`. Este script lo detecta y lo
// dice en vez de dejar un error de Postgres a secas.
//
// ## Por qué Reddit, y por qué estas búsquedas
//
// El resto del sistema mira RESULTADOS —videos que ya existen—, así que llega después. Reddit mira
// conversación. Medido el 27 oct 2026 en una sola corrida: «Halloween 🎃 Wan 3.0 vs Kling 4.0» y
// «Kling 4.0 is quite a good cheaper alternative to Seedance 2.5», con números de versión y
// comparaciones ya hechas, cuando ningún canal oficial había publicado nada todavía.
//
// Las búsquedas son NOMBRES DE MODELO y no categorías, por lo mismo que en el radar de YouTube: los
// temas de Dante son nombres (`radar_temas`), así que buscar el nombre es buscar el tema, y además
// el nombre es lo que aparece en el título del post, que es de donde sale la señal.
//
// Van en INGLÉS y sin versión en español (Dante, 27 oct 2026: «enfócate en inglés, que son los
// primeros que sacan las tendencias»). En Reddit eso además no cuesta nada decidirlo: el nicho de
// IA generativa allí es anglófono casi por completo.
//
// ## Ojo: en Reddit cada búsqueda CUESTA, y el tope es de la corrida completa
//
// Todas las búsquedas van en UNA corrida de Apify (el arranque son $0.04 y pagarlo seis veces sería
// tirar dinero), pero el actor abre cada post con un navegador para sacar los upvotes, así que el
// costo sube con el número de posts, no con el de búsquedas. `max_por_corrida` de cada fila se SUMA
// para formar el `maxItems` de la corrida: seis filas de 5 son 30 posts.

import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';

const CONSULTAS = [
  {
    etiqueta: 'Seedance (RD)',
    consulta: 'seedance',
    // El modelo que salió en TODAS las pruebas del día, en X y en Reddit. Tiene subreddit propio
    // (r/Seedance_AI) que el sistema no miraba.
    porQue: 'el modelo de video del momento; r/Seedance_AI es suyo',
  },
  {
    etiqueta: 'Kling (RD)',
    consulta: 'kling ai',
    // «kling ai» y no «kling»: en Reddit `kling` a secas trae apellidos alemanes. Misma lección que
    // `sora` en X, donde 17 de 20 resultados eran de un personaje de anime.
    porQue: 'r/KlingAI_Videos; de aquí salió «Kling 4.0» antes de que hubiera videos',
  },
  {
    etiqueta: 'Sora (RD)',
    consulta: 'sora 2',
    // Calificado por lo mismo: `sora` es un nombre propio japonés y un personaje de videojuego.
    porQue: 'el de OpenAI, calificado para no traer anime',
  },
  {
    etiqueta: 'Veo (RD)',
    consulta: 'google veo',
    // `veo 3` se probó y se cayó: Reddit no respeta la frase entera, así que casó con «VEO» solo y
    // trajo «A realization after getting a VEO from Microsoft» desde r/hyderabad. `google veo`
    // obliga a que aparezca Google.
    porQue: 'el de Google; «veo 3» medido trae VEO como siglas de otra cosa',
  },
  {
    etiqueta: 'Nano Banana (RD)',
    consulta: 'nano banana',
    porQue: 'imagen; es tema propio suyo en radar_temas',
  },
  {
    etiqueta: 'Claude Code (RD)',
    consulta: 'claude code',
    porQue: 'su tema más publicado, y en Reddit es donde se discuten las versiones',
  },
];

// Cuántos posts pide cada búsqueda. Se SUMAN para el `maxItems` de la corrida. Cinco por búsqueda
// son 30 posts, que es lo medido como una pasada razonable.
const POSTS_POR_BUSQUEDA = 5;

const escribir = process.argv.includes('--escribir');
const c = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  db: { schema: process.env.SUPABASE_SCHEMA || 'public' },
});

const { data: existentes, error } = await c
  .from(config.radarBusquedasTable)
  .select('id,etiqueta,consulta,activo,max_por_corrida')
  .eq('plataforma', 'rd');
if (error) throw new Error(error.message);

const porEtiqueta = new Map((existentes || []).map((r) => [r.etiqueta, r]));
const plan = [];
for (const q of CONSULTAS) {
  const ya = porEtiqueta.get(q.etiqueta);
  if (!ya) plan.push({ accion: 'CREAR', q });
  else if (ya.consulta !== q.consulta || ya.activo !== true || ya.max_por_corrida !== POSTS_POR_BUSQUEDA)
    plan.push({ accion: 'ACTUALIZAR', id: ya.id, q });
  else plan.push({ accion: 'ya está igual', q });
}

for (const p of plan) console.log(`${p.accion.padEnd(13)} ${p.q.etiqueta.padEnd(20)} :: ${p.q.consulta}`);

if (!escribir) {
  console.log('\n(ensayo: nada escrito. Añade --escribir para aplicarlo)');
  process.exit(0);
}

for (const p of plan) {
  if (p.accion === 'ya está igual') continue;
  const fila = {
    plataforma: 'rd',
    consulta: p.q.consulta,
    etiqueta: p.q.etiqueta,
    max_por_corrida: POSTS_POR_BUSQUEDA,
    activo: true,
  };
  const { error: e } =
    p.accion === 'CREAR'
      ? await c.from(config.radarBusquedasTable).insert(fila)
      : await c.from(config.radarBusquedasTable).update(fila).eq('id', p.id);
  if (e) {
    if (/plataforma_check/.test(e.message)) {
      console.error(
        '\n❌ La base todavía no acepta la plataforma «rd».\n' +
          '   Corre primero `artefactos/radar-reddit.sql` en el editor SQL de Supabase\n' +
          '   (amplía los dos CHECK de `radar` y `radar_busquedas`) y vuelve a lanzar esto.'
      );
      process.exit(1);
    }
    throw new Error(`${p.q.etiqueta}: ${e.message}`);
  }
}

const { data: final } = await c
  .from(config.radarBusquedasTable)
  .select('etiqueta,activo,max_por_corrida')
  .eq('plataforma', 'rd')
  .order('etiqueta');
const total = (final || []).filter((f) => f.activo).reduce((a, f) => a + (f.max_por_corrida || 0), 0);
console.log(`\nConsultas de Reddit (${(final || []).filter((f) => f.activo).length} activas · ${total} posts por pasada):`);
for (const f of final || []) console.log(`  ${f.activo ? '[ON ]' : '[off]'} ${f.etiqueta}`);

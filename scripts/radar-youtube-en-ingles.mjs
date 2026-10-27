// Pone el radar de YouTube a buscar en INGLÉS y apaga las consultas en español y portugués.
//
//   node scripts/radar-youtube-en-ingles.mjs            # ensayo
//   node scripts/radar-youtube-en-ingles.mjs --escribir # lo aplica
//
// Decisión de Dante el 27 oct 2026: «X y youtube no te enfoques en español, enfócate en inglés,
// que son los primeros que sacan las tendencias». Tiene razón y está en los datos del proyecto: la
// ola de Claude Duet reconstruida desde la base da −0.5 h para el primero en inglés y **+3.0 h
// para el primero en español**. Si el radar mira primero en inglés, ve la ola tres horas antes.
//
// ## Cómo se dice el idioma (y por qué no hay columna de idioma)
//
// `streamers/youtube-scraper` no tiene parámetro de idioma, y el actor ignora `hl`/`gl` y el país
// del proxy (todo medido el 21 oct 2026). Lo único que funciona es el idioma del TEXTO de la
// consulta... y el locale con el que se pide la página en el radar libre, que sale del SUFIJO de la
// etiqueta: `nano banana · en` busca en inglés, `· en,es` en los dos. Por eso aquí se cambia la
// etiqueta y, donde hace falta, el texto (`capcut ia` → `capcut ai`).
//
// ## Qué se apaga y qué NO se borra
//
// Las filas en español y portugués se APAGAN, no se borran: siguen siendo el registro de qué se
// buscó y la referencia (`busqueda_id`) de los hallazgos que ya entraron por ellas. Volver al
// español es encenderlas y ponerles el sufijo, no escribirlas otra vez.
//
// ⚠️ Consecuencia que conviene tener presente: el aviso de YouTube cuenta cuántos videos del tema
// hay ya en español para decir si el hueco sigue abierto («🟢 Nadie lo ha hecho en español
// todavía»). Sin consultas en español ese contador no puede ver, así que esa línea DESAPARECE del
// aviso en vez de afirmar un hueco que no se ha medido.

import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';

// Los temas que quedan ENCENDIDOS, todos en inglés. El texto es el que ya estaba midiendo bien;
// solo cambia el sufijo de la etiqueta (y el texto de los dos que estaban escritos en español).
const EN_INGLES = [
  // Modelos de video e imagen: estaban como `· en,es` y pasan a `· en`.
  { etiqueta: 'arcads · en' },
  { etiqueta: 'chatgpt · en' },
  { etiqueta: 'elevenlabs · en' },
  { etiqueta: 'google veo · en' },
  { etiqueta: 'gpt image · en' },
  { etiqueta: 'hailuo · en' },
  { etiqueta: 'heygen · en' },
  { etiqueta: 'higgsfield · en' },
  { etiqueta: 'kling · en' },
  { etiqueta: 'midjourney · en' },
  { etiqueta: 'nano banana · en' },
  { etiqueta: 'runway · en' },
  { etiqueta: 'seedance · en' },
  { etiqueta: 'sora · en' },
  // Estas dos estaban SOLO en español, con el texto en español. Se traducen.
  { etiqueta: 'capcut · en', consulta: 'capcut ai', antes: 'capcut · es' },
  { etiqueta: 'topview · en', consulta: 'topview ai', antes: 'topview · es' },
  // Estas siete ya estaban escritas en inglés pero APAGADAS, así que el radar no las corría desde
  // que empezó a respetar `activo`. Son temas suyos que ahora sí se miran: Claude Code, las skills
  // de Claude, Google Flow y la parte de anuncios.
  { etiqueta: 'claude · en' },
  { etiqueta: 'claude code · en' },
  { etiqueta: 'claude skills · en' },
  { etiqueta: 'google flow · en' },
  { etiqueta: 'ai ads · en' },
  { etiqueta: 'ai influencer · en' },
  { etiqueta: 'ugc ads · en' },
];

// `grokbot` lo añadió Dante desde Fuentes y no tiene etiqueta, así que hereda el idioma por
// defecto, que desde hoy es inglés. Se deja encendido sin tocarlo.
const SIN_ETIQUETA_SE_QUEDAN = ['grokbot'];

const escribir = process.argv.includes('--escribir');
const c = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  db: { schema: process.env.SUPABASE_SCHEMA || 'public' },
});

const { data: filas, error } = await c
  .from(config.radarBusquedasTable)
  .select('id,etiqueta,consulta,activo')
  .eq('plataforma', 'yt');
if (error) throw new Error(error.message);

// Índice por etiqueta Y por consulta: las filas que cambian de etiqueta hay que encontrarlas por
// la etiqueta vieja la primera vez y por la nueva si el script se vuelve a correr.
const porEtiqueta = new Map(filas.filter((f) => f.etiqueta).map((f) => [f.etiqueta, f]));
const plan = [];
const tocadas = new Set();

for (const q of EN_INGLES) {
  const fila = porEtiqueta.get(q.etiqueta) || (q.antes ? porEtiqueta.get(q.antes) : null)
    // Un tema que estaba como `· en,es` se busca por su nombre base.
    || filas.find((f) => f.etiqueta && f.etiqueta.replace(/\s*·.*$/, '') === q.etiqueta.replace(/\s*·.*$/, ''));
  if (!fila) {
    plan.push({ accion: 'NO EXISTE', etiqueta: q.etiqueta });
    continue;
  }
  tocadas.add(fila.id);
  const cambios = {};
  if (fila.etiqueta !== q.etiqueta) cambios.etiqueta = q.etiqueta;
  if (q.consulta && fila.consulta !== q.consulta) cambios.consulta = q.consulta;
  if (fila.activo !== true) cambios.activo = true;
  plan.push(
    Object.keys(cambios).length
      ? { accion: 'ENCENDER EN', id: fila.id, etiqueta: `${fila.etiqueta} → ${q.etiqueta}`, cambios }
      : { accion: 'ya está', etiqueta: q.etiqueta }
  );
}

for (const f of filas) {
  if (tocadas.has(f.id)) continue;
  if (!f.etiqueta && SIN_ETIQUETA_SE_QUEDAN.includes(f.consulta)) {
    plan.push({ accion: 'se queda', etiqueta: `${f.consulta} (sin etiqueta → inglés)` });
    continue;
  }
  if (f.activo) plan.push({ accion: 'APAGAR', id: f.id, etiqueta: f.etiqueta || f.consulta });
  else plan.push({ accion: 'ya apagada', etiqueta: f.etiqueta || f.consulta });
}

for (const p of plan) console.log(`${p.accion.padEnd(13)} ${p.etiqueta}`);

if (!escribir) {
  console.log('\n(ensayo: nada escrito. Añade --escribir para aplicarlo)');
  process.exit(0);
}

for (const p of plan) {
  if (p.accion === 'ENCENDER EN') {
    const { error: e } = await c.from(config.radarBusquedasTable).update(p.cambios).eq('id', p.id);
    if (e) throw new Error(`${p.etiqueta}: ${e.message}`);
  } else if (p.accion === 'APAGAR') {
    const { error: e } = await c
      .from(config.radarBusquedasTable)
      .update({ activo: false })
      .eq('id', p.id);
    if (e) throw new Error(`${p.etiqueta}: ${e.message}`);
  }
}

const { data: final } = await c
  .from(config.radarBusquedasTable)
  .select('etiqueta,consulta,activo')
  .eq('plataforma', 'yt')
  .order('etiqueta');
const activas = (final || []).filter((f) => f.activo);
console.log(`\nActivas: ${activas.length} de ${final.length}`);
for (const f of activas) console.log(`  [ON ] ${f.etiqueta || f.consulta + ' (sin etiqueta)'}`);

// Backfill: vuelca el histórico de Fuentes de Airtable (Creadores, Canales YT, Búsquedas YT,
// Anunciantes) a las tablas nuevas de Supabase (ig_creators, yt_channels, yt_searches,
// fb_advertisers) una sola vez. Idempotente (upsert por la key única de cada tabla). Incluye
// fuentes inactivas también (no filtra por Activo).
//
// Uso:  node src/backfillSourcesSupabase.js

import Airtable from 'airtable';
import { config } from './config.js';
import { supabaseEnabled, upsertRows } from './supabase.js';

const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);

function num(v) {
  return v === undefined || v === null || v === '' ? null : Number(v);
}
function str(v) {
  return v === undefined || v === null || v === '' ? null : v.toString().trim();
}

// Airtable puede tener filas duplicadas por la misma key (re-altas manuales, mayúsculas distintas,
// etc.) — Postgres rechaza el upsert si el mismo batch trae la key repetida ("ON CONFLICT DO UPDATE
// command cannot affect row a second time"). Nos quedamos con la última (más reciente en la lectura).
function dedupeByKey(rows, key) {
  const byKey = new Map();
  for (const r of rows) byKey.set(r[key].toLowerCase(), r);
  const deduped = [...byKey.values()];
  if (deduped.length < rows.length) {
    console.log(`[backfill Fuentes] ${rows.length - deduped.length} duplicados por "${key}" descartados`);
  }
  return deduped;
}

async function backfillCreators() {
  const rows = [];
  await base(config.creatorsTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const username = str(r.get('Username'))?.replace(/^@/, '');
        if (!username) continue;
        rows.push({
          username,
          activo: !!r.get('Activo'),
          proyecto: str(r.get('Proyecto')),
          reels_por_corrida: num(r.get('Reels por corrida')),
          ultima_corrida: r.get('Última corrida') || null,
        });
      }
      next();
    });
  const n = await upsertRows(config.igCreatorsTable, dedupeByKey(rows, 'username'), 'username');
  console.log(`[backfill Fuentes] ${n} creadores IG volcados a Supabase`);
  return n;
}

async function backfillChannels() {
  const rows = [];
  await base(config.channelsTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const canalUrl = str(r.get('Canal'));
        if (!canalUrl) continue;
        rows.push({
          canal_url: canalUrl,
          activo: !!r.get('Activo'),
          proyecto: str(r.get('Proyecto')),
          videos_por_corrida: num(r.get('Videos por corrida')),
          shorts_por_corrida: num(r.get('Shorts por corrida')),
          ultima_corrida: r.get('Última corrida') || null,
        });
      }
      next();
    });
  const n = await upsertRows(config.ytChannelsTable, dedupeByKey(rows, 'canal_url'), 'canal_url');
  console.log(`[backfill Fuentes] ${n} canales YT volcados a Supabase`);
  return n;
}

async function backfillSearches() {
  const rows = [];
  await base(config.searchesTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const busqueda = str(r.get('Búsqueda'));
        if (!busqueda) continue;
        rows.push({
          busqueda,
          activo: !!r.get('Activo'),
          proyecto: str(r.get('Proyecto')),
          videos_por_busqueda: num(r.get('Videos por búsqueda')),
          shorts_por_busqueda: num(r.get('Shorts por búsqueda')),
          ultima_corrida: r.get('Última corrida') || null,
        });
      }
      next();
    });
  const n = await upsertRows(config.ytSearchesTable, dedupeByKey(rows, 'busqueda'), 'busqueda');
  console.log(`[backfill Fuentes] ${n} búsquedas YT volcadas a Supabase`);
  return n;
}

async function backfillAdvertisers() {
  const rows = [];
  await base(config.advertisersTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const url = str(r.get('URL'));
        if (!url) continue;
        rows.push({
          url,
          marca: str(r.get('Marca')),
          activo: !!r.get('Activo'),
          proyecto: str(r.get('Proyecto')),
          anuncios_por_corrida: num(r.get('Anuncios por corrida')),
          ultima_corrida: r.get('Última corrida') || null,
        });
      }
      next();
    });
  const n = await upsertRows(config.fbAdvertisersTable, dedupeByKey(rows, 'url'), 'url');
  console.log(`[backfill Fuentes] ${n} anunciantes volcados a Supabase`);
  return n;
}

async function main() {
  if (!supabaseEnabled()) {
    console.error('Supabase no está configurado (faltan SUPABASE_URL / SUPABASE_SERVICE_KEY).');
    process.exit(1);
  }
  await backfillCreators();
  await backfillChannels();
  await backfillSearches();
  await backfillAdvertisers();
  console.log('Backfill de Fuentes completo.');
}

main().catch((e) => {
  console.error('Backfill de Fuentes falló:', e.message);
  process.exit(1);
});

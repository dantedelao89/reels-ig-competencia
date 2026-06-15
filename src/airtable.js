// Capa de acceso a Airtable: lee creadores, los ShortCodes ya existentes,
// inserta reels nuevos en lotes y actualiza la fecha de "Última corrida".

import Airtable from 'airtable';
import { config } from './config.js';

const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);

// Lee los creadores marcados como Activo.
export async function getActiveCreators() {
  const creators = [];
  await base(config.creatorsTable)
    .select({ filterByFormula: '{Activo} = TRUE()' })
    .eachPage((records, next) => {
      for (const r of records) {
        const username = (r.get('Username') || '').toString().trim().replace(/^@/, '');
        if (!username) continue;
        creators.push({
          recordId: r.id,
          username,
          resultsLimit: Number(r.get('Reels por corrida')) || config.defaultResultsLimit,
          lastRun: r.get('Última corrida') || null,
        });
      }
      next();
    });
  return creators;
}

// Devuelve un Set con todos los ShortCode ya guardados (para dedupe global).
export async function getExistingShortCodes() {
  const set = new Set();
  await base(config.reelsTable)
    .select({ fields: ['ShortCode'] })
    .eachPage((records, next) => {
      for (const r of records) {
        const sc = r.get('ShortCode');
        if (sc) set.add(sc.toString());
      }
      next();
    });
  return set;
}

// Inserta reels nuevos. Airtable permite máximo 10 registros por llamada.
export async function insertReels(rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((fields) => ({ fields }));
    await base(config.reelsTable).create(batch, { typecast: true });
    inserted += batch.length;
  }
  return inserted;
}

export async function updateCreatorLastRun(recordId, isoDate) {
  await base(config.creatorsTable).update(recordId, { 'Última corrida': isoDate });
}

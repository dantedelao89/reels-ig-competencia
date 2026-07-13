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
          project: r.get('Proyecto') || '',
        });
      }
      next();
    });
  return creators;
}

// Busca UN creador por su Username (acepta con o sin @). Lo usa el scrape individual manual.
export async function getCreatorByUsername(usernameOrUrl) {
  const target = (usernameOrUrl || '').trim().replace(/^@/, '').toLowerCase();
  if (!target) return null;
  let found = null;
  await base(config.creatorsTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        const u = (r.get('Username') || '').toString().trim().replace(/^@/, '').toLowerCase();
        if (u && u === target) {
          found = {
            recordId: r.id,
            username: (r.get('Username') || '').toString().trim().replace(/^@/, ''),
            resultsLimit: Number(r.get('Reels por corrida')) || config.defaultResultsLimit,
            lastRun: r.get('Última corrida') || null,
            project: r.get('Proyecto') || '',
          };
        }
      }
      next();
    });
  return found;
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
// Devuelve los registros creados como [{ id, shortCode }].
export async function insertReels(rows) {
  const created = [];
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((fields) => ({ fields }));
    const recs = await base(config.reelsTable).create(batch, { typecast: true });
    for (const r of recs) created.push({ id: r.id, shortCode: r.get('ShortCode') });
  }
  return created;
}

export async function updateReelTranscription(recordId, text) {
  await base(config.reelsTable).update(recordId, { Transcripción: text });
}

export async function updateCreatorLastRun(recordId, isoDate) {
  await base(config.creatorsTable).update(recordId, { 'Última corrida': isoDate });
}

// Da de alta un creador nuevo como fuente activa (lo dispara el scrape manual por URL cuando el
// dueño del contenido todavía no era una fuente nuestra). Sin Proyecto: se puede asignar después.
export async function createCreator(username) {
  const recs = await base(config.creatorsTable).create(
    [{ fields: { Username: username, Activo: true } }],
    { typecast: true }
  );
  return { recordId: recs[0].id, username, resultsLimit: config.defaultResultsLimit, lastRun: null, project: '' };
}

// ---- YouTube (búsqueda por palabra clave) ----

// Lee las búsquedas marcadas como Activo.
export async function getActiveSearches() {
  const searches = [];
  await base(config.searchesTable)
    .select({ filterByFormula: '{Activo} = TRUE()' })
    .eachPage((records, next) => {
      for (const r of records) {
        const query = (r.get('Búsqueda') || '').toString().trim();
        if (!query) continue;
        searches.push({
          recordId: r.id,
          query,
          maxResults: Number(r.get('Videos por búsqueda')) || config.youtubeDefaultMaxResults,
          maxShorts: Number(r.get('Shorts por búsqueda')) || 0,
          lastRun: r.get('Última corrida') || null,
          project: r.get('Proyecto') || '',
        });
      }
      next();
    });
  return searches;
}

// Devuelve un Set con todos los Video ID ya guardados (para dedupe global).
export async function getExistingVideoIds() {
  const set = new Set();
  await base(config.videosTable)
    .select({ fields: ['Video ID'] })
    .eachPage((records, next) => {
      for (const r of records) {
        const id = r.get('Video ID');
        if (id) set.add(id.toString());
      }
      next();
    });
  return set;
}

// Inserta videos nuevos en lotes de 10.
export async function insertVideos(rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((fields) => ({ fields }));
    await base(config.videosTable).create(batch, { typecast: true });
    inserted += batch.length;
  }
  return inserted;
}

export async function updateSearchLastRun(recordId, isoDate) {
  await base(config.searchesTable).update(recordId, { 'Última corrida': isoDate });
}

// Lee los canales de YouTube marcados como Activo.
export async function getActiveChannels() {
  const channels = [];
  await base(config.channelsTable)
    .select({ filterByFormula: '{Activo} = TRUE()' })
    .eachPage((records, next) => {
      for (const r of records) {
        const channelUrl = (r.get('Canal') || '').toString().trim();
        if (!channelUrl) continue;
        channels.push({
          recordId: r.id,
          channelUrl,
          maxResults: Number(r.get('Videos por corrida')) || config.youtubeDefaultMaxResults,
          maxShorts: Number(r.get('Shorts por corrida')) || 0,
          lastRun: r.get('Última corrida') || null,
          project: r.get('Proyecto') || '',
        });
      }
      next();
    });
  return channels;
}

export async function updateChannelLastRun(recordId, isoDate) {
  await base(config.channelsTable).update(recordId, { 'Última corrida': isoDate });
}

// Da de alta un canal de YouTube nuevo como fuente activa (lo dispara el scrape manual por URL
// cuando el canal todavía no era una fuente nuestra). Sin Proyecto: se puede asignar después.
export async function createChannel(channelUrl) {
  const recs = await base(config.channelsTable).create(
    [{ fields: { Canal: channelUrl, Activo: true } }],
    { typecast: true }
  );
  return {
    recordId: recs[0].id,
    channelUrl,
    maxResults: config.youtubeDefaultMaxResults,
    maxShorts: 0,
    lastRun: null,
    project: '',
  };
}

// Busca un canal de YouTube por su URL (para el re-scrape manual de un solo canal).
export async function getChannelByUrl(url) {
  let found = null;
  const target = (url || '').trim();
  await base(config.channelsTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        if ((r.get('Canal') || '').toString().trim() === target) {
          found = {
            recordId: r.id,
            channelUrl: target,
            maxResults: Number(r.get('Videos por corrida')) || config.youtubeDefaultMaxResults,
            maxShorts: Number(r.get('Shorts por corrida')) || 0,
            lastRun: r.get('Última corrida') || null,
            project: r.get('Proyecto') || '',
          };
        }
      }
      next();
    });
  return found;
}

// Videos sin subtítulos (para backfill). Devuelve [{ recordId, videoId, url }].
export async function getVideosWithoutSubtitles() {
  const out = [];
  await base(config.videosTable)
    .select({ filterByFormula: '{Subtítulos} = ""', fields: ['Video ID', 'URL'] })
    .eachPage((records, next) => {
      for (const r of records) {
        const videoId = r.get('Video ID');
        const url = r.get('URL');
        if (videoId && url) out.push({ recordId: r.id, videoId: videoId.toString(), url: url.toString() });
      }
      next();
    });
  return out;
}

export async function updateVideoSubtitles(recordId, text) {
  await base(config.videosTable).update(recordId, { Subtítulos: text });
}

// ---- Ads (Meta Ad Library) ----

// Lee los anunciantes (páginas de Facebook) marcados como Activo.
export async function getActiveAdvertisers() {
  const advertisers = [];
  await base(config.advertisersTable)
    .select({ filterByFormula: '{Activo} = TRUE()' })
    .eachPage((records, next) => {
      for (const r of records) {
        const url = (r.get('URL') || '').toString().trim();
        if (!url) continue;
        advertisers.push({
          recordId: r.id,
          url,
          marca: r.get('Marca') || '',
          resultsLimit: r.get('Anuncios por corrida') ? Number(r.get('Anuncios por corrida')) : null,
          lastRun: r.get('Última corrida') || null,
          project: r.get('Proyecto') || '',
        });
      }
      next();
    });
  return advertisers;
}

// Set con todos los Ad ID ya guardados (dedupe global).
export async function getExistingAdIds() {
  const set = new Set();
  await base(config.adsTable)
    .select({ fields: ['Ad ID'] })
    .eachPage((records, next) => {
      for (const r of records) {
        const id = r.get('Ad ID');
        if (id) set.add(id.toString());
      }
      next();
    });
  return set;
}

// Inserta anuncios nuevos en lotes de 10. Devuelve cuántos insertó.
export async function insertAds(rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10).map((fields) => ({ fields }));
    await base(config.adsTable).create(batch, { typecast: true });
    inserted += batch.length;
  }
  return inserted;
}

export async function updateAdvertiserLastRun(recordId, isoDate) {
  await base(config.advertisersTable).update(recordId, { 'Última corrida': isoDate });
}

// Busca un anunciante por su URL (para el disparo manual de una sola página).
export async function getAdvertiserByUrl(url) {
  let found = null;
  const target = (url || '').trim();
  await base(config.advertisersTable)
    .select()
    .eachPage((records, next) => {
      for (const r of records) {
        if ((r.get('URL') || '').toString().trim() === target) {
          found = {
            recordId: r.id,
            url: target,
            marca: r.get('Marca') || '',
            resultsLimit: r.get('Anuncios por corrida') ? Number(r.get('Anuncios por corrida')) : null,
            lastRun: r.get('Última corrida') || null,
            project: r.get('Proyecto') || '',
          };
        }
      }
      next();
    });
  return found;
}

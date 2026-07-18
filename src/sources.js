// Capa de acceso a "Fuentes" (qué scrapear) en Supabase: creadores IG, canales YT, búsquedas YT
// y anunciantes de Meta Ads. Reemplaza las funciones de Fuentes de src/airtable.js — mismas firmas
// y forma de retorno (recordId/lastRun/project, etc.) para no tocar los call sites en scrape.js,
// scrapeYoutube.js y scrapeAds.js.

import { config } from './config.js';
import { getClient } from './supabase.js';

// ---- Instagram (creadores) ----

export async function getActiveCreators() {
  const c = await getClient();
  const { data, error } = await c.from(config.igCreatorsTable).select('*').eq('activo', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    recordId: r.id,
    username: r.username,
    resultsLimit: r.reels_por_corrida || config.defaultResultsLimit,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  }));
}

// Busca UN creador por su Username (acepta con o sin @). Lo usa el scrape individual manual.
export async function getCreatorByUsername(usernameOrUrl) {
  const target = (usernameOrUrl || '').trim().replace(/^@/, '').toLowerCase();
  if (!target) return null;
  const c = await getClient();
  const { data, error } = await c.from(config.igCreatorsTable).select('*');
  if (error) throw new Error(error.message);
  const r = (data || []).find((row) => (row.username || '').trim().replace(/^@/, '').toLowerCase() === target);
  if (!r) return null;
  return {
    recordId: r.id,
    username: r.username,
    resultsLimit: r.reels_por_corrida || config.defaultResultsLimit,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  };
}

export async function updateCreatorLastRun(recordId, isoDate) {
  const c = await getClient();
  const { error } = await c.from(config.igCreatorsTable).update({ ultima_corrida: isoDate }).eq('id', recordId);
  if (error) throw new Error(error.message);
}

// Da de alta un creador nuevo como fuente activa (lo dispara el scrape manual por URL cuando el
// dueño del contenido todavía no era una fuente nuestra). Sin Proyecto: se puede asignar después.
export async function createCreator(username) {
  const c = await getClient();
  const { data, error } = await c
    .from(config.igCreatorsTable)
    .insert({ username, activo: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { recordId: data.id, username, resultsLimit: config.defaultResultsLimit, lastRun: null, project: '' };
}

// ---- YouTube (búsqueda por palabra clave) ----

export async function getActiveSearches() {
  const c = await getClient();
  const { data, error } = await c.from(config.ytSearchesTable).select('*').eq('activo', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    recordId: r.id,
    query: r.busqueda,
    maxResults: r.videos_por_busqueda || config.youtubeDefaultMaxResults,
    maxShorts: r.shorts_por_busqueda || 0,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  }));
}

export async function updateSearchLastRun(recordId, isoDate) {
  const c = await getClient();
  const { error } = await c.from(config.ytSearchesTable).update({ ultima_corrida: isoDate }).eq('id', recordId);
  if (error) throw new Error(error.message);
}

// ---- YouTube (canales) ----

export async function getActiveChannels() {
  const c = await getClient();
  const { data, error } = await c.from(config.ytChannelsTable).select('*').eq('activo', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    recordId: r.id,
    channelUrl: r.canal_url,
    maxResults: r.videos_por_corrida || config.youtubeDefaultMaxResults,
    maxShorts: r.shorts_por_corrida || 0,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  }));
}

export async function updateChannelLastRun(recordId, isoDate) {
  const c = await getClient();
  const { error } = await c.from(config.ytChannelsTable).update({ ultima_corrida: isoDate }).eq('id', recordId);
  if (error) throw new Error(error.message);
}

// Da de alta un canal de YouTube nuevo como fuente activa (lo dispara el scrape manual por URL
// cuando el canal todavía no era una fuente nuestra). Sin Proyecto: se puede asignar después.
export async function createChannel(channelUrl) {
  const c = await getClient();
  const { data, error } = await c
    .from(config.ytChannelsTable)
    .insert({ canal_url: channelUrl, activo: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    recordId: data.id,
    channelUrl,
    maxResults: config.youtubeDefaultMaxResults,
    maxShorts: 0,
    lastRun: null,
    project: '',
  };
}

// Busca un canal de YouTube por su URL (para el re-scrape manual de un solo canal).
export async function getChannelByUrl(url) {
  const target = (url || '').trim();
  if (!target) return null;
  const c = await getClient();
  const { data, error } = await c.from(config.ytChannelsTable).select('*');
  if (error) throw new Error(error.message);
  const r = (data || []).find((row) => (row.canal_url || '').trim() === target);
  if (!r) return null;
  return {
    recordId: r.id,
    channelUrl: target,
    maxResults: r.videos_por_corrida || config.youtubeDefaultMaxResults,
    maxShorts: r.shorts_por_corrida || 0,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  };
}

// ---- Ads (Meta Ad Library) ----

export async function getActiveAdvertisers() {
  const c = await getClient();
  const { data, error } = await c.from(config.fbAdvertisersTable).select('*').eq('activo', true);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    recordId: r.id,
    url: r.url,
    marca: r.marca || '',
    resultsLimit: r.anuncios_por_corrida ?? null,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  }));
}

export async function updateAdvertiserLastRun(recordId, isoDate) {
  const c = await getClient();
  const { error } = await c.from(config.fbAdvertisersTable).update({ ultima_corrida: isoDate }).eq('id', recordId);
  if (error) throw new Error(error.message);
}

// Guarda el nombre real del anunciante (page_name de la Ad Library) en la fuente, para que Fuentes
// muestre "BenCorde" en vez de la URL cruda "profile.php?id=…". Se llama tras scrapear, con el nombre
// del primer anuncio traído. No-op si no hay nombre.
export async function setAdvertiserMarca(recordId, marca) {
  const name = (marca || '').trim();
  if (!name) return;
  const c = await getClient();
  const { error } = await c.from(config.fbAdvertisersTable).update({ marca: name }).eq('id', recordId);
  if (error) throw new Error(error.message);
}

// Da de alta un anunciante nuevo como fuente activa (lo dispara el scrape manual por URL de un
// post/anuncio cuando la página todavía no era una fuente nuestra). Sin Proyecto: se asigna después.
export async function createAdvertiser(url) {
  const c = await getClient();
  const { data, error } = await c
    .from(config.fbAdvertisersTable)
    .insert({ url, activo: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { recordId: data.id, url, marca: '', resultsLimit: null, lastRun: null, project: '' };
}

// Busca un anunciante por su URL (para el disparo manual de una sola página).
export async function getAdvertiserByUrl(url) {
  const target = (url || '').trim();
  if (!target) return null;
  const c = await getClient();
  const { data, error } = await c.from(config.fbAdvertisersTable).select('*');
  if (error) throw new Error(error.message);
  const r = (data || []).find((row) => (row.url || '').trim() === target);
  if (!r) return null;
  return {
    recordId: r.id,
    url: target,
    marca: r.marca || '',
    resultsLimit: r.anuncios_por_corrida ?? null,
    lastRun: r.ultima_corrida,
    project: r.proyecto || '',
  };
}

// Definición de las 4 fuentes que se gestionan desde DISECTA. Supabase es la fuente única:
// estos mapeos coinciden con las tablas/columnas que lee el scraper (src/sources.js).

export type SourceType = 'ig' | 'yt_channel' | 'yt_search' | 'fb_advertiser';

export interface SourceDef {
  label: string;
  table: string;
  keyColumn: string;
  numColumn: string;
  keyLabel: string;
  keyPlaceholder: string;
  nameColumn?: string; // columna con el nombre legible (ej. anunciantes: 'marca')
}

export const SOURCE_DEFS: Record<SourceType, SourceDef> = {
  ig: {
    label: 'Creadores IG',
    table: 'ig_creators',
    keyColumn: 'username',
    numColumn: 'reels_por_corrida',
    keyLabel: '@usuario',
    keyPlaceholder: '@usuario',
  },
  yt_channel: {
    label: 'Canales YT',
    table: 'yt_channels',
    keyColumn: 'canal_url',
    numColumn: 'videos_por_corrida',
    keyLabel: 'URL del canal',
    keyPlaceholder: 'https://youtube.com/@canal',
  },
  yt_search: {
    label: 'Búsquedas YT',
    table: 'yt_searches',
    keyColumn: 'busqueda',
    numColumn: 'videos_por_busqueda',
    keyLabel: 'Palabra clave',
    keyPlaceholder: 'ej. claude code',
  },
  fb_advertiser: {
    label: 'Anunciantes',
    table: 'fb_advertisers',
    keyColumn: 'url',
    numColumn: 'anuncios_por_corrida',
    keyLabel: 'URL de página de Facebook',
    keyPlaceholder: 'https://www.facebook.com/MARCA',
    nameColumn: 'marca',
  },
};

export const SOURCE_ORDER: SourceType[] = ['ig', 'yt_channel', 'yt_search'];
export const ADS_SOURCE_ORDER: SourceType[] = ['fb_advertiser'];
export const ALL_SOURCE_ORDER: SourceType[] = [...SOURCE_ORDER, ...ADS_SOURCE_ORDER];

export interface SourceRecord {
  id: string;
  key: string;
  name: string | null; // nombre legible (anunciantes: marca); null si la fuente no lo tiene
  activo: boolean;
  proyecto: string | null;
  num: number | null;
  ultimaCorrida: string | null;
}

// Normaliza la "key" para comparar duplicados (mismo creador/canal escrito distinto).
export function normalizeKey(type: SourceType, key: string): string {
  let k = (key || '').trim();
  if (type === 'ig') {
    k = k.replace(/^@/, '').toLowerCase();
  } else if (type === 'yt_channel' || type === 'fb_advertiser') {
    k = k
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/\/+$/, '');
  } else {
    k = k.toLowerCase();
  }
  return k;
}

// Definición de las 3 fuentes que se gestionan desde DISECTA. Airtable es la fuente única:
// estos mapeos coinciden con los campos que lee el scraper (airtable.js).

export type SourceType = 'ig' | 'yt_channel' | 'yt_search' | 'fb_advertiser';

export interface SourceDef {
  label: string;
  tableEnv: string;
  tableDefault: string;
  keyField: string;
  numField: string;
  keyLabel: string;
  keyPlaceholder: string;
}

export const SOURCE_DEFS: Record<SourceType, SourceDef> = {
  ig: {
    label: 'Creadores IG',
    tableEnv: 'CREATORS_TABLE',
    tableDefault: 'Creadores',
    keyField: 'Username',
    numField: 'Reels por corrida',
    keyLabel: '@usuario',
    keyPlaceholder: '@usuario',
  },
  yt_channel: {
    label: 'Canales YT',
    tableEnv: 'YT_CHANNELS_TABLE',
    tableDefault: 'Canales YT',
    keyField: 'Canal',
    numField: 'Videos por corrida',
    keyLabel: 'URL del canal',
    keyPlaceholder: 'https://youtube.com/@canal',
  },
  yt_search: {
    label: 'Búsquedas YT',
    tableEnv: 'YT_SEARCHES_TABLE',
    tableDefault: 'Búsquedas YT',
    keyField: 'Búsqueda',
    numField: 'Videos por búsqueda',
    keyLabel: 'Palabra clave',
    keyPlaceholder: 'ej. claude code',
  },
  fb_advertiser: {
    label: 'Anunciantes',
    tableEnv: 'ADVERTISERS_TABLE',
    tableDefault: 'Anunciantes',
    keyField: 'URL',
    numField: 'Anuncios por corrida',
    keyLabel: 'URL de página de Facebook',
    keyPlaceholder: 'https://www.facebook.com/MARCA',
  },
};

export const SOURCE_ORDER: SourceType[] = ['ig', 'yt_channel', 'yt_search'];
export const ADS_SOURCE_ORDER: SourceType[] = ['fb_advertiser'];
export const ALL_SOURCE_ORDER: SourceType[] = [...SOURCE_ORDER, ...ADS_SOURCE_ORDER];

export interface SourceRecord {
  id: string;
  key: string;
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

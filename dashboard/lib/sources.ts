// Definición de las 4 fuentes que se gestionan desde DISECTA. Supabase es la fuente única:
// estos mapeos coinciden con las tablas/columnas que lee el scraper (src/sources.js).

export type SourceType = 'ig' | 'tiktok' | 'x' | 'x_search' | 'yt_channel' | 'yt_search' | 'fb_advertiser';

export interface SourceDef {
  label: string;
  table: string;
  keyColumn: string;
  numColumn: string;
  keyLabel: string;
  keyPlaceholder: string;
  nameColumn?: string; // columna con el nombre legible (ej. anunciantes: 'marca')
  // Etiqueta de la columna numérica, para no decirle "Videos/corrida" a una búsqueda de X.
  numLabel?: string;
  // Si la tabla NO tiene columna `proyecto`, el formulario no debe mandarlo: el insert fallaría
  // con "column … does not exist". Le pasa a las búsquedas del radar.
  sinProyecto?: boolean;
  // El nombre legible lo escribe el usuario (no lo rellena el scraper, como sí hace 'marca').
  nombreEditable?: boolean;
  // Columna booleana extra que se edita desde la tabla (IG: captura automática de historias).
  extraBool?: { column: string; label: string; title: string };
}

export const SOURCE_DEFS: Record<SourceType, SourceDef> = {
  ig: {
    label: 'Creadores IG',
    table: 'ig_creators',
    keyColumn: 'username',
    numColumn: 'reels_por_corrida',
    keyLabel: '@usuario',
    keyPlaceholder: '@usuario',
    extraBool: {
      column: 'historias_auto',
      label: 'Historias auto',
      title:
        'Capturar sus historias solas, 2 veces al día. Solo las cuentas marcadas: el actor cobra por historia, así que cada cuenta encendida suma al gasto. El estado del cron y la lista completa están en la sección Historias.',
    },
  },
  tiktok: {
    label: 'Cuentas TikTok',
    table: 'tiktok_creators',
    keyColumn: 'username',
    numColumn: 'videos_por_corrida',
    keyLabel: '@usuario',
    keyPlaceholder: '@usuario o URL del perfil',
  },
  x: {
    label: 'Cuentas X',
    table: 'x_creators',
    keyColumn: 'username',
    numColumn: 'posts_por_corrida',
    keyLabel: '@usuario',
    keyPlaceholder: '@usuario o URL del perfil',
    numLabel: 'Posts/corrida',
  },
  x_search: {
    label: 'Búsquedas X',
    table: 'x_busquedas',
    keyColumn: 'consulta',
    numColumn: 'posts_por_corrida',
    // El actor devuelve en bloques de 20 y redondea HACIA ARRIBA (medido: pedir 10 da 20, pedir 30
    // da 40, pedir 60 da 60). Así que el número es un mínimo, no un tope, y el piso real es 20.
    numLabel: 'Posts/corrida (de 20 en 20)',
    sinProyecto: true,
    nombreEditable: true,
    keyLabel: 'Consulta de X',
    // Se muestra la sintaxis en el placeholder porque es lo que separa señal de ruido: sin
    // operadores, una consulta de hashtags devuelve casi todo con menos de 10 likes.
    keyPlaceholder: 'ej. ("just released" OR "introducing") (AI OR LLM) min_faves:300 -filter:replies',
    nameColumn: 'etiqueta',
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

export const SOURCE_ORDER: SourceType[] = ['ig', 'tiktok', 'x', 'x_search', 'yt_channel', 'yt_search'];
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
  extra?: boolean; // valor de extraBool (IG: historias_auto)
}

// Normaliza la "key" para comparar duplicados (mismo creador/canal escrito distinto).
export function normalizeKey(type: SourceType, key: string): string {
  let k = (key || '').trim();
  if (type === 'ig') {
    k = k.replace(/^@/, '').toLowerCase();
  } else if (type === 'tiktok') {
    // Igual que IG, pero tolerando que peguen la URL del perfil.
    const deUrl = k.match(/tiktok\.com\/@([^/?\s]+)/i);
    k = (deUrl ? deUrl[1] : k).replace(/^@/, '').toLowerCase();
  } else if (type === 'x') {
    // Igual que TikTok, tolerando la URL del perfil en sus dos dominios.
    const deUrl = k.match(/(?:twitter|x)\.com\/([^/?\s]+)/i);
    k = (deUrl ? deUrl[1] : k).replace(/^@/, '').toLowerCase();
  } else if (type === 'x_search') {
    // La consulta se compara tal cual (sin bajar a minúsculas los operadores cambiaría el sentido
    // de cosas como lang:ES), solo normalizando espacios.
    k = k.replace(/\s+/g, ' ').toLowerCase();
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

// Definición de las 4 fuentes que se gestionan desde DISECTA. Supabase es la fuente única:
// estos mapeos coinciden con las tablas/columnas que lee el scraper (src/sources.js).

export type SourceType = 'ig' | 'tiktok' | 'x' | 'x_search' | 'yt_channel' | 'yt_search' | 'rd_search' | 'fb_advertiser';

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
  // Columnas con valor FIJO para esta fuente. Hacen falta cuando varias fuentes comparten tabla:
  // las consultas del radar viven todas en `radar_busquedas` y se distinguen por `plataforma`.
  // Se aplican al insertar Y al listar — sin el filtro, las Búsquedas X mostrarían las de YouTube.
  fixed?: Record<string, string>;
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
    // Desde el 19 oct 2026 las consultas de las tres plataformas viven en `radar_busquedas`, y
    // `plataforma` las separa. Antes estaban en `x_busquedas`: si el radar leyera de la tabla nueva
    // y Fuentes siguiera escribiendo en la vieja, una consulta recién agregada no correría nunca.
    table: 'radar_busquedas',
    fixed: { plataforma: 'x' },
    keyColumn: 'consulta',
    numColumn: 'max_por_corrida',
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
    // Antes apuntaban a `yt_searches` y sus resultados caían en `yt_videos`, o sea en la MISMA
    // galería que el contenido curado: el descubrimiento ensuciaba el archivo y cada video
    // descubierto se archivaba aunque fuera a descartarse. Ahora son consultas del radar.
    table: 'radar_busquedas',
    fixed: { plataforma: 'yt' },
    keyColumn: 'consulta',
    numColumn: 'max_por_corrida',
    numLabel: 'Videos/corrida',
    sinProyecto: true,
    nombreEditable: true,
    nameColumn: 'etiqueta',
    keyLabel: 'Palabra clave',
    // El idioma de la consulta ES el idioma en que se busca: el actor no tiene parámetro de idioma
    // ni de país, y pasarle hl/gl o un proxy de MX/BR no cambia nada (medido el 21 oct 2026). En el
    // radar libre, además, el SUFIJO de la etiqueta elige el locale con el que se pide la página.
    //
    // Desde el 27 oct 2026 el radar va en INGLÉS (Dante: «son los primeros que sacan las
    // tendencias»), así que el ejemplo enseña el sufijo en vez de las tres versiones por idioma.
    // Para volver a buscar en español se pone `· en,es` y se enciende la fila.
    keyPlaceholder: 'ej. claude code   ·   etiqueta: claude code · en',
  },
  rd_search: {
    label: 'Búsquedas Reddit',
    // Cuarta plataforma del radar (27 oct 2026), en la misma tabla que las otras tres.
    table: 'radar_busquedas',
    fixed: { plataforma: 'rd' },
    keyColumn: 'consulta',
    numColumn: 'max_por_corrida',
    // El número es por búsqueda pero el actor hace UNA sola corrida con todas, así que lo que
    // manda el gasto es la SUMA: seis búsquedas de 5 son 30 posts, y el actor abre cada post con un
    // navegador para sacar los upvotes. Añadir una búsqueda más sube el costo de la pasada.
    numLabel: 'Posts/corrida (se suman)',
    sinProyecto: true,
    nombreEditable: true,
    nameColumn: 'etiqueta',
    keyLabel: 'Búsqueda de Reddit',
    // Nombres de modelo y CALIFICADOS. Reddit no entiende operadores como X, así que la única
    // defensa contra el ruido es que el término no sea ambiguo: `kling` solo trae apellidos
    // alemanes y `sora` nombres propios, igual que pasó en X.
    keyPlaceholder: 'ej. seedance · kling ai · sora 2 · nano banana',
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

export const SOURCE_ORDER: SourceType[] = ['ig', 'tiktok', 'x', 'x_search', 'yt_channel', 'yt_search', 'rd_search'];
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
    // Se tolera la URL del perfil, igual que en TikTok y X: Dante pega desde el iPhone, y sin esto
    // "instagram.com/paula" y "@paula" no se detectaban como la misma cuenta, así que el candado
    // anti-duplicados las dejaba entrar a las dos.
    const deUrl = k.match(/instagram\.com\/([^/?\s]+)/i);
    k = (deUrl ? deUrl[1] : k).replace(/^@/, '').toLowerCase();
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

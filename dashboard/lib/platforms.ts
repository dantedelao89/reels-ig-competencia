// Registro de plataformas del pipeline orgánico.
//
// Antes de este archivo, la plataforma vivía en ~45 ternarios binarios (`platform === 'ig' ? … : …`).
// Con dos plataformas funcionaban; con una tercera fallan EN SILENCIO: devuelven la tabla
// equivocada o un PATCH que responde ok sin actualizar nada. Aquí se declara una vez y los sitios
// que deciden por plataforma lo consultan.
//
// Sin JSX a propósito: este archivo lo importan route handlers de servidor, así que el icono
// viaja como clave de texto y el componente se resuelve en PlatformToggle.

import type { ContentItem, Platform } from './types';

export interface PlatformDef {
  key: Platform;
  label: string;              // 'Instagram'
  short: string;              // 'IG' — badge de tarjeta y tabla
  table: string;
  idCol: string;              // columna del id externo (shortcode / video_id)
  autorCol: string;           // creador / canal
  textCol: string;            // dónde vive la transcripción
  listCols: string;           // select() de la lista (columnas ligeras)
  detailExtraCols: string;    // columnas extra del detalle, con coma inicial
  searchable: boolean;        // tiene search_tsv generada + índice GIN
  hasOrigen: boolean;         // el filtro canal/búsqueda (solo YouTube)
  transcribeOnDemand: boolean;// muestra el botón "Transcribir con IA"
  thumbRatio: string;         // proporción de la miniatura
  icon: 'instagram' | 'youtube' | 'tiktok' | 'x';
  activeClass: string;        // clases del toggle cuando está activo
  activeStyle?: Record<string, string>;
  toItem: (r: any) => ContentItem;
}

export function fmtSeconds(s: number | null): string | null {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const IG_COLS =
  'id,shortcode,creador,url,video_url,caption,fecha_publicacion,likes,comentarios,views,duracion_seg,tipo,imagenes,regen_estado,thumbnail_original,thumbnail_url,proyecto,estado,scrapeado_en,mi_guion,mi_notas,mi_link,mi_video_url';
const YT_COLS =
  'id,video_id,titulo,canal,canal_url,url,fecha_publicacion,views,duracion,thumbnail_original,thumbnail_url,proyecto,estado,scrapeado_en,mi_guion,mi_notas,mi_link,mi_video_url';
const X_COLS =
  'id,post_id,creador,creador_nombre,url,caption,respuestas_autor,fecha_publicacion,views,likes,comentarios,retweets,duracion_seg,tipo,video_url,imagenes,thumbnail_original,thumbnail_url,proyecto,estado,scrapeado_en,mi_guion,mi_notas,mi_link,mi_video_url';
const TT_COLS =
  'id,video_id,creador,creador_nombre,url,caption,fecha_publicacion,views,likes,comentarios,duracion_seg,es_slideshow,thumbnail_original,thumbnail_url,proyecto,estado,scrapeado_en,mi_guion,mi_notas,mi_link,mi_video_url';

export const PLATFORMS: Record<Platform, PlatformDef> = {
  ig: {
    key: 'ig',
    label: 'Instagram',
    short: 'IG',
    table: 'ig_reels',
    idCol: 'shortcode',
    autorCol: 'creador',
    textCol: 'transcripcion',
    listCols: IG_COLS,
    detailExtraCols: ', regen, regen_estado',
    searchable: true,
    hasOrigen: false,
    transcribeOnDemand: false,
    thumbRatio: 'pt-[133%]',
    icon: 'instagram',
    activeClass: 'text-white',
    activeStyle: { background: 'linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)' },
    toItem: (r) => ({
      id: r.id,
      platform: 'ig',
      externalId: r.shortcode,
      creador: r.creador,
      titulo: r.caption,
      url: r.url,
      fechaPublicacion: r.fecha_publicacion,
      views: r.views,
      likes: r.likes,
      comentarios: r.comentarios,
      duracion: fmtSeconds(r.duracion_seg),
      thumbnail: r.thumbnail_url || r.thumbnail_original,
      tipo: r.tipo ?? null,
      imagenes: Array.isArray(r.imagenes) ? r.imagenes : null,
      regenEstado: r.regen_estado ?? null,
      proyecto: r.proyecto,
      estado: r.estado,
      transcripcion: r.transcripcion,
      scrapeadoEn: r.scrapeado_en,
      miGuion: r.mi_guion,
      miNotas: r.mi_notas,
      miLink: r.mi_link,
      miVideoUrl: r.mi_video_url,
    }),
  },
  yt: {
    key: 'yt',
    label: 'YouTube',
    short: 'YT',
    table: 'yt_videos',
    idCol: 'video_id',
    autorCol: 'canal',
    textCol: 'subtitulos',
    listCols: YT_COLS,
    detailExtraCols: ', variantes, video_id',
    searchable: true,
    hasOrigen: true,
    transcribeOnDemand: true,
    thumbRatio: 'pt-[56%]',
    icon: 'youtube',
    activeClass: 'text-white',
    activeStyle: { background: '#FF0000' },
    toItem: (r) => ({
      id: r.id,
      platform: 'yt',
      externalId: r.video_id,
      creador: r.canal,
      titulo: r.titulo,
      url: r.url,
      fechaPublicacion: r.fecha_publicacion,
      views: r.views,
      likes: null,
      comentarios: null,
      duracion: r.duracion,
      thumbnail: r.thumbnail_url || r.thumbnail_original,
      tipo: null,
      imagenes: null,
      proyecto: r.proyecto,
      estado: r.estado,
      transcripcion: r.subtitulos,
      scrapeadoEn: r.scrapeado_en,
      miGuion: r.mi_guion,
      miNotas: r.mi_notas,
      miLink: r.mi_link,
      miVideoUrl: r.mi_video_url,
    }),
  },
  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    short: 'TT',
    table: 'tiktok_videos',
    idCol: 'video_id',
    autorCol: 'creador',
    textCol: 'transcripcion',
    listCols: TT_COLS,
    detailExtraCols: '',
    searchable: true,
    hasOrigen: false,
    // El botón "Transcribir con IA" resuelve el audio con getTiktokMediaUrl: la URL pública de
    // TikTok es una página HTML, así que hace falta una corrida del actor de descarga.
    transcribeOnDemand: true,
    thumbRatio: 'pt-[177%]', // 9:16
    icon: 'tiktok',
    activeClass: 'text-white',
    activeStyle: { background: '#000000' },
    toItem: (r) => ({
      id: r.id,
      platform: 'tiktok',
      externalId: r.video_id,
      creador: r.creador,
      titulo: r.caption,
      url: r.url,
      fechaPublicacion: r.fecha_publicacion,
      views: r.views,
      likes: r.likes,
      comentarios: r.comentarios,
      duracion: fmtSeconds(r.duracion_seg),
      thumbnail: r.thumbnail_url || r.thumbnail_original,
      tipo: r.es_slideshow ? 'Slideshow' : null,
      imagenes: null,
      proyecto: r.proyecto,
      estado: r.estado,
      transcripcion: null,
      scrapeadoEn: r.scrapeado_en,
      miGuion: r.mi_guion,
      miNotas: r.mi_notas,
      miLink: r.mi_link,
      miVideoUrl: r.mi_video_url,
    }),
  },
  x: {
    key: 'x',
    label: 'X',
    short: 'X',
    table: 'x_posts',
    idCol: 'post_id',
    autorCol: 'creador',
    textCol: 'transcripcion',
    listCols: X_COLS,
    detailExtraCols: ', conversation_id',
    searchable: true,
    hasOrigen: false,
    // El MP4 ya está archivado en R2, así que transcribir NO cuesta una corrida extra del actor
    // (a diferencia de TikTok): el modal manda mediaUrl y el backend lo pasa directo al modelo.
    transcribeOnDemand: true,
    // X no tiene una proporción fija (16:9, 1:1 y 9:16 conviven). 4:5 es el punto medio que no
    // recorta de más en ninguna de las tres.
    thumbRatio: 'pt-[125%]',
    icon: 'x',
    activeClass: 'text-white',
    activeStyle: { background: '#000000' },
    toItem: (r) => ({
      id: r.id,
      platform: 'x',
      externalId: r.post_id,
      creador: r.creador,
      titulo: r.caption,
      url: r.url,
      fechaPublicacion: r.fecha_publicacion,
      views: r.views,
      likes: r.likes,
      comentarios: r.comentarios,
      duracion: fmtSeconds(r.duracion_seg),
      thumbnail: r.thumbnail_url || r.thumbnail_original,
      tipo: r.tipo ?? null,
      imagenes: Array.isArray(r.imagenes) ? r.imagenes : null,
      // El medio archivado: es lo que hace que el video se pueda ver y descargar desde el detalle.
      mediaUrl: r.video_url || (Array.isArray(r.imagenes) ? r.imagenes[0] : null) || null,
      mediaTipo: r.video_url ? 'video' : Array.isArray(r.imagenes) && r.imagenes.length ? 'image' : null,
      respuestasAutor: Array.isArray(r.respuestas_autor) ? r.respuestas_autor : null,
      proyecto: r.proyecto,
      estado: r.estado,
      transcripcion: r.transcripcion,
      scrapeadoEn: r.scrapeado_en,
      miGuion: r.mi_guion,
      miNotas: r.mi_notas,
      miLink: r.mi_link,
      miVideoUrl: r.mi_video_url,
    }),
  },
};

export const PLATFORM_ORDER: Platform[] = ['ig', 'yt', 'tiktok', 'x'];

// --- Identificador copiable de un contenido ---
//
// Formato `IG-DMxxxx`, `YT-dQw4w9WgXcQ`, `TT-7412…`, `X-2093…`: la plataforma más el id nativo.
// Se prefiere esto al uuid interno porque dice de un vistazo de qué red es, permite reconstruir la
// URL original, y es el mismo id que ya usan los endpoints — o sea que sirve para hablar del
// contenido fuera de DISECTA, no solo para verlo.
export function codigoDe(item: Pick<ContentItem, 'platform' | 'externalId'>): string {
  return `${PLATFORMS[item.platform].short}-${item.externalId}`;
}

// Lo contrario: de un código pegado en el buscador, a qué tabla y qué id mirar. Devuelve null si
// el texto no es un código, para que la búsqueda normal siga su curso.
export function desdeCodigo(texto: string): { platform: Platform; externalId: string } | null {
  const m = String(texto || '').trim().match(/^([A-Za-z]{1,3})-(.+)$/);
  if (!m) return null;
  const short = m[1].toUpperCase();
  const key = PLATFORM_ORDER.find((p) => PLATFORMS[p].short === short);
  return key ? { platform: key, externalId: m[2].trim() } : null;
}

export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && v in PLATFORMS;
}

// Tablas que aceptan la capa de curación (estado, mi_*, recurso_*). Incluye 'ad' (meta_ads),
// que no es una plataforma de la galería orgánica pero sí se cura desde la misma UI.
export const CURATION_TABLES: Record<Platform | 'ad', string> = {
  ig: PLATFORMS.ig.table,
  yt: PLATFORMS.yt.table,
  tiktok: PLATFORMS.tiktok.table,
  x: PLATFORMS.x.table,
  ad: 'meta_ads',
};

export const CURATION_TEXT_COL: Record<Platform | 'ad', string> = {
  ig: PLATFORMS.ig.textCol,
  yt: PLATFORMS.yt.textCol,
  tiktok: PLATFORMS.tiktok.textCol,
  x: PLATFORMS.x.textCol,
  ad: 'transcripcion',
};

export function isCurable(v: unknown): v is Platform | 'ad' {
  return typeof v === 'string' && v in CURATION_TABLES;
}

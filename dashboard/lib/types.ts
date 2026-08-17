export type Platform = 'ig' | 'yt' | 'tiktok';

export type Estado = 'nuevo' | 'por_curar' | 'curado' | 'produccion' | 'publicado' | 'descartado';

export const ESTADOS: { key: Estado; label: string }[] = [
  { key: 'nuevo', label: 'Nuevo' },
  { key: 'por_curar', label: 'Por curar' },
  { key: 'curado', label: 'Curado' },
  { key: 'produccion', label: 'Producción' },
  { key: 'publicado', label: 'Publicado' },
  { key: 'descartado', label: 'Descartado' },
];

// Una diapositiva de carrusel (formato nuevo). Puede ser video o imagen.
export interface CarouselSlide {
  tipo: 'video' | 'image';
  url: string;
  poster?: string | null;
}

// Forma normalizada que consume el frontend (une ig_reels y yt_videos).
export interface ContentItem {
  id: string;
  platform: Platform;
  externalId: string; // shortcode | video_id
  creador: string | null;
  titulo: string | null; // caption | titulo
  url: string | null;
  fechaPublicacion: string | null;
  views: number | null;
  likes: number | null;
  comentarios: number | null;
  duracion: string | null;
  thumbnail: string | null; // thumbnail_url (R2) || thumbnail_original
  tipo: string | null; // 'Image' | 'Video' | 'Sidecar' (carrusel) | null
  // Carrusel: diapositivas (R2). Formato nuevo: { tipo:'video'|'image', url, poster? }.
  // Formato viejo (carruseles ya guardados): string (URL de imagen). El front normaliza ambos.
  imagenes: (string | CarouselSlide)[] | null;
  // Regenerador: null | 'leyendo' | 'ganchos' | 'escribiendo' | 'generando' | 'revisando' | 'listo'
  regenEstado?: string | null;
  proyecto: string | null;
  estado: Estado;
  transcripcion: string | null;
  scrapeadoEn: string | null;
  // capa de producción
  miGuion: string | null;
  miNotas: string | null;
  miLink: string | null;
  miVideoUrl: string | null;
}

export interface ContentResponse {
  items: ContentItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type SortField = 'fecha_publicacion' | 'scrapeado_en' | 'views' | 'engagement';
export type SortDir = 'asc' | 'desc';

// --- Regenerador de carruseles (v2) ---

export interface RegenSlide {
  idx: number;
  tipoMedia: 'image' | 'video';
  accion: 'copiar' | 'limpiar' | 'regenerar';
  rol: string;
  tipoSlide?: string; // alias legado de rol
  textos: string[];
  textoNuevo: string | null;
  textoOriginal: string | null;
  foto: string | null;
  acento: string | null;
  chip: string | null;
  variante: string | null;
  refId: string | null;
  nota: string | null;
  prompt: string | null;
  estado: 'pendiente' | 'generando' | 'listo' | 'error';
  outputUrl: string | null;
  error: string | null;
  modelo: string | null;
  qa: { ok: boolean; problemas: string[]; instruccion: string | null; intentos?: number } | null;
}

export interface RegenGancho {
  id: string;
  formula: string;
  titular: string;
  porque: string;
  avisos?: string[];
  origen?: string;
}

export interface RegenMeta {
  v: number;
  brief: string | null;
  analisis: {
    tema: string | null;
    queEntrega: string | null;
    piezas: number | null;
    keyword: string | null;
    dolor: string | null;
    argumento: string | null;
    publico: string | null;
    numLaminas: number;
  };
  ganchos: RegenGancho[];
  ganchoElegido: RegenGancho | null;
  keyword?: string;
  ctaVariante?: string;
  costoEstimado?: number;
  historial?: { ts: string; texto: string; idxs: number[]; mensaje: string | null }[];
}

export interface RegenProgreso {
  paso: string;
  mensaje: string;
  hechos: number | null;
  total: number | null;
  ts: string;
}

// Estados en los que hay un job trabajando (la UI bloquea acciones y hace polling).
export const REGEN_OCUPADO = ['leyendo', 'escribiendo', 'generando', 'revisando'];

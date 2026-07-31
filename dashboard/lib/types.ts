export type Platform = 'ig' | 'yt';

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

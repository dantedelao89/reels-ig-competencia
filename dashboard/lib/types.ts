export type Platform = 'ig' | 'yt';

export type Estado = 'por_curar' | 'curado' | 'produccion' | 'publicado' | 'descartado';

export const ESTADOS: { key: Estado; label: string }[] = [
  { key: 'por_curar', label: 'Por curar' },
  { key: 'curado', label: 'Curado' },
  { key: 'produccion', label: 'Producción' },
  { key: 'publicado', label: 'Publicado' },
  { key: 'descartado', label: 'Descartado' },
];

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
  proyecto: string | null;
  estado: Estado;
  transcripcion: string | null;
  scrapeadoEn: string | null;
}

export interface ContentResponse {
  items: ContentItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type SortField = 'fecha_publicacion' | 'scrapeado_en' | 'views' | 'engagement';
export type SortDir = 'asc' | 'desc';

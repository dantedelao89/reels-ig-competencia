import type { Estado } from './types';

// Estilos de badge por estado (clases tailwind).
export const ESTADO_STYLE: Record<Estado, { label: string; cls: string }> = {
  por_curar: { label: 'Por curar', cls: 'bg-gray-100 text-gray-600' },
  curado: { label: 'Curado', cls: 'bg-blue-50 text-blue-700' },
  produccion: { label: 'Producción', cls: 'bg-amber-50 text-amber-700' },
  publicado: { label: 'Publicado', cls: 'bg-green-50 text-green-700' },
  descartado: { label: 'Descartado', cls: 'bg-red-50 text-red-600' },
};

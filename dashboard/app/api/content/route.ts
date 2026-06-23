import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, IG_TABLE, YT_TABLE } from '@/lib/supabase';
import type { ContentItem, Platform } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Tope de filas que traemos por tabla para mergear/ordenar en memoria.
// A escala actual (cientos) es instantáneo. Optimización futura: una VIEW que una ambas tablas.
const CAP = 5000;

function fmtSeconds(s: number | null): string | null {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function igToItem(r: any): ContentItem {
  return {
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
    proyecto: r.proyecto,
    estado: r.estado,
    transcripcion: r.transcripcion,
    scrapeadoEn: r.scrapeado_en,
  };
}

function ytToItem(r: any): ContentItem {
  return {
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
    proyecto: r.proyecto,
    estado: r.estado,
    transcripcion: r.subtitulos,
    scrapeadoEn: r.scrapeado_en,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = (sp.get('platform') || 'all') as Platform | 'all';
  const estado = sp.get('estado') || '';
  const creador = sp.get('creador') || '';
  const proyecto = sp.get('proyecto') || '';
  const q = sp.get('q')?.trim() || '';
  const sort = sp.get('sort') || 'fecha_publicacion';
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const dateField = sp.get('dateField') === 'scrapeado' ? 'scrapeado_en' : 'fecha_publicacion';
  const desde = sp.get('desde') || '';
  const hasta = sp.get('hasta') || '';
  const page = Math.max(1, Number(sp.get('page') || 1));
  const pageSize = Math.min(120, Math.max(1, Number(sp.get('pageSize') || 40)));

  const supabase = getSupabase();

  async function fetchTable(table: string, creadorCol: string): Promise<any[]> {
    let query = supabase.from(table).select('*').limit(CAP);
    if (estado) query = query.eq('estado', estado);
    if (creador) query = query.eq(creadorCol, creador);
    if (proyecto) query = query.eq('proyecto', proyecto);
    if (q) query = query.textSearch('search_tsv', q, { config: 'spanish', type: 'websearch' });
    if (desde) query = query.gte(dateField, desde);
    if (hasta) query = query.lte(dateField, hasta);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  }

  try {
    const items: ContentItem[] = [];
    if (platform !== 'yt') (await fetchTable(IG_TABLE, 'creador')).forEach((r) => items.push(igToItem(r)));
    if (platform !== 'ig') (await fetchTable(YT_TABLE, 'canal')).forEach((r) => items.push(ytToItem(r)));

    const val = (it: ContentItem): number | string => {
      if (sort === 'views') return it.views ?? -1;
      if (sort === 'engagement') return (it.likes ?? 0) + (it.comentarios ?? 0);
      if (sort === 'scrapeado_en') return it.scrapeadoEn ?? '';
      return it.fechaPublicacion ?? '';
    };
    items.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });

    const total = items.length;
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    return NextResponse.json({ items: pageItems, total, page, pageSize });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

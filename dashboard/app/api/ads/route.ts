import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const COLS =
  'id,ad_id,anunciante,copy,titulo,cta,link_destino,formato,plataformas,activo,fecha_inicio,fecha_fin,dias_corriendo,thumbnail_original,thumbnail_url,video_url,proyecto,estado,scrapeado_en,mi_guion,mi_notas,mi_link,mi_video_url';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const estado = sp.get('estado') || '';
  const anunciantes = (sp.get('anunciante') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const proyectos = (sp.get('proyecto') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const activo = sp.get('activo') || ''; // 'true' | 'false' | ''
  const q = sp.get('q')?.trim() || '';
  const sort = sp.get('sort') || 'fecha_inicio'; // fecha_inicio | dias_corriendo | scrapeado_en
  const dir = sp.get('dir') === 'asc' ? true : false;
  const page = Math.max(1, Number(sp.get('page') || 1));
  const pageSize = Math.min(120, Math.max(1, Number(sp.get('pageSize') || 40)));

  const supabase = getSupabase();
  let query = supabase.from('meta_ads').select(COLS, { count: 'exact' });
  if (estado) query = query.eq('estado', estado);
  if (anunciantes.length) query = query.in('anunciante', anunciantes);
  if (proyectos.length) query = query.in('proyecto', proyectos);
  if (activo === 'true') query = query.eq('activo', true);
  if (activo === 'false') query = query.eq('activo', false);
  if (q) query = query.textSearch('search_tsv', q, { config: 'spanish', type: 'websearch' });
  query = query.order(sort, { ascending: dir, nullsFirst: false });
  query = query.range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1);

  try {
    const { data, count, error } = await query;
    if (error) throw new Error(error.message);
    const items = (data || []).map((r: any) => ({
      id: r.id,
      adId: r.ad_id,
      anunciante: r.anunciante,
      copy: r.copy,
      titulo: r.titulo,
      cta: r.cta,
      linkDestino: r.link_destino,
      formato: r.formato,
      plataformas: r.plataformas,
      activo: r.activo,
      fechaInicio: r.fecha_inicio,
      fechaFin: r.fecha_fin,
      diasCorriendo: r.dias_corriendo,
      thumbnail: r.thumbnail_url || r.thumbnail_original,
      videoUrl: r.video_url,
      proyecto: r.proyecto,
      estado: r.estado,
      scrapeadoEn: r.scrapeado_en,
      miGuion: r.mi_guion,
      miNotas: r.mi_notas,
      miLink: r.mi_link,
      miVideoUrl: r.mi_video_url,
    }));
    return NextResponse.json({ items, total: count || 0, page, pageSize });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STORIES_TABLE = 'ig_stories';
const COLS =
  'id,story_id,creador,fecha_publicacion,dia,expira_en,tipo,media_url,poster_url,media_original,media_error,ancho,alto,tiene_audio,duracion_seg,proyecto,scrapeado_en,notas,favorito';

// Archivo de historias. Devuelve PLANO y ordenado; la vista agrupa por día.
// Agrupar aquí obligaría a paginar por día y un día partido entre dos páginas se rompería.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const creador = sp.get('creador') || '';
  const desde = sp.get('desde') || '';
  const hasta = sp.get('hasta') || '';
  const page = Math.max(1, Number(sp.get('page') || 1));
  const pageSize = Math.min(500, Math.max(1, Number(sp.get('pageSize') || 200)));

  let q = getSupabase()
    .from(STORIES_TABLE)
    .select(COLS, { count: 'exact' })
    // Día más reciente arriba; dentro del día, en el orden en que se publicaron.
    .order('dia', { ascending: false, nullsFirst: false })
    .order('fecha_publicacion', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (creador) q = q.eq('creador', creador.replace(/^@/, '').toLowerCase());
  if (desde) q = q.gte('dia', desde);
  if (hasta) q = q.lte('dia', hasta);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data || []).map((r: any) => ({
    id: r.id,
    storyId: r.story_id,
    creador: r.creador,
    fechaPublicacion: r.fecha_publicacion,
    dia: r.dia,
    expiraEn: r.expira_en,
    tipo: r.tipo,
    mediaUrl: r.media_url,
    posterUrl: r.poster_url,
    mediaOriginal: r.media_original,
    mediaError: r.media_error,
    ancho: r.ancho,
    alto: r.alto,
    tieneAudio: r.tiene_audio,
    duracionSeg: r.duracion_seg,
    proyecto: r.proyecto,
    scrapeadoEn: r.scrapeado_en,
    notas: r.notas,
    favorito: r.favorito,
  }));

  return NextResponse.json({ items, total: count ?? items.length, page, pageSize });
}

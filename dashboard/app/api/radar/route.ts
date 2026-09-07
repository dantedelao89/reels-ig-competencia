import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const RADAR_TABLE = 'x_radar';
const COLS =
  'id,post_id,busqueda_id,busqueda_etiqueta,creador,creador_nombre,creador_url,creador_seguidores,url,caption,respuestas_autor,fecha_publicacion,dia,views,likes,comentarios,retweets,guardados,duracion_seg,tipo,hashtags,links_externos,idioma,conversation_id,thumbnail_original,video_original,promovido,descartado,scrapeado_en';

// Lo que trajeron las consultas del radar. Devuelve PLANO y ordenado; la vista agrupa por día
// (mismo criterio que las historias: agrupar aquí obligaría a paginar por día y un día partido
// entre dos páginas se rompería).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const busqueda = sp.get('busqueda') || '';
  const q = sp.get('q')?.trim() || '';
  const desde = sp.get('desde') || '';
  const minLikes = Number(sp.get('minLikes') || 0);
  const verDescartados = sp.get('descartados') === '1';
  const page = Math.max(1, Number(sp.get('page') || 1));
  const pageSize = Math.min(500, Math.max(1, Number(sp.get('pageSize') || 200)));

  let query = getSupabase()
    .from(RADAR_TABLE)
    .select(COLS, { count: 'exact' })
    // Día más reciente arriba y, dentro del día, lo más reaccionado primero: en un radar lo que
    // importa no es el orden en que se publicó sino qué pegó.
    .order('dia', { ascending: false, nullsFirst: false })
    .order('likes', { ascending: false, nullsFirst: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (busqueda) query = query.eq('busqueda_id', busqueda);
  if (desde) query = query.gte('dia', desde);
  if (minLikes) query = query.gte('likes', minLikes);
  // Lo descartado se esconde por defecto: el radar sirve si lo que queda a la vista es lo que
  // todavía no se ha juzgado.
  if (!verDescartados) query = query.eq('descartado', false);
  if (q) query = query.textSearch('search_tsv', q, { config: 'spanish', type: 'websearch' });

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data || []).map((r: any) => ({
    id: r.id,
    postId: r.post_id,
    busquedaId: r.busqueda_id,
    busqueda: r.busqueda_etiqueta,
    creador: r.creador,
    creadorNombre: r.creador_nombre,
    seguidores: r.creador_seguidores,
    url: r.url,
    caption: r.caption,
    respuestasAutor: Array.isArray(r.respuestas_autor) ? r.respuestas_autor : null,
    fechaPublicacion: r.fecha_publicacion,
    dia: r.dia,
    views: r.views,
    likes: r.likes,
    comentarios: r.comentarios,
    retweets: r.retweets,
    tipo: r.tipo,
    hashtags: r.hashtags,
    linksExternos: r.links_externos,
    thumbnail: r.thumbnail_original,
    promovido: r.promovido,
    descartado: r.descartado,
    scrapeadoEn: r.scrapeado_en,
  }));

  return NextResponse.json({ items, total: count ?? items.length, page, pageSize });
}

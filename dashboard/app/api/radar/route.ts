import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Tabla única de las tres plataformas (X / YouTube / LinkedIn), con `plataforma` para separarlas.
const RADAR_TABLE = 'radar';
const COLS =
  'id,plataforma,external_id,busqueda_id,busqueda_etiqueta,creador,creador_nombre,creador_url,creador_seguidores,url,caption,respuestas_autor,fecha_publicacion,dia,views,likes,comentarios,compartidos,guardados,velocidad,duracion_seg,tipo,hashtags,links_externos,idioma,hilo_id,thumbnail_original,video_original,temas,promovido,descartado,guardado,scrapeado_en';

// Lo que trajeron las consultas del radar. Devuelve PLANO y ordenado; la vista agrupa por día
// (mismo criterio que las historias: agrupar aquí obligaría a paginar por día y un día partido
// entre dos páginas se rompería).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const busqueda = sp.get('busqueda') || '';
  const plataforma = sp.get('plataforma') || '';
  const tema = sp.get('tema') || '';
  const orden = sp.get('orden') || '';
  const q = sp.get('q')?.trim() || '';
  const desde = sp.get('desde') || '';
  const minLikes = Number(sp.get('minLikes') || 0);
  const verDescartados = sp.get('descartados') === '1';
  const page = Math.max(1, Number(sp.get('page') || 1));
  const pageSize = Math.min(500, Math.max(1, Number(sp.get('pageSize') || 200)));

  let query = getSupabase()
    .from(RADAR_TABLE)
    .select(COLS, { count: 'exact' })
    .order('dia', { ascending: false, nullsFirst: false });

  // Dentro del día: por velocidad (lo que está explotando AHORA) o por reacciones totales. El
  // total absoluto es el orden histórico y se conserva como opción, pero no detecta tendencias:
  // 2 M de vistas en dos años le gana a 40 mil en seis horas y eso es justo lo que no interesa.
  query =
    orden === 'velocidad'
      ? query.order('velocidad', { ascending: false, nullsFirst: false })
      : query.order('likes', { ascending: false, nullsFirst: false });

  query = query.range((page - 1) * pageSize, page * pageSize - 1);

  if (busqueda) query = query.eq('busqueda_id', busqueda);
  if (plataforma) query = query.eq('plataforma', plataforma);
  // `temas` es un array: contains() exige que el tema esté entre los que se le detectaron.
  if (tema) query = query.contains('temas', [tema]);
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
    plataforma: r.plataforma,
    // Se sigue llamando postId hacia la vista: el nombre de la columna cambió a `external_id` al
    // unificar las plataformas, pero renombrarlo también en la UI no aportaba nada.
    postId: r.external_id,
    busquedaId: r.busqueda_id,
    busqueda: r.busqueda_etiqueta,
    creador: r.creador,
    creadorNombre: r.creador_nombre,
    creadorUrl: r.creador_url,
    seguidores: r.creador_seguidores,
    url: r.url,
    caption: r.caption,
    respuestasAutor: Array.isArray(r.respuestas_autor) ? r.respuestas_autor : null,
    fechaPublicacion: r.fecha_publicacion,
    dia: r.dia,
    views: r.views,
    likes: r.likes,
    comentarios: r.comentarios,
    retweets: r.compartidos,
    velocidad: r.velocidad,
    temas: Array.isArray(r.temas) ? r.temas : [],
    tipo: r.tipo,
    duracionSeg: r.duracion_seg,
    hashtags: r.hashtags,
    linksExternos: r.links_externos,
    thumbnail: r.thumbnail_original,
    promovido: r.promovido,
    guardado: r.guardado,
    descartado: r.descartado,
    scrapeadoEn: r.scrapeado_en,
  }));

  return NextResponse.json({ items, total: count ?? items.length, page, pageSize });
}

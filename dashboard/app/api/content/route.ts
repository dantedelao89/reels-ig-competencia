import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import type { ContentItem, Platform } from '@/lib/types';
import { PLATFORMS, PLATFORM_ORDER, type PlatformDef } from '@/lib/platforms';

export const dynamic = 'force-dynamic';

// Tope de filas que traemos por tabla para mergear/ordenar en memoria.
// A escala actual (cientos) es instantáneo. Optimización futura: una VIEW que una ambas tablas.
const CAP = 5000;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const platform = (sp.get('platform') || 'all') as Platform | 'all';
  const estado = sp.get('estado') || '';
  // creador/proyecto aceptan varios valores separados por coma (chips multi-select).
  const creadores = (sp.get('creador') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const proyectos = (sp.get('proyecto') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const q = sp.get('q')?.trim() || '';
  // Origen (solo YouTube): 'canal' = origen es una URL de canal; 'busqueda' = origen es palabra clave.
  const origen = sp.get('origen') || '';
  const sort = sp.get('sort') || 'fecha_publicacion';
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const dateField = sp.get('dateField') === 'scrapeado' ? 'scrapeado_en' : 'fecha_publicacion';
  const desde = sp.get('desde') || '';
  const hasta = sp.get('hasta') || '';
  const page = Math.max(1, Number(sp.get('page') || 1));
  const pageSize = Math.min(120, Math.max(1, Number(sp.get('pageSize') || 40)));

  const supabase = getSupabase();

  // Las columnas LIGERAS de cada plataforma viven en el registro (lib/platforms.ts). Se excluyen a
  // propósito los campos pesados (transcripcion/subtitulos ~95k chars y search_tsv) → la
  // transcripción se carga aparte al abrir el detalle (/api/item).

  // Columna real por la que ordenar EN LA BASE. Clave: Supabase corta en 1000 filas por request,
  // así que sin ORDER BY las filas que llegan son arbitrarias y lo recién scrapeado se queda fuera
  // (bug: las últimas altas no aparecían al superar 1000 filas). Ordenando en la base garantizamos
  // que lleguen las filas correctas para el orden pedido. 'engagement' no es columna → cae a recencia.
  const dbOrderCol =
    sort === 'views' ? 'views' : sort === 'fecha_publicacion' ? 'fecha_publicacion' : 'scrapeado_en';

  // PostgREST corta en 1000 filas por petición pase lo que pase (max_rows), así que un .limit(5000)
  // devolvía 1000 en silencio: con 1243 reels, 243 quedaban invisibles y `total` mentía. Se pagina
  // hasta CAP.
  const PAGE_DB = 1000;

  async function fetchTable(def: PlatformDef): Promise<any[]> {
    const filas: any[] = [];
    for (let from = 0; from < CAP; from += PAGE_DB) {
      let query = supabase
        .from(def.table)
        .select(def.listCols)
        .order(dbOrderCol, { ascending: dir === 'asc', nullsFirst: false })
        .range(from, Math.min(from + PAGE_DB, CAP) - 1);
      if (estado) query = query.eq('estado', estado);
      if (creadores.length) query = query.in(def.autorCol, creadores);
      if (proyectos.length) query = query.in('proyecto', proyectos);
      if (q) query = query.textSearch('search_tsv', q, { config: 'spanish', type: 'websearch' });
      if (desde) query = query.gte(dateField, desde);
      if (hasta) query = query.lte(dateField, hasta);
      // Filtro por origen: solo lo tienen las plataformas con fuentes de dos clases (YouTube:
      // canal vs búsqueda). Canal = origen tipo URL; búsqueda = palabra clave.
      if (def.hasOrigen && origen === 'canal') query = query.ilike('origen', 'http%');
      if (def.hasOrigen && origen === 'busqueda') query = query.not('origen', 'ilike', 'http%');
      const { data, error } = await query;
      if (error) throw new Error(`${def.table}: ${error.message}`);
      if (!data?.length) break;
      filas.push(...data);
      if (data.length < PAGE_DB) break;
    }
    return filas;
  }

  try {
    // Qué plataformas entran en esta consulta. Antes eran dos ternarios binarios
    // (`platform !== 'yt'` / `platform !== 'ig'`) que con una tercera plataforma devolvían la
    // tabla equivocada sin dar error.
    const defs = PLATFORM_ORDER.map((p) => PLATFORMS[p]).filter((def) => {
      if (platform !== 'all' && platform !== def.key) return false;
      // El filtro de origen excluye a quien no lo tiene (si no, se colaría todo su contenido).
      if (origen && !def.hasOrigen) return false;
      // Buscar en una tabla sin search_tsv daría 500; se excluye en vez de devolverla sin filtrar.
      if (q && !def.searchable) return false;
      return true;
    });

    const rowsPorPlataforma = await Promise.all(defs.map((def) => fetchTable(def)));
    const items: ContentItem[] = [];
    defs.forEach((def, i) => rowsPorPlataforma[i].forEach((r) => items.push(def.toItem(r))));

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

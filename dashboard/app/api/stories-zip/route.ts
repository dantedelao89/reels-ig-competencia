import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { buildZip } from '@/lib/zip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const STORIES_TABLE = 'ig_stories';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Tope de seguridad: el ZIP se arma en memoria, así que un día con muchos videos podría tumbar el
// proceso. Antes de llegar ahí se corta y se dice qué pasó.
const MAX_BYTES = 400 * 1024 * 1024;

function isAllowed(url: string): boolean {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base && url.startsWith(base)) return true;
  // Las historias se archivan en R2 al capturarlas; esto solo cubre alguna cuyo archivado falló y
  // todavía apunta al CDN de Instagram (esas URLs caducan en horas).
  return /^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net)\//.test(url);
}

// HHMM en CDMX. Va en el nombre para que, además de quedar en orden, se vea a qué hora se publicó.
function hhmm(iso: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return f.format(new Date(iso)).replace(':', '');
}

// Descarga con un pool de N a la vez, conservando el orden del array de entrada.
// Secuencial no sirve: un día de 30 historias no cabe en el tiempo de la petición.
async function bajarEnPool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = siguiente++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

// Descarga toda la secuencia de un día en un .zip, numerada en el orden en que se publicó.
//
// La lista se arma AQUÍ, desde la base, y no se recibe del navegador: así el zip trae el día
// completo aunque la vista tuviera solo una parte cargada, y el orden es el mismo que usa el
// archivo (fecha_publicacion ascendente).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const dia = String(body?.dia || '').trim();
  const creador = String(body?.creador || '').replace(/^@/, '').toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return NextResponse.json({ error: 'dia requerido (YYYY-MM-DD)' }, { status: 400 });
  }

  let q = getSupabase()
    .from(STORIES_TABLE)
    .select('story_id,creador,fecha_publicacion,tipo,media_url')
    .eq('dia', dia)
    .not('media_url', 'is', null)
    .order('fecha_publicacion', { ascending: true });
  if (creador) q = q.eq('creador', creador);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const historias = data || [];
  if (!historias.length) {
    return NextResponse.json({ error: 'No hay historias archivadas de ese día' }, { status: 404 });
  }

  // Con varias cuentas en el mismo día, el nombre lleva el handle para no mezclarlas.
  const variasCuentas = new Set(historias.map((h: any) => h.creador)).size > 1;
  const ancho = String(historias.length).length;

  let bytes = 0;
  let cortadoPorTamano = false;
  const bajadas = await bajarEnPool(historias, 4, async (h: any, i: number) => {
    if (!h.media_url || !isAllowed(h.media_url) || cortadoPorTamano) return null;
    try {
      const res = await fetch(h.media_url, {
        headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*' },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = Buffer.from(await res.arrayBuffer());
      bytes += data.length;
      if (bytes > MAX_BYTES) {
        cortadoPorTamano = true;
        return null;
      }
      const ext = h.tipo === 'video' ? 'mp4' : 'jpg';
      const partes = [
        String(i + 1).padStart(ancho, '0'),
        hhmm(h.fecha_publicacion),
        ...(variasCuentas ? [String(h.creador || '').replace(/[^\w.-]/g, '_')] : []),
      ];
      return { name: `${partes.join('_')}.${ext}`, data };
    } catch {
      return null;
    }
  });

  const files = bajadas.filter(Boolean) as { name: string; data: Buffer }[];
  const fallidas = historias.length - files.length;
  if (!files.length) {
    return NextResponse.json(
      { error: 'No se pudo bajar ninguna historia de ese día (su archivo en R2 no responde)' },
      { status: 502 }
    );
  }
  if (cortadoPorTamano) {
    console.warn(`[stories-zip] ${dia}: cortado en ${files.length} de ${historias.length} por tamaño`);
  } else if (fallidas) {
    console.warn(`[stories-zip] ${dia}: ${fallidas} de ${historias.length} no se pudieron bajar`);
  }

  const zip = buildZip(files);
  const nombre = `historias_${creador ? creador + '_' : ''}${dia}`.replace(/[^\w.-]/g, '_');
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombre}.zip"`,
      // Cuántas entraron y cuántas no, para que la UI lo pueda decir sin abrir el zip.
      'X-Historias-Incluidas': String(files.length),
      'X-Historias-Totales': String(historias.length),
      'X-Historias-Cortado': cortadoPorTamano ? '1' : '0',
      'Cache-Control': 'no-store',
    },
  });
}

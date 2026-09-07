import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Guarda UN hallazgo del radar de forma permanente.
//
// El radar no archiva nada a propósito (es un firehose del que casi todo se descarta), así que
// "guardar" significa traer el post COMPLETO por la vía normal de X: hilo del autor, video y
// portada archivados en R2. Cae en `x_posts`, o sea la galería de Orgánico, y con eso hereda todo
// lo que ya existe ahí — reproductor, capturador de frames, descarga, transcripción, estados de
// curación y su ID copiable. Por eso no hay una "biblioteca del radar" aparte: seria construir de
// nuevo lo que la galería ya hace.
//
// altaFuente:false es la diferencia con pegar una URL a mano: guardar un post NO debe meter a su
// autor en Fuentes. Para eso está el botón "＋ Fuentes", que es la otra intención.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'Falta el id del hallazgo' }, { status: 400 });

  const supabase = getSupabase();
  const { data: fila, error: e1 } = await supabase
    .from('x_radar')
    .select('id,post_id,url,creador')
    .eq('id', id)
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!fila?.url) return NextResponse.json({ error: 'Ese hallazgo no tiene URL' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/scrape-x-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ url: fila.url, altaFuente: false }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }

    // Se marca DESPUÉS de que el scraper confirmó: si falla, el botón sigue disponible en vez de
    // quedar en un "guardado" que no existe.
    await supabase.from('x_radar').update({ guardado: true }).eq('id', id);

    return NextResponse.json({
      ok: true,
      postId: data.postId,
      creador: data.creador,
      // El código con el que se encuentra en la galería (pegándolo en el buscador).
      codigo: `X-${data.postId}`,
      respuestasAutor: data.respuestasAutor ?? 0,
    });
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'El guardado tardó demasiado' : e.message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Baja el MP4 de un TikTok (sin marca de agua) a través del scraper, que es quien tiene la llave
// de RapidAPI.
//
// Por qué no se baja directo desde aquí con /api/download, que ya permite los CDN de TikTok: esa
// ruta necesita una URL de archivo, y las filas de TikTok NO guardan ninguna — el actor solo
// devuelve el MP4 si se le pide `shouldDownloadVideos`, y el scrape normal lo lleva apagado. La
// URL del archivo hay que resolverla en el momento, y además caduca, así que guardarla tampoco
// serviría: en unas semanas el botón apuntaría a un enlace muerto.
//
// Se reenvía el cuerpo TAL CUAL, sin leerlo en memoria, igual que en /api/descargar-yt.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.url) return NextResponse.json({ error: 'url requerida' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/descargar-tiktok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ url: body.url }),
      signal: AbortSignal.timeout(290_000),
    });

    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      return NextResponse.json({ error: d.error || `scraper ${res.status}` }, { status: 502 });
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'video/mp4',
        'Content-Disposition':
          res.headers.get('content-disposition') || 'attachment; filename="tiktok.mp4"',
        // A diferencia de YouTube aquí el tamaño se conoce (no se recodifica), así que se propaga
        // para que el navegador enseñe el progreso real.
        ...(res.headers.get('content-length')
          ? { 'Content-Length': res.headers.get('content-length')! }
          : {}),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

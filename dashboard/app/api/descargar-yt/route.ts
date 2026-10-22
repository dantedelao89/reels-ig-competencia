import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Baja el MP4 de un video de YouTube a través del scraper, que es quien tiene ffmpeg para unir las
// pistas de video y audio (YouTube las sirve separadas salvo en una pista de 360p).
//
// Pasa el archivo TAL CUAL en vez de leerlo entero en memoria: un video de 8 minutos son decenas
// de MB, y bufferizarlos aquí multiplicaría la memoria del panel por cada descarga simultánea.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.url) return NextResponse.json({ error: 'url requerida' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/descargar-yt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ url: body.url, altura: body.altura ?? 1080 }),
      signal: AbortSignal.timeout(290_000),
    });

    if (!res.ok || !res.body) {
      const d = await res.json().catch(() => ({}));
      // El 403 del CDN de YouTube se distingue a propósito: no se arregla reintentando, se arregla
      // bajándolo desde otra red. Decirlo aquí evita que el usuario insista contra una pared.
      return NextResponse.json({ error: d.error || `scraper ${res.status}` }, { status: 502 });
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'video/mp4',
        'Content-Disposition': res.headers.get('content-disposition') || 'attachment; filename="video.mp4"',
        ...(res.headers.get('content-length') ? { 'Content-Length': res.headers.get('content-length')! } : {}),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

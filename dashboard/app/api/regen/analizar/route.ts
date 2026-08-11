import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Proxy al scraper: lee el carrusel con visión y propone 5 titulares. ~30-60s. No gasta en imágenes.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const { shortcode, brief } = await req.json().catch(() => ({}));
  if (!shortcode) return NextResponse.json({ error: 'Falta shortcode' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/regen/analizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ shortcode, brief }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'La lectura tardó demasiado' : e.message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

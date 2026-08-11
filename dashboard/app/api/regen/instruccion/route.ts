import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Proxy al scraper: interpreta una instrucción en lenguaje natural y regenera las láminas
// afectadas. Responde con la interpretación en ~5-15s; la regeneración sigue en background.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const { shortcode, texto } = await req.json().catch(() => ({}));
  if (!shortcode || !texto?.trim()) {
    return NextResponse.json({ error: 'Falta shortcode o texto' }, { status: 400 });
  }

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/regen/instruccion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ shortcode, texto }),
      signal: AbortSignal.timeout(115_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: res.status === 409 ? 409 : 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

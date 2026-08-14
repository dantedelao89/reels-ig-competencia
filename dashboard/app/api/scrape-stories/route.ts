import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Proxy al scraper: captura la bandeja de historias de 24h de un creador y la archiva.
// Devuelve el objeto completo (no solo un contador) para que el toast pueda decir exactamente
// qué pasó: privada, sin historias, sin novedades, o N nuevas.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const { url } = await req.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: 'Falta la cuenta' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/scrape-stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'La captura tardó demasiado' : e.message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

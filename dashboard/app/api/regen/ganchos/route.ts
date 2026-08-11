import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Proxy al scraper: otros 5 titulares reusando el análisis ya guardado (~10s, sin visión).
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const { shortcode, brief, excluir } = await req.json().catch(() => ({}));
  if (!shortcode) return NextResponse.json({ error: 'Falta shortcode' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/regen/ganchos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ shortcode, brief, excluir }),
      signal: AbortSignal.timeout(55_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

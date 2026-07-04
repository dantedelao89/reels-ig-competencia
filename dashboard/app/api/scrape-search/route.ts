import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Dispara en el scraper una búsqueda de YouTube por palabra clave (la fila de "Búsquedas YT").
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  // scrapeOne manda { url: row.key } donde row.key es la palabra clave.
  const query = body?.query || body?.url;
  if (!query) return NextResponse.json({ error: 'query requerida' }, { status: 400 });
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/scrape-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ query, maxResults: 30 }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({ error: 'respuesta inválida del scraper' }));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `scraper ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, inserted: data.inserted ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Dispara en el scraper la búsqueda de variantes A/B (portada/título) de UN video de YouTube.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.videoId) return NextResponse.json({ error: 'videoId requerido' }, { status: 400 });
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/scrape-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ videoId: body.videoId }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({ error: 'respuesta inválida del scraper' }));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `scraper ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      added: !!data.added,
      message: data.message || '',
      variantes: data.variantes || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

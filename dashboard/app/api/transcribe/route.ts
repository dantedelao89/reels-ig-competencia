import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Dispara la transcripción manual en el scraper (que tiene OpenRouter + Apify) y devuelve el texto.
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.id || (body?.platform !== 'yt' && body?.platform !== 'ad') || !body?.url) {
    return NextResponse.json({ error: 'platform (yt|ad), id y url requeridos' }, { status: 400 });
  }
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ platform: body.platform, id: body.id, url: body.url }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({ error: 'respuesta inválida del scraper' }));
    if (!res.ok || !data.ok) {
      return NextResponse.json({ error: data.error || `scraper ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, text: data.text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

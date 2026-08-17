import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Proxy al scraper: trae UN video de TikTok por su URL (＋Agregar por URL).
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const { url } = await req.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: 'Falta la URL' }, { status: 400 });

  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/scrape-tiktok-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      inserted: data.inserted ?? 0,
      creador: data.creador,
      cuentaNueva: data.cuentaNueva,
      videoId: data.videoId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

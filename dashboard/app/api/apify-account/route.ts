import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Trae del scraper la info de la cuenta de Apify conectada (nombre + uso/saldo). Panel privado.
export async function GET() {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/apify-account`, {
      headers: { 'x-trigger-secret': secret },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({ error: 'respuesta inválida del scraper' }));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `scraper ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

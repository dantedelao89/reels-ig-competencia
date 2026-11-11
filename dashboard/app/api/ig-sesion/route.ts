import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Pregunta al scraper si la sesión de Instagram sigue viva y con qué cuenta. El scraper NUNCA
// devuelve la cookie, así que aquí no hay nada que curar: se pasa tal cual.
export async function GET() {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/ig-sesion`, {
      headers: { 'x-trigger-secret': secret },
      // Más holgado que los otros: esta llamada sale a Instagram de verdad, no es solo lectura local.
      signal: AbortSignal.timeout(25_000),
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

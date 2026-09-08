import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Proxy al scraper: estado real de los crons.
//
// Existe porque el estado del cron vivía SOLO en una variable de entorno de Railway, invisible
// desde el dashboard. Cuando la variable no llegó al servicio, desde la interfaz se veía idéntico
// a estar encendido: el botón manual de "Capturar historias" funciona igual en ambos casos. Se
// perdieron dos vueltas de depuración por eso, así que el estado se muestra en pantalla.
export async function GET(_req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/crons`, {
      headers: { 'x-trigger-secret': secret },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'El scraper no respondió' : e.message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Proxy al scraper: corre TODAS las búsquedas de Reddit.
//
// No hay versión "una sola búsqueda" como en X a propósito: el actor de Reddit hace una única
// corrida de Apify con todas las búsquedas y cobra $0.04 solo por arrancar, así que disparar una
// costaría lo mismo que disparar las seis. El botón de una fila corre la pasada completa.
//
// Ojo con el tiempo: el actor abre cada post con un navegador para sacar los upvotes y va a unos
// 3 posts por minuto. Una pasada de 30 posts puede pasar de los 290 s de este proxy; cuando eso
// pasa, la corrida SIGUE en Apify y los hallazgos se guardan igual — lo que se pierde es la
// respuesta, no el trabajo.
export async function POST(_req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/radar-rd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      // Sin avisar: el disparo manual no debe escribir en el canal de Slack. Eso lo hace el cron.
      body: JSON.stringify({ avisar: false }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `Error ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e: any) {
    const msg =
      e?.name === 'TimeoutError'
        ? 'La corrida pasó de 5 minutos. Sigue en Apify y los hallazgos se guardarán igual; recarga el Radar en un rato.'
        : e.message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

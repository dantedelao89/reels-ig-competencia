import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Extrae la "clave" de una URL de página de Facebook: id numérico (profile.php?id= / /people/…/ID /
// /ID) o, si no, el handle. Es la misma clave con la que se cruzan meta_ads.pagina_url y
// fb_advertisers.url (que suelen venir en formatos distintos apuntando al mismo anunciante).
function keyFromUrl(url: string): string | null {
  const s = url || '';
  const num =
    s.match(/[?&]id=(\d{6,})/) ||
    s.match(/facebook\.com\/people\/[^/]+\/(\d{6,})/i) ||
    s.match(/facebook\.com\/(\d{6,})(?:[/?]|$)/i);
  if (num) return num[1];
  const handle = s.match(/facebook\.com\/([^/?#]+)/i);
  return handle ? handle[1].toLowerCase() : null;
}

// Re-scrapea al anunciante dueño de un anuncio para traer sus anuncios nuevos. Recibe la pagina_url
// del anuncio, ubica su fila en fb_advertisers (Fuentes) por clave y dispara el mismo scrape que el
// botón "⚡ Scrapear" de Fuentes (/scrape-ads con la URL de la fuente, que resuelve el page_id bien).
export async function POST(req: NextRequest) {
  const scraper = process.env.SCRAPER_URL;
  const secret = process.env.TRANSCRIBE_SECRET;
  if (!scraper || !secret) {
    return NextResponse.json({ error: 'Falta SCRAPER_URL / TRANSCRIBE_SECRET' }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  const paginaUrl = (body?.paginaUrl || '').trim();
  if (!paginaUrl) return NextResponse.json({ error: 'paginaUrl requerida' }, { status: 400 });

  // 1) Ubica la fuente (fb_advertisers) que corresponde a este anuncio.
  const key = keyFromUrl(paginaUrl);
  let sourceUrl: string | null = null;
  let marca: string | null = null;
  try {
    const { data, error } = await getSupabase().from('fb_advertisers').select('url, marca');
    if (error) throw new Error(error.message);
    const match = (data || []).find((r: any) => keyFromUrl(r.url || '') === key);
    if (match) {
      sourceUrl = match.url;
      marca = match.marca ?? null;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  if (!sourceUrl) {
    return NextResponse.json(
      { error: 'Este anunciante no está en Fuentes. Agrégalo ahí para poder re-scrapearlo.' },
      { status: 404 }
    );
  }

  // 2) Dispara el scrape del anunciante (mismo endpoint que usa Fuentes).
  try {
    const res = await fetch(`${scraper.replace(/\/$/, '')}/scrape-ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trigger-secret': secret },
      body: JSON.stringify({ url: sourceUrl }),
      signal: AbortSignal.timeout(290_000),
    });
    const data = await res.json().catch(() => ({ error: 'respuesta inválida del scraper' }));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ error: data.error || `scraper ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, inserted: data.inserted ?? 0, marca });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

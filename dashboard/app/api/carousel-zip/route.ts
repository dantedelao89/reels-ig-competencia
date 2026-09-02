import { NextRequest, NextResponse } from 'next/server';
import { buildZip } from '@/lib/zip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Empaqueta las diapositivas de un carrusel (imágenes + videos, ya en R2) en un solo .zip, con los
// archivos numerados en orden. El ZIP lo arma lib/zip.ts, compartido con la descarga de historias.

function isAllowed(url: string): boolean {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base && url.startsWith(base)) return true;
  // twimg.com: los posts de X con varias fotos reutilizan este ZIP. Sus imágenes ya se archivan
  // en R2 (caso de arriba); esto solo cubre aquellas cuyo rehost falló.
  return /^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net|ytimg\.com|twimg\.com)\//.test(url);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const slides: { url: string; name: string }[] = Array.isArray(body?.slides) ? body.slides : [];
  const zipName = (body?.zipName || 'carrusel').toString().replace(/[^\w.-]/g, '_');
  if (!slides.length) return NextResponse.json({ error: 'slides requerido' }, { status: 400 });

  try {
    // Cada slide se baja por separado: una diapositiva caída (URL de Instagram caducada) ya no
    // tumba el zip entero. Se manda User-Agent porque los CDN de Meta rechazan las peticiones
    // sin él.
    const UA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    const files: { name: string; data: Buffer }[] = [];
    let fallidas = 0;
    for (const s of slides) {
      if (!s?.url || !isAllowed(s.url)) {
        fallidas++;
        continue;
      }
      try {
        const res = await fetch(s.url, {
          headers: { 'User-Agent': UA, Accept: 'image/*,video/*,*/*' },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = Buffer.from(await res.arrayBuffer());
        files.push({ name: (s.name || 'archivo').replace(/[^\w.-]/g, '_'), data });
      } catch {
        fallidas++;
      }
    }
    if (!files.length) {
      return NextResponse.json(
        {
          error:
            'Las imágenes de este carrusel ya caducaron en Instagram y no se guardaron en R2. Vuelve a scrapear el post (pega su URL en “＋Agregar por URL”) y se arregla.',
        },
        { status: 502 }
      );
    }
    if (fallidas) console.warn(`[carousel-zip] ${fallidas} de ${slides.length} diapositivas no se pudieron bajar`);
    const zip = buildZip(files);
    // Buffer de Node no es BodyInit para la Web Response → lo pasamos como Uint8Array.
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

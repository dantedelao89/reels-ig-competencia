import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Proxy de descarga: fuerza la descarga de una miniatura o del medio completo (video/imagen).
// Restringido al bucket R2 público (y a los CDNs originales) para no ser un open proxy.
//
// Hace falta el proxy porque el atributo `download` de un <a> lo IGNORA el navegador cuando el
// archivo viene de otro origen: sin esto, "descargar" abría el archivo en una pestaña.

function isAllowed(url: string): boolean {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base && url.startsWith(base)) return true;
  // twimg.com = los CDN de X: pbs (imágenes) y video (los MP4). Aunque el medio de X ya se
  // archiva en R2, se permiten para poder descargar un post cuyo rehost falló.
  return /^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net|ytimg\.com|tiktokcdn\.com|tiktokcdn-us\.com|ttwstatic\.com|tiktokv\.com|twimg\.com)\//.test(url);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || '';
  const name = req.nextUrl.searchParams.get('name') || 'thumbnail.jpg';
  if (!isAllowed(url)) {
    return NextResponse.json({ error: 'url no permitida' }, { status: 400 });
  }
  // UA de navegador: los CDN de Meta y de X rechazan peticiones sin él (es la misma causa que
  // dejó 4 items con la miniatura rota en producción).
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(290_000),
  });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: `origen ${res.status}` }, { status: 502 });
  }
  const headers: Record<string, string> = {
    'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`,
    'Cache-Control': 'no-store',
  };
  // El largo, cuando el origen lo dice, para que el navegador muestre el progreso real.
  const len = res.headers.get('content-length');
  if (len) headers['Content-Length'] = len;
  // Se reenvía el cuerpo en streaming en vez de cargarlo entero a memoria: un video de X puede
  // pesar decenas de MB y bufferizarlo por descarga es gratis de evitar.
  return new NextResponse(res.body, { headers });
}

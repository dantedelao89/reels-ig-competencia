import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Sirve un medio de R2 desde NUESTRO origen, para reproducirlo.
//
// Existe por una sola razón: el capturador de frames. Dibujar un `<video>` en un `<canvas>` "mancha"
// el canvas si el video viene de otro origen, y entonces `toBlob()` lanza SecurityError. La salida
// normal sería CORS, pero el dominio público de R2 (`pub-….r2.dev`) IGNORA la configuración CORS
// del bucket — comprobado: se aplicó la regla por la API S3 y el dominio siguió sin mandar
// `Access-Control-Allow-Origin`, y el preflight OPTIONS responde 403. Cloudflare solo respeta CORS
// en dominios propios. Sirviéndolo desde aquí el canvas queda limpio y la captura sale en la
// resolución nativa del video.
//
// Se reenvía `Range` tal cual: sin eso el navegador no puede saltar por el video ni pausar donde
// quiera, que es justo lo que hace falta para elegir el frame.

function isAllowed(url: string): boolean {
  const base = process.env.R2_PUBLIC_BASE_URL;
  return !!base && url.startsWith(base);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || '';
  if (!isAllowed(url)) {
    return NextResponse.json({ error: 'url no permitida' }, { status: 400 });
  }

  const range = req.headers.get('range');
  const res = await fetch(url, {
    headers: {
      ...(range ? { Range: range } : {}),
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(290_000),
  });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: `origen ${res.status}` }, { status: 502 });
  }

  const headers: Record<string, string> = {
    'Content-Type': res.headers.get('content-type') || 'video/mp4',
    // Sin accept-ranges el navegador asume que no puede saltar y deshabilita la barra de progreso.
    'Accept-Ranges': res.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }
  // Se conserva el 206 del origen: devolver 200 a una petición con Range rompe la búsqueda.
  return new NextResponse(res.body, { status: res.status, headers });
}

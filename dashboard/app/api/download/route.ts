import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Proxy de descarga: fuerza la descarga de una thumbnail. Restringido al bucket R2 público
// (y a los CDNs originales) para no ser un open proxy.
const ALLOWED = [
  process.env.R2_PUBLIC_BASE_URL || '',
  'https://',
].filter(Boolean);

function isAllowed(url: string): boolean {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base && url.startsWith(base)) return true;
  return /^https:\/\/[^/]+\.(cdninstagram\.com|fbcdn\.net|ytimg\.com)\//.test(url);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || '';
  const name = req.nextUrl.searchParams.get('name') || 'thumbnail.jpg';
  if (!isAllowed(url)) {
    return NextResponse.json({ error: 'url no permitida' }, { status: 400 });
  }
  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: `origen ${res.status}` }, { status: 502 });
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/jpeg',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

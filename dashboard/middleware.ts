import { NextRequest, NextResponse } from 'next/server';
import { sessionToken, SESSION_COOKIE } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Rutas públicas: la pantalla de login y su endpoint.
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login')) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const expected = await sessionToken();
  if (cookie && cookie === expected) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

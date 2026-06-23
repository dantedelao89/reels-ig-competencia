import { NextRequest, NextResponse } from 'next/server';
import { sessionToken, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || password !== expected) {
    return NextResponse.json({ ok: false, error: 'Password incorrecto' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// Token de sesión = HMAC-SHA256(SESSION_SECRET, payload fijo). Funciona en edge (middleware)
// y en node (route handlers) usando Web Crypto. Suficiente para un dashboard privado de 1 usuario.

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET || 'dev-secret-cambialo';
  return hmacHex(secret, 'dashboard-session-v1');
}

export const SESSION_COOKIE = 'dash_session';

// Slash command de Slack (/scrape <url>): verifica la firma de cada request y responde de forma
// diferida vía response_url (Slack exige un ACK en <3s; el scrape real tarda más que eso).

import crypto from 'crypto';
import { config } from './config.js';

export function verifySlackSignature(req) {
  if (!config.slackSigningSecret) return true; // sin secreto configurado (dev local)
  const ts = req.get('x-slack-request-timestamp');
  const sig = req.get('x-slack-signature');
  if (!ts || !sig || !req.rawBody) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false; // anti-replay (5 min)
  const base = `v0:${ts}:${req.rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', config.slackSigningSecret).update(base).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function slackReply(responseUrl, textOrPayload) {
  const payload = typeof textOrPayload === 'string' ? { text: textOrPayload } : textOrPayload;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[slack] no se pudo responder vía response_url:', e.message);
  }
}

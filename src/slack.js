// Slash command de Slack (/scrape <url>): verifica la firma de cada request y responde de forma
// diferida vía response_url (Slack exige un ACK en <3s; el scrape real tarda más que eso).

import crypto from 'crypto';
import { config } from './config.js';

// Un rechazo aquí devolvía 401 sin dejar rastro, así que un comando que "no llegó" era
// indistinguible de uno que nunca se envió. Ahora cada rechazo dice por qué.
export function verifySlackSignature(req) {
  if (!config.slackSigningSecret) return true; // sin secreto configurado (dev local)
  const ts = req.get('x-slack-request-timestamp');
  const sig = req.get('x-slack-signature');
  if (!ts || !sig || !req.rawBody) {
    console.warn('[slack] petición rechazada: faltan cabeceras de firma o el body crudo');
    return false;
  }
  const desfase = Math.abs(Date.now() / 1000 - Number(ts));
  if (desfase > 60 * 5) {
    console.warn(`[slack] petición rechazada: timestamp desfasado ${Math.round(desfase)}s (máx 300)`);
    return false; // anti-replay (5 min)
  }
  const base = `v0:${ts}:${req.rawBody}`;
  const expected = 'v0=' + crypto.createHmac('sha256', config.slackSigningSecret).update(base).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) console.warn('[slack] petición rechazada: la firma no coincide (¿SLACK_SIGNING_SECRET distinto?)');
  return ok;
}

// Todo mensaje a response_url SIN `response_type` sale EFÍMERO: solo lo ve quien lanzó el comando
// y Slack no lo conserva al recargar ni entre el iPhone y el escritorio. El ACK "🔄 Procesando…" sí
// es in_channel, así que quedaba fijo en el canal mientras el ✅ se esfumaba: el comando "se quedaba
// procesando" aunque hubiera terminado bien (medido 13 sep 2026: 6 de 8 /scrape se guardaron y aun
// así parecían colgados). Por eso aquí todo va al canal salvo que se pida efímero explícito.
//
// Tampoco se revisaba la respuesta. Slack acepta como máximo 5 mensajes por response_url en 30 min
// y rechaza el resto (`used_url`, `expired_url`); ese rechazo no dejaba ni un log. Devuelve si Slack
// lo aceptó, para que quien llama pueda saberlo.
export async function slackReply(responseUrl, textOrPayload) {
  const payload = typeof textOrPayload === 'string' ? { text: textOrPayload } : { ...textOrPayload };
  if (!payload.response_type) payload.response_type = 'in_channel';
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const cuerpo = await res.text().catch(() => '');
    if (!res.ok || /"ok"\s*:\s*false/.test(cuerpo)) {
      console.error(`[slack] Slack rechazó el mensaje (${res.status}): ${cuerpo.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[slack] no se pudo responder vía response_url:', e.message);
    return false;
  }
}

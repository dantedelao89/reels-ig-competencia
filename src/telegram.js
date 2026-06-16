// Utilidades del bot de Telegram: enviar mensajes y validar quién puede disparar.

import { config } from './config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;

export async function tgSend(chatId, text) {
  if (!config.telegramBotToken) return;
  try {
    await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error('[telegram] sendMessage falló:', e.message);
  }
}

// Por seguridad: si la lista blanca está vacía, nadie está autorizado todavía.
export function isAllowed(chatId) {
  if (config.telegramAllowedChatIds.length === 0) return false;
  return config.telegramAllowedChatIds.includes(String(chatId));
}

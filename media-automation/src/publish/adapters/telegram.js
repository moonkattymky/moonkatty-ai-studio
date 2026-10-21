'use strict';
const fs = require('fs'); const path = require('path'); const { call } = require('../http');
/** Telegram Bot API: sendVideo / sendPhoto / sendMessage to a channel (bot must be channel admin). */
class TelegramAdapter {
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.platform = 'telegram'; }
  validate(p) { const e = []; if (!p.chatId) e.push('chatId required'); if (!p.text && !p.videoPath && !p.imagePath) e.push('text or media required'); if ((p.text || '').length > (p.videoPath || p.imagePath ? 1024 : 4096)) e.push('text too long'); return e; }
  preview(p) { return { platform: this.platform, chatId: p.chatId, kind: p.videoPath ? 'video' : p.imagePath ? 'photo' : 'text', text: p.text }; }
  async publish(p, { token }) {
    const base = `https://api.telegram.org/bot${token}`; let method, body;
    if (p.videoPath || p.imagePath) {
      const file = p.videoPath || p.imagePath; method = p.videoPath ? 'sendVideo' : 'sendPhoto';
      body = new FormData(); body.set('chat_id', String(p.chatId)); if (p.text) body.set('caption', p.text); if (p.videoPath) body.set('supports_streaming', 'true');
      body.set(p.videoPath ? 'video' : 'photo', new Blob([fs.readFileSync(file)]), path.basename(file));
    } else { method = 'sendMessage'; body = JSON.stringify({ chat_id: p.chatId, text: p.text, disable_web_page_preview: false }); }
    const r = await call(this.fetchFn, 'telegram', `${base}/${method}`, { method: 'POST', body, headers: typeof body === 'string' ? { 'content-type': 'application/json' } : undefined });
    if (!r.body.ok) throw new Error('telegram: ' + JSON.stringify(r.body).slice(0, 200));
    const msg = r.body.result; const ch = String(p.chatId).replace(/^@/, '');
    return { remoteId: `${p.chatId}:${msg.message_id}`, url: /^-?\d+$/.test(ch) ? null : `https://t.me/${ch}/${msg.message_id}` };
  }
  async status(remoteId) { return { state: 'sent', remoteId }; } // Bot API has no per-message status endpoint
}
module.exports = { TelegramAdapter };

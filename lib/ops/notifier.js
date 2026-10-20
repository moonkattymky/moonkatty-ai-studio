// Pluggable owner notifications. Disabled by default (OPS_NOTIFY unset → "none").
// OPS_NOTIFY=ntfy     + OPS_NTFY_URL (e.g. https://ntfy.sh/<secret-topic> or self-hosted) [+ OPS_NTFY_TOKEN]
// OPS_NOTIFY=telegram + OPS_TELEGRAM_BOT_TOKEN + OPS_TELEGRAM_CHAT_ID
// Deduplication: the same key is sent at most once per `dedupeMs`. Messages are redacted.
'use strict';
const sec = require('../security.js');
function makeNotifier(env = process.env, { fetchFn = globalThis.fetch, now = Date.now, dedupeMs = 30 * 60000, log = () => {} } = {}) {
  const kind = String(env.OPS_NOTIFY || 'none').toLowerCase(); const sent = new Map(); const outbox = [];
  const transports = {
    none: async () => ({ ok: true, skipped: 'disabled' }),
    ntfy: async (title, body, prio) => {
      if (!env.OPS_NTFY_URL || !/^https:\/\//.test(env.OPS_NTFY_URL)) return { ok: false, error: 'OPS_NTFY_URL (https) не задан' };
      const h = { Title: encodeURIComponent(title).slice(0, 200), Priority: prio === 'critical' ? '5' : prio === 'warn' ? '4' : '3' };
      if (env.OPS_NTFY_TOKEN) h.Authorization = 'Bearer ' + env.OPS_NTFY_TOKEN;
      const r = await fetchFn(env.OPS_NTFY_URL, { method: 'POST', headers: h, body, signal: AbortSignal.timeout(10000) }); return { ok: r.ok, status: r.status };
    },
    telegram: async (title, body) => {
      if (!env.OPS_TELEGRAM_BOT_TOKEN || !env.OPS_TELEGRAM_CHAT_ID) return { ok: false, error: 'Telegram не настроен' };
      const r = await fetchFn(`https://api.telegram.org/bot${env.OPS_TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.OPS_TELEGRAM_CHAT_ID, text: `${title}\n${body}`.slice(0, 4000), disable_web_page_preview: true }), signal: AbortSignal.timeout(10000) });
      return { ok: r.ok, status: r.status };
    }
  };
  if (!transports[kind]) throw new Error('Неизвестный OPS_NOTIFY: ' + kind);
  async function notify({ key, title, body = '', level = 'warn' }) {
    const t = now(); const k = key || title;
    if (sent.has(k) && t - sent.get(k) < dedupeMs) return { ok: true, skipped: 'dedupe' };
    sent.set(k, t); const msg = { at: new Date(t).toISOString(), key: k, title: sec.redact(title), body: sec.redact(body), level };
    outbox.push(msg); if (outbox.length > 100) outbox.shift();
    try { return await transports[kind](msg.title, msg.body, level); } catch (e) { log('notify failed: ' + sec.redact(e.message)); return { ok: false, error: e.name }; }
  }
  return { kind, enabled: kind !== 'none', notify, outbox };
}
module.exports = { makeNotifier };

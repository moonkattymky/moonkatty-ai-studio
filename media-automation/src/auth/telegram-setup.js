'use strict';
/** Telegram bot setup: validate token via getMe, optional channel check via getChat + bot admin check, then store in secret store. */
async function setupTelegram({ token, channel, secrets, fetchFn = globalThis.fetch }) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token || '')) throw new Error('token format invalid (expected <digits>:<35 chars>)');
  const api = async (m, q = {}) => { const r = await fetchFn(`https://api.telegram.org/bot${token}/${m}?${new URLSearchParams(q)}`); const j = JSON.parse(await r.text() || '{}');
    if (!j.ok) throw new Error(`telegram ${m}: ${j.description || r.status}`); return j.result; };
  const me = await api('getMe'); if (!me.is_bot) throw new Error('token is not a bot');
  let chat = null, admin = null;
  if (channel) { chat = await api('getChat', { chat_id: channel }); const m = await api('getChatMember', { chat_id: channel, user_id: me.id }); admin = ['administrator', 'creator'].includes(m.status) && (m.can_post_messages !== false); }
  await secrets.set('telegram_bot_token', token);
  return { bot: { id: me.id, username: me.username }, channel: chat ? { id: chat.id, title: chat.title, type: chat.type } : null, canPost: admin };
}
module.exports = { setupTelegram };

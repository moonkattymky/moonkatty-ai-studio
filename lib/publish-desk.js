// Telegram and YouTube connection desk.
// Tokens go only to macOS Keychain (security -i, never argv). No Keychain → nothing is stored.
// "Подключено" is returned only after a live check in this request. TEST builds never send a post.
'use strict';
const fs = require('fs'), path = require('path');
const { setupTelegram } = require('../media-automation/src/auth/telegram-setup.js');

const TOKEN_RE = /\d{5,}:[A-Za-z0-9_-]{20,}/g;
const redact = s => String(s ?? '').replace(TOKEN_RE, '[token]');

function mountPublishDesk(app, { dataDir, log, keystore, isTest, fetchFn = globalThis.fetch }) {
  const journal = path.join(dataDir, 'publish-journal.jsonl');
  const queueFile = path.join(dataDir, 'publish-queue.json');
  const checksFile = path.join(dataDir, 'publish-checks.json');
  function note(row) {
    const safe = JSON.parse(redact(JSON.stringify(row)));
    fs.appendFileSync(journal, JSON.stringify({ at: new Date().toISOString(), ...safe }) + '\n', { mode: 0o600 });
    try { log('info', 'publish', [safe.event, safe.channel, safe.code].filter(Boolean).join(' ')); } catch {}
  }
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  function stored(account) { if (!keystore.available()) return false; try { return !!keystore.secretGet(account); } catch { return false; } }
  function checks() { return readJson(checksFile, {}); }

  function telegramView() {
    const kc = keystore.available();
    const has = stored('telegram_bot_token');
    const live = checks().telegram;
    const connected = !!(kc && has && live && live.ok === true && live.username);
    return { id: 'telegram', connected, status: connected ? 'Подключено' : 'Не подключено', tokenStored: has, bot: connected ? live.username : null, checkedAt: live && live.at || null, keychain: kc,
      blocker: !kc ? 'macOS Keychain недоступна. Токен бота не сохраняется.' : !has ? 'Нет токена бота. Пароль аккаунта Telegram не нужен.' : !connected ? 'Токен в Keychain, живая проверка getMe не подтверждена.' : null };
  }
  function youtubeView() {
    const kc = keystore.available();
    const has = stored('youtube_oauth_client');
    const live = checks().youtube;
    const connected = !!(kc && has && live && live.ok === true);
    return { id: 'youtube', connected, status: connected ? 'Подключено' : 'Не подключено', clientStored: has, keychain: kc,
      blocker: !kc ? 'macOS Keychain недоступна. OAuth-клиент не сохраняется.' : !has ? 'Нет OAuth-клиента YouTube. Пароль Google не запрашивается.' : 'Клиент в Keychain. Вход владельца в браузере на этом запуске не выполнялся.' };
  }

  app.get('/api/publish/connectors', (req, res) => {
    res.json({ telegram: telegramView(), youtube: youtubeView(), publishEnabled: false, queue: readJson(queueFile, []),
      reason: isTest ? 'TEST-сборка не отправляет посты в сети.' : 'Отправка выключена, пока нет отдельного разрешения на публикацию.' });
  });

  app.post('/api/publish/telegram', async (req, res) => {
    const token = req.body && req.body.token;
    const channel = req.body && req.body.channel ? String(req.body.channel).slice(0, 80) : undefined;
    if (!keystore.available()) { note({ event: 'refused', channel: 'telegram', code: 'keychain_unavailable' });
      return res.status(424).json({ error: 'Keychain недоступна. Токен не сохранён.', code: 'keychain_unavailable', status: 'Не подключено', connected: false }); }
    try {
      const result = await setupTelegram({ token, channel, fetchFn, secrets: { set: async (name, value) => { if (name !== 'telegram_bot_token') throw new Error('unexpected secret'); keystore.secretSet(name, value); } } });
      const prev = checks();
      fs.writeFileSync(checksFile, JSON.stringify({ ...prev, telegram: { ok: true, username: result.bot.username, at: new Date().toISOString() } }, null, 2), { mode: 0o600 });
      note({ event: 'checked', channel: 'telegram', code: 'ok', bot: result.bot.username });
      return res.json({ status: 'Подключено', connected: true, bot: result.bot.username, channel: result.channel ? result.channel.title : null });
    } catch (e) {
      note({ event: 'error', channel: 'telegram', code: 'check_failed', message: redact(e.message).slice(0, 200) });
      return res.status(400).json({ error: redact(e.message).slice(0, 300), code: 'check_failed', status: 'Не подключено', connected: false });
    }
  });

  app.post('/api/publish/youtube/client', (req, res) => {
    const b = req.body || {};
    if (!keystore.available()) { note({ event: 'refused', channel: 'youtube', code: 'keychain_unavailable' });
      return res.status(424).json({ error: 'Keychain недоступна. Клиент не сохранён.', code: 'keychain_unavailable', status: 'Не подключено', connected: false }); }
    if (typeof b.client_id !== 'string' || !/^[\w.-]{8,200}$/.test(b.client_id)) return res.status(400).json({ error: 'Нужен client_id', code: 'bad_client', status: 'Не подключено', connected: false });
    if (b.client_secret != null && (typeof b.client_secret !== 'string' || b.client_secret.length > 200)) return res.status(400).json({ error: 'client_secret', code: 'bad_client' });
    keystore.secretSet('youtube_oauth_client', JSON.stringify({ client_id: b.client_id, ...(b.client_secret ? { client_secret: b.client_secret } : {}) }));
    note({ event: 'client_stored', channel: 'youtube', code: 'not_authorized' });
    return res.json({ status: 'Не подключено', connected: false, clientStored: true, blocker: 'Клиент записан в Keychain. Канал не подключён: нужен вход владельца в браузере на Mac. Пароль Google сюда не вводится.' });
  });

  app.post('/api/publish/queue', (req, res) => {
    const b = req.body || {};
    const text = String(b.text || '').trim();
    if (!text || typeof b.contentHash !== 'string' || !b.contentHash) return res.status(400).json({ error: 'Нужны text и contentHash' });
    const channel = b.channel === 'youtube' ? 'youtube' : 'telegram';
    const row = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), channel, text: text.slice(0, 4000), contentHash: b.contentHash.slice(0, 128), scheduledAt: b.scheduledAt || null, status: 'queued', by: req.user || null, at: new Date().toISOString() };
    const rows = readJson(queueFile, []); rows.push(row); fs.writeFileSync(queueFile, JSON.stringify(rows, null, 2), { mode: 0o600 });
    note({ event: 'queued', channel, id: row.id });
    return res.status(201).json(row);
  });

  app.post('/api/publish/dispatch', (req, res) => {
    const b = req.body || {};
    const row = readJson(queueFile, []).find(r => r.id === b.id);
    if (!row) return res.status(404).json({ error: 'Нет такой записи в очереди' });
    if (b.ownerConfirmed !== true) { note({ event: 'dispatch_refused', channel: row.channel, code: 'owner_confirmation_required', id: row.id });
      return res.status(422).json({ error: 'Нужно подтверждение владельца', code: 'owner_confirmation_required' }); }
    if (b.contentHash !== row.contentHash) { note({ event: 'dispatch_refused', channel: row.channel, code: 'content_changed', id: row.id });
      return res.status(409).json({ error: 'Текст очереди не совпадает с подтверждением', code: 'content_changed' }); }
    note({ event: 'dispatch_refused', channel: row.channel, code: 'publish_not_enabled', id: row.id });
    return res.status(403).json({ error: 'Пост не отправлен. TEST-сборка не публикует, и живое подключение с разрешением на отправку не включено.', code: 'publish_not_enabled', status: 'Не подключено' });
  });
}

module.exports = { mountPublishDesk, redact };

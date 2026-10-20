'use strict';
const crypto = require('crypto'); const http = require('http');
/**
 * YouTube OAuth 2.0 for installed apps: loopback redirect (http://127.0.0.1:<port>) + PKCE (S256) + state.
 * Separate channels = separate token sets: account 'youtube-news' / 'youtube-project'.
 * Secrets: client id/secret: `youtube_oauth_client` (JSON {client_id, client_secret}); refresh token: `<account>_refresh_token`.
 * Access tokens are kept in memory only.
 */
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function pkce() { const verifier = b64url(crypto.randomBytes(48)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), method: 'S256' }; }
class YouTubeOAuth {
  constructor({ secrets, fetchFn = globalThis.fetch, now = () => Date.now(), authBase = 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl = 'https://oauth2.googleapis.com/token' }) {
    Object.assign(this, { secrets, fetchFn, now, authBase, tokenUrl }); this.cache = new Map();
  }
  async _client() { const raw = await this.secrets.require('youtube_oauth_client'); const c = JSON.parse(raw); if (!c.client_id) throw new Error('youtube_oauth_client missing client_id'); return c; }
  authUrl({ clientId, redirectUri, challenge, state, loginHint }) {
    const u = new URL(this.authBase); const q = { client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent select_account' };
    if (loginHint) q.login_hint = loginHint; for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); return u.toString();
  }
  async _token(params) {
    const r = await this.fetchFn(this.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const j = JSON.parse(await r.text() || '{}'); if (!r.ok) { const e = new Error(`token endpoint ${r.status}: ${j.error || ''} ${j.error_description || ''}`.trim()); e.status = r.status; e.oauthError = j.error; throw e; } return j;
  }
  /**
   * Interactive authorization for one account. Opens nothing by itself: `onUrl(url)` must show/open it (e.g. macOS `open`).
   * Listens on 127.0.0.1 ephemeral port for the redirect; validates state; exchanges code with PKCE verifier; stores refresh token.
   */
  async authorize(account, { onUrl, timeoutMs = 300000, port = 0, loginHint } = {}) {
    if (!/^youtube-(news|project)$/.test(account)) throw new Error('account must be youtube-news or youtube-project');
    const c = await this._client(); const p = pkce(); const state = b64url(crypto.randomBytes(16));
    const { code, redirectUri } = await new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' }).end(ok ? 'MOONKATTY: authorization received. You can close this tab.' : 'Authorization failed.');
        clearTimeout(timer); srv.close(); ok ? resolve({ code: u.searchParams.get('code'), redirectUri }) : reject(new Error('oauth: ' + (u.searchParams.get('error') || 'state mismatch')));
      });
      let redirectUri; const timer = setTimeout(() => { srv.close(); reject(new Error('oauth: timeout')); }, timeoutMs); timer.unref?.();
      srv.listen(port, '127.0.0.1', () => { redirectUri = `http://127.0.0.1:${srv.address().port}/oauth2callback`; onUrl(this.authUrl({ clientId: c.client_id, redirectUri, challenge: p.challenge, state, loginHint })); });
    });
    const t = await this._token({ client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), code, code_verifier: p.verifier, grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (!t.refresh_token) throw new Error('oauth: no refresh_token returned (revoke previous grant and retry with prompt=consent)');
    await this.secrets.set(`${account.replace('-', '_')}_refresh_token`, t.refresh_token);
    this.cache.set(account, { token: t.access_token, exp: this.now() + (t.expires_in - 60) * 1000 });
    return { account, scopes: t.scope, expiresIn: t.expires_in };
  }
  /** Access token for account; refreshes with stored refresh token when expired. */
  async accessToken(account) {
    const c0 = this.cache.get(account); if (c0 && c0.exp > this.now()) return c0.token;
    const rt = await this.secrets.get(`${account.replace('-', '_')}_refresh_token`); if (!rt) throw new Error(`${account}: not authorized (run bin/youtube-auth.js ${account})`);
    const c = await this._client();
    try { const t = await this._token({ client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), refresh_token: rt, grant_type: 'refresh_token' });
      if (t.refresh_token && t.refresh_token !== rt) await this.secrets.set(`${account.replace('-', '_')}_refresh_token`, t.refresh_token);
      this.cache.set(account, { token: t.access_token, exp: this.now() + (t.expires_in - 60) * 1000 }); return t.access_token; }
    catch (e) { if (e.oauthError === 'invalid_grant') throw new Error(`${account}: refresh token revoked/expired — re-run authorization`); throw e; }
  }
}
/** Secrets adapter so Publisher can use OAuth-managed YouTube tokens transparently. */
class OAuthTokenSecrets { constructor(oauth, map = { youtube_news_token: 'youtube-news', youtube_project_token: 'youtube-project' }) { this.oauth = oauth; this.map = map; this.name = 'youtube-oauth'; }
  async get(name) { return this.map[name] ? this.oauth.accessToken(this.map[name]).catch(() => null) : null; } }
module.exports = { YouTubeOAuth, OAuthTokenSecrets, pkce, SCOPES };

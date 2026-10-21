'use strict';
/**
 * Bridge to the EXISTING repo-root meta.js (Meta OAuth, owned by another dev). Read-only reuse, no duplicate OAuth:
 *  - connection state (status, pageId, igUserId, lastError, rateLimit) is READ from the Studio workspaces that meta.js
 *    maintains, via an injected listWorkspaces() (server ctx.list('workspaces')) or the Studio HTTP API.
 *  - tokens: meta.js keeps page tokens AES-GCM encrypted and does NOT export a getter. We never decrypt them ourselves.
 *    If the host passes getPageToken (future export by the meta.js owner) it is used; otherwise publishing uses the
 *    Keychain secret meta_page_token_news via ChainSecrets. Either way nothing here starts an OAuth flow.
 *  - insights can be fetched THROUGH meta.js's own endpoint POST /api/meta/ws/:id/insights (its auth, its rate capture).
 */
class MetaOAuthBridge {
  constructor({ listWorkspaces = null, getPageToken = null, studioBase = null, studioFetch = globalThis.fetch, cookie = null } = {}) { Object.assign(this, { listWorkspaces, getPageToken, studioBase, studioFetch, cookie }); }
  async _workspaces() { if (this.listWorkspaces) return await this.listWorkspaces();
    if (!this.studioBase) return [];
    const r = await this.studioFetch(`${this.studioBase}/api/workspaces`, { headers: this.cookie ? { cookie: this.cookie } : {} }); return r.ok ? await r.json() : []; }
  /** platform: 'facebook' | 'instagram' -> [{ workspaceId, status, pageId, igUserId, connected, lastError }] (no secrets). */
  async connections(platform) { const ws = (await this._workspaces()).filter(w => w.platform === platform && w.connection);
    return ws.map(w => ({ workspaceId: w.id, title: w.title || null, status: w.connection.status || 'disconnected', connected: w.connection.status === 'connected', pageId: w.connection.pageId || null, igUserId: w.connection.igUserId || null, lastError: w.connection.lastError ? { message: w.connection.lastError.message, code: w.connection.lastError.code ?? null } : null, rateLimit: w.connection.rateLimit || null })); }
  /** Publisher target ids from meta.js connection (pageId for FB, igUserId for IG). */
  async target(platform) { const c = (await this.connections(platform)).find(x => x.connected); if (!c) return null; return platform === 'instagram' ? c.igUserId : c.pageId; }
  /** A Secrets-compatible provider: only works if the host injected getPageToken. Never decrypts meta.js storage itself. */
  secretsProvider() { const self = this; return { async get(name) { if (!self.getPageToken || !/^meta_page_token/.test(name)) return null; const t = await self.target('facebook'); return t ? await self.getPageToken(t) : null; } }; }
  /** Delegate insights to meta.js's endpoint (reuses its OAuth tokens). */
  async insightsViaStudio(workspaceId) { if (!this.studioBase) throw new Error('studioBase not set');
    const r = await this.studioFetch(`${this.studioBase}/api/meta/ws/${encodeURIComponent(workspaceId)}/insights`, { method: 'POST', headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: '{}' });
    if (!r.ok) throw new Error('studio insights HTTP ' + r.status); return await r.json(); }
}
module.exports = { MetaOAuthBridge };

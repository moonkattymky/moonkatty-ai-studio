// Read-only Tailscale. Peer names are dropped. up/down/set/serve/funnel do not exist here.
'use strict';
const exec = require('../exec');

function parseStatus(text) {
  const j = JSON.parse(text);
  const self = j.Self || {};
  const peers = j.Peer && typeof j.Peer === 'object' ? Object.keys(j.Peer).length : 0;
  return {
    online: !!self.Online,
    ipCount: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.length : 0,
    peers
  };
}

async function check(ctx = {}) {
  const ver = await exec.run('ts.version', ctx);
  const st = await exec.run('ts.status', ctx);
  if (ver.status === 'BLOCKED' || st.status === 'BLOCKED') {
    return { id: 'tailscale', status: 'BLOCKED', summary: 'tailscale не установлен — статус сети не читался', data: {} };
  }
  if (st.code !== 0) return { id: 'tailscale', status: 'FAIL', summary: 'tailscale status завершился с кодом ' + st.code, data: { version: (ver.stdout || '').trim().slice(0, 80) } };
  try {
    const parsed = parseStatus(st.stdout);
    return { id: 'tailscale', status: parsed.online ? 'OK' : 'WARN', summary: parsed.online ? `в сети, peers ${parsed.peers}` : 'Tailscale выключен', data: { ...parsed, version: (ver.stdout || '').trim().slice(0, 80) } };
  } catch (e) {
    return { id: 'tailscale', status: 'FAIL', summary: 'Неразобранный JSON Tailscale', data: { error: e.message } };
  }
}

module.exports = { check, parseStatus };

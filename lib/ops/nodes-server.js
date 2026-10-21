// v1.2.4-test: glue between server.js and Studio 3's Node Manager (lib/ops/nodes.js, ported from feat/studio-operations @af1e869).
//  • Node API = SEPARATE HTTPS listener (self-signed cert, nodes pin its SHA-256), port CFG.nodesPort (TEST 8690, prod 8790),
//    bound to 127.0.0.1 and, optionally, ONE Tailscale address of this Mac (100.64.0.0/10 or fd7a:115c:a1e0::/48).
//    Never 0.0.0.0, never LAN/public; Tailscale Serve/Funnel are NOT used or enabled. The main panel stays loopback-only.
//  • Admin API (owner session of the main panel): register (token shown ONCE, server keeps sha256 only), rotate, revoke,
//    commands, jobs. Register/rotate need the owner's password + typed confirmation; revoke needs typed confirmation.
//  • Node jobs never run on the Mac mini: only light capabilities, no heavy models/Blender/OpenCode/arbitrary commands
//    (FORBIDDEN_CAPS), and jobs that need file transfer are held back while the heavy lock is busy.
'use strict';
const fs = require('fs'), path = require('path'), N = require('./nodes.js');
function mountNodes(app, { CFG, dataDir, log, q, heavy, checkPassword, env = process.env }) {
  const opsDir = path.join(dataDir, 'ops');
  const readSettings = () => { try { return JSON.parse(q.meta.get('nodesSettings')?.v || '{}'); } catch { return {}; } };
  const st0 = readSettings();
  const enabled = env.STUDIO_NODES === '1' || st0.enabled === true;
  const bind = env.STUDIO_NODES_BIND !== undefined ? env.STUDIO_NODES_BIND : (st0.bind || '');
  const devOverride = String(CFG.FLAVOR_SOURCE || '').startsWith('env'); // source checkout (tests) only — never in a packaged app
  const port = devOverride && /^\d{4,5}$/.test(env.STUDIO_NODES_PORT || '') ? +env.STUDIO_NODES_PORT : CFG.nodesPort;
  const alerts = []; const tune = devOverride ? { ...(+env.STUDIO_NODES_LEASE_MS ? { leaseMs: +env.STUDIO_NODES_LEASE_MS } : {}), ...(+env.STUDIO_NODES_DOWN_MS ? { nodeDownMs: +env.STUDIO_NODES_DOWN_MS } : {}) } : {};
  const state = { enabled, port, listening: [], errors: [], fingerprint: null, bind: bind || null };
  let mgr = null; const servers = [];
  if (enabled) {
    mgr = N.createNodeManager({ dir: opsDir, log, ...tune, idSuffix: CFG.nodeIdSuffix || '', heavyBusy: () => !!(heavy && heavy.status().holder),
      notify: async m => { alerts.unshift({ ...m, at: new Date().toISOString() }); alerts.length = Math.min(alerts.length, 50); log('warn', 'nodes', `${m.title}: ${m.body}`); } });
    setInterval(() => { try { mgr.sweep(); } catch (e) { log('error', 'nodes', e.message); } }, devOverride && +env.STUDIO_NODES_SWEEP_MS ? +env.STUDIO_NODES_SWEEP_MS : 10000).unref();
    let tls = null;
    try { tls = N.ensureCert(opsDir); }
    catch { try { const ex = require('child_process').execFileSync; // macOS LibreSSL fallback: RSA instead of EC
      ex('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=moonkatty-coordinator', '-keyout', path.join(opsDir, 'nodes-tls.key'), '-out', path.join(opsDir, 'nodes-tls.crt')], { stdio: 'ignore' });
      fs.chmodSync(path.join(opsDir, 'nodes-tls.key'), 0o600); tls = N.ensureCert(opsDir); } catch (e) { state.errors.push('TLS: ' + e.message); } }
    if (tls) { state.fingerprint = tls.fingerprint;
      const hosts = ['127.0.0.1']; if (bind) { if (N.isTailscaleOrLoopback(bind) && !/^127\.|^::1$/.test(bind)) hosts.push(bind); else state.errors.push('адрес привязки не Tailscale: ' + bind); }
      for (const host of hosts) N.listen(mgr, { host, port, tls }).then(s => { servers.push(s); state.listening.push(`${host}:${port}`); log('info', 'nodes', `Node API (TLS) на ${host}:${port}, отпечаток ${tls.fingerprint}`); })
        .catch(e => { state.errors.push(`${host}:${port} — ${e.message}`); log('error', 'nodes', `Node API ${host}:${port}: ${e.message}`); }); }
  }
  const bad = (res, e, code = 400) => res.status(code).json({ error: String(e.message || e) });
  const need = (req, res, word, pw) => { const b = req.body || {}; if (b.confirm !== word) { res.status(400).json({ error: `Подтвердите: confirm = «${word}»`, code: 'confirm_required' }); return false; }
    if (pw && !checkPassword(req.user, String(b.password || ''))) { res.status(403).json({ error: 'Неверный пароль владельца', code: 'password_required' }); return false; } return true; };
  const off = res => res.status(409).json({ error: 'Node Manager выключен (включите в «Узлы» и перезапустите сервер)', code: 'nodes_disabled' });
  const connectInfo = id => ({ keychainService: 'moonkatty-node-' + id, keychainAccount: 'node-token', port, fingerprint: state.fingerprint,
    coordinatorUrl: bind ? `https://${/:/.test(bind) ? '[' + bind + ']' : bind}:${port}` : null });
  app.get('/api/ops/nodes', (req, res) => res.json({ ...state, idSuffix: CFG.nodeIdSuffix || '', settings: readSettings(), roles: N.ROLES, devices: N.DEVICES, ...(mgr ? mgr.status() : { nodes: [], jobs: [] }), alerts }));
  app.get('/api/ops/nodes/cert', (req, res) => { const f = path.join(opsDir, 'nodes-tls.crt'); if (!mgr || !fs.existsSync(f)) return off(res); // public certificate only (never the key)
    res.type('application/x-pem-file').set('content-disposition', 'attachment; filename="coordinator.crt"').send(fs.readFileSync(f, 'utf8')); });
  app.get('/api/ops/nodes/jobs', (req, res) => mgr ? res.json(mgr._state.jobs) : off(res)); // full job records (input/events/result) for the owner
  // owner uploads an input file for a node job (e.g. a clip for ffprobe.check): streamed to disk, SHA-256 verified, ≤ 512 MB
  app.put('/api/ops/nodes/files/:sha256', async (req, res) => { if (!mgr) return off(res); const r = await mgr.putFileStream({}, String(req.params.sha256), req); r.code ? res.status(r.code).json({ error: r.error }) : res.json(r); });
  app.post('/api/ops/nodes/settings', (req, res) => { if (!need(req, res, 'СОХРАНИТЬ', true)) return; const b = req.body || {}; const s = { enabled: b.enabled === true, bind: String(b.bind || '').trim() };
    if (s.bind && (!N.isTailscaleOrLoopback(s.bind) || /^127\.|^::1$/.test(s.bind))) return bad(res, 'Привязка разрешена только к адресу Tailscale (100.64.0.0/10 или fd7a:115c:a1e0::/48)');
    q.setMeta.run('nodesSettings', JSON.stringify(s)); log('info', 'nodes', `Настройки узлов: ${s.enabled ? 'включено' : 'выключено'}${s.bind ? ', Tailscale ' + s.bind : ''} (нужен перезапуск сервера)`, req.user); res.json({ ok: true, settings: s, restartRequired: true }); });
  app.post('/api/ops/nodes', (req, res) => { if (!mgr) return off(res); if (!need(req, res, 'ВЫДАТЬ', true)) return;
    try { const b = req.body || {}; const r = mgr.registerNode({ id: b.id, name: b.name, role: b.role, caps: b.caps }); log('info', 'nodes', 'Зарегистрирован узел ' + r.id + ' (токен выдан один раз)', req.user);
      res.json({ ...r, ...connectInfo(r.id), note: 'Токен показан один раз. На сервере хранится только его SHA-256.' }); } catch (e) { bad(res, e); } });
  app.post('/api/ops/nodes/:id/rotate', (req, res) => { if (!mgr) return off(res); if (!need(req, res, 'СМЕНИТЬ', true)) return;
    try { const r = mgr.rotateNode(req.params.id); log('info', 'nodes', 'Токен узла сменён: ' + r.id, req.user); res.json({ ...r, ...connectInfo(r.id), note: 'Новый токен показан один раз; старый больше не действует.' }); } catch (e) { bad(res, e); } });
  app.post('/api/ops/nodes/:id/revoke', (req, res) => { if (!mgr) return off(res); if (!need(req, res, 'ОТОЗВАТЬ', false)) return;
    try { const r = mgr.revokeNode(req.params.id); log('info', 'nodes', 'Токен узла отозван: ' + req.params.id, req.user); res.json(r); } catch (e) { bad(res, e); } });
  app.post('/api/ops/nodes/:id/command', (req, res) => { if (!mgr) return off(res); try { const r = mgr.setCommand(req.params.id, String((req.body || {}).command || '')); log('info', 'nodes', `Команда узлу ${req.params.id}: ${req.body.command}`, req.user); res.json(r); } catch (e) { bad(res, e); } });
  app.post('/api/ops/nodes/jobs', (req, res) => { if (!mgr) return off(res); try { res.json(mgr.submit(req.body || {})); } catch (e) { bad(res, e); } });
  app.post('/api/ops/nodes/jobs/:id/:act', (req, res) => { if (!mgr) return off(res); if (!['cancel', 'retry'].includes(req.params.act)) return res.status(404).end(); try { res.json(mgr[req.params.act](req.params.id)); } catch (e) { bad(res, e); } });
  app.get('/api/ops/nodes/route', (req, res) => { if (!mgr) return off(res); res.json(mgr.route({ capability: String(req.query.capability || ''), requires: {} })); });
  const runViaNode = async (a, t, signal) => { if (!mgr) throw Object.assign(new Error('Задача для узла, но Node Manager выключен'), { blocked: true }); return mgr.runViaNode(a, t, signal); };
  return { state, mgr: () => mgr, runViaNode, close: () => servers.forEach(s => s.close()) };
}
module.exports = { mountNodes };

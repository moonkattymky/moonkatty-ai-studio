// Background server management. macOS: launchd LaunchAgent (survives window close, restarts on crash,
// optional start at login). Other OS (dev/test): detached child process.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFile } = require('child_process');
const LABEL = 'com.moonkatty.aistudio.server';
// Start at login ON → plist in ~/Library/LaunchAgents (launchd loads it at login).
// OFF → plist in the data folder: loaded by the app only for this session (KeepAlive implies RunAtLoad).
const loginPlist = () => path.join(os.homedir(), 'Library', 'LaunchAgents', LABEL + '.plist');
const plistPath = o => o && !o.startAtLogin ? path.join(o.dataDir, 'launchd', LABEL + '.plist') : loginPlist();
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function serverEnv({ dataDir, port, runAsNode, enableOpenCode, allowedHosts, opsResources, opsMobile }) {
  const env = { STUDIO_DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production',
    PATH: [path.join(os.homedir(), '.opencode', 'bin'), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':') };
  if (runAsNode) env.ELECTRON_RUN_AS_NODE = '1'; // dev only; packaged builds use the bundled Node binary (RunAsNode fuse off)
  if (enableOpenCode) env.STUDIO_OPENCODE = '1';
  if (allowedHosts && allowedHosts.length) env.STUDIO_ALLOWED_HOSTS = allowedHosts.join(',');
  if (opsResources) env.STUDIO_OPS_RESOURCES = '1'; // Resource Manager (docs/ops/RESOURCE_MANAGER.md)
  if (opsMobile) env.STUDIO_OPS_MOBILE = '1';       // Mobile Control Center (docs/ops/MOBILE.md)
  return env;
}
function plist(o) {
  const { execPath, serverJs, dataDir, logDir } = o; const env = serverEnv(o);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(execPath)}</string><string>${xml(serverJs)}</string></array>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
  <key>WorkingDirectory</key><string>${xml(dataDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>ExitTimeOutSecs</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, 'server.log'))}</string>
</dict></plist>
`;
}
const run = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 15000 }, (e, so, se) => res({ ok: !e, code: e ? e.code : 0, out: String(so || '') + String(se || '') })));
const uid = () => process.getuid ? process.getuid() : 0;
async function health(port) { try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) }); const j = await r.json(); return j.app === 'moonkatty-ai-studio' ? j : { foreign: true }; } catch (e) { return null; } }
async function waitHealthy(port, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const h = await health(port); if (h && !h.foreign) return h; await new Promise(r => setTimeout(r, 500)); } return null; }
async function installAndStart(o) {
  fs.mkdirSync(o.logDir, { recursive: true }); fs.mkdirSync(o.dataDir, { recursive: true });
  if (process.platform !== 'darwin') { // dev/test path: detached process, independent of the window
    const out = fs.openSync(path.join(o.logDir, 'server.log'), 'a');
    const p = spawn(o.execPath, [o.serverJs], { detached: true, stdio: ['ignore', out, out], cwd: o.dataDir, env: { ...serverEnv(o), HOME: os.homedir() } });
    p.unref(); return { method: 'detached', pid: p.pid };
  }
  const f = plistPath(o), other = plistPath({ ...o, startAtLogin: !o.startAtLogin }); fs.mkdirSync(path.dirname(f), { recursive: true });
  const content = plist(o); const changed = !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== content || fs.existsSync(other);
  if (changed) { await run('/bin/launchctl', ['bootout', `gui/${uid()}/${LABEL}`]); try { fs.unlinkSync(other); } catch {} fs.writeFileSync(f, content); }
  const b = await run('/bin/launchctl', ['bootstrap', `gui/${uid()}`, f]); // "already loaded" is fine
  const k = await run('/bin/launchctl', ['kickstart', `gui/${uid()}/${LABEL}`]);
  return { method: 'launchd', plist: f, bootstrap: b.out.trim(), kickstart: k.ok ? 'ok' : k.out.trim() };
}
async function stop(port) {
  if (process.platform === 'darwin') { const r = await run('/bin/launchctl', ['bootout', `gui/${uid()}/${LABEL}`]); return { method: 'launchd', ok: r.ok, out: r.out.trim() }; }
  const h = await health(port); if (h && h.pid) { try { process.kill(h.pid, 'SIGTERM'); return { method: 'signal', ok: true }; } catch (e) { return { ok: false, out: e.message }; } }
  return { ok: false, out: 'Сервер не запущен' };
}
async function setStartAtLogin(o) { if (process.platform !== 'darwin') return { ok: false, out: 'Только macOS' }; return installAndStart(o); }
async function launchdStatus() { if (process.platform !== 'darwin') return null; const r = await run('/bin/launchctl', ['print', `gui/${uid()}/${LABEL}`]); return { loaded: r.ok, state: (/state = (\w+)/.exec(r.out) || [])[1] || null, lastExit: (/last exit code = ([^\n]+)/.exec(r.out) || [])[1] || null }; }
module.exports = { LABEL, plistPath, plist, health, waitHealthy, installAndStart, stop, setStartAtLogin, launchdStatus };

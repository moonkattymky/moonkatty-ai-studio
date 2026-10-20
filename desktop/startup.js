const D = window.studioDesktop, $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let first = true;
function row(name, st, cls) { return `<div class="row ${cls}"><span class="dot"></span><b>${name}</b><span>${esc(st)}</span></div>`; }
async function check() {
  const s = await D.status();
  $('#auto').checked = s.cfg.autoStartServer; $('#login').checked = s.cfg.startAtLogin; $('#login').disabled = !s.platform.startsWith('darwin');
  $('#rows').innerHTML = row('Сервер', s.server.detail, s.server.ok ? 'ok' : 'bad') + row('База данных', s.db.detail, s.db.ok ? 'ok' : 'bad')
    + row('Ключ шифрования', s.keys ? s.keys.detail : 'Нет данных', s.keys ? 'ok' : 'warn') + row('Ollama (qwen3:8b)', s.ollama.detail, s.ollama.ok ? 'ok' : 'warn')
    + row('Фоновая служба', s.launchd ? (s.launchd.loaded ? `launchd: ${s.launchd.state || 'загружена'}` + (s.launchd.lastExit ? `, последний выход: ${s.launchd.lastExit}` : '') : 'launchd: не загружена') : 'Не macOS: отдельный фоновый процесс', s.launchd ? (s.launchd.loaded ? 'ok' : 'warn') : 'warn')
    + row('Версия', `${s.version} · ${s.platform}`, 'ok');
  $('#start').disabled = s.server.ok; $('#open').disabled = !s.server.ok;
  return s;
}
async function start() { $('#msg').textContent = 'Запуск сервера…'; $('#start').disabled = true; const r = await D.startServer(); $('#msg').textContent = r.ok ? '' : 'Ошибка: ' + r.error; await check(); return r.ok; }
$('#start').onclick = start; $('#recheck').onclick = check; $('#open').onclick = () => D.openPanel();
$('#data').onclick = () => D.openPath('data'); $('#logs').onclick = () => D.openPath('logs');
$('#auto').onchange = e => D.setCfg({ autoStartServer: e.target.checked });
$('#login').onchange = async e => { const r = await D.setCfg({ startAtLogin: e.target.checked }); if (r && r.ok === false) $('#msg').textContent = r.out || 'Ошибка'; check(); };
(async () => { const s = await check(); const auto = !location.hash.includes('status');
  if (auto && s.server.ok) return setTimeout(() => D.openPanel(), 600);
  if (auto && s.cfg.autoStartServer && !s.server.ok && !/занят/.test(s.server.detail)) { if (await start()) setTimeout(() => D.openPanel(), 600); } })();

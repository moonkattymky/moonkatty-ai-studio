'use strict';
// Local speech-to-text. The recognized string is only returned to the editor.
// autoSend is always false. The text is never passed to a shell.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function which(name) {
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}
function fail(status, code, error) { const e = new Error(error); e.status = status; e.code = code; return e; }

function prepareUtterance({ permission, text } = {}) {
  if (permission === 'denied') return { ok: false, code: 'mic_denied', text: '', autoSend: false, error: 'Микрофон запрещён. Введите текст вручную.' };
  if (permission !== 'granted') return { ok: false, code: 'mic_required', text: '', autoSend: false, error: 'Нет разрешения микрофона.' };
  return { ok: true, code: 'ready', text: String(text || '').slice(0, 4000), autoSend: false };
}

function whisperBin() { return which('whisper-cli') || which('whisper-cpp'); }

function spawnText(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch {}
      try { p.kill('SIGKILL'); } catch {}
      reject(fail(504, 'timeout', 'распознавание прервано по таймауту'));
    }, 60000);
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(fail(500, 'whisper_failed', (err || out).slice(-300) || 'whisper failed')); });
  });
}

async function transcribeFile(file, { lang = 'ru', run, bin } = {}) {
  if (!['ru', 'en'].includes(lang)) throw fail(400, 'bad_lang', 'Язык: ru или en');
  const cmd = bin || whisperBin();
  if (!cmd) throw fail(424, 'voice_unavailable', 'Локальное распознавание недоступно: нет whisper.cpp (whisper-cli). Текст можно ввести вручную.');
  const args = ['-l', lang, '-f', file, '-nt', '-np'];
  const out = await (run || spawnText)(cmd, args);
  return { text: String(out).trim().slice(0, 4000), autoSend: false, lang };
}

function mountVoice(app, { log = () => {} } = {}) {
  app.post('/api/voice/transcribe', async (req, res) => {
    const b = req.body || {};
    const gate = prepareUtterance({ permission: b.permission, text: '' });
    if (!gate.ok) return res.status(gate.code === 'mic_denied' ? 403 : 400).json({ error: gate.error, code: gate.code, text: '', autoSend: false });
    if (b.command || b.argv || b.shell) return res.status(400).json({ error: 'Распознанный текст не выполняется как команда', code: 'command_forbidden', text: '', autoSend: false });
    if (!whisperBin()) return res.status(424).json({ error: 'Локальное распознавание недоступно: нет whisper.cpp. Введите текст вручную — он не отправится сам.', code: 'voice_unavailable', text: '', autoSend: false });
    const raw = String(b.audioBase64 || '');
    if (!raw || raw.length > 2_000_000) return res.status(400).json({ error: 'Нужен короткий локальный фрагмент аудио', code: 'audio_required', text: '', autoSend: false });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-voice-'));
    try {
      const src = path.join(dir, 'in.bin'); const wav = path.join(dir, 'in.wav');
      fs.writeFileSync(src, Buffer.from(raw, 'base64'));
      const ff = which('ffmpeg'); if (!ff) throw fail(424, 'voice_unavailable', 'ffmpeg не найден');
      await spawnText(ff, ['-y', '-v', 'error', '-i', src, '-ar', '16000', '-ac', '1', wav]);
      const r = await transcribeFile(wav, { lang: b.lang === 'en' ? 'en' : 'ru' });
      res.json(r);
    } catch (e) {
      log('warn', 'voice', e.message);
      res.status(e.status || 500).json({ error: e.message, code: e.code || 'error', text: '', autoSend: false });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

module.exports = { prepareUtterance, transcribeFile, whisperBin, mountVoice };

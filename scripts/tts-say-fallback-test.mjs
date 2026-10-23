import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MacSayTTS, detectTTS } = require('../media-automation/src/video/tts.js');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const voices = 'Samantha  en_US    # Hello\nAlex       en_US    # Hi there\nMilena     ru_RU    # Привет\n';
const calls = [];
const runFn = async (bin, args) => {
  calls.push(bin + ' ' + args.join(' '));
  if (bin === 'say' && args[0] === '-v' && args[1] === '?') return { stdout: voices, stderr: '' };
  if (bin === 'say' && args.includes('Samantha')) { const e = new Error('say: voice Samantha not found'); throw e; }
  if (bin === 'say') return { stdout: '', stderr: '' };
  if (bin === 'ffprobe') return { stdout: '1.25\n', stderr: '' };
  return { stdout: '', stderr: '' };
};
const tts = new MacSayTTS({ voice: 'Samantha', runFn });
const r = await tts.synthesize('Hello from the desk.', '/tmp/mk-say-fallback.wav');
t('say falls back to another English voice', r.voice === 'Alex' && tts.name === 'macos-say:Alex', tts.name);
t('failed Samantha attempt is not the only say call', calls.filter(c => c.startsWith('say ') && !c.includes('-v ?')).length === 2, calls.join(' | '));
const es = await detectTTS({ env: { MA_TTS: '' }, has: async b => b === 'espeak-ng' });
t('without say, detectTTS uses espeak-ng on this host or skips say', es && es.name === 'espeak-ng', es && es.name);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

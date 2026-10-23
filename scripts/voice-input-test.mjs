import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const V = require('../lib/voice-input.js');
let fail = 0, pass = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); c ? pass++ : fail++; };

const denied = V.prepareUtterance({ permission: 'denied', text: 'rm -rf /' });
ok('denied mic returns no text and does not send', denied.ok === false && denied.code === 'mic_denied' && denied.text === '' && denied.autoSend === false);
const ready = V.prepareUtterance({ permission: 'granted', text: 'привет' });
ok('granted text is editable and never auto-sent', ready.ok === true && ready.text === 'привет' && ready.autoSend === false);

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mk-v-')), 'a.wav');
fs.writeFileSync(file, 'x');
let argv = null;
const heard = await V.transcribeFile(file, { lang: 'ru', bin: '/usr/bin/whisper-cli', run: (bin, args) => { argv = [bin, ...args]; return Promise.resolve('привет мир\n'); } });
ok('whisper argv is fixed and the transcript is not a command', argv[0] === '/usr/bin/whisper-cli' && argv[1] === '-l' && argv[2] === 'ru' && !argv.join(' ').includes('привет') && heard.autoSend === false && heard.text === 'привет мир');
ok('unknown language rejected', await V.transcribeFile(file, { lang: 'fr', bin: '/usr/bin/whisper-cli', run: () => Promise.resolve('x') }).then(() => false, e => e.code === 'bad_lang'));
ok('missing whisper is unavailable, not a fake transcript', await V.transcribeFile(file, { lang: 'en', bin: '', run: () => { throw new Error('must not run'); } }).then(() => false, e => e.code === 'voice_unavailable'));

const plist = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
ok('Info.plist usage string is present', plist.includes('NSMicrophoneUsageDescription'));
const main = fs.readFileSync(path.join(process.cwd(), 'desktop', 'main.js'), 'utf8');
ok('Electron allows the microphone and still denies other permissions', /MIC\.has\(perm\)/.test(main) && !/setPermissionCheckHandler\(\(\) => false\)/.test(main));

const appJs = fs.readFileSync(path.join(process.cwd(), 'public', 'app.js'), 'utf8');
ok('dictation offers ru and en and does not call the agent by itself', appJs.includes('id="atLang"') && appJs.includes("value === 'en'") && appJs.includes('autoSend') && !appJs.includes("atMic').onclick = () => atRun"));
function plistFlags(flavor) {
  const r = spawnSync(process.execPath, ['-e', `
    const s = require('./desktop/service.js');
    const dir = ${JSON.stringify(path.join(os.tmpdir(), 'mk-plist-' + flavor))};
    const xml = s.plist({ execPath: '/bin/node', serverJs: '/tmp/server.js', dataDir: dir, logDir: dir, port: 9 });
    const has = k => xml.includes('<key>' + k + '</key><string>1</string>');
    console.log(JSON.stringify({ upd: has('STUDIO_OPS_UPDATE'), bak: has('STUDIO_OPS_BACKUP'), oc: xml.includes('STUDIO_OPENCODE') }));
  `], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: flavor }, encoding: 'utf8' });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || '').slice(-400) };
  return JSON.parse(r.stdout.trim());
}
const testPlist = plistFlags('test');
ok('TEST launchd turns Update Center and backup on, OpenCode stays off', testPlist.upd === true && testPlist.bak === true && testPlist.oc === false, testPlist.error || JSON.stringify(testPlist));
const prodPlist = plistFlags('prod');
ok('prod launchd does not enable Update Center', prodPlist.upd === false && prodPlist.bak === false && prodPlist.oc === false, prodPlist.error || JSON.stringify(prodPlist));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

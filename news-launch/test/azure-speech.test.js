'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CharacterBudget, resolveCap, warnThreshold, F0_FREE_CHARS } = require('../azure-tts/budget');
const { readKey, storeKey, SERVICE, TEST_SERVICE, ACCOUNT } = require('../azure-tts/keychain');
const { buildSsml } = require('../azure-tts/ssml');
const { AzureSpeechProvider } = require('../azure-tts/provider');
const { runCli } = require('../azure-tts/keychain-cli');
const { MasterVoice } = require('../../media-automation/src/video/master-voice');
const { SpeechComposer } = require('../../media-automation/src/video/speech');

const KEY = 'LEAK-TEST-KEY-9f3a';
const ENV_KEY = 'ENV-KEY-SHOULD-NOT-BE-USED-99';
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'azure-tts-'));

function scriptedSpawn({ code = 0, stdout = '', stderr = '' } = {}) {
  const calls = [];
  function spawn(cmd, args) {
    const rec = { cmd, args: args.slice(), stdin: '' };
    calls.push(rec);
    const proc = {
      stdin: { write(s) { rec.stdin += s; }, end(s) { if (s) rec.stdin += s; } },
      stdout: { on(ev, fn) { if (ev === 'data' && stdout) fn(Buffer.from(stdout)); } },
      stderr: { on(ev, fn) { if (ev === 'data' && stderr) fn(Buffer.from(stderr)); } },
      on(ev, fn) { if (ev === 'close') queueMicrotask(() => fn(code)); },
    };
    return proc;
  }
  spawn.calls = calls;
  return spawn;
}

function provider(root, extra = {}) {
  const stateFile = path.join(root, 'usage.json');
  const calls = [];
  const fetchFn = extra.fetchFn || (async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async text() { return ''; },
      async arrayBuffer() { return Uint8Array.from(Buffer.from('RIFF-audio')).buffer; },
    };
  });
  const runFn = async (cmd, args) => {
    calls.push({ cmd, args });
    const input = args[args.indexOf('-i') + 1];
    calls.push({ raw: fs.readFileSync(input).toString() });
    fs.writeFileSync(args[args.length - 1], 'wav');
    return { stdout: '', stderr: '' };
  };
  const p = new AzureSpeechProvider({
    enabled: true,
    tier: 'F0',
    region: 'uaenorth',
    rate: 0.95,
    stateFile,
    now: () => new Date('2026-10-21T12:00:00Z'),
    getKey: async () => KEY,
    fetchFn,
    runFn,
    probeDurationFn: async () => 1.5,
    ...extra,
    stateFile: extra.stateFile || stateFile,
  });
  p._calls = calls;
  p._stateFile = p.stateFile;
  return p;
}

test('free-tier thresholds match the published 0.5 million character quota', () => {
  assert.equal(F0_FREE_CHARS, 500000);
  assert.equal(warnThreshold(500000, 70), 350000);
  assert.equal(warnThreshold(500000, 90), 450000);
  assert.equal(resolveCap({ tier: 'F0' }).limitChars, 500000);
});

test('counter reserves before the request, rolls over on the UTC month, and blocks above the cap', () => {
  const root = dir();
  const file = path.join(root, 'usage.json');
  fs.writeFileSync(file, JSON.stringify({ month: '2026-09', usedChars: 400000 }));
  const october = new CharacterBudget({ stateFile: file, limitChars: 100, now: () => new Date('2026-10-21T12:00:00Z') });
  const first = october.reserve(70);
  assert.equal(first.month, '2026-10');
  assert.equal(first.usedChars, 70);
  assert.equal(first.warnings.length, 1);
  assert.match(first.warnings[0], /70%/);
  const both = october.reserve(25);
  assert.equal(both.usedChars, 95);
  assert.equal(both.warnings.length, 1);
  assert.match(both.warnings[0], /90%/);
  const exact = october.reserve(5);
  assert.equal(exact.usedChars, 100);
  assert.deepEqual(exact.warnings, []);
  assert.throws(() => october.reserve(1), /cap reached \(100\+1 > 100 for 2026-10\)/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).usedChars, 100);
  const israelNewMonth = new CharacterBudget({ stateFile: file, limitChars: 100, now: () => new Date('2026-11-01T00:30:00+03:00') });
  assert.throws(() => israelNewMonth.reserve(1), /100\+1 > 100 for 2026-10/);
});

test('a new UTC month resets the counter, and one request can cross both warnings', () => {
  const root = dir();
  const file = path.join(root, 'usage.json');
  fs.writeFileSync(file, JSON.stringify({ month: '2026-09', usedChars: 400000 }));
  const budget = new CharacterBudget({ stateFile: file, limitChars: 100, now: () => new Date('2026-10-21T00:00:00Z') });
  const jumped = budget.reserve(95);
  assert.equal(jumped.usedChars, 95);
  assert.equal(jumped.warnings.length, 2);
  assert.match(jumped.warnings[0], /70%/);
  assert.match(jumped.warnings[1], /90%/);
  const blockedFile = path.join(root, 'blocked.json');
  fs.writeFileSync(blockedFile, JSON.stringify({ month: '2026-09', usedChars: 400000 }));
  const fresh = new CharacterBudget({ stateFile: blockedFile, limitChars: 10, now: () => new Date('2026-10-21T00:00:00Z') });
  assert.throws(() => fresh.reserve(11), /0\+11 > 10/);
  assert.deepEqual(JSON.parse(fs.readFileSync(blockedFile, 'utf8')), { month: '2026-10', usedChars: 0, tier: 'F0', limitChars: 10 });
});

test('unknown tier, S0 without the owner flag, F0 HD, and a missing paid cap refuse before HTTP', async () => {
  const root = dir();
  let fetches = 0;
  const fetchFn = async () => { fetches += 1; throw new Error('should not fetch'); };
  const base = { region: 'uaenorth', stateFile: path.join(root, 'usage.json'), fetchFn, getKey: async () => KEY };
  await assert.rejects(() => provider(root, { ...base, tier: 'S1' }).synthesize('hello', path.join(root, 'a.wav')), /pricing tier is unknown \(S1\)/);
  await assert.rejects(() => provider(root, { ...base, tier: undefined }).synthesize('hello', path.join(root, 'b.wav')), /unknown \(missing\)/);
  await assert.rejects(() => provider(root, { ...base, tier: 'S0', allowPaid: false }).synthesize('hello', path.join(root, 'c.wav')), /tier S0 is the paid Standard tier/);
  await assert.rejects(() => provider(root, { ...base, tier: 'S0', allowPaid: true }).synthesize('hello', path.join(root, 'd.wav')), /paidCapChars/);
  await assert.rejects(() => provider(root, { ...base, tier: 'S0', allowPaid: true, paidCapChars: 0 }).synthesize('hello', path.join(root, 'e.wav')), /paidCapChars/);
  await assert.rejects(() => provider(root, { ...base, voice: 'en-US-Andrew:DragonHDLatestNeural' }).synthesize('hello', path.join(root, 'f.wav')), /HD voice/);
  await assert.rejects(() => provider(root, { ...base, tier: 'F0', allowPaid: true, paidCapChars: 100 }).synthesize('hello', path.join(root, 'g.wav')), /does not apply to tier F0/);
  await assert.rejects(() => provider(root, { ...base, limitChars: 500001 }).synthesize('hello', path.join(root, 'h.wav')), /500000/);
  assert.equal(fetches, 0);
  assert.equal(fs.existsSync(base.stateFile), false);
});

test('S0 with an explicit cap blocks at that cap and still warns', async () => {
  const root = dir();
  let fetches = 0;
  const p = provider(root, {
    tier: 'S0',
    allowPaid: true,
    paidCapChars: 10,
    fetchFn: async () => { fetches += 1; return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }; },
  });
  const ok = await p.synthesize('1234567890', path.join(root, 'ok.wav'));
  assert.equal(ok.usedChars, 10);
  assert.equal(ok.warnings.length, 2);
  await assert.rejects(() => p.synthesize('x', path.join(root, 'over.wav')), /10\+1 > 10/);
  assert.equal(fetches, 1);
});

test('the character count is committed before HTTP and is kept when HTTP fails', async () => {
  const root = dir();
  const out = path.join(root, 'a.wav');
  const p = provider(root, {
    fetchFn: async () => {
      const used = JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).usedChars;
      assert.equal(used, 5);
      throw new Error(`network down ${KEY}`);
    },
  });
  await assert.rejects(() => p.synthesize('hello', out), (err) => {
    assert.match(err.message, /request failed/);
    assert.equal(err.message.includes(KEY), false);
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).usedChars, 5);
});

test('HTTP error bodies and corrupt usage files cannot echo the key', async () => {
  const root = dir();
  const logs = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  process.env.AZURE_SPEECH_KEY = ENV_KEY;
  const origFetch = globalThis.fetch;
  let live = 0;
  globalThis.fetch = async () => { live += 1; throw new Error('LIVE'); };
  try {
    const p = provider(root, {
      fetchFn: async (url, init) => {
        assert.equal(init.headers['Ocp-Apim-Subscription-Key'], KEY);
        assert.equal(JSON.stringify(init).includes(ENV_KEY), false);
        assert.equal(url.includes(KEY), false);
        return { ok: false, status: 401, text: async () => `denied ${KEY}`, arrayBuffer: async () => Buffer.alloc(0) };
      },
    });
    await assert.rejects(() => p.synthesize('hello', path.join(root, 'a.wav')), (err) => {
      assert.match(err.message, /HTTP 401/);
      assert.equal(err.message.includes(KEY), false);
      assert.equal(err.stack.includes(KEY), false);
      assert.match(err.message, /\[redacted\]/);
      return true;
    });
    const state = fs.readFileSync(p._stateFile, 'utf8');
    assert.equal(state.includes(KEY), false);
    assert.equal(p._calls.some(c => JSON.stringify(c.args || '').includes(KEY)), false);
    assert.equal(live, 0);
    assert.equal(logs.some(line => line.includes(KEY) || line.includes(ENV_KEY)), false);
    fs.writeFileSync(path.join(root, 'corrupt.json'), `{${KEY}`);
    const budget = new CharacterBudget({ stateFile: path.join(root, 'corrupt.json'), limitChars: 10, now: () => new Date('2026-10-21T00:00:00Z') });
    assert.throws(() => budget.reserve(1), (err) => {
      assert.match(err.message, /unreadable/);
      assert.equal(err.message.includes(KEY), false);
      return true;
    });
  } finally {
    console.log = orig.log; console.error = orig.error; console.warn = orig.warn;
    delete process.env.AZURE_SPEECH_KEY;
    globalThis.fetch = origFetch;
  }
});

test('SSML aliases MOONKATTY, wraps prosody and breaks, and can carry a phoneme', () => {
  const ssml = buildSsml('Hello MOONKATTY. [pause 250ms] Next.', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 });
  assert.match(ssml, /<voice name="en-US-AndrewMultilingualNeural">/);
  assert.match(ssml, /<prosody rate="95%">/);
  assert.match(ssml, /<sub alias="moon-KAT-ee">MOONKATTY<\/sub>/);
  assert.match(ssml, /<break time="250ms"\/>/);
  assert.equal(buildSsml('MOONKATTYS', { rate: 1 }).includes('<sub'), false);
  const lex = buildSsml('Hello Moon Katty', { rate: null });
  assert.match(lex, /<sub alias="moon-KAT-ee">Moon Katty<\/sub>/);
  assert.equal(lex.includes('<prosody'), false);
  const phone = buildSsml('MOONKATTY', { pronunciations: [{ text: 'MOONKATTY', alphabet: 'ipa', ph: 'a<b' }] });
  assert.match(phone, /<phoneme alphabet="ipa" ph="a&lt;b">MOONKATTY<\/phoneme>/);
});

test('synthesize posts SSML to the regional endpoint and stays inside the mocked fetch', async () => {
  const root = dir();
  const seen = [];
  const p = provider(root, {
    fetchFn: async (url, init) => {
      seen.push({ url, init });
      const st = JSON.parse(fs.readFileSync(p._stateFile, 'utf8'));
      assert.equal(st.usedChars, 'Hello MOONKATTY'.length);
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer };
    },
  });
  const result = await p.synthesize('Hello MOONKATTY', path.join(root, 'out.wav'));
  assert.equal(seen[0].url, 'https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['X-Microsoft-OutputFormat'], 'riff-24khz-16bit-mono-pcm');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/ssml+xml');
  assert.equal(seen[0].init.headers['User-Agent'], 'moonkatty-news');
  assert.match(seen[0].init.body, /<sub alias="moon-KAT-ee">MOONKATTY<\/sub>/);
  assert.equal(seen[0].init.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.equal(result.durationSec, 1.5);
  assert.equal(result.characters, 'Hello MOONKATTY'.length);
  assert.equal(p._calls.some(c => c.cmd === 'ffmpeg' && c.args.includes('44100') && c.args.includes('pcm_s16le')), true);
  assert.equal(fs.existsSync(path.join(root, 'out.wav.azure.wav')), false);
});

test('SpeechComposer lexicon output is aliased as moon-KAT-ee', async () => {
  const root = dir();
  const seen = [];
  const p = provider(root, {
    fetchFn: async (url, init) => {
      seen.push(init.body);
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from([82, 73, 70, 70]).buffer };
    },
  });
  const composer = new SpeechComposer({
    tts: p,
    lexicon: { MOONKATTY: 'Moon Katty' },
    runFn: async (cmd) => {
      if (cmd === 'ffprobe') return { stdout: '1.25\n', stderr: '' };
      throw new Error(`unexpected ${cmd}`);
    },
  });
  const result = await composer.synthesize('Hello MOONKATTY', path.join(root, 'composed.wav'));
  assert.match(seen[0], /<sub alias="moon-KAT-ee">Moon Katty<\/sub>/);
  assert.equal(result.spokenText, 'Hello Moon Katty');
  assert.equal(result.durationSec, 1.25);
});

test('Keychain read and write keep the secret out of argv and out of errors', async () => {
  const readFail = scriptedSpawn({ code: 1, stdout: `${KEY}\n`, stderr: `stderr ${KEY}` });
  await assert.rejects(() => readKey({ spawnFn: readFail, platform: 'darwin', service: TEST_SERVICE }), (err) => {
    assert.equal(err.message, 'Azure Speech key is not in the Keychain.');
    assert.equal(err.message.includes(KEY), false);
    return true;
  });
  assert.deepEqual(readFail.calls[0].args, ['find-generic-password', '-s', TEST_SERVICE, '-a', ACCOUNT, '-w']);
  const readOk = scriptedSpawn({ code: 0, stdout: `${KEY}\n` });
  assert.equal(await readKey({ spawnFn: readOk, platform: 'darwin', service: SERVICE }), KEY);
  let spawned = 0;
  await assert.rejects(() => readKey({ platform: 'linux', spawnFn: () => { spawned += 1; } }), /macOS-only/);
  await assert.rejects(() => storeKey(`bad" ${KEY}`, { platform: 'darwin', spawnFn: () => { spawned += 1; } }), (err) => {
    assert.match(err.message, /will not accept/);
    assert.equal(err.message.includes(KEY), false);
    return true;
  });
  assert.equal(spawned, 0);
  const writeFail = scriptedSpawn({ code: 1, stderr: KEY });
  await assert.rejects(() => storeKey(KEY, { spawnFn: writeFail, platform: 'darwin', service: TEST_SERVICE }), (err) => {
    assert.equal(err.message, 'Azure Speech key was not stored.');
    assert.equal(err.message.includes(KEY), false);
    return true;
  });
  assert.deepEqual(writeFail.calls[0].args, ['-i']);
  assert.equal(writeFail.calls[0].args.join(' ').includes(KEY), false);
  assert.match(writeFail.calls[0].stdin, new RegExp(`-s "${TEST_SERVICE}"`));
  assert.match(writeFail.calls[0].stdin, new RegExp(`-w "${KEY}"`));
  await assert.rejects(() => runCli(['store', KEY], `${KEY}\n`, { spawnFn: scriptedSpawn(), platform: 'darwin' }), (err) => {
    assert.match(err.message, /no extra arguments/);
    assert.equal(err.message.includes(KEY), false);
    return true;
  });
  const cliSpawn = scriptedSpawn({ code: 0 });
  const msg = await runCli(['store-test'], `${KEY}\n`, { spawnFn: cliSpawn, platform: 'darwin' });
  assert.equal(msg, 'Stored Azure Speech key in the Keychain. The key was not printed.');
  assert.equal(msg.includes(KEY), false);
  assert.deepEqual(cliSpawn.calls[0].args, ['-i']);
  assert.match(cliSpawn.calls[0].stdin, new RegExp(`-s "${TEST_SERVICE}"`));
});

test('Linux without an injected Keychain does not spawn or fetch', async () => {
  const root = dir();
  let spawned = 0;
  let fetched = 0;
  const p = new AzureSpeechProvider({
    enabled: true,
    tier: 'F0',
    region: 'uaenorth',
    stateFile: path.join(root, 'usage.json'),
    platform: 'linux',
    spawnFn: () => { spawned += 1; throw new Error('spawned'); },
    fetchFn: async () => { fetched += 1; throw new Error('fetched'); },
  });
  await assert.rejects(() => p.synthesize('hello', path.join(root, 'a.wav')), /macOS-only/);
  assert.equal(spawned, 0);
  assert.equal(fetched, 0);
  assert.equal(fs.existsSync(path.join(root, 'usage.json')), false);
});

test('a disabled provider is not a MasterVoice swap, and the repo candidate stays Kokoro', () => {
  const root = dir();
  const disabled = path.join(root, 'disabled.json');
  fs.writeFileSync(disabled, JSON.stringify({ status: 'candidate', engine: 'azure', enabled: false, gender: 'male', voice: 'en-US-AndrewMultilingualNeural', tier: 'F0', region: 'uaenorth' }));
  assert.throws(() => new MasterVoice({ file: disabled, env: {} }).createTTS(), /disabled[\s\S]*not locked/);
  const enabled = path.join(root, 'enabled.json');
  fs.writeFileSync(enabled, JSON.stringify({ status: 'candidate', engine: 'azure', enabled: true, gender: 'male', voice: 'en-US-AndrewMultilingualNeural', tier: 'F0', region: 'uaenorth', allowPaid: false, rate: 0.95, stateFile: path.join(root, 'usage.json') }));
  const tts = new MasterVoice({ file: enabled, env: {} }).createTTS();
  assert.equal(tts.name, 'azure:en-US-AndrewMultilingualNeural');
  assert.equal(tts.enabled, true);
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'media-automation', 'config', 'master-voice.json'), 'utf8'));
  assert.equal(live.status, 'candidate');
  assert.equal(live.engine, 'kokoro');
  assert.equal(live.voice, 'am_michael');
  assert.equal(live.lockedBy, null);
  assert.equal(live.lockedAt, null);
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'azure-tts', 'candidate.example.json'), 'utf8'));
  assert.equal(example.enabled, false);
  assert.equal(example.engine, 'azure');
  assert.equal(example.voice, 'en-US-AndrewMultilingualNeural');
  assert.equal(example.allowPaid, false);
  assert.equal('key' in example, false);
  for (const name of ['budget.js', 'keychain.js', 'ssml.js', 'provider.js', 'keychain-cli.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'azure-tts', name), 'utf8');
    assert.equal(src.includes(KEY), false);
    assert.equal(src.includes('process.env.AZURE'), false);
    assert.doesNotMatch(src, /process\.env\s*\[/);
  }
});

test('the provider is disabled by default and an empty script does not reserve quota', async () => {
  const root = dir();
  let fetched = 0;
  const p = new AzureSpeechProvider({ enabled: false, tier: 'F0', region: 'uaenorth', stateFile: path.join(root, 'usage.json'), fetchFn: async () => { fetched += 1; } });
  await assert.rejects(() => p.synthesize('hello', path.join(root, 'a.wav')), /disabled/);
  const on = provider(root, { fetchFn: async () => { fetched += 1; throw new Error('no'); } });
  await assert.rejects(() => on.synthesize('   ', path.join(root, 'b.wav')), /empty text/);
  assert.equal(fetched, 0);
  assert.equal(fs.existsSync(on._stateFile), false);
});

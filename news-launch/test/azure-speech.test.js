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
  await assert.rejects(() => provider(root, { ...base, tier: 'S0', allowPaid: false }).synthesize('hello', path.join(root, 'c.wav')), /S0 calls are refused/);
  await assert.rejects(() => provider(root, { ...base, tier: 'S0', paidEnabled: true }).synthesize('hello', path.join(root, 'd.wav')), /S0 calls are refused/);
  await assert.rejects(() => provider(root, { ...base, tier: 'S0', paidEnabled: false, paidApproval: { at: '2026-10-21T00:00:00Z', by: 'owner' } }).synthesize('hello', path.join(root, 'e.wav')), /S0 calls are refused/);
  await assert.rejects(() => provider(root, { ...base, voice: 'en-US-Andrew:DragonHDLatestNeural' }).synthesize('hello', path.join(root, 'f.wav')), /HD voice/);
  await assert.rejects(() => provider(root, { ...base, tier: 'F0', allowPaid: true, paidCapChars: 100 }).synthesize('hello', path.join(root, 'g.wav')), /does not apply to tier F0/);
  await assert.rejects(() => provider(root, { ...base, limitChars: 500001 }).synthesize('hello', path.join(root, 'h.wav')), /500000/);
  assert.equal(fetches, 0);
  assert.equal(fs.existsSync(base.stateFile), false);
});

test('S0 dollar budget warns at 70 and 90 percent and blocks above one dollar', async () => {
  const { UsdBudget, costMicro } = require('../azure-tts/usd');
  const root = dir();
  const file = path.join(root, 'usd.json');
  const now = () => new Date('2026-10-21T12:00:00Z');
  const budget = new UsdBudget({ stateFile: file, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now });
  const first = budget.begin({ chars: 60000, hash: 'a' });
  assert.equal(first.spentMicro, costMicro(60000, 15));
  assert.equal(first.warnings.length, 2);
  assert.throws(() => budget.begin({ chars: 6667, hash: 'b' }), /monthly budget reached/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).spentMicro, costMicro(60000, 15));
  const exact = new UsdBudget({ stateFile: path.join(root, 'exact.json'), monthlyBudgetUsd: 1, pricePerMillionChars: 10, now });
  assert.equal(exact.begin({ chars: 100000, hash: 'c' }).spentMicro, 1000000);
  assert.throws(() => exact.begin({ chars: 1, hash: 'd' }), /monthly budget reached/);
});

test('the character count is committed before HTTP and is kept when HTTP fails', async () => {
  const root = dir();
  const out = path.join(root, 'a.wav');
  const p = provider(root, {
    maxAttempts: 1,
    fetchFn: async () => {
      const used = JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).usedChars;
      assert.equal(used, buildSsml('hello', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length);
      throw new Error(`network down ${KEY}`);
    },
  });
  await assert.rejects(() => p.synthesize('hello', out), (err) => {
    assert.match(err.message, /request failed/);
    assert.equal(err.message.includes(KEY), false);
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).usedChars, buildSsml('hello', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length);
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
      assert.equal(st.usedChars, buildSsml('Hello MOONKATTY', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length);
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
  assert.equal(result.characters, buildSsml('Hello MOONKATTY', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length);
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
  assert.equal(example.paidEnabled, false);
  assert.equal(example.paidApproval, null);
  assert.equal(example.monthlyBudgetUsd, 1);
  assert.equal(example.pricePerMillionChars, 15);
  assert.equal(example.tier, 'S0');
  assert.equal(example.fallback.engine, 'kokoro');
  assert.equal(example.fallback.voice, 'am_michael');
  assert.equal('key' in example, false);
  for (const name of ['budget.js', 'keychain.js', 'ssml.js', 'provider.js', 'keychain-cli.js', 'usd.js', 'ledger.js', 'disclosure.js', 'session.js']) {
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

const APPROVAL = { at: '2026-10-21T00:00:00Z', by: 'owner' };

function s0(root, extra = {}) {
  return provider(root, {
    tier: 'S0',
    paidEnabled: true,
    paidApproval: APPROVAL,
    monthlyBudgetUsd: 1,
    pricePerMillionChars: 15,
    ...extra,
  });
}

test('neural and HD prices default from the 21 October 2026 retail meters and stay editable', () => {
  const { resolvePrice, costMicro, PRICE_SOURCE, NEURAL_USD_PER_MILLION, HD_USD_PER_MILLION } = require('../azure-tts/usd');
  assert.equal(PRICE_SOURCE.url, 'https://prices.azure.com/api/retail/prices');
  assert.equal(PRICE_SOURCE.accessed, '2026-10-21');
  assert.equal(NEURAL_USD_PER_MILLION, 15);
  assert.equal(HD_USD_PER_MILLION, 22);
  assert.equal(resolvePrice({ voice: 'en-US-AndrewMultilingualNeural' }).pricePerMillionChars, 15);
  assert.equal(resolvePrice({ voice: 'en-US-AndrewMultilingualNeural' }).monthlyBudgetUsd, 1);
  assert.equal(resolvePrice({ voice: 'en-US-Andrew:DragonHDLatestNeural' }).pricePerMillionChars, 22);
  assert.equal(resolvePrice({ voice: 'en-US-Andrew:DragonHDLatestNeural', pricePerMillionChars: 15 }).pricePerMillionChars, 15);
  assert.equal(costMicro(1, 15), 15);
  assert.equal(costMicro(1, 0.5), 1);
});

test('reconciliation raises the guard to a higher owner figure and does not lower it', () => {
  const { UsdBudget } = require('../azure-tts/usd');
  const root = dir();
  const file = path.join(root, 'usd.json');
  const now = () => new Date('2026-10-21T12:00:00Z');
  const budget = new UsdBudget({ stateFile: file, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now });
  budget.begin({ chars: 1000, hash: 'seed' });
  const before = JSON.parse(fs.readFileSync(file, 'utf8')).spentMicro;
  assert.throws(() => budget.reconcile({ actualUsd: 0.5 }), /owner name/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).spentMicro, before);
  const raised = budget.reconcile({ actualUsd: 0.5, by: 'owner', note: 'portal usage' });
  assert.equal(raised.spentMicro, 500000);
  assert.equal(raised.reconciliation.by, 'owner');
  assert.equal(raised.reconciliation.note, 'portal usage');
  const kept = budget.reconcile({ actualUsd: 0.01, by: 'owner' });
  assert.equal(kept.spentMicro, 500000);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.spentMicro, 500000);
  assert.equal(JSON.stringify(state).includes(KEY), false);
});

test('the budget lock blocks a fresh lock, breaks a stale one, and keeps both processes', async () => {
  const { withFileLock } = require('../azure-tts/budget');
  const { UsdBudget, costMicro } = require('../azure-tts/usd');
  const { spawn } = require('child_process');
  const root = dir();
  const held = path.join(root, 'held.lock');
  fs.writeFileSync(held, 'other');
  const started = Date.now();
  assert.throws(() => withFileLock(held, () => { throw new Error('ran'); }), /lock is held/);
  assert.ok(Date.now() - started >= 1900);
  assert.equal(fs.existsSync(held), true);
  const stale = path.join(root, 'stale.lock');
  fs.writeFileSync(stale, 'old');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(stale, old, old);
  let ran = false;
  withFileLock(stale, () => { ran = true; });
  assert.equal(ran, true);
  assert.equal(fs.existsSync(stale), false);

  const file = path.join(root, 'usd.json');
  const usdPath = path.join(__dirname, '..', 'azure-tts', 'usd.js');
  function reserveChild(hash) {
    const code = `
      const { UsdBudget } = require(${JSON.stringify(usdPath)});
      const b = new UsdBudget({ stateFile: ${JSON.stringify(file)}, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: () => new Date('2026-10-21T12:00:00Z') });
      const r = b.begin({ chars: 1000, hash: ${JSON.stringify(hash)} });
      process.stdout.write(JSON.stringify({ spentMicro: r.spentMicro }));
    `;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (codeNum) => (codeNum === 0 ? resolve(out) : reject(new Error(err || out))));
    });
  }
  await Promise.all([reserveChild('h1'), reserveChild('h2')]);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.spentMicro, costMicro(1000, 15) * 2);
  assert.equal((fs.statSync(file).mode & 0o077), 0);
});

test('every S0 attempt is billed, including a timeout, and the ledger stores no script and no key', async () => {
  const { costMicro, formatUsd } = require('../azure-tts/usd');
  const { ledgerPath, appendLedger } = require('../azure-tts/ledger');
  const root = dir();
  const script = 'Hello MOONKATTY ledger-secret';
  const ssml = buildSsml(script, { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 });
  let fetches = 0;
  let keys = 0;
  const ids = [];
  const p = s0(root, {
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async (url, init) => {
      fetches += 1;
      ids.push(init.headers['X-Client-Request-Id']);
      assert.equal(url, 'https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1');
      if (fetches === 1) {
        const err = new Error(`timeout ${KEY}`);
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer };
    },
  });
  const result = await p.synthesize(script, path.join(root, 'out.wav'));
  assert.equal(fetches, 2);
  assert.equal(keys, 1);
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[0].length, 16);
  assert.equal(result.attempts, 2);
  assert.equal(result.cached, false);
  assert.equal(result.characters, ssml.length);
  const perTry = costMicro(ssml.length, 15);
  assert.equal(JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).spentMicro, perTry * 2);
  const lines = fs.readFileSync(ledgerPath(root, '2026-10'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((row) => row.status), ['reserved', 'timeout', 'reserved', 'ok']);
  for (const row of lines) {
    assert.deepEqual(Object.keys(row).sort(), ['at', 'attempt', 'chars', 'estCostUsd', 'month', 'requestId', 'status']);
    assert.equal(row.chars, ssml.length);
    assert.equal(row.estCostUsd, formatUsd(perTry));
    assert.equal(row.requestId, ids[0]);
    assert.equal(JSON.stringify(row).includes(script), false);
    assert.equal(JSON.stringify(row).includes(KEY), false);
    assert.equal(JSON.stringify(row).includes('MOONKATTY'), false);
  }
  assert.equal(fs.readFileSync(p._stateFile, 'utf8').includes(KEY), false);
  assert.equal(fs.readFileSync(p._stateFile, 'utf8').includes(script), false);
  const refused = path.join(root, 'refused.jsonl');
  assert.throws(() => appendLedger(refused, { at: '2026-10-21T00:00:00Z', text: script, chars: 1, status: 'ok' }, KEY), /script content/);
  assert.equal(fs.existsSync(refused), false);
  assert.throws(() => appendLedger(refused, { at: '2026-10-21T00:00:00Z', chars: 1, estCostUsd: KEY, status: 'ok', requestId: 'a', attempt: 1, month: '2026-10' }, KEY), /refused a secret/);
  assert.equal(fs.existsSync(refused), false);
});

test('an identical re-render is cached at zero dollars and does not call the network', async () => {
  const { costMicro } = require('../azure-tts/usd');
  const { ledgerPath } = require('../azure-tts/ledger');
  const root = dir();
  let fetches = 0;
  let keys = 0;
  const p = s0(root, {
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async () => {
      fetches += 1;
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF-audio')).buffer };
    },
  });
  const first = await p.synthesize('Hello MOONKATTY', path.join(root, 'a.wav'));
  const spent = JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).spentMicro;
  assert.equal(spent, costMicro(first.characters, 15));
  const second = await p.synthesize('Hello MOONKATTY', path.join(root, 'b.wav'));
  assert.equal(fetches, 1);
  assert.equal(keys, 1);
  assert.equal(second.cached, true);
  assert.equal(second.characters, 0);
  assert.equal(second.attempts, 0);
  assert.equal(JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).spentMicro, spent);
  const lines = fs.readFileSync(ledgerPath(root, '2026-10'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[lines.length - 1].status, 'cache');
  assert.equal(lines[lines.length - 1].chars, 0);
  assert.equal(lines[lines.length - 1].estCostUsd, '0.000000');
  let third = 0;
  const other = s0(root, {
    stateFile: p._stateFile,
    cacheDir: p.cacheDir,
    getKey: async () => KEY,
    fetchFn: async () => { third += 1; return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from([1]).buffer }; },
  });
  await other.synthesize('A different line', path.join(root, 'c.wav'));
  assert.equal(third, 1);
});

test('a live in-flight hash does not send or charge, and a dead pid does not block', async () => {
  const { requestHash } = require('../azure-tts/provider');
  const { spawn } = require('child_process');
  const root = dir();
  const voice = 'en-US-AndrewMultilingualNeural';
  const ssml = buildSsml('hello', { voice, rate: 0.95 });
  const hash = requestHash({ text: 'hello', voice, rate: 0.95, ssml });
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  let fetches = 0;
  try {
    assert.equal(process.kill(child.pid, 0), true);
    const stateFile = path.join(root, 'usage.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      month: '2026-10', spentMicro: 1234, inflight: { [hash]: { pid: child.pid, at: new Date().toISOString() } },
    }));
    const p = s0(root, {
      stateFile,
      fetchFn: async () => { fetches += 1; throw new Error('sent'); },
    });
    await assert.rejects(() => p.synthesize('hello', path.join(root, 'a.wav')), /already in flight/);
    assert.equal(fetches, 0);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).spentMicro, 1234);
  } finally {
    child.kill();
  }
  const { UsdBudget, costMicro } = require('../azure-tts/usd');
  let dead = 1 << 20;
  for (; dead < (1 << 22); dead++) {
    try { process.kill(dead, 0); } catch (e) { if (e.code === 'ESRCH') break; }
  }
  const file = path.join(root, 'dead.json');
  fs.writeFileSync(file, JSON.stringify({
    month: '2026-10', spentMicro: 0, inflight: { dead: { pid: dead, at: new Date().toISOString() } },
  }));
  const budget = new UsdBudget({ stateFile: file, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: () => new Date('2026-10-21T12:00:00Z') });
  const reserved = budget.begin({ chars: 10, hash: 'dead' });
  assert.equal(reserved.busy, false);
  assert.equal(reserved.spentMicro, costMicro(10, 15));
});

test('S0 hard-blocks before HTTP when the next attempt would pass the dollar budget', async () => {
  const { UsdBudget } = require('../azure-tts/usd');
  const { ledgerPath } = require('../azure-tts/ledger');
  const root = dir();
  const stateFile = path.join(root, 'usage.json');
  const now = () => new Date('2026-10-21T12:00:00Z');
  const budget = new UsdBudget({ stateFile, monthlyBudgetUsd: 1, pricePerMillionChars: 10, now });
  budget.begin({ chars: 100000, hash: 'fill' });
  budget.clearInflight('fill');
  let fetches = 0;
  let keys = 0;
  const p = s0(root, {
    stateFile,
    pricePerMillionChars: 10,
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  await assert.rejects(() => p.synthesize('hello', path.join(root, 'a.wav')), /monthly budget reached/);
  assert.equal(fetches, 0);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).spentMicro, 1000000);
  const lines = fs.readFileSync(ledgerPath(root, '2026-10'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[lines.length - 1].status, 'blocked');
  assert.equal(JSON.stringify(lines).includes('hello'), false);
  assert.equal(JSON.stringify(lines).includes(KEY), false);
  assert.equal(keys, 1);
});

test('an HD voice on S0 uses 22 dollars per million unless the owner overrides it', async () => {
  const { costMicro, formatUsd } = require('../azure-tts/usd');
  const root = dir();
  const voice = 'en-US-Andrew:DragonHDLatestNeural';
  const p = s0(root, {
    voice,
    pricePerMillionChars: null,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer }),
  });
  const result = await p.synthesize('Hi', path.join(root, 'a.wav'));
  const chars = buildSsml('Hi', { voice, rate: 0.95 }).length;
  assert.equal(result.characters, chars);
  assert.equal(result.estCostUsd, formatUsd(costMicro(chars, 22)));
  assert.equal(JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).pricePerMillionChars, 22);
});

test('the YouTube dry-run payload carries the synthetic voice disclosure', async () => {
  const { dryRunAzureEpisode, AZURE_DISCLOSURE, episodeRecord } = require('../azure-tts/disclosure');
  const root = dir();
  const orig = globalThis.fetch;
  let live = 0;
  globalThis.fetch = async () => { live += 1; throw new Error('LIVE'); };
  try {
    const result = await dryRunAzureEpisode({
      outDir: root,
      episodeId: 'ep-azure',
      title: 'MOONKATTY NEWS',
      summary: 'Markets moved.',
      showCaption: true,
    });
    assert.equal(AZURE_DISCLOSURE, 'Voice: AI-generated (Microsoft Azure)');
    assert.match(result.description, /Markets moved\./);
    assert.match(result.description, /Voice: AI-generated \(Microsoft Azure\)/);
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].status, 'dry_run');
    assert.match(result.posts[0].payload.description, /Voice: AI-generated \(Microsoft Azure\)/);
    assert.equal(result.posts[0].payload.caption, AZURE_DISCLOSURE);
    assert.match(result.posts[0].remote.preview.description, /Voice: AI-generated \(Microsoft Azure\)/);
    assert.match(result.posts[0].remote.preview.description, /Markets moved\./);
    assert.equal(live, 0);
    const caption = episodeRecord({ episodeId: 'ep-azure', engine: 'azure:en-US-AndrewMultilingualNeural', voice: 'en-US-AndrewMultilingualNeural', summary: 'Markets moved.', showCaption: true });
    assert.equal(caption.caption, AZURE_DISCLOSURE);
    const hidden = episodeRecord({ episodeId: 'ep-azure', engine: 'azure:en-US-AndrewMultilingualNeural', voice: 'en-US-AndrewMultilingualNeural', summary: 'Markets moved.', showCaption: false });
    assert.equal(hidden.caption, null);
    assert.match(hidden.description, /Voice: AI-generated \(Microsoft Azure\)/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('Azure failure falls back to the local engine and a final render is marked for review', async () => {
  const { VoiceSession } = require('../azure-tts/session');
  const { AZURE_DISCLOSURE } = require('../azure-tts/disclosure');
  const root = dir();
  const episodeFile = path.join(root, 'episode.json');
  let localCalls = 0;
  const local = {
    name: 'kokoro:am_michael',
    synthesize: async (text, out) => {
      localCalls += 1;
      fs.writeFileSync(out, 'local');
      return { file: out, durationSec: 1, spoken: text };
    },
  };
  let fetches = 0;
  const disabled = new AzureSpeechProvider({
    enabled: false,
    tier: 'S0',
    region: 'uaenorth',
    stateFile: path.join(root, 'usage.json'),
    fetchFn: async () => { fetches += 1; throw new Error('LIVE'); },
    getKey: async () => KEY,
  });
  const unnamed = new VoiceSession({
    azure: disabled,
    local: { synthesize: async (text, out) => ({ file: out, durationSec: 1 }) },
    episodeFile,
    summary: 'Markets moved.',
    fallback: { engine: 'kokoro', voice: 'am_michael' },
  });
  const preview = await unnamed.render('hello', path.join(root, 'local.wav'), { episodeId: 'ep-1', final: true });
  assert.equal(preview.voice, 'fallback');
  assert.equal(preview.review, 'owner-review');
  assert.equal(preview.engine, 'kokoro:am_michael');
  assert.equal(fetches, 0);
  let saved = JSON.parse(fs.readFileSync(episodeFile, 'utf8'));
  assert.equal(saved.voice, 'fallback');
  assert.equal(saved.review, 'owner-review');
  assert.equal(saved.description.includes(AZURE_DISCLOSURE), false);
  assert.equal(saved.azureStatus, 'disabled');

  const chatter = new VoiceSession({
    azure: disabled,
    local: { name: 'chatterbox:ref', synthesize: local.synthesize },
    episodeFile,
    summary: 'Markets moved.',
  });
  const chatterResult = await chatter.render('hello', path.join(root, 'chatter.wav'), { episodeId: 'ep-2', final: true });
  assert.equal(chatterResult.engine, 'chatterbox:ref');
  assert.equal(chatterResult.voice, 'fallback');
  assert.equal(JSON.parse(fs.readFileSync(episodeFile, 'utf8')).engine, 'chatterbox:ref');

  const noKey = s0(root, {
    getKey: async () => { throw new Error('Azure Speech key is not in the Keychain.'); },
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  const noKeySession = new VoiceSession({ azure: noKey, local, episodeFile, summary: 'Markets moved.' });
  const noKeyResult = await noKeySession.render('hello', path.join(root, 'nokey.wav'), { episodeId: 'ep-3', final: true });
  assert.equal(noKeyResult.voice, 'fallback');
  assert.equal(noKeyResult.azureStatus, 'no-key');
  assert.equal(fetches, 0);

  const { UsdBudget } = require('../azure-tts/usd');
  const stateFile = path.join(root, 'blocked.json');
  const budget = new UsdBudget({ stateFile, monthlyBudgetUsd: 1, pricePerMillionChars: 10, now: () => new Date('2026-10-21T12:00:00Z') });
  budget.begin({ chars: 100000, hash: 'fill' });
  budget.clearInflight('fill');
  const blocked = s0(root, {
    stateFile,
    pricePerMillionChars: 10,
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  const blockedSession = new VoiceSession({ azure: blocked, local, episodeFile, summary: 'Markets moved.' });
  const blockedResult = await blockedSession.render('hello', path.join(root, 'blocked.wav'), { episodeId: 'ep-4', final: true });
  assert.equal(blockedResult.voice, 'fallback');
  assert.equal(blockedResult.review, 'owner-review');
  assert.equal(blockedResult.azureStatus, 'budget-blocked');
  assert.equal(fetches, 0);

  const broken = s0(root, {
    fetchFn: async () => { fetches += 1; throw new Error(`network down UNIQUE-AZURE-FAIL-TOKEN ${KEY}`); },
    maxAttempts: 1,
  });
  const brokenSession = new VoiceSession({ azure: broken, local, episodeFile, summary: 'Markets moved.' });
  const brokenResult = await brokenSession.render('hello', path.join(root, 'err.wav'), { episodeId: 'ep-5', final: true });
  assert.equal(brokenResult.voice, 'fallback');
  assert.equal(brokenResult.engine, 'kokoro:am_michael');
  assert.equal(brokenResult.azureStatus, 'error');
  saved = JSON.parse(fs.readFileSync(episodeFile, 'utf8'));
  assert.equal(saved.voice, 'fallback');
  assert.equal(JSON.stringify(saved).includes('UNIQUE-AZURE-FAIL-TOKEN'), false);
  assert.equal(JSON.stringify(saved).includes(KEY), false);
  assert.ok(localCalls >= 1);

  const azure = s0(root, {
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer }),
  });
  const before = localCalls;
  const okSession = new VoiceSession({
    azure,
    local: { name: 'kokoro:am_michael', synthesize: async () => { throw new Error('local should not run'); } },
    episodeFile,
    summary: 'Markets moved.',
    showCaption: true,
  });
  const spoken = await okSession.render('Hello', path.join(root, 'azure.wav'), { episodeId: 'ep-6', final: true });
  assert.equal(spoken.voice, 'en-US-AndrewMultilingualNeural');
  assert.equal(spoken.engine, 'azure:en-US-AndrewMultilingualNeural');
  assert.equal(spoken.review, null);
  assert.equal(spoken.caption, AZURE_DISCLOSURE);
  assert.match(spoken.description, /Voice: AI-generated \(Microsoft Azure\)/);
  assert.equal(localCalls, before);
  assert.equal(JSON.parse(fs.readFileSync(episodeFile, 'utf8')).voice, 'en-US-AndrewMultilingualNeural');

  const unapproved = new AzureSpeechProvider({
    enabled: true, tier: 'S0', region: 'uaenorth', paidEnabled: false,
    stateFile: path.join(root, 'unapproved.json'),
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
    getKey: async () => KEY,
    now: () => new Date('2026-10-21T12:00:00Z'),
  });
  const unapprovedSession = new VoiceSession({ azure: unapproved, local, episodeFile, summary: 'Markets moved.' });
  const unapprovedResult = await unapprovedSession.render('hello', path.join(root, 'unapproved.wav'), { episodeId: 'ep-8', final: true });
  assert.equal(unapprovedResult.voice, 'fallback');
  assert.equal(unapprovedResult.azureStatus, 'not-approved');
  assert.equal(fetches, 1);

  const failingLocal = new VoiceSession({
    azure: disabled,
    local: { name: 'kokoro:am_michael', synthesize: async () => { throw new Error('local failed'); } },
    episodeFile,
    summary: 'Markets moved.',
  });
  await assert.rejects(() => failingLocal.render('hello', path.join(root, 'fail-local.wav'), { episodeId: 'ep-7', final: true }), /local failed/);
  assert.equal(JSON.parse(fs.readFileSync(episodeFile, 'utf8')).voice, 'fallback');
});

test('S0 makes no network call unless paidEnabled and an owner approval are both set', async () => {
  const root = dir();
  const orig = globalThis.fetch;
  let live = 0;
  globalThis.fetch = async () => { live += 1; throw new Error('LIVE'); };
  let keys = 0;
  try {
    const bare = new AzureSpeechProvider({ stateFile: path.join(root, 'bare.json') });
    await assert.rejects(() => bare.synthesize('hello', path.join(root, 'a.wav')), /disabled/);
    const refused = new AzureSpeechProvider({
      enabled: true,
      tier: 'S0',
      region: 'uaenorth',
      paidEnabled: false,
      monthlyBudgetUsd: 1,
      stateFile: path.join(root, 'usage.json'),
      platform: 'linux',
      getKey: async () => { keys += 1; return KEY; },
      now: () => new Date('2026-10-21T12:00:00Z'),
    });
    await assert.rejects(() => refused.synthesize('hello', path.join(root, 'b.wav')), /S0 calls are refused/);
    const half = new AzureSpeechProvider({
      enabled: true,
      tier: 'S0',
      region: 'uaenorth',
      paidEnabled: true,
      paidApproval: { at: 'not-a-timestamp', by: 'owner' },
      stateFile: path.join(root, 'half.json'),
      getKey: async () => { keys += 1; return KEY; },
      now: () => new Date('2026-10-21T12:00:00Z'),
    });
    await assert.rejects(() => half.synthesize('hello', path.join(root, 'c.wav')), /S0 calls are refused/);
    const file = path.join(root, 'voice.json');
    fs.writeFileSync(file, JSON.stringify({
      status: 'candidate', engine: 'azure', enabled: true, gender: 'male',
      voice: 'en-US-AndrewMultilingualNeural', tier: 'S0', region: 'uaenorth',
      paidEnabled: true, monthlyBudgetUsd: 1, rate: 0.95, stateFile: path.join(root, 'mv.json'),
    }));
    assert.throws(() => new MasterVoice({ file, env: {} }).createTTS(), /S0 calls are refused/);
    fs.writeFileSync(file, JSON.stringify({
      status: 'candidate', engine: 'azure', enabled: true, gender: 'male',
      voice: 'en-US-AndrewMultilingualNeural', tier: 'S0', region: 'uaenorth',
      paidEnabled: true, paidApproval: APPROVAL, monthlyBudgetUsd: 1, rate: 0.95,
      stateFile: path.join(root, 'mv.json'),
    }));
    const tts = new MasterVoice({ file, env: {} }).createTTS();
    assert.equal(tts.paidEnabled, true);
    assert.equal(tts.name, 'azure:en-US-AndrewMultilingualNeural');
    assert.equal(keys, 0);
    assert.equal(live, 0);
    assert.equal(fs.existsSync(path.join(root, 'usage.json')), false);
  } finally {
    globalThis.fetch = orig;
  }
});

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
  const exact = new UsdBudget({ stateFile: path.join(root, 'exact.json'), monthlyBudgetUsd: 15, pricePerMillionChars: 15, now });
  assert.equal(exact.begin({ chars: 1000000, hash: 'c' }).spentMicro, 15000000);
  assert.throws(() => exact.begin({ chars: 1, hash: 'd' }), /monthly budget reached/);
});

test('the character count is committed before HTTP and is kept when HTTP fails', async () => {
  const root = dir();
  const out = path.join(root, 'a.wav');
  const p = provider(root, {
    maxAttempts: 1,
    fetchFn: async () => {
      const { costMicro } = require('../azure-tts/usd');
      const spent = JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).spentMicro;
      assert.equal(spent, costMicro(buildSsml('hello', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length, 15));
      throw new Error(`network down ${KEY}`);
    },
  });
  await assert.rejects(() => p.synthesize('hello', out), (err) => {
    assert.match(err.message, /request failed/);
    assert.equal(err.message.includes(KEY), false);
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
  const { costMicro } = require('../azure-tts/usd');
  assert.equal(JSON.parse(fs.readFileSync(p._stateFile, 'utf8')).spentMicro, costMicro(buildSsml('hello', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length, 15));
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
      const { costMicro } = require('../azure-tts/usd');
      const st = JSON.parse(fs.readFileSync(p._stateFile, 'utf8'));
      assert.equal(st.spentMicro, costMicro(buildSsml('Hello MOONKATTY', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length, 15));
      assert.equal(String(url).includes('management.azure.com'), false);
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
  for (const name of ['budget.js', 'keychain.js', 'ssml.js', 'provider.js', 'keychain-cli.js', 'usd.js', 'ledger.js', 'disclosure.js', 'session.js', 'approval.js', 'price.js', 'sku.js']) {
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

const crypto = require('crypto');
const ownerPair = crypto.generateKeyPairSync('ed25519');
const OWNER_PUB = ownerPair.publicKey.export({ type: 'spki', format: 'pem' });
const OWNER_PRIV = ownerPair.privateKey;

function signedApproval(extra = {}) {
  const { signApproval } = require('../azure-tts/approval');
  return signApproval(OWNER_PRIV, {
    at: '2026-10-21T00:00:00Z',
    by: 'owner',
    voice: extra.voice || 'en-US-AndrewMultilingualNeural',
    region: extra.region || 'uaenorth',
  });
}

function s0(root, extra = {}) {
  const voice = extra.voice || 'en-US-AndrewMultilingualNeural';
  const region = extra.region || 'uaenorth';
  const paidApproval = Object.prototype.hasOwnProperty.call(extra, 'paidApproval') ? extra.paidApproval : signedApproval({ voice, region });
  const approvalPublicKeyPem = Object.prototype.hasOwnProperty.call(extra, 'approvalPublicKeyPem') ? extra.approvalPublicKeyPem : OWNER_PUB;
  return provider(root, {
    tier: 'S0',
    paidEnabled: true,
    monthlyBudgetUsd: 1,
    pricePerMillionChars: 15,
    voice,
    region,
    ...extra,
    paidApproval,
    approvalPublicKeyPem,
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
  assert.throws(() => resolvePrice({ voice: 'en-US-Andrew:DragonHDLatestNeural', pricePerMillionChars: 15 }), /retail floor of 22.00/);
  assert.throws(() => resolvePrice({ voice: 'en-US-AndrewMultilingualNeural', pricePerMillionChars: 0.0000004 }), /retail floor/);
  assert.equal(resolvePrice({ voice: 'en-US-AndrewMultilingualNeural', pricePerMillionChars: 16 }).pricePerMillionChars, 16);
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
    assert.deepEqual(Object.keys(row).sort(), ['at', 'attempt', 'chars', 'estCostUsd', 'month', 'prev', 'requestId', 'status']);
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
  assert.equal(keys, 2);
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
  const budget = new UsdBudget({ stateFile, monthlyBudgetUsd: 15, pricePerMillionChars: 15, now });
  budget.begin({ chars: 1000000, hash: 'fill' });
  budget.clearInflight('fill');
  let fetches = 0;
  let keys = 0;
  const p = s0(root, {
    stateFile,
    monthlyBudgetUsd: 15,
    pricePerMillionChars: 15,
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  await assert.rejects(() => p.synthesize('hello', path.join(root, 'a.wav')), /monthly budget reached/);
  assert.equal(fetches, 0);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).spentMicro, 15000000);
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
  const budget = new UsdBudget({ stateFile, monthlyBudgetUsd: 15, pricePerMillionChars: 15, now: () => new Date('2026-10-21T12:00:00Z') });
  budget.begin({ chars: 1000000, hash: 'fill' });
  budget.clearInflight('fill');
  const blocked = s0(root, {
    stateFile,
    monthlyBudgetUsd: 15,
    pricePerMillionChars: 15,
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  const blockedSession = new VoiceSession({ azure: blocked, local, episodeFile, summary: 'Markets moved.' });
  const blockedResult = await blockedSession.render('hello', path.join(root, 'blocked.wav'), { episodeId: 'ep-4', final: true });
  assert.equal(blockedResult.voice, 'fallback');
  assert.equal(blockedResult.review, 'owner-review');
  assert.equal(blockedResult.azureStatus, 'budget-blocked');
  assert.equal(fetches, 0);

  const spokenState = path.join(root, 'spoken', 'usage.json');
  const broken = s0(root, {
    stateFile: spokenState,
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
    stateFile: spokenState,
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
      paidEnabled: true, paidApproval: signedApproval(), monthlyBudgetUsd: 1, rate: 0.95,
      stateFile: path.join(root, 'mv.json'),
    }));
    const tts = new MasterVoice({ file, env: {}, approvalPublicKeyPem: OWNER_PUB }).createTTS();
    assert.equal(tts.paidEnabled, true);
    assert.equal(tts.name, 'azure:en-US-AndrewMultilingualNeural');
    assert.equal(keys, 0);
    assert.equal(live, 0);
    assert.equal(fs.existsSync(path.join(root, 'usage.json')), false);
  } finally {
    globalThis.fetch = orig;
  }
});

test('QA-AZR-001 config tier F0 is budgeted in USD and the sku read is not a TTS call', async () => {
  const { costMicro } = require('../azure-tts/usd');
  const { skuReadRequest, SKU_API_VERSION } = require('../azure-tts/sku');
  const root = dir();
  const orig = globalThis.fetch;
  let live = 0;
  globalThis.fetch = async () => { live += 1; throw new Error('LIVE'); };
  let fetches = 0;
  try {
    const ssml = buildSsml('hello', { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 });
    const p = provider(root, {
      tier: 'F0',
      paidEnabled: false,
      fetchFn: async (url) => {
        fetches += 1;
        assert.equal(url, 'https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1');
        assert.equal(String(url).includes('management.azure.com'), false);
        return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF-audio')).buffer };
      },
    });
    const result = await p.synthesize('hello', path.join(root, 'a.wav'));
    assert.equal(result.spentMicro, costMicro(ssml.length, 15));
    assert.equal(fetches, 1);
    const req = skuReadRequest({
      subscriptionId: '11111111-1111-1111-1111-111111111111',
      resourceGroup: 'rg',
      accountName: 'speech',
    });
    assert.equal(req.method, 'GET');
    assert.equal(SKU_API_VERSION, '2024-10-01');
    assert.equal(req.url, 'https://management.azure.com/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/speech?api-version=2024-10-01');
    assert.equal(req.skuField, 'sku.name');
    assert.equal(fetches, 1);
    assert.equal(live, 0);
    let probeFetches = 0;
    const mismatch = provider(root, {
      tier: 'F0',
      stateFile: path.join(root, 'mismatch.json'),
      skuProbe: async () => 'S0',
      fetchFn: async () => { probeFetches += 1; throw new Error('sent'); },
    });
    await assert.rejects(() => mismatch.synthesize('hello', path.join(root, 'b.wav')), /sku is S0/);
    assert.equal(probeFetches, 0);
    const unknown = provider(root, {
      tier: 'F0',
      stateFile: path.join(root, 'unknown.json'),
      skuProbe: async () => 'B0',
      fetchFn: async () => { probeFetches += 1; throw new Error('sent'); },
    });
    await assert.rejects(() => unknown.synthesize('hello', path.join(root, 'c.wav')), /sku is unknown/);
    assert.equal(probeFetches, 0);
    const matched = provider(root, {
      tier: 'F0',
      stateFile: path.join(root, 'matched', 'usage.json'),
      skuProbe: async () => 'F0',
      fetchFn: async () => {
        probeFetches += 1;
        return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer };
      },
    });
    const matchedResult = await matched.synthesize('hello', path.join(root, 'd.wav'));
    assert.equal(probeFetches, 1);
    assert.equal(matchedResult.spentMicro, costMicro(ssml.length, 15));
    assert.equal(live, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test('QA-AZR-002 agents cannot flip paid switches and an unsigned approval does not lock S0', async () => {
  const { verifyApproval, OWNER_SERVICE } = require('../azure-tts/approval');
  const { runOwner } = require('../azure-tts/keychain-cli');
  const { PRICE_FILE } = require('../azure-tts/price');
  const root = dir();
  const kokoro = {
    status: 'candidate', engine: 'kokoro', voice: 'am_michael', gender: 'male', enabled: false, paidEnabled: false,
  };
  const voiceFile = path.join(root, 'voice.json');
  fs.writeFileSync(voiceFile, JSON.stringify(kokoro));
  const mv = new MasterVoice({ file: voiceFile, env: {} });
  assert.throws(() => mv.setCandidate({
    enabled: true,
    paidEnabled: true,
    paidApproval: APPROVAL,
    pricePerMillionChars: 0.0000004,
    tier: 'S0',
  }, 'agent'), /owner-only/);
  assert.deepEqual(JSON.parse(fs.readFileSync(voiceFile, 'utf8')), kokoro);
  assert.throws(() => mv.setCandidate({ enabled: true }, 'agent'), /owner-only/);
  assert.throws(() => mv.setCandidate({ paidEnabled: true }, 'agent'), /owner-only/);
  const changed = mv.setCandidate({ voice: 'am_michael' }, 'owner');
  assert.equal(changed.voice, 'am_michael');
  assert.equal(changed.status, 'candidate');
  assert.equal(changed.paidEnabled, false);

  const forgedFile = path.join(root, 'forged.json');
  const forged = {
    status: 'candidate', engine: 'azure', enabled: true, gender: 'male',
    voice: 'en-US-AndrewMultilingualNeural', tier: 'S0', region: 'uaenorth',
    paidEnabled: true, paidApproval: { at: '2026-10-21T00:00:00Z', by: 'agent' },
    rate: 0.95, stateFile: path.join(root, 'forged-usage.json'),
    lockedBy: null, lockedAt: null,
  };
  fs.writeFileSync(forgedFile, JSON.stringify(forged));
  const forgedVoice = new MasterVoice({ file: forgedFile, env: {}, approvalPublicKeyPem: OWNER_PUB });
  assert.throws(() => forgedVoice.lock('agent'), /S0 calls are refused/);
  const afterLock = JSON.parse(fs.readFileSync(forgedFile, 'utf8'));
  assert.equal(afterLock.status, 'candidate');
  assert.equal(afterLock.lockedBy, null);
  assert.equal(afterLock.paidApproval.sig, undefined);

  const other = crypto.generateKeyPairSync('ed25519');
  const { signApproval } = require('../azure-tts/approval');
  const foreign = signApproval(other.privateKey, {
    at: '2026-10-21T00:00:00Z', by: 'agent', voice: 'en-US-AndrewMultilingualNeural', region: 'uaenorth',
  });
  let fetches = 0;
  const foreignProvider = s0(root, {
    paidApproval: foreign,
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  await assert.rejects(() => foreignProvider.synthesize('hello', path.join(root, 'a.wav')), /S0 calls are refused/);
  assert.equal(fetches, 0);
  assert.equal(verifyApproval(foreign, OWNER_PUB, { voice: 'en-US-AndrewMultilingualNeural', region: 'uaenorth' }), false);
  assert.equal(verifyApproval(APPROVAL, OWNER_PUB, { voice: 'en-US-AndrewMultilingualNeural', region: 'uaenorth' }), false);

  const der = OWNER_PRIV.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const approved = await runOwner(['approve', '2026-10-21T00:00:00Z', 'owner', 'en-US-AndrewMultilingualNeural', 'uaenorth'], `${der}\n`);
  const record = JSON.parse(approved);
  assert.equal(verifyApproval(record, OWNER_PUB, { voice: 'en-US-AndrewMultilingualNeural', region: 'uaenorth' }), true);
  assert.equal(approved.includes(der), false);
  const spawn = scriptedSpawn({ code: 0 });
  const stored = await runOwner(['store-owner'], `${der}\n`, { spawnFn: spawn, platform: 'darwin' });
  assert.match(stored, /not printed/);
  assert.equal(stored.includes(der), false);
  assert.deepEqual(spawn.calls[0].args, ['-i']);
  assert.equal(spawn.calls[0].args.join(' ').includes(der), false);
  assert.equal(spawn.calls[0].stdin.includes(`-s "${OWNER_SERVICE}"`), true);
  assert.equal(spawn.calls[0].stdin.includes(`-w "${der}"`), true);
  const providerSrc = fs.readFileSync(path.join(__dirname, '..', 'azure-tts', 'provider.js'), 'utf8');
  assert.equal(providerSrc.includes('MOONKATTY AI STUDIO.azure-speech-owner'), false);

  assert.equal(fs.existsSync(PRICE_FILE), false);
  const priced = path.join(root, 'priced.json');
  fs.writeFileSync(priced, JSON.stringify({
    status: 'candidate', engine: 'azure', enabled: true, gender: 'male',
    voice: 'en-US-AndrewMultilingualNeural', tier: 'F0', region: 'uaenorth',
    paidEnabled: false, pricePerMillionChars: 0.0000004, monthlyBudgetUsd: 1000,
    rate: 0.95, stateFile: path.join(root, 'priced-usage.json'),
  }));
  const tts = new MasterVoice({ file: priced, env: {} }).createTTS();
  assert.equal(tts.pricePerMillionChars, null);
  assert.equal(tts.monthlyBudgetUsd, null);
  const policy = tts.assertConfig();
  assert.equal(policy.pricePerMillionChars, 15);
  assert.equal(policy.monthlyBudgetUsd, 1);
});

test('QA-AZR-003 a near-zero price is refused and the price file must be owner-only', async () => {
  const { writeOwnerPrice, readOwnerPrice } = require('../azure-tts/price');
  const root = dir();
  let fetches = 0;
  const cheap = provider(root, {
    pricePerMillionChars: 0.0000004,
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  await assert.rejects(() => cheap.synthesize('hello', path.join(root, 'a.wav')), /retail floor/);
  assert.equal(fetches, 0);
  const priceFile = path.join(root, 'price.json');
  const written = writeOwnerPrice(priceFile, { pricePerMillionChars: 15, monthlyBudgetUsd: 1, voice: 'en-US-AndrewMultilingualNeural' });
  assert.equal(written.pricePerMillionChars, 15);
  assert.equal(fs.statSync(priceFile).mode & 0o077, 0);
  fs.chmodSync(priceFile, 0o644);
  assert.throws(() => readOwnerPrice(priceFile, 'en-US-AndrewMultilingualNeural'), /owner-only/);
  const loose = provider(root, {
    stateFile: path.join(root, 'loose.json'),
    priceFile,
    fetchFn: async () => { fetches += 1; throw new Error('sent'); },
  });
  await assert.rejects(() => loose.synthesize('hello', path.join(root, 'b.wav')), /owner-only/);
  assert.equal(fetches, 0);
  fs.chmodSync(priceFile, 0o600);
  assert.equal(readOwnerPrice(priceFile, 'en-US-AndrewMultilingualNeural').pricePerMillionChars, 15);
  const badPrice = path.join(root, 'bad-price.json');
  assert.throws(() => writeOwnerPrice(badPrice, { pricePerMillionChars: 0.0000004, voice: 'en-US-AndrewMultilingualNeural' }), /retail floor/);
  assert.equal(fs.existsSync(badPrice), false);
  writeOwnerPrice(priceFile, { pricePerMillionChars: 16, monthlyBudgetUsd: 1, voice: 'en-US-AndrewMultilingualNeural' });
  const priced = provider(root, {
    stateFile: path.join(root, 'priced.json'),
    priceFile,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer }),
  });
  await priced.synthesize('hello', path.join(root, 'c.wav'));
  assert.equal(JSON.parse(fs.readFileSync(priced._stateFile, 'utf8')).pricePerMillionChars, 16);
});

test('QA-AZR-004 a planted cache file is not returned as the Azure render', async () => {
  const { requestHash, sealCache } = require('../azure-tts/provider');
  const { VoiceSession } = require('../azure-tts/session');
  const voice = 'en-US-AndrewMultilingualNeural';
  const rate = 0.95;
  const text = 'hello';
  const ssml = buildSsml(text, { voice, rate });
  const hash = requestHash({ text, voice, rate, ssml });
  const root = dir();
  let fetches = 0;
  const p = provider(root, {
    fetchFn: async () => {
      fetches += 1;
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF-REAL')).buffer };
    },
  });
  fs.mkdirSync(p.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(p.cacheDir, hash), 'PLANTED');
  const planted = await p.synthesize(text, path.join(root, 'a.wav'));
  assert.equal(planted.cached, false);
  assert.equal(fetches, 1);
  const raw = p._calls.find((call) => Object.prototype.hasOwnProperty.call(call, 'raw'));
  assert.equal(raw.raw.includes('PLANTED'), false);
  assert.equal(raw.raw.includes('RIFF-REAL'), true);
  assert.equal(fs.readFileSync(path.join(p.cacheDir, hash)).includes(KEY), false);

  const root2 = dir();
  let secondFetches = 0;
  const sealed = provider(root2, {
    fetchFn: async () => {
      secondFetches += 1;
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF-REAL')).buffer };
    },
  });
  fs.mkdirSync(sealed.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(sealed.cacheDir, hash), sealCache(KEY, hash, Buffer.from('RIFF-FAKE')));
  const miss = await sealed.synthesize(text, path.join(root2, 'b.wav'));
  assert.equal(miss.cached, false);
  assert.equal(secondFetches, 1);
  const sealedRaw = sealed._calls.find((call) => Object.prototype.hasOwnProperty.call(call, 'raw'));
  assert.equal(sealedRaw.raw.includes('RIFF-FAKE'), false);
  assert.equal(sealedRaw.raw.includes('RIFF-REAL'), true);
  assert.equal(fs.readFileSync(path.join(sealed.cacheDir, hash)).includes(KEY), false);

  const root3 = dir();
  const failing = provider(root3, {
    maxAttempts: 1,
    fetchFn: async () => { throw new Error('network down'); },
  });
  fs.mkdirSync(failing.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(failing.cacheDir, hash), 'PLANTED');
  const episodeFile = path.join(root3, 'episode.json');
  const session = new VoiceSession({
    azure: failing,
    local: {
      name: 'kokoro:am_michael',
      synthesize: async (script, out) => {
        fs.writeFileSync(out, 'local-wav');
        return { file: out, durationSec: 1, spoken: script };
      },
    },
    episodeFile,
    summary: 'Markets moved.',
  });
  const spoken = await session.render(text, path.join(root3, 'out.wav'), { episodeId: 'ep-planted', final: true });
  assert.equal(spoken.voice, 'fallback');
  assert.notEqual(spoken.voice, voice);
  assert.equal(fs.readFileSync(path.join(root3, 'out.wav'), 'utf8'), 'local-wav');
  assert.equal(JSON.parse(fs.readFileSync(episodeFile, 'utf8')).voice, 'fallback');
});

test('QA-AZR-005 a long description keeps the disclosure after truncation', async () => {
  const { dryRunAzureEpisode, AZURE_DISCLOSURE, fitDescription } = require('../azure-tts/disclosure');
  const root = dir();
  const orig = globalThis.fetch;
  let live = 0;
  globalThis.fetch = async () => { live += 1; throw new Error('LIVE'); };
  try {
    const fitted = fitDescription('M'.repeat(5000));
    assert.ok(fitted.length <= 5000);
    assert.equal(fitted.endsWith(AZURE_DISCLOSURE), true);
    const result = await dryRunAzureEpisode({
      outDir: root,
      episodeId: 'ep-long',
      title: 'MOONKATTY NEWS',
      summary: 'M'.repeat(5000),
    });
    assert.ok(result.posts[0].payload.description.length <= 5000);
    assert.equal(result.posts[0].payload.description.endsWith('Voice: AI-generated (Microsoft Azure)'), true);
    assert.equal(result.posts[0].remote.preview.description.endsWith('Voice: AI-generated (Microsoft Azure)'), true);
    assert.equal(result.posts[0].status, 'dry_run');
    assert.equal(live, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test('deleting usage.json fails closed when the ledger remains, and a broken chain is refused', () => {
  const { UsdBudget, costMicro, formatUsd } = require('../azure-tts/usd');
  const { appendLedger, ledgerPath } = require('../azure-tts/ledger');
  const root = dir();
  const now = () => new Date('2026-10-21T12:00:00Z');
  const missDir = path.join(root, 'miss');
  const missState = path.join(missDir, 'usage.json');
  const budget = new UsdBudget({ stateFile: missState, ledgerDir: missDir, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now });
  budget.begin({ chars: 1000, hash: 'seed' });
  budget.clearInflight('seed');
  appendLedger(ledgerPath(missDir, '2026-10'), {
    at: '2026-10-21T12:00:00.000Z',
    chars: 1000,
    estCostUsd: formatUsd(costMicro(1000, 15)),
    status: 'reserved',
    requestId: 'seed',
    attempt: 1,
    month: '2026-10',
  });
  fs.rmSync(missState);
  assert.throws(() => budget.begin({ chars: 10, hash: 'next' }), /usage state is missing but the ledger exists/);
  assert.equal(fs.existsSync(missState), false);

  const bare = path.join(root, 'bare-usage.json');
  fs.writeFileSync(bare, JSON.stringify({ month: '2026-10' }));
  const bareBudget = new UsdBudget({
    stateFile: bare,
    ledgerDir: path.join(root, 'bare-ledger'),
    monthlyBudgetUsd: 1,
    pricePerMillionChars: 15,
    now,
  });
  assert.throws(() => bareBudget.begin({ chars: 10, hash: 'bare' }), /unreadable/);
  assert.deepEqual(JSON.parse(fs.readFileSync(bare, 'utf8')), { month: '2026-10' });

  const lowDir = path.join(root, 'low');
  const lowState = path.join(lowDir, 'usage.json');
  fs.mkdirSync(lowDir, { recursive: true });
  appendLedger(ledgerPath(lowDir, '2026-10'), {
    at: '2026-10-21T12:00:00.000Z',
    chars: 1000,
    estCostUsd: formatUsd(costMicro(1000, 15)),
    status: 'reserved',
    requestId: 'low',
    attempt: 1,
    month: '2026-10',
  });
  fs.writeFileSync(lowState, JSON.stringify({ month: '2026-10', spentMicro: 0 }));
  const low = new UsdBudget({ stateFile: lowState, ledgerDir: lowDir, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now });
  assert.throws(() => low.begin({ chars: 10, hash: 'low' }), /below the ledger/);
  assert.equal(JSON.parse(fs.readFileSync(lowState, 'utf8')).spentMicro, 0);

  const chainDir = path.join(root, 'chain');
  const chainState = path.join(root, 'chain.json');
  fs.mkdirSync(chainDir, { recursive: true });
  fs.writeFileSync(ledgerPath(chainDir, '2026-10'), `${JSON.stringify({ prev: 'tampered', status: 'reserved', estCostUsd: '0.015000' })}\n`);
  fs.writeFileSync(chainState, JSON.stringify({ month: '2026-10', spentMicro: 15000 }));
  const chain = new UsdBudget({ stateFile: chainState, ledgerDir: chainDir, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now });
  assert.throws(() => chain.begin({ chars: 10, hash: 'bad' }), /ledger chain/);
  assert.equal(JSON.parse(fs.readFileSync(chainState, 'utf8')).spentMicro, 15000);

  let when = new Date('2026-01-15T00:00:00Z');
  const clockState = path.join(root, 'clock.json');
  const clock = new UsdBudget({
    stateFile: clockState,
    ledgerDir: path.join(root, 'clock-ledger'),
    monthlyBudgetUsd: 1,
    pricePerMillionChars: 15,
    now: () => when,
  });
  const january = clock.begin({ chars: 1000, hash: 'jan' });
  clock.clearInflight('jan');
  when = new Date('2026-02-15T00:00:00Z');
  const february = clock.begin({ chars: 10, hash: 'feb' });
  clock.clearInflight('feb');
  assert.equal(february.spentMicro, costMicro(10, 15));
  when = new Date('2026-01-20T00:00:00Z');
  const back = clock.begin({ chars: 10, hash: 'jan2' });
  assert.equal(back.spentMicro, january.spentMicro + costMicro(10, 15));
});

'use strict';
// Independent re-audit of Azure Speech at 148ff2b. Mock HTTP only. No Azure.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const ROOT = process.env.AZURE_SRC || '/tmp/mk-azure-v2';
const { AzureSpeechProvider, requestHash, sealCache, cacheMac } = require(path.join(ROOT, 'news-launch/azure-tts/provider'));
const { resolveCap } = require(path.join(ROOT, 'news-launch/azure-tts/budget'));
const { UsdBudget, costMicro, formatUsd } = require(path.join(ROOT, 'news-launch/azure-tts/usd'));
const { appendLedger, ledgerPath, inspectLedger } = require(path.join(ROOT, 'news-launch/azure-tts/ledger'));
const { readOwnerPrice, writeOwnerPrice, PRICE_FILE } = require(path.join(ROOT, 'news-launch/azure-tts/price'));
const { OWNER_SERVICE, OWNER_ACCOUNT, signApproval, verifyApproval, approvalMessage, OWNER_ONLY_FIELDS } = require(path.join(ROOT, 'news-launch/azure-tts/approval'));
const { SERVICE, ACCOUNT, OWNER_SERVICE: KC_OWNER_SERVICE, OWNER_ACCOUNT: KC_OWNER_ACCOUNT, readKey } = require(path.join(ROOT, 'news-launch/azure-tts/keychain'));
const { runOwner } = require(path.join(ROOT, 'news-launch/azure-tts/keychain-cli'));
const { dryRunAzureEpisode, AZURE_DISCLOSURE, fitDescription } = require(path.join(ROOT, 'news-launch/azure-tts/disclosure'));
const { VoiceSession } = require(path.join(ROOT, 'news-launch/azure-tts/session'));
const { MasterVoice } = require(path.join(ROOT, 'media-automation/src/video/master-voice'));
const { buildSsml } = require(path.join(ROOT, 'news-launch/azure-tts/ssml'));

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const KEY = 'fake-azure-key-0123456789abcdef';
const VOICE = 'en-US-AndrewMultilingualNeural';
const REGION = 'uaenorth';
const WHEN = () => new Date('2026-10-21T12:00:00Z');
const owner = crypto.generateKeyPairSync('ed25519');
const OWNER_PUB = owner.publicKey.export({ type: 'spki', format: 'pem' });
const results = [];
const findings = [];

function redact(value) {
  return String(value == null ? '' : value).split(KEY).join('[redacted]');
}
function check(kind, name, ok, detail) {
  const row = { kind, name, ok: !!ok, detail: detail == null ? null : detail };
  results.push(row);
  if (kind === 'residual' && ok) findings.push(name);
  console.log(`${ok ? 'PASS ' : 'FAIL '}${kind} ${name}`);
  return !!ok;
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-az2-'));
function wavOk() {
  return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF-REAL')).buffer };
}
function provider(root, extra = {}) {
  const fetches = [];
  let keys = 0;
  const p = new AzureSpeechProvider({
    enabled: true,
    tier: 'F0',
    region: REGION,
    voice: VOICE,
    rate: 0.95,
    paidEnabled: false,
    monthlyBudgetUsd: 1,
    pricePerMillionChars: 15,
    stateFile: path.join(root, 'usage.json'),
    ledgerDir: root,
    cacheDir: path.join(root, 'cache'),
    now: WHEN,
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async (url, init) => { fetches.push({ url, init }); return wavOk(); },
    runFn: async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); },
    probeDurationFn: async () => 1.25,
    ...extra,
  });
  p._fetches = fetches;
  p._keys = () => keys;
  return p;
}
function spent(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).spentMicro;
}
function sign(privateKey, extra = {}) {
  return signApproval(privateKey, {
    at: extra.at || '2026-10-21T00:00:00Z',
    by: extra.by || 'owner',
    voice: extra.voice || VOICE,
    region: extra.region || REGION,
  });
}
function stubSpawn(payload) {
  const calls = [];
  const spawnFn = (cmd, args) => {
    const proc = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let stdin = '';
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.stdin = { write(chunk) { stdin += chunk; }, end() {} };
    calls.push({ cmd, args, get stdin() { return stdin; } });
    process.nextTick(() => {
      stdout.emit('data', payload);
      proc.emit('close', 0);
    });
    return proc;
  };
  spawnFn.calls = calls;
  return spawnFn;
}
function azureVoice(root, extra = {}) {
  return {
    status: 'candidate',
    engine: 'azure',
    enabled: true,
    gender: 'male',
    voice: VOICE,
    tier: 'F0',
    region: REGION,
    paidEnabled: false,
    paidApproval: null,
    rate: 0.95,
    stateFile: path.join(root, 'usage.json'),
    ...extra,
  };
}

async function guards() {
  const root = dir();
  const ssml = buildSsml('hello', { voice: VOICE, rate: 0.95 });
  const p = provider(root);
  const spoken = await p.synthesize('hello', path.join(root, 'a.wav'));
  check('hold', 'F0 synthesize reserves USD and calls the mock once', spoken.spentMicro === costMicro(ssml.length, 15) && p._fetches.length === 1 && p._keys() === 1, { spent: spoken.spentMicro, fetches: p._fetches.length });
  check('hold', 'F0 request URL has no tier and the body does not name F0 or S0', p._fetches[0].url === 'https://uaenorth.tts.speech.microsoft.com/cognitiveservices/v1' && !String(p._fetches[0].init.body).includes('F0') && !String(p._fetches[0].init.body).includes('S0'), null);

  const capped = provider(dir(), { limitChars: 100, monthlyBudgetUsd: 20 });
  const overQuota = await capped.synthesize('hello', path.join(capped.stateFile, '..', 'quota.wav'));
  check('hold', 'limitChars is not the synthesize gate', overQuota.characters > 100 && capped._fetches.length === 1, { characters: overQuota.characters });

  let mismatchFetches = 0;
  let mismatchKeys = 0;
  let probes = 0;
  const mismatch = provider(dir(), {
    skuProbe: async () => { probes += 1; return 'S0'; },
    getKey: async () => { mismatchKeys += 1; return KEY; },
    fetchFn: async () => { mismatchFetches += 1; throw new Error('sent'); },
  });
  let mismatchErr = '';
  try { await mismatch.synthesize('hello', path.join(dir(), 'm.wav')); } catch (e) { mismatchErr = e.message; }
  check('hold', 'sku probe mismatch refuses before the key and the mock', /sku is S0/.test(mismatchErr) && mismatchFetches === 0 && mismatchKeys === 0 && probes === 1, { fetches: mismatchFetches, keys: mismatchKeys });

  let unknownFetches = 0;
  const unknown = provider(dir(), {
    skuProbe: async () => 'B0',
    fetchFn: async () => { unknownFetches += 1; throw new Error('sent'); },
  });
  let unknownErr = '';
  try { await unknown.synthesize('hello', path.join(dir(), 'u.wav')); } catch (e) { unknownErr = e.message; }
  check('hold', 'unknown sku refuses before the mock', /sku is unknown/.test(unknownErr) && unknownFetches === 0, null);

  const wired = new MasterVoice({
    file: writeVoice(dir(), azureVoice(dir())),
    env: {},
  }).createTTS();
  check('hold', 'MasterVoice createTTS does not attach a sku probe', wired.skuProbe == null, null);

  let s0Fetches = 0;
  let s0Keys = 0;
  let s0Probes = 0;
  const refused = provider(dir(), {
    tier: 'S0',
    paidEnabled: false,
    skuProbe: async () => { s0Probes += 1; return 'S0'; },
    getKey: async () => { s0Keys += 1; return KEY; },
    fetchFn: async () => { s0Fetches += 1; throw new Error('sent'); },
  });
  let refusedErr = '';
  try { await refused.synthesize('hello', path.join(dir(), 's.wav')); } catch (e) { refusedErr = e.message; }
  check('hold', 'paidEnabled false sends nothing and does not read the key', /S0 calls are refused/.test(refusedErr) && s0Fetches === 0 && s0Keys === 0 && s0Probes === 0, null);

  let hdFetches = 0;
  const hd = provider(dir(), { voice: 'en-US-Andrew:DragonHDLatestNeural', fetchFn: async () => { hdFetches += 1; throw new Error('sent'); } });
  let hdErr = '';
  try { await hd.synthesize('hello', path.join(dir(), 'h.wav')); } catch (e) { hdErr = e.message; }
  check('hold', 'HD on F0 refuses before the mock', /HD voice/.test(hdErr) && hdFetches === 0, null);

  let tierFetches = 0;
  const badTier = provider(dir(), { tier: 'S1', fetchFn: async () => { tierFetches += 1; throw new Error('sent'); } });
  let tierErr = '';
  try { await badTier.synthesize('hello', path.join(dir(), 't.wav')); } catch (e) { tierErr = e.message; }
  check('hold', 'tier S1 refuses before the mock', /unknown/.test(tierErr) && tierFetches === 0, null);
  check('hold', 'a missing tier refuses', (() => { try { resolveCap({ tier: undefined }); return false; } catch (e) { return /unknown/.test(e.message); } })(), null);
}

function writeVoice(root, body) {
  const file = path.join(root, 'voice.json');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

async function stateAttacks() {
  const root = dir();
  const file = path.join(root, 'usage.json');
  const budget = new UsdBudget({ stateFile: file, ledgerDir: root, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN });
  budget.begin({ chars: 1000, hash: 'seed' });
  budget.clearInflight('seed');
  appendLedger(ledgerPath(root, '2026-10'), {
    at: '2026-10-21T12:00:00.000Z', chars: 1000, estCostUsd: formatUsd(costMicro(1000, 15)),
    status: 'reserved', requestId: 'seed', attempt: 1, month: '2026-10',
  });
  const kept = spent(file);
  fs.rmSync(file);
  let missingErr = '';
  try { budget.begin({ chars: 10, hash: 'next' }); } catch (e) { missingErr = e.message; }
  check('hold', 'deleting usage.json while the ledger remains refuses', /missing but the ledger exists/.test(missingErr) && !fs.existsSync(file), null);

  fs.writeFileSync(file, JSON.stringify({ month: '2026-10', spentMicro: kept }));
  fs.rmSync(ledgerPath(root, '2026-10'));
  fs.rmSync(file);
  const reset = budget.begin({ chars: 1000, hash: 'reset' });
  check('residual', 'deleting usage.json and the ledger starts the counter at the new charge', reset.spentMicro === costMicro(1000, 15), { spent: reset.spentMicro });

  const both = provider(dir());
  await both.synthesize('hello', path.join(path.dirname(both.stateFile), 'a.wav'));
  const once = spent(both.stateFile);
  fs.rmSync(both.stateFile);
  for (const name of fs.readdirSync(both.ledgerDir)) {
    if (name.startsWith('ledger-')) fs.rmSync(path.join(both.ledgerDir, name));
  }
  await both.synthesize('hello', path.join(path.dirname(both.stateFile), 'b.wav'));
  check('residual', 'a second synthesize after both files are gone is one mock call and one charge', both._fetches.length === 2 && spent(both.stateFile) === once, { fetches: both._fetches.length, spent: spent(both.stateFile), once });

  const lowRoot = dir();
  const lowFile = path.join(lowRoot, 'usage.json');
  appendLedger(ledgerPath(lowRoot, '2026-10'), {
    at: '2026-10-21T12:00:00.000Z', chars: 1000, estCostUsd: formatUsd(costMicro(1000, 15)),
    status: 'reserved', requestId: 'low', attempt: 1, month: '2026-10',
  });
  fs.writeFileSync(lowFile, JSON.stringify({ month: '2026-10', spentMicro: 0 }));
  let lowErr = '';
  try {
    new UsdBudget({ stateFile: lowFile, ledgerDir: lowRoot, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN }).begin({ chars: 10, hash: 'x' });
  } catch (e) { lowErr = e.message; }
  check('hold', 'spentMicro below the ledger refuses and the file stays', /below the ledger/.test(lowErr) && spent(lowFile) === 0, null);

  const bare = path.join(dir(), 'usage.json');
  fs.writeFileSync(bare, '{');
  let bareErr = '';
  try { new UsdBudget({ stateFile: bare, ledgerDir: dir(), monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN }).begin({ chars: 10, hash: 'b' }); } catch (e) { bareErr = e.message; }
  check('hold', 'truncated usage.json refuses', /unreadable/.test(bareErr), null);
  const neg = path.join(dir(), 'usage.json');
  fs.writeFileSync(neg, JSON.stringify({ month: '2026-10', spentMicro: -1 }));
  let negErr = '';
  try { new UsdBudget({ stateFile: neg, ledgerDir: dir(), monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN }).begin({ chars: 10, hash: 'n' }); } catch (e) { negErr = e.message; }
  check('hold', 'negative spentMicro refuses', /unreadable/.test(negErr), null);

  const chainRoot = dir();
  const chainFile = path.join(chainRoot, 'usage.json');
  fs.writeFileSync(ledgerPath(chainRoot, '2026-10'), `${JSON.stringify({ prev: 'tampered', status: 'reserved', estCostUsd: '0.015000' })}\n`);
  fs.writeFileSync(chainFile, JSON.stringify({ month: '2026-10', spentMicro: 15000 }));
  let chainErr = '';
  try { new UsdBudget({ stateFile: chainFile, ledgerDir: chainRoot, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN }).begin({ chars: 10, hash: 'c' }); } catch (e) { chainErr = e.message; }
  check('hold', 'a broken ledger link refuses', /ledger chain/.test(chainErr) && spent(chainFile) === 15000, null);

  let when = new Date('2026-01-15T00:00:00Z');
  const clockRoot = dir();
  const clockFile = path.join(clockRoot, 'usage.json');
  const clock = new UsdBudget({
    stateFile: clockFile, ledgerDir: clockRoot, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: () => when,
  });
  const january = clock.begin({ chars: 1000, hash: 'jan' });
  clock.clearInflight('jan');
  appendLedger(ledgerPath(clockRoot, '2026-01'), {
    at: '2026-01-15T00:00:00.000Z', chars: 1000, estCostUsd: formatUsd(january.costMicro),
    status: 'reserved', requestId: 'jan', attempt: 1, month: '2026-01',
  });
  when = new Date('2026-02-15T00:00:00Z');
  const february = clock.begin({ chars: 10, hash: 'feb' });
  clock.clearInflight('feb');
  when = new Date('2026-01-20T00:00:00Z');
  const back = clock.begin({ chars: 10, hash: 'jan2' });
  check('hold', 'a clock return restores the January total from history', back.spentMicro === january.spentMicro + costMicro(10, 15) && february.spentMicro === costMicro(10, 15), { back: back.spentMicro, january: january.spentMicro });

  const rewriteRoot = dir();
  const rewriteFile = path.join(rewriteRoot, 'usage.json');
  const full = new UsdBudget({ stateFile: rewriteFile, ledgerDir: rewriteRoot, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN });
  full.begin({ chars: 53334, hash: 'full' });
  full.clearInflight('full');
  const high = spent(rewriteFile);
  const row = {
    at: '2026-10-21T12:00:00.000Z', chars: 1000, estCostUsd: formatUsd(15000), status: 'reserved',
    requestId: 'rewritten', attempt: 1, month: '2026-10', prev: 'genesis',
  };
  fs.writeFileSync(ledgerPath(rewriteRoot, '2026-10'), `${JSON.stringify(row)}\n`);
  fs.writeFileSync(rewriteFile, JSON.stringify({ month: '2026-10', spentMicro: 15000, inflight: {}, history: {} }));
  const chain = inspectLedger(ledgerPath(rewriteRoot, '2026-10'));
  const after = full.begin({ chars: 1000, hash: 'again' });
  check('residual', 'a rewritten ledger chain with a matching usage file lowers the guard', chain.lines === 1 && chain.spentMicro === 15000 && high > 800000 && after.spentMicro === 30000, { high, after: after.spentMicro });

  const voiceRoot = dir();
  const state1 = path.join(voiceRoot, 'one', 'usage.json');
  fs.mkdirSync(path.dirname(state1), { recursive: true });
  const voiceFile = writeVoice(voiceRoot, azureVoice(voiceRoot, { stateFile: state1 }));
  new UsdBudget({ stateFile: state1, ledgerDir: path.dirname(state1), monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN }).begin({ chars: 66666, hash: 'fill' });
  const filled = spent(state1);
  const mv = new MasterVoice({ file: voiceFile, env: {} });
  const state2 = path.join(voiceRoot, 'two', 'usage.json');
  const saved = mv.setCandidate({ stateFile: state2 }, 'agent');
  const tts = mv.createTTS();
  let moved = 0;
  tts.fetchFn = async () => { moved += 1; return wavOk(); };
  tts.getKey = async () => KEY;
  tts.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  tts.probeDurationFn = async () => 1;
  tts.now = WHEN;
  await tts.synthesize('hello', path.join(voiceRoot, 'out.wav'));
  check('residual', 'setCandidate can point stateFile at an empty ledger and the mock is called', saved.stateFile === state2 && filled + costMicro(buildSsml('hello', { voice: VOICE, rate: 0.95 }).length, 15) > 1000000 && moved === 1 && spent(state2) < 100000 && spent(state1) === filled, { filled, moved, fresh: spent(state2) });
}

async function parallel() {
  const root = dir();
  const file = path.join(root, 'usage.json');
  const chars = 26667;
  const children = [];
  for (let i = 0; i < 8; i += 1) {
    const child = spawn(process.execPath, ['-e', `
      const { UsdBudget } = require(${JSON.stringify(path.join(ROOT, 'news-launch/azure-tts/usd.js'))});
      try {
        new UsdBudget({
          stateFile: ${JSON.stringify(file)},
          ledgerDir: ${JSON.stringify(root)},
          monthlyBudgetUsd: 1,
          pricePerMillionChars: 15,
          now: () => new Date('2026-10-21T12:00:00Z'),
        }).begin({ chars: ${chars}, hash: 'p${i}-' + process.pid });
        process.exit(0);
      } catch (e) {
        process.stderr.write(String(e && e.message || e));
        process.exit(2);
      }
    `]);
    children.push(new Promise((resolve) => {
      let err = '';
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => resolve({ code, err }));
    }));
  }
  const done = await Promise.all(children);
  const successes = done.filter((row) => row.code === 0).length;
  const total = spent(file);
  check('hold', 'eight processes stay inside the dollar cap', successes === 2 && total === successes * chars * 15 && total <= 1000000, { successes, total, errors: done.filter((row) => row.code !== 0).map((row) => redact(row.err)).slice(0, 3) });
}

async function approvalAttacks() {
  const record = sign(owner.privateKey);
  check('hold', 'owner signature verifies for the same voice and region', verifyApproval(record, OWNER_PUB, { voice: VOICE, region: REGION }) === true, null);
  check('hold', 'swapping the voice fails verification', verifyApproval(record, OWNER_PUB, { voice: 'en-US-AndrewNeural', region: REGION }) === false, null);
  check('hold', 'swapping the region fails verification', verifyApproval(record, OWNER_PUB, { voice: VOICE, region: 'westeurope' }) === false, null);
  check('hold', 'an unsigned at/by record fails verification', verifyApproval({ at: record.at, by: record.by }, OWNER_PUB, { voice: VOICE, region: REGION }) === false, null);
  const foreign = crypto.generateKeyPairSync('ed25519');
  const foreignSig = sign(foreign.privateKey);
  check('hold', 'an agent key does not verify against the owner public key', verifyApproval(foreignSig, OWNER_PUB, { voice: VOICE, region: REGION }) === false, null);

  let foreignFetches = 0;
  const foreignProvider = provider(dir(), {
    tier: 'S0', paidEnabled: true, paidApproval: foreignSig, approvalPublicKeyPem: OWNER_PUB,
    fetchFn: async () => { foreignFetches += 1; throw new Error('sent'); },
  });
  let foreignErr = '';
  try { await foreignProvider.synthesize('hello', path.join(dir(), 'f.wav')); } catch (e) { foreignErr = e.message; }
  check('hold', 'a foreign signature sends nothing', /S0 calls are refused/.test(foreignErr) && foreignFetches === 0, null);

  const old = sign(owner.privateKey, { at: '2020-01-01T00:00:00Z' });
  check('residual', 'a signature from 2020 still verifies', verifyApproval(old, OWNER_PUB, { voice: VOICE, region: REGION }) === true, { at: old.at });
  const replayRoot = dir();
  const replayFile = writeVoice(replayRoot, azureVoice(replayRoot, {
    tier: 'S0', paidEnabled: true, paidApproval: old,
  }));
  const replayVoice = new MasterVoice({ file: replayFile, env: {}, approvalPublicKeyPem: OWNER_PUB });
  const replayTts = replayVoice.createTTS();
  let replayFetches = 0;
  replayTts.fetchFn = async () => { replayFetches += 1; return wavOk(); };
  replayTts.getKey = async () => KEY;
  replayTts.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  replayTts.probeDurationFn = async () => 1;
  replayTts.now = WHEN;
  await replayTts.synthesize('hello', path.join(replayRoot, 'a.wav'));
  check('residual', 'pasting that signature with paidEnabled true reaches the mock', replayFetches === 1, null);

  fs.writeFileSync(replayFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(replayFile, 'utf8')), paidEnabled: false }));
  const off = new MasterVoice({ file: replayFile, env: {}, approvalPublicKeyPem: OWNER_PUB });
  let offErr = '';
  try { off.createTTS(); } catch (e) { offErr = e.message; }
  check('hold', 'paidEnabled false refuses even with a valid signature', /S0 calls are refused/.test(offErr), null);
  const restored = JSON.parse(fs.readFileSync(replayFile, 'utf8'));
  restored.paidEnabled = true;
  restored.paidApproval = old;
  fs.writeFileSync(replayFile, JSON.stringify(restored));
  const back = new MasterVoice({ file: replayFile, env: {}, approvalPublicKeyPem: OWNER_PUB }).createTTS();
  let backFetches = 0;
  back.fetchFn = async () => { backFetches += 1; return wavOk(); };
  back.getKey = async () => KEY;
  back.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  back.probeDurationFn = async () => 1;
  back.now = WHEN;
  await back.synthesize('hello again', path.join(replayRoot, 'b.wav'));
  check('residual', 'writing paidEnabled back to true with the same signature reaches the mock again', backFetches === 1, null);

  const swapRoot = dir();
  const swapFile = writeVoice(swapRoot, azureVoice(swapRoot, { tier: 'S0', paidEnabled: true, paidApproval: record }));
  const swapMv = new MasterVoice({ file: swapFile, env: {}, approvalPublicKeyPem: OWNER_PUB });
  swapMv.setCandidate({ region: 'westeurope' }, 'agent');
  let swapErr = '';
  try { swapMv.createTTS(); } catch (e) { swapErr = e.message; }
  check('hold', 'setCandidate region swap fails closed against the old signature', /S0 calls are refused/.test(swapErr), null);

  const kokoroRoot = dir();
  const kokoro = { status: 'candidate', engine: 'kokoro', voice: 'am_michael', gender: 'male', enabled: false, paidEnabled: false };
  const kokoroFile = writeVoice(kokoroRoot, kokoro);
  const kokoroMv = new MasterVoice({ file: kokoroFile, env: {} });
  let flipErr = '';
  try {
    kokoroMv.setCandidate({ enabled: true, paidEnabled: true, paidApproval: record, tier: 'S0', pricePerMillionChars: 0.0000004 }, 'agent');
  } catch (e) { flipErr = e.message; }
  check('hold', 'setCandidate refuses the paid flags and does not save', /owner-only/.test(flipErr) && JSON.stringify(JSON.parse(fs.readFileSync(kokoroFile, 'utf8'))) === JSON.stringify(kokoro), null);
  const inherited = Object.assign(Object.create({ enabled: true, paidEnabled: true }), { voice: 'am_michael' });
  const inheritedCfg = kokoroMv.setCandidate(inherited, 'agent');
  check('hold', 'paid flags on the prototype are not copied', inheritedCfg.enabled === false && inheritedCfg.paidEnabled === false, null);

  const shipped = writeVoice(dir(), azureVoice(dir(), { tier: 'S0', paidEnabled: true, paidApproval: record, approvalPublicKeyPem: foreign.publicKey.export({ type: 'spki', format: 'pem' }) }));
  let noPub = '';
  try { new MasterVoice({ file: shipped, env: {} }).createTTS(); } catch (e) { noPub = e.message; }
  check('hold', 'a voice-file public key is ignored and a missing constructor key refuses S0', /S0 calls are refused/.test(noPub), null);

  const providerSrc = fs.readFileSync(path.join(ROOT, 'news-launch/azure-tts/provider.js'), 'utf8');
  check('hold', 'provider.js does not name the owner Keychain service', !providerSrc.includes(OWNER_SERVICE) && OWNER_SERVICE === KC_OWNER_SERVICE, null);

  const der = owner.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const spawnFn = stubSpawn(`${der}\n`);
  const readBack = await readKey({ service: OWNER_SERVICE, account: OWNER_ACCOUNT, spawnFn, platform: 'darwin' });
  const signedFromKeychain = signApproval(crypto.createPrivateKey({ key: Buffer.from(readBack, 'base64'), format: 'der', type: 'pkcs8' }), {
    at: '2026-10-21T00:00:00Z', by: 'agent', voice: VOICE, region: REGION,
  });
  const readArgs = spawnFn.calls[0].args;
  check('residual', 'readKey on the owner service returns material that can sign', verifyApproval(signedFromKeychain, OWNER_PUB, { voice: VOICE, region: REGION }) === true && readArgs[readArgs.indexOf('-s') + 1] === OWNER_SERVICE && readArgs[readArgs.indexOf('-a') + 1] === OWNER_ACCOUNT && !readArgs.join(' ').includes(der), null);

  const storeSpawn = stubSpawn('');
  const stored = await runOwner(['store-owner'], `${der}\n`, { spawnFn: storeSpawn, platform: 'darwin' });
  const stdin = storeSpawn.calls[0].stdin;
  check('hold', 'store-owner keeps the key off argv and writes the owner service', stored.includes('not printed') && !stored.includes(der) && storeSpawn.calls[0].args.join(' ') === '-i' && stdin.includes(`-s "${OWNER_SERVICE}"`) && stdin.includes(`-a "${OWNER_ACCOUNT}"`) && !stdin.includes('-T'), null);

  const pointedRoot = dir();
  const pointedFile = writeVoice(pointedRoot, azureVoice(pointedRoot));
  const pointed = new MasterVoice({ file: pointedFile, env: {} });
  pointed.setCandidate({ keyService: OWNER_SERVICE }, 'agent');
  const pointedTts = pointed.createTTS();
  const pointedSpawn = stubSpawn('speech-account-miss\n');
  pointedTts.spawnFn = pointedSpawn;
  pointedTts.platform = 'darwin';
  pointedTts.fetchFn = async () => wavOk();
  pointedTts.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  pointedTts.probeDurationFn = async () => 1;
  pointedTts.now = WHEN;
  await pointedTts.synthesize('hello', path.join(pointedRoot, 'k.wav'));
  const pointedArgs = pointedSpawn.calls[0] ? pointedSpawn.calls[0].args : [];
  const pointedAccount = pointedArgs[pointedArgs.indexOf('-a') + 1];
  const pointedService = pointedArgs[pointedArgs.indexOf('-s') + 1];
  check('residual', 'setCandidate keyService makes the provider call security on the owner service with the speech account', pointedTts.keyService === OWNER_SERVICE && pointedService === OWNER_SERVICE && pointedAccount === ACCOUNT, { account: pointedAccount });

  const directSpawn = stubSpawn('direct-owner\n');
  const direct = new AzureSpeechProvider({
    enabled: true, tier: 'F0', region: REGION, voice: VOICE, rate: 0.95,
    stateFile: path.join(dir(), 'usage.json'), now: WHEN, platform: 'darwin', spawnFn: directSpawn,
    keyService: OWNER_SERVICE, account: OWNER_ACCOUNT,
    fetchFn: async () => wavOk(),
    runFn: async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); },
    probeDurationFn: async () => 1,
  });
  await direct.synthesize('hello', path.join(dir(), 'd.wav'));
  const directArgs = directSpawn.calls[0].args;
  check('residual', 'a provider constructed with the owner account reads that Keychain item', directArgs[directArgs.indexOf('-s') + 1] === OWNER_SERVICE && directArgs[directArgs.indexOf('-a') + 1] === OWNER_ACCOUNT, null);
  check('hold', 'approval message binds voice and region and not the price', approvalMessage({ at: record.at, by: record.by, voice: VOICE, region: REGION }).includes(VOICE) && !approvalMessage({ at: record.at, by: record.by, voice: VOICE, region: REGION }).includes('price'), null);
  check('hold', 'stateFile and keyService are not owner-only fields', !OWNER_ONLY_FIELDS.includes('stateFile') && !OWNER_ONLY_FIELDS.includes('keyService'), null);
}

async function priceAttacks() {
  for (const value of [NaN, Infinity, -1, 0, 0.0000004, 14.99]) {
    let err = '';
    try { writeOwnerPrice(path.join(dir(), 'price.json'), { pricePerMillionChars: value, voice: VOICE }); } catch (e) { err = e.message; }
    check('hold', `price ${value} is refused`, /retail floor|positive number/.test(err), null);
  }
  let hdErr = '';
  try { writeOwnerPrice(path.join(dir(), 'price.json'), { pricePerMillionChars: 15, voice: 'en-US-Andrew:DragonHDLatestNeural' }); } catch (e) { hdErr = e.message; }
  check('hold', 'HD below $22 is refused', /retail floor of 22.00/.test(hdErr), null);
  const okFile = path.join(dir(), 'price.json');
  writeOwnerPrice(okFile, { pricePerMillionChars: 15, monthlyBudgetUsd: 1, voice: VOICE });
  check('hold', 'a written price file is mode 0600', (fs.statSync(okFile).mode & 0o077) === 0, { mode: (fs.statSync(okFile).mode & 0o777).toString(8) });
  fs.chmodSync(okFile, 0o644);
  let modeErr = '';
  try { readOwnerPrice(okFile, VOICE); } catch (e) { modeErr = e.message; }
  check('hold', 'mode 0644 refuses', /owner-only/.test(modeErr), null);
  fs.chmodSync(okFile, 0o600);
  let looseFetches = 0;
  const loose = provider(dir(), { priceFile: okFile, fetchFn: async () => { looseFetches += 1; throw new Error('sent'); } });
  fs.chmodSync(okFile, 0o644);
  let looseErr = '';
  try { await loose.synthesize('hello', path.join(dir(), 'p.wav')); } catch (e) { looseErr = e.message; }
  check('hold', 'a loose price file sends nothing', /owner-only/.test(looseErr) && looseFetches === 0, null);

  const raised = path.join(dir(), 'price.json');
  const written = writeOwnerPrice(raised, { pricePerMillionChars: 15, monthlyBudgetUsd: 1000, voice: VOICE });
  const big = new UsdBudget({
    stateFile: path.join(dir(), 'usage.json'), monthlyBudgetUsd: written.monthlyBudgetUsd,
    pricePerMillionChars: written.pricePerMillionChars, voice: VOICE, now: WHEN,
  });
  const claim = big.begin({ chars: 100000, hash: 'big' });
  check('residual', 'price.json can set a budget far above $1 and the reserve succeeds', written.monthlyBudgetUsd === 1000 && (fs.statSync(raised).mode & 0o077) === 0 && claim.spentMicro === 1500000 && claim.spentMicro > 1000000, { spent: claim.spentMicro });

  const ignoredRoot = dir();
  const ignoredFile = writeVoice(ignoredRoot, azureVoice(ignoredRoot, { pricePerMillionChars: 0.0000004, monthlyBudgetUsd: 1000 }));
  check('hold', 'the product price file is absent', !fs.existsSync(PRICE_FILE), null);
  const ignored = new MasterVoice({ file: ignoredFile, env: {} }).createTTS().assertConfig();
  check('hold', 'dust price and a large budget in the voice JSON are ignored', ignored.pricePerMillionChars === 15 && ignored.monthlyBudgetUsd === 1, null);
}

async function cacheAttacks() {
  const text = 'hello';
  const rate = 0.95;
  const ssml = buildSsml(text, { voice: VOICE, rate });
  const hash = requestHash({ text, voice: VOICE, rate, ssml });
  const planted = provider(dir());
  fs.mkdirSync(planted.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(planted.cacheDir, hash), 'PLANTED');
  const first = await planted.synthesize(text, path.join(dir(), 'a.wav'));
  check('hold', 'a planted cache file is a miss', first.cached === false && planted._fetches.length === 1, null);

  const macOnly = provider(dir());
  fs.mkdirSync(macOnly.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(macOnly.cacheDir, hash), sealCache(KEY, hash, Buffer.from('RIFF-FAKE')));
  const second = await macOnly.synthesize(text, path.join(dir(), 'b.wav'));
  check('hold', 'a valid MAC without a ledger ok line is a miss', second.cached === false && macOnly._fetches.length === 1, null);
  check('hold', 'the sealed cache file does not contain the speech key', !fs.readFileSync(path.join(macOnly.cacheDir, hash)).includes(KEY), null);

  const poisonRoot = dir();
  const poison = provider(poisonRoot);
  fs.mkdirSync(poison.cacheDir, { recursive: true });
  appendLedger(ledgerPath(poisonRoot, '2026-10'), {
    at: '2026-10-21T12:00:00.000Z', chars: 0, estCostUsd: '0.000000', status: 'ok',
    requestId: hash.slice(0, 16), attempt: 1, month: '2026-10',
  });
  fs.writeFileSync(path.join(poison.cacheDir, hash), sealCache(KEY, hash, Buffer.from('RIFF-FAKE')));
  let raw = '';
  poison.runFn = async (cmd, args) => {
    const input = args[args.indexOf('-i') + 1];
    raw = fs.readFileSync(input).toString();
    fs.writeFileSync(args[args.length - 1], 'wav');
  };
  const hit = await poison.synthesize(text, path.join(poisonRoot, 'c.wav'));
  check('residual', 'the speech key plus a forged ok line returns the planted audio with no mock call', hit.cached === true && poison._fetches.length === 0 && raw === 'RIFF-FAKE' && poison._keys() === 1, null);
  const episode = path.join(poisonRoot, 'episode.json');
  const session = new VoiceSession({ azure: poison, episodeFile: episode, summary: 'Markets moved.' });
  poison.fetchFn = async () => { throw new Error('sent'); };
  const rendered = await session.render(text, path.join(poisonRoot, 'd.wav'), { episodeId: 'ep', final: true });
  const stored = JSON.parse(fs.readFileSync(episode, 'utf8'));
  check('residual', 'that hit is stored as the Azure voice with final true', rendered.cached === true && stored.voice === VOICE && stored.final === true && stored.review == null, { voice: stored.voice, final: stored.final });

  const wrong = provider(dir());
  fs.mkdirSync(wrong.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(wrong.cacheDir, hash), sealCache('other-secret', hash, Buffer.from('RIFF-FAKE')));
  fs.writeFileSync(wrong.stateFile, JSON.stringify({ month: '2026-10', spentMicro: 0 }));
  appendLedger(ledgerPath(path.dirname(wrong.stateFile), '2026-10'), {
    at: '2026-10-21T12:00:00.000Z', chars: 0, estCostUsd: '0.000000', status: 'ok',
    requestId: hash.slice(0, 16), attempt: 1, month: '2026-10',
  });
  const missed = await wrong.synthesize(text, path.join(dir(), 'e.wav'));
  check('hold', 'a MAC under a different key is a miss', missed.cached === false && wrong._fetches.length === 1, null);
  const sealed = JSON.parse(fs.readFileSync(path.join(poison.cacheDir, hash), 'utf8'));
  check('hold', 'the cache MAC is HMAC-SHA256 under the speech key', sealed.mac === cacheMac(KEY, hash, Buffer.from('RIFF-FAKE')) && SERVICE === 'MOONKATTY AI STUDIO.azure-speech' && ACCOUNT === 'azure-speech', null);
}

async function disclosureAndLeak() {
  const orig = globalThis.fetch;
  let live = 0;
  globalThis.fetch = async () => { live += 1; throw new Error('LIVE'); };
  try {
    const fitted = fitDescription('M'.repeat(5000));
    const result = await dryRunAzureEpisode({ outDir: dir(), episodeId: 'ep-long', summary: 'M'.repeat(5000) });
    const description = result.posts[0].payload.description;
    check('hold', 'a 5000 character dry-run keeps the disclosure inside the limit', fitted.length <= 5000 && fitted.endsWith(AZURE_DISCLOSURE) && description.length <= 5000 && description.endsWith(AZURE_DISCLOSURE) && result.posts[0].status === 'dry_run' && live === 0 && result.posts[0].payload.caption == null, { length: description.length });
    const short = await dryRunAzureEpisode({ outDir: dir(), episodeId: 'ep-short', summary: 'Markets moved.' });
    check('hold', 'a short dry-run keeps the disclosure', short.posts[0].payload.description.includes(AZURE_DISCLOSURE) && live === 0, null);
  } finally {
    globalThis.fetch = orig;
  }

  const root = dir();
  const leak = provider(root, {
    maxAttempts: 1,
    fetchFn: async () => ({ ok: false, status: 401, text: async () => `denied ${KEY}`, arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  let err = '';
  try { await leak.synthesize('hello', path.join(root, 'a.wav')); } catch (e) { err = e.message; }
  const ledger = fs.readFileSync(ledgerPath(root, '2026-10'), 'utf8');
  const state = fs.readFileSync(leak.stateFile, 'utf8');
  check('hold', 'the HTTP error, ledger, and usage file do not contain the key', !err.includes(KEY) && err.includes('[redacted]') && !ledger.includes(KEY) && !state.includes(KEY), null);

  const noteFile = path.join(dir(), 'usage.json');
  const noted = new UsdBudget({ stateFile: noteFile, ledgerDir: path.dirname(noteFile), monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: WHEN });
  noted.begin({ chars: 10, hash: 'n' });
  noted.reconcile({ actualUsd: 0.01, by: 'owner', note: KEY });
  const noteKept = fs.readFileSync(noteFile, 'utf8').includes(KEY);
  check('residual', 'reconcile stores a pasted key in usage.json', noteKept === true, null);
  fs.rmSync(noteFile, { force: true });

  const episode = path.join(dir(), 'episode.json');
  const disabled = provider(dir(), { enabled: false });
  let threw = false;
  try {
    await new VoiceSession({ azure: disabled, episodeFile: episode }).render('hello', path.join(dir(), 'f.wav'), { final: false });
  } catch (e) { threw = true; }
  const stored = JSON.parse(fs.readFileSync(episode, 'utf8'));
  check('residual', 'a preview with no local engine is stored final true and voice fallback', threw && stored.voice === 'fallback' && stored.final === true && stored.review === 'owner-review', null);
}

async function main() {
  if (fs.existsSync(PRICE_FILE)) throw new Error('product price file exists; refusing to run against it');
  await guards();
  await stateAttacks();
  await parallel();
  await approvalAttacks();
  await priceAttacks();
  await cacheAttacks();
  await disclosureAndLeak();
  const failed = results.filter((row) => !row.ok);
  const body = JSON.stringify({ controls: results.length, failed: failed.map((row) => row.name), findings, results }, null, 2);
  if (body.includes(KEY)) throw new Error('attack log would contain the fake key');
  fs.writeFileSync(path.join(OUT, 'attack.json'), body);
  console.log(JSON.stringify({ controls: results.length, failed: failed.length, findings: findings.length }));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(redact(e && e.stack || e));
  process.exit(1);
});

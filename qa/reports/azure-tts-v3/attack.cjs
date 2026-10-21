'use strict';
// Re-audit of Azure Speech at cbc9c70. Mock HTTP only. No Azure.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const ROOT = process.env.AZURE_SRC || '/tmp/mk-azure-v3';
const { AzureSpeechProvider, requestHash, sealCache, cacheMac, CACHE_KEY_FILE } = require(path.join(ROOT, 'news-launch/azure-tts/provider'));
const { UsdBudget, costMicro, formatUsd } = require(path.join(ROOT, 'news-launch/azure-tts/usd'));
const { appendLedger, ledgerPath, ledgerOkMac } = require(path.join(ROOT, 'news-launch/azure-tts/ledger'));
const { readOwnerPrice, writeOwnerPrice, PRICE_FILE } = require(path.join(ROOT, 'news-launch/azure-tts/price'));
const { OWNER_SERVICE, OWNER_ACCOUNT, signApproval, verifyApproval, signBudgetGrant, verifyBudgetGrant, APPROVAL_TTL_MS, BUDGET_CEILING_USD, OWNER_ONLY_FIELDS } = require(path.join(ROOT, 'news-launch/azure-tts/approval'));
const { SERVICE, ACCOUNT, readKey, OWNER_UNREADABLE } = require(path.join(ROOT, 'news-launch/azure-tts/keychain'));
const { runOwner } = require(path.join(ROOT, 'news-launch/azure-tts/keychain-cli'));
const { loadOwnerConfig, writeOwnerConfig, OWNER_CONFIG } = require(path.join(ROOT, 'news-launch/azure-tts/owner-config'));
const { VoiceSession } = require(path.join(ROOT, 'news-launch/azure-tts/session'));
const { MasterVoice } = require(path.join(ROOT, 'media-automation/src/video/master-voice'));
const { buildSsml } = require(path.join(ROOT, 'news-launch/azure-tts/ssml'));

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const KEY = 'fake-azure-key-0123456789abcdef';
const CACHE = 'qa-cache-mac-key-not-the-speech-key';
const VOICE = 'en-US-AndrewMultilingualNeural';
const REGION = 'uaenorth';
const WHEN = new Date('2026-10-21T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const owner = crypto.generateKeyPairSync('ed25519');
const OWNER_PUB = owner.publicKey.export({ type: 'spki', format: 'pem' });
const results = [];
const findings = [];

function redact(value) {
  return String(value == null ? '' : value).split(KEY).join('[redacted]');
}
function check(kind, name, ok, detail) {
  results.push({ kind, name, ok: !!ok, detail: detail == null ? null : detail });
  if (kind === 'residual' && ok) findings.push(name);
  console.log(`${ok ? 'PASS ' : 'FAIL '}${kind} ${name}`);
  return !!ok;
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-az3-'));
function wavOk(body = 'RIFF-REAL') {
  return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer };
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
    cacheKey: CACHE,
    cacheKeyFile: path.join(root, 'cache-mac.key'),
    now: () => WHEN,
    approvalPublicKeyPem: OWNER_PUB,
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
function iso(ms) {
  return new Date(ms).toISOString();
}
function sign(privateKey, extra = {}) {
  return signApproval(privateKey, {
    at: extra.at || iso(WHEN.getTime()),
    by: extra.by || 'owner',
    voice: extra.voice || VOICE,
    region: extra.region || REGION,
    serial: extra.serial == null ? 1 : extra.serial,
  });
}
function stubSpawn() {
  const calls = [];
  const spawnFn = (cmd, args) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    let stdin = '';
    proc.stdin = { write(chunk) { stdin += chunk; }, end() {} };
    calls.push({ cmd, args, get stdin() { return stdin; } });
    process.nextTick(() => proc.emit('close', 0));
    return proc;
  };
  spawnFn.calls = calls;
  return spawnFn;
}
function voiceBody(root, extra = {}) {
  return {
    status: 'candidate', engine: 'azure', enabled: true, gender: 'male',
    voice: VOICE, tier: 'F0', region: REGION, paidEnabled: false, paidApproval: null,
    rate: 0.95, stateFile: path.join(root, 'usage.json'), ...extra,
  };
}
function writeVoice(root, body) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'voice.json');
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

async function budgetAttacks() {
  let raised = '';
  try { writeOwnerPrice(path.join(dir(), 'price.json'), { pricePerMillionChars: 15, monthlyBudgetUsd: 1000, voice: VOICE, approvalPublicKeyPem: OWNER_PUB, now: WHEN }); }
  catch (e) { raised = e.message; }
  check('hold', 'a budget of 1000 without a grant is refused', /ceiling of 1.00/.test(raised), null);
  let ctor = '';
  try { new UsdBudget({ stateFile: path.join(dir(), 'usage.json'), monthlyBudgetUsd: 1000, pricePerMillionChars: 15, voice: VOICE, approvalPublicKeyPem: OWNER_PUB, now: () => WHEN }); }
  catch (e) { ctor = e.message; }
  check('hold', 'UsdBudget refuses a budget above 1 without a grant', /ceiling of 1.00/.test(ctor), null);

  const rawRoot = dir();
  const rawPrice = path.join(rawRoot, 'price.json');
  fs.writeFileSync(rawPrice, JSON.stringify({ pricePerMillionChars: 15, monthlyBudgetUsd: 1000 }) + '\n', { mode: 0o600 });
  let rawErr = '';
  try { readOwnerPrice(rawPrice, VOICE, { approvalPublicKeyPem: OWNER_PUB, now: WHEN }); } catch (e) { rawErr = e.message; }
  let rawFetches = 0;
  const rawProvider = provider(rawRoot, { priceFile: rawPrice, fetchFn: async () => { rawFetches += 1; throw new Error('sent'); } });
  let synthErr = '';
  try { await rawProvider.synthesize('hello', path.join(rawRoot, 'a.wav')); } catch (e) { synthErr = e.message; }
  check('hold', 'a hand-written price file above 1 sends nothing', /ceiling of 1.00/.test(rawErr) && /ceiling of 1.00/.test(synthErr) && rawFetches === 0, null);

  const grant = signBudgetGrant(owner.privateKey, { at: iso(WHEN.getTime()), by: 'owner', monthlyBudgetUsd: 1000 });
  const granted = writeOwnerPrice(path.join(dir(), 'price.json'), {
    pricePerMillionChars: 15, monthlyBudgetUsd: 1000, voice: VOICE, budgetGrant: grant, approvalPublicKeyPem: OWNER_PUB, now: WHEN,
  });
  const big = new UsdBudget({
    stateFile: path.join(dir(), 'usage.json'), monthlyBudgetUsd: granted.monthlyBudgetUsd, pricePerMillionChars: 15,
    voice: VOICE, budgetGrant: grant, approvalPublicKeyPem: OWNER_PUB, now: () => WHEN,
  });
  const claim = big.begin({ chars: 100000, hash: 'big' });
  check('hold', 'an owner-signed grant allows a budget of 1000', granted.monthlyBudgetUsd === 1000 && claim.spentMicro === 1500000, { spent: claim.spentMicro });

  const agent = crypto.generateKeyPairSync('ed25519');
  const agentGrant = signBudgetGrant(agent.privateKey, { at: iso(WHEN.getTime()), by: 'agent', monthlyBudgetUsd: 1000 });
  let agentErr = '';
  try {
    writeOwnerPrice(path.join(dir(), 'price.json'), {
      pricePerMillionChars: 15, monthlyBudgetUsd: 1000, voice: VOICE, budgetGrant: agentGrant, approvalPublicKeyPem: OWNER_PUB, now: WHEN,
    });
  } catch (e) { agentErr = e.message; }
  check('hold', 'a grant from another key is refused', /ceiling of 1.00/.test(agentErr), null);
  const stale = signBudgetGrant(owner.privateKey, { at: iso(WHEN.getTime() - 32 * DAY), by: 'owner', monthlyBudgetUsd: 1000 });
  check('hold', 'a grant older than 31 days is refused', verifyBudgetGrant(stale, OWNER_PUB, { micro: 1000000000, now: WHEN }) === false, null);
  const recent = signBudgetGrant(owner.privateKey, { at: iso(WHEN.getTime() - 10 * DAY), by: 'owner', monthlyBudgetUsd: 1000 });
  check('hold', 'a grant 10 days old still verifies and ignores the approval serial', verifyBudgetGrant(recent, OWNER_PUB, { micro: 1000000000, now: WHEN }) === true && BUDGET_CEILING_USD === 1, null);

  const one = new UsdBudget({ stateFile: path.join(dir(), 'usage.json'), monthlyBudgetUsd: 1, pricePerMillionChars: 15, voice: VOICE, now: () => WHEN });
  one.begin({ chars: 1000, hash: 'one' });
  check('hold', 'a budget of 1 does not need a grant', spent(one.stateFile) === costMicro(1000, 15), null);

  const root = dir();
  const file = path.join(root, 'usage.json');
  const budget = new UsdBudget({ stateFile: file, ledgerDir: root, monthlyBudgetUsd: 1, pricePerMillionChars: 15, voice: VOICE, now: () => WHEN });
  budget.begin({ chars: 1000, hash: 'seed' });
  budget.clearInflight('seed');
  appendLedger(ledgerPath(root, '2026-10'), {
    at: iso(WHEN.getTime()), chars: 1000, estCostUsd: formatUsd(costMicro(1000, 15)),
    status: 'reserved', requestId: 'seed', attempt: 1, month: '2026-10',
  });
  fs.rmSync(file);
  let missing = '';
  try { budget.begin({ chars: 10, hash: 'next' }); } catch (e) { missing = e.message; }
  check('hold', 'deleting usage.json while the ledger remains refuses', /missing but the ledger exists/.test(missing), null);
  fs.rmSync(ledgerPath(root, '2026-10'));
  const reset = budget.begin({ chars: 1000, hash: 'reset' });
  check('residual', 'deleting usage.json and the ledger starts the counter at the new charge', reset.spentMicro === costMicro(1000, 15), { spent: reset.spentMicro });

  const both = provider(dir());
  await both.synthesize('hello', path.join(path.dirname(both.stateFile), 'a.wav'));
  const once = spent(both.stateFile);
  fs.rmSync(both.stateFile);
  for (const name of fs.readdirSync(both.ledgerDir)) if (name.startsWith('ledger-')) fs.rmSync(path.join(both.ledgerDir, name));
  await both.synthesize('hello', path.join(path.dirname(both.stateFile), 'b.wav'));
  check('residual', 'a second synthesize after both files are gone calls the mock again for one charge', both._fetches.length === 2 && spent(both.stateFile) === once, { fetches: both._fetches.length, spent: spent(both.stateFile) });

  const rewriteRoot = dir();
  const rewriteFile = path.join(rewriteRoot, 'usage.json');
  const rewrite = new UsdBudget({ stateFile: rewriteFile, ledgerDir: rewriteRoot, monthlyBudgetUsd: 1, pricePerMillionChars: 15, voice: VOICE, now: () => WHEN });
  rewrite.begin({ chars: 26667, hash: 'a' });
  rewrite.begin({ chars: 26667, hash: 'b' });
  const high = spent(rewriteFile);
  appendLedger(ledgerPath(rewriteRoot, '2026-10'), {
    at: iso(WHEN.getTime()), chars: 1000, estCostUsd: formatUsd(costMicro(1000, 15)),
    status: 'reserved', requestId: 'rewritten', attempt: 1, month: '2026-10',
  });
  const rewritten = JSON.parse(fs.readFileSync(rewriteFile, 'utf8'));
  rewritten.spentMicro = costMicro(1000, 15);
  fs.writeFileSync(rewriteFile, JSON.stringify(rewritten) + '\n');
  const lowered = rewrite.begin({ chars: 1000, hash: 'c' });
  check('residual', 'a rewritten ledger with a matching spentMicro lowers the counter', high === 800010 && lowered.spentMicro === 30000, { before: high, after: lowered.spentMicro });

  const voiceRoot = dir();
  const state1 = path.join(voiceRoot, 'one', 'usage.json');
  fs.mkdirSync(path.dirname(state1), { recursive: true });
  const voiceFile = writeVoice(voiceRoot, voiceBody(voiceRoot, { stateFile: state1 }));
  const before = fs.readFileSync(voiceFile, 'utf8');
  const mv = new MasterVoice({ file: voiceFile, env: {}, approvalPublicKeyPem: OWNER_PUB, approvalMinSerial: 0 });
  let stateErr = '';
  try { mv.setCandidate({ stateFile: path.join(voiceRoot, 'two', 'usage.json') }, 'agent'); } catch (e) { stateErr = e.message; }
  let keyErr = '';
  try { mv.setCandidate({ keyService: OWNER_SERVICE }, 'agent'); } catch (e) { keyErr = e.message; }
  check('hold', 'setCandidate cannot set stateFile or keyService', /owner-only/.test(stateErr) && /owner-only/.test(keyErr) && fs.readFileSync(voiceFile, 'utf8') === before && OWNER_ONLY_FIELDS.includes('stateFile') && OWNER_ONLY_FIELDS.includes('keyService'), null);

  new UsdBudget({ stateFile: state1, ledgerDir: path.dirname(state1), monthlyBudgetUsd: 1, pricePerMillionChars: 15, voice: VOICE, now: () => WHEN }).begin({ chars: 66666, hash: 'fill' });
  const filled = spent(state1);
  const state2 = path.join(voiceRoot, 'two', 'usage.json');
  const edited = JSON.parse(fs.readFileSync(voiceFile, 'utf8'));
  edited.stateFile = state2;
  edited.keyService = OWNER_SERVICE;
  fs.writeFileSync(voiceFile, JSON.stringify(edited));
  const moved = new MasterVoice({ file: voiceFile, env: {}, approvalPublicKeyPem: OWNER_PUB, approvalMinSerial: 0 }).createTTS();
  let fetches = 0;
  moved.fetchFn = async () => { fetches += 1; return wavOk(); };
  moved.getKey = async () => KEY;
  moved.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  moved.probeDurationFn = async () => 1;
  moved.now = () => WHEN;
  moved.cacheKey = CACHE;
  moved.cacheKeyFile = path.join(voiceRoot, 'cache-mac.key');
  await moved.synthesize('hello', path.join(voiceRoot, 'out.wav'));
  check('residual', 'a hand-edited stateFile still selects an empty ledger', moved.keyService === SERVICE && fetches === 1 && spent(state1) === filled && spent(state2) < 100000 && filled + costMicro(buildSsml('hello', { voice: VOICE, rate: 0.95 }).length, 15) > 1000000, { filled, fresh: spent(state2), service: moved.keyService });
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
  check('hold', 'eight processes stay inside one dollar', successes === 2 && spent(file) === 800010, { successes, total: spent(file) });
}

async function approvalAttacks() {
  const fresh = sign(owner.privateKey, { serial: 6 });
  const oldSerial = sign(owner.privateKey, { serial: 5 });
  check('hold', 'a serial above the watermark verifies', verifyApproval(fresh, OWNER_PUB, { voice: VOICE, region: REGION, now: WHEN, minSerial: 5 }) === true, null);
  check('hold', 'a serial equal to the watermark is refused', verifyApproval(oldSerial, OWNER_PUB, { voice: VOICE, region: REGION, now: WHEN, minSerial: 5 }) === false, null);
  const expired = sign(owner.privateKey, { serial: 6, at: iso(WHEN.getTime() - APPROVAL_TTL_MS) });
  const within = sign(owner.privateKey, { serial: 6, at: iso(WHEN.getTime() - APPROVAL_TTL_MS + 1) });
  const ahead = sign(owner.privateKey, { serial: 6, at: iso(WHEN.getTime() + 5 * 60 * 1000 + 1) });
  check('hold', 'a signature at the 31-day mark is refused and one millisecond inside is accepted', verifyApproval(expired, OWNER_PUB, { voice: VOICE, region: REGION, now: WHEN, minSerial: 5 }) === false && verifyApproval(within, OWNER_PUB, { voice: VOICE, region: REGION, now: WHEN, minSerial: 5 }) === true, null);
  check('hold', 'a signature more than five minutes ahead is refused', verifyApproval(ahead, OWNER_PUB, { voice: VOICE, region: REGION, now: WHEN, minSerial: 5 }) === false, null);
  check('hold', 'swapping the voice or region fails', verifyApproval(fresh, OWNER_PUB, { voice: 'en-US-AndrewNeural', region: REGION, now: WHEN, minSerial: 0 }) === false && verifyApproval(fresh, OWNER_PUB, { voice: VOICE, region: 'westeurope', now: WHEN, minSerial: 0 }) === false, null);

  const replayRoot = dir();
  let replayFetches = 0;
  const replay = provider(replayRoot, {
    tier: 'S0', paidEnabled: true, paidApproval: oldSerial, approvalMinSerial: 5,
    fetchFn: async () => { replayFetches += 1; throw new Error('sent'); },
  });
  let replayErr = '';
  try { await replay.synthesize('hello', path.join(replayRoot, 'a.wav')); } catch (e) { replayErr = e.message; }
  check('hold', 'replaying a signature at the watermark sends nothing', /S0 calls are refused/.test(replayErr) && replayFetches === 0 && replay._keys() === 0, null);

  const ownerFile = path.join(dir(), 'owner.json');
  writeOwnerConfig(ownerFile, { privateKey: owner.privateKey, publicKeyPem: OWNER_PUB, at: iso(WHEN.getTime()), by: 'owner', serial: 2 });
  const snapshot = fs.readFileSync(ownerFile);
  writeOwnerConfig(ownerFile, { privateKey: owner.privateKey, publicKeyPem: OWNER_PUB, at: iso(WHEN.getTime()), by: 'owner', serial: 5 });
  let backErr = '';
  try { writeOwnerConfig(ownerFile, { privateKey: owner.privateKey, publicKeyPem: OWNER_PUB, at: iso(WHEN.getTime()), by: 'owner', serial: 4 }); }
  catch (e) { backErr = e.message; }
  check('hold', 'writeOwnerConfig refuses a lower serial', /cannot move backwards/.test(backErr) && loadOwnerConfig(ownerFile).serial === 5, null);
  fs.writeFileSync(ownerFile, snapshot);
  fs.chmodSync(ownerFile, 0o600);
  const rolled = loadOwnerConfig(ownerFile);
  const revived = sign(owner.privateKey, { serial: 3 });
  check('residual', 'replacing owner.json with an older signed copy lowers the watermark', rolled.serial === 2 && rolled.publicKeyPem === OWNER_PUB && verifyApproval(revived, rolled.publicKeyPem, { voice: VOICE, region: REGION, now: WHEN, minSerial: rolled.serial }) === true, { serial: rolled.serial });

  const agent = crypto.generateKeyPairSync('ed25519');
  const agentPub = agent.publicKey.export({ type: 'spki', format: 'pem' });
  const agentFile = path.join(dir(), 'owner.json');
  const agentBody = {
    v: 1, publicKeyPem: agentPub, serial: 0, at: iso(WHEN.getTime()), by: 'agent',
  };
  const { serialMessage } = require(path.join(ROOT, 'news-launch/azure-tts/owner-config'));
  agentBody.sig = crypto.sign(null, Buffer.from(serialMessage({ at: agentBody.at, by: agentBody.by, serial: 0, publicKeyPem: agentPub })), agent.privateKey).toString('base64');
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  fs.writeFileSync(agentFile, JSON.stringify(agentBody) + '\n', { mode: 0o600 });
  const installed = loadOwnerConfig(agentFile);
  const agentApproval = sign(agent.privateKey, { by: 'agent', serial: 1 });
  const takenRoot = dir();
  const takenFile = writeVoice(takenRoot, voiceBody(takenRoot, { tier: 'S0', paidEnabled: true, paidApproval: agentApproval }));
  const taken = new MasterVoice({
    file: takenFile, env: {}, approvalPublicKeyPem: installed.publicKeyPem, approvalMinSerial: installed.serial,
  });
  const takenTts = taken.createTTS();
  let takenFetches = 0;
  takenTts.fetchFn = async () => { takenFetches += 1; return wavOk(); };
  takenTts.getKey = async () => KEY;
  takenTts.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  takenTts.probeDurationFn = async () => 1;
  takenTts.now = () => WHEN;
  takenTts.cacheKey = CACHE;
  takenTts.cacheKeyFile = path.join(takenRoot, 'cache-mac.key');
  await takenTts.synthesize('hello', path.join(takenRoot, 'a.wav'));
  check('residual', 'an agent-written owner.json becomes the public key and the mock is called', installed.publicKeyPem === agentPub && installed.serial === 0 && verifyApproval(agentApproval, OWNER_PUB, { voice: VOICE, region: REGION, now: WHEN, minSerial: 0 }) === false && takenFetches === 1, null);

  const unsigned = path.join(dir(), 'owner.json');
  fs.writeFileSync(unsigned, JSON.stringify({ v: 1, serial: 0, publicKeyPem: agentPub }) + '\n', { mode: 0o600 });
  let unsignedErr = '';
  try { loadOwnerConfig(unsigned); } catch (e) { unsignedErr = e.message; }
  check('hold', 'an unsigned owner.json refuses', /does not verify/.test(unsignedErr), null);
  fs.chmodSync(agentFile, 0o644);
  let looseErr = '';
  try { loadOwnerConfig(agentFile); } catch (e) { looseErr = e.message; }
  check('hold', 'a mode 0644 owner.json refuses', /owner-only/.test(looseErr), null);
  check('hold', 'a missing owner config has no public key', !fs.existsSync(OWNER_CONFIG) && loadOwnerConfig(path.join(dir(), 'missing.json')).publicKeyPem == null && loadOwnerConfig(path.join(dir(), 'missing.json')).serial === 0, null);

  let spawns = 0;
  const spawnFn = () => { spawns += 1; throw new Error('spawned'); };
  let readErr = '';
  try { await readKey({ service: OWNER_SERVICE, account: OWNER_ACCOUNT, spawnFn, platform: 'darwin' }); } catch (e) { readErr = e.message; }
  check('hold', 'readKey refuses the owner item and does not spawn', readErr === OWNER_UNREADABLE && spawns === 0, null);
  const storeSpawn = stubSpawn();
  const der = owner.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const stored = await runOwner(['store-owner'], `${der}\n`, { spawnFn: storeSpawn, platform: 'darwin' });
  const stdin = storeSpawn.calls[0].stdin;
  check('hold', 'store-owner keeps the key off argv and sends -T empty', !stored.includes(der) && storeSpawn.calls[0].args.join(' ') === '-i' && stdin.includes(' -T ""') && stdin.includes(`-s "${OWNER_SERVICE}"`) && stdin.includes(`-a "${OWNER_ACCOUNT}"`), null);

  const pointed = provider(dir(), { keyService: OWNER_SERVICE, account: OWNER_ACCOUNT, getKey: undefined, platform: 'darwin', spawnFn });
  let pointedErr = '';
  try { await pointed.synthesize('hello', path.join(dir(), 'p.wav')); } catch (e) { pointedErr = e.message; }
  check('hold', 'a provider pointed at the owner service sends nothing', pointedErr === OWNER_UNREADABLE && spawns === 0, null);

  const factory = fs.readFileSync(path.join(ROOT, 'news-launch/src/factory-render.js'), 'utf8');
  const bin = fs.readFileSync(path.join(ROOT, 'media-automation/bin/master-voice.js'), 'utf8');
  check('hold', 'factory-render and bin/master-voice load the owner config', factory.includes('loadOwnerConfig') && factory.includes('approvalPublicKeyPem: owner.publicKeyPem') && bin.includes('loadOwnerConfig') && bin.includes('approvalPublicKeyPem: owner.publicKeyPem'), null);
  const providerSrc = fs.readFileSync(path.join(ROOT, 'news-launch/azure-tts/provider.js'), 'utf8');
  check('hold', 'provider.js does not name the owner service', !providerSrc.includes(OWNER_SERVICE), null);
}

async function cacheAndSession() {
  const text = 'hello';
  const rate = 0.95;
  const ssml = buildSsml(text, { voice: VOICE, rate });
  const hash = requestHash({ text, voice: VOICE, rate, ssml });
  const requestId = hash.slice(0, 16);

  const speechRoot = dir();
  const speech = provider(speechRoot);
  fs.mkdirSync(speech.cacheDir, { recursive: true });
  fs.writeFileSync(speech.stateFile, JSON.stringify({ month: '2026-10', spentMicro: 0 }));
  fs.writeFileSync(path.join(speech.cacheDir, hash), sealCache(KEY, hash, Buffer.from('RIFF-FAKE')));
  appendLedger(ledgerPath(speechRoot, '2026-10'), {
    at: iso(WHEN.getTime()), chars: 0, estCostUsd: '0.000000', status: 'ok', requestId, attempt: 1, month: '2026-10',
    mac: ledgerOkMac(KEY, requestId),
  });
  const missed = await speech.synthesize(text, path.join(speechRoot, 'a.wav'));
  check('hold', 'a cache sealed with the speech key is a miss', missed.cached === false && speech._fetches.length === 1, null);
  check('hold', 'the cache MAC key is not the speech key', cacheMac(CACHE, hash, Buffer.from('RIFF-FAKE')) !== cacheMac(KEY, hash, Buffer.from('RIFF-FAKE')) && CACHE_KEY_FILE.endsWith(`${path.join('state', 'cache-mac.key')}`), null);

  const poisonRoot = dir();
  const poison = provider(poisonRoot);
  fs.mkdirSync(poison.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(poison.cacheDir, hash), sealCache(CACHE, hash, Buffer.from('RIFF-FAKE')));
  appendLedger(ledgerPath(poisonRoot, '2026-10'), {
    at: iso(WHEN.getTime()), chars: 0, estCostUsd: '0.000000', status: 'ok', requestId, attempt: 1, month: '2026-10',
    mac: ledgerOkMac(CACHE, requestId),
  });
  let raw = '';
  poison.runFn = async (cmd, args) => {
    raw = fs.readFileSync(args[args.indexOf('-i') + 1]).toString();
    fs.writeFileSync(args[args.length - 1], 'wav');
  };
  const episode = path.join(poisonRoot, 'episode.json');
  const rendered = await new VoiceSession({ azure: poison, episodeFile: episode, summary: 'Markets moved.' }).render(text, path.join(poisonRoot, 'b.wav'), { episodeId: 'ep', final: true });
  const stored = JSON.parse(fs.readFileSync(episode, 'utf8'));
  check('hold', 'a cache hit whose ledger mac matches is final', rendered.cached === true && poison._fetches.length === 0 && raw === 'RIFF-FAKE' && rendered.ledgerRequestId === rendered.requestId && stored.final === true && stored.voice === VOICE, null);

  const bareMac = provider(dir());
  fs.mkdirSync(bareMac.cacheDir, { recursive: true });
  fs.writeFileSync(bareMac.stateFile, JSON.stringify({ month: '2026-10', spentMicro: 0 }));
  fs.writeFileSync(path.join(bareMac.cacheDir, hash), sealCache(CACHE, hash, Buffer.from('RIFF-FAKE')));
  const noMac = await bareMac.synthesize(text, path.join(dir(), 'c.wav'));
  check('hold', 'a valid cache MAC without the ledger mac is a miss', noMac.cached === false && bareMac._fetches.length === 1, null);

  const stubEpisode = path.join(dir(), 'stub.json');
  const stub = {
    name: 'azure:stub',
    voice: VOICE,
    synthesize: async () => ({ cached: true, requestId: 'abc', ledgerRequestId: null, file: 'x', durationSec: 1 }),
  };
  const stubbed = await new VoiceSession({ azure: stub, episodeFile: stubEpisode }).render(text, path.join(dir(), 'd.wav'), { final: true });
  check('hold', 'final is false when a cache hit has no ledger request id', stubbed.final === false && JSON.parse(fs.readFileSync(stubEpisode, 'utf8')).final === false, null);

  const loose = path.join(dir(), 'cache-mac.key');
  fs.writeFileSync(loose, `${CACHE}\n`, { mode: 0o644 });
  let looseFetches = 0;
  const looseProvider = provider(dir(), { cacheKey: null, cacheKeyFile: loose, fetchFn: async () => { looseFetches += 1; throw new Error('sent'); } });
  let looseErr = '';
  try { await looseProvider.synthesize(text, path.join(dir(), 'e.wav')); } catch (e) { looseErr = e.message; }
  check('hold', 'a mode 0644 cache key sends nothing', /owner-only/.test(looseErr) && looseFetches === 0, null);
}

async function reconcileAndPreview() {
  const root = dir();
  const file = path.join(root, 'usage.json');
  const budget = new UsdBudget({ stateFile: file, ledgerDir: root, monthlyBudgetUsd: 1, pricePerMillionChars: 15, voice: VOICE, now: () => WHEN });
  budget.begin({ chars: 1000, hash: 'n' });
  const before = fs.readFileSync(file, 'utf8');
  let refused = '';
  try { budget.reconcile({ actualUsd: 0.02, by: 'owner', note: KEY }); } catch (e) { refused = e.message; }
  check('hold', 'reconcile refuses a pasted key and leaves the file', /note was refused/.test(refused) && fs.readFileSync(file, 'utf8') === before && !before.includes(KEY), null);
  const noted = budget.reconcile({ actualUsd: 0.02, by: 'owner', note: 'invoice checked' });
  check('hold', 'reconcile keeps a short note', noted.reconciliation.note === 'invoice checked' && fs.readFileSync(file, 'utf8').includes('invoice checked'), null);
  const oneDot = `${KEY.slice(0, 11)}.${KEY.slice(11)}`;
  let oneDotErr = '';
  try { budget.reconcile({ actualUsd: 0.03, by: 'owner', note: oneDot }); } catch (e) { oneDotErr = e.message; }
  check('hold', 'reconcile refuses a key with one dot while a 12-character run remains', /note was refused/.test(oneDotErr) && !fs.readFileSync(file, 'utf8').includes(oneDot), null);
  const chunked = KEY.replace(/(.{11})/g, '$1.');
  let chunkErr = '';
  try { budget.reconcile({ actualUsd: 0.04, by: 'owner', note: chunked }); } catch (e) { chunkErr = e.message; }
  const chunkKept = fs.readFileSync(file, 'utf8').includes(chunked);
  check('residual', 'reconcile stores a key broken into runs shorter than 12', chunkErr === '' && chunkKept, null);
  if (chunkKept) {
    const text = fs.readFileSync(file, 'utf8').split(chunked).join('[split]');
    fs.writeFileSync(file, text);
  }

  const episode = path.join(dir(), 'episode.json');
  let threw = false;
  try {
    await new VoiceSession({ azure: provider(dir(), { enabled: false }), episodeFile: episode }).render('hello', path.join(dir(), 'a.wav'), { final: false });
  } catch (e) { threw = true; }
  const stored = JSON.parse(fs.readFileSync(episode, 'utf8'));
  check('hold', 'a preview with no local engine is final false and voice fallback', threw && stored.voice === 'fallback' && stored.final === false && stored.review === 'owner-review', null);

  const failedEpisode = path.join(dir(), 'failed.json');
  let localThrew = false;
  try {
    await new VoiceSession({
      azure: provider(dir(), { enabled: false }),
      local: { name: 'kokoro:am_michael', synthesize: async () => { throw new Error('local down'); } },
      episodeFile: failedEpisode,
    }).render('hello', path.join(dir(), 'b.wav'), { final: false });
  } catch (e) { localThrew = true; }
  const failed = JSON.parse(fs.readFileSync(failedEpisode, 'utf8'));
  check('residual', 'a local-engine failure is stored final true', localThrew && failed.voice === 'fallback' && failed.final === true, null);

  let s0Fetches = 0;
  let s0Keys = 0;
  const refusedS0 = provider(dir(), {
    tier: 'S0', paidEnabled: false,
    getKey: async () => { s0Keys += 1; return KEY; },
    fetchFn: async () => { s0Fetches += 1; throw new Error('sent'); },
  });
  let s0Err = '';
  try { await refusedS0.synthesize('hello', path.join(dir(), 'c.wav')); } catch (e) { s0Err = e.message; }
  check('hold', 'paidEnabled false sends nothing', /S0 calls are refused/.test(s0Err) && s0Fetches === 0 && s0Keys === 0, null);

  const f0 = provider(dir());
  const spoken = await f0.synthesize('hello', path.join(dir(), 'd.wav'));
  check('hold', 'F0 still reserves USD and calls the mock once', spoken.spentMicro === costMicro(buildSsml('hello', { voice: VOICE, rate: 0.95 }).length, 15) && f0._fetches.length === 1, { spent: spoken.spentMicro });
}

async function main() {
  if (fs.existsSync(PRICE_FILE) || fs.existsSync(OWNER_CONFIG) || fs.existsSync(CACHE_KEY_FILE)) {
    throw new Error('product state file exists; refusing to run');
  }
  await budgetAttacks();
  await parallel();
  await approvalAttacks();
  await cacheAndSession();
  await reconcileAndPreview();
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

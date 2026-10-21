'use strict';
// Independent Azure Speech cost/security probes. Mock HTTP only. No Azure. Fake key only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.AZURE_SRC || '/tmp/mk-azure';
const { AzureSpeechProvider } = require(path.join(ROOT, 'news-launch/azure-tts/provider'));
const { CharacterBudget, resolveCap, withFileLock, isHdVoice } = require(path.join(ROOT, 'news-launch/azure-tts/budget'));
const { UsdBudget, resolvePrice, costMicro } = require(path.join(ROOT, 'news-launch/azure-tts/usd'));
const { buildSsml } = require(path.join(ROOT, 'news-launch/azure-tts/ssml'));
const { readKey, storeKey } = require(path.join(ROOT, 'news-launch/azure-tts/keychain'));
const { VoiceSession } = require(path.join(ROOT, 'news-launch/azure-tts/session'));
const { dryRunAzureEpisode, AZURE_DISCLOSURE } = require(path.join(ROOT, 'news-launch/azure-tts/disclosure'));
const { MasterVoice } = require(path.join(ROOT, 'media-automation/src/video/master-voice'));

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const KEY = 'fake-azure-key-0123456789abcdef';
const APPROVAL = { at: '2026-10-21T00:00:00Z', by: 'owner' };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? null : detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  return !!ok;
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-az-'));
const wavOk = () => ({ ok: true, status: 200, text: async () => '', arrayBuffer: async () => Uint8Array.from(Buffer.from('RIFF')).buffer });
function provider(root, extra = {}) {
  const fetches = [];
  const runArgs = [];
  let keys = 0;
  const p = new AzureSpeechProvider({
    enabled: true,
    tier: 'S0',
    region: 'uaenorth',
    rate: 0.95,
    paidEnabled: true,
    paidApproval: APPROVAL,
    monthlyBudgetUsd: 1,
    pricePerMillionChars: 15,
    stateFile: path.join(root, 'usage.json'),
    now: () => new Date('2026-10-21T12:00:00Z'),
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async (url, init) => { fetches.push({ url, init }); return wavOk(); },
    runFn: async (cmd, args) => { runArgs.push({ cmd, args }); fs.writeFileSync(args[args.length - 1], 'wav'); },
    probeDurationFn: async () => 1.25,
    ...extra,
  });
  p._fetches = fetches;
  p._keys = () => keys;
  p._runArgs = runArgs;
  return p;
}
function spent(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).spentMicro;
}

async function budgetAttacks() {
  const root = dir();
  const file = path.join(root, 'usage.json');
  let month = '2026-01';
  const budget = () => new UsdBudget({
    stateFile: file, monthlyBudgetUsd: 1, pricePerMillionChars: 15,
    now: () => new Date(`${month}-15T00:00:00Z`),
  });
  const one = costMicro(1, 15);
  const janChars = 53334;
  const febChars = 13334;
  const smallChars = 1000;
  const janCost = costMicro(janChars, 15);
  const febCost = costMicro(febChars, 15);
  const smallCost = costMicro(smallChars, 15);
  check('one character at $15 per million is 15 micro-dollars', one === 15 && janCost === janChars * 15, { one, janCost });
  budget().begin({ chars: janChars, hash: 'jan' });
  check('January holds the reserved spend', spent(file) === janCost, { spent: spent(file) });
  month = '2026-02';
  budget().begin({ chars: febChars, hash: 'feb' });
  check('a forward month starts a new counter', spent(file) === febCost && JSON.parse(fs.readFileSync(file, 'utf8')).month === '2026-02', null);
  month = '2026-01';
  const again = budget().begin({ chars: janChars, hash: 'jan2' });
  check('clock back to January spends again and drops the February total', again.spentMicro === janCost && spent(file) === janCost, { spent: spent(file), month: JSON.parse(fs.readFileSync(file, 'utf8')).month });

  fs.rmSync(file, { force: true });
  const afterDelete = budget().begin({ chars: smallChars, hash: 'deleted' });
  check('deleting usage.json starts the month at the new charge', afterDelete.spentMicro === smallCost, { spent: afterDelete.spentMicro });

  fs.writeFileSync(file, '{');
  let corrupt = null;
  try { budget().begin({ chars: 10, hash: 'bad' }); } catch (e) { corrupt = e.message; }
  check('a truncated usage file is refused', /unreadable/.test(corrupt || ''), { corrupt });

  fs.writeFileSync(file, JSON.stringify({ month: '2026-01', spentMicro: -5 }));
  let neg = null;
  try { budget().begin({ chars: 10, hash: 'neg' }); } catch (e) { neg = e.message; }
  check('a negative spentMicro is refused', /unreadable/.test(neg || ''), { neg });

  fs.writeFileSync(file, JSON.stringify({ month: '2026-01', spentMicro: 1.5 }));
  let frac = null;
  try { budget().begin({ chars: 10, hash: 'frac' }); } catch (e) { frac = e.message; }
  check('a fractional spentMicro is refused', /unreadable/.test(frac || ''), { frac });

  fs.writeFileSync(file, JSON.stringify({ month: '2026-01' }));
  const missing = budget().begin({ chars: smallChars, hash: 'missing' });
  check('a missing spentMicro is treated as zero and the call is reserved', missing.spentMicro === smallCost, { spent: missing.spentMicro });

  fs.writeFileSync(file, JSON.stringify({ month: '2026-12', spentMicro: 1000000 }));
  const swapped = budget().begin({ chars: smallChars, hash: 'swap' });
  check('a different month string in the file resets the current month', swapped.spentMicro === smallCost && JSON.parse(fs.readFileSync(file, 'utf8')).month === '2026-01', { spent: swapped.spentMicro });

  const prices = [NaN, Infinity, -1, 0, -0, '15'];
  const rejected = [];
  for (const price of prices) {
    try { resolvePrice({ voice: 'en-US-AndrewMultilingualNeural', pricePerMillionChars: price }); rejected.push(String(price)); }
    catch { /* expected */ }
  }
  check('NaN, infinite, negative, zero, and string prices are refused', rejected.length === 0, { rejected });
  check('a dust price rounds to zero micro-dollars', costMicro(1000000, 0.0000004) === 0 && costMicro(1, 0.0000004) === 0, { dust: costMicro(1000000, 0.0000004) });
  const dustFile = path.join(root, 'dust.json');
  const dust = new UsdBudget({ stateFile: dustFile, monthlyBudgetUsd: 1, pricePerMillionChars: 0.0000004, now: () => new Date('2026-01-15T00:00:00Z') });
  dust.begin({ chars: 500000, hash: 'd1' });
  dust.begin({ chars: 500000, hash: 'd2' });
  check('dust price lets a second half-million characters through with spend still zero', spent(dustFile) === 0, { spent: spent(dustFile) });

  let fetches = 0;
  const dustProvider = provider(root, {
    stateFile: dustFile,
    pricePerMillionChars: 0.0000004,
    now: () => new Date('2026-01-15T00:00:00Z'),
    fetchFn: async () => { fetches += 1; return wavOk(); },
  });
  await dustProvider.synthesize('hello dust', path.join(root, 'dust.wav'));
  check('a dust-price provider still calls the mock', fetches === 1 && spent(dustFile) === 0, { fetches, spent: spent(dustFile) });
  fs.rmSync(root, { recursive: true, force: true });
}

async function parallelBudget() {
  const root = dir();
  const file = path.join(root, 'usage.json');
  const usdPath = path.join(ROOT, 'news-launch/azure-tts/usd.js');
  const micro = 400005; // ceil(26667 * 15)
  const chars = 26667;
  check('parallel chunk is about $0.40', costMicro(chars, 15) === micro, { cost: costMicro(chars, 15) });
  const children = [];
  for (let i = 0; i < 8; i++) {
    const code = `
      const { UsdBudget } = require(${JSON.stringify(usdPath)});
      const b = new UsdBudget({ stateFile: ${JSON.stringify(file)}, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: () => new Date('2026-10-21T12:00:00Z') });
      try {
        const r = b.begin({ chars: ${chars}, hash: 'p${i}' });
        process.stdout.write(JSON.stringify({ ok: true, spent: r.spentMicro }));
      } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, msg: e.message }));
      }
    `;
    children.push(new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, raw: out }); } });
    }));
  }
  const rows = await Promise.all(children);
  const ok = rows.filter((r) => r.ok).length;
  const finalSpend = spent(file);
  check('eight processes cannot reserve more than one dollar', finalSpend <= 1000000 && ok === Math.floor(1000000 / micro) && finalSpend === ok * micro, { ok, finalSpend, rows: rows.map((r) => r.ok) });

  const root2 = dir();
  const file2 = path.join(root2, 'usage.json');
  const textA = 'hello one';
  const textB = 'hello two';
  const len = buildSsml(textA, { voice: 'en-US-AndrewMultilingualNeural', rate: 0.95 }).length;
  const charge = costMicro(len, 15);
  fs.writeFileSync(file2, JSON.stringify({ month: '2026-10', spentMicro: 1000000 - charge, inflight: {} }));
  let hits = 0;
  const slow = provider(root2, {
    stateFile: file2,
    fetchFn: async () => { hits += 1; await new Promise((r) => setTimeout(r, 40)); return wavOk(); },
  });
  const both = await Promise.allSettled([
    slow.synthesize(textA, path.join(root2, 'a.wav')),
    slow.synthesize(textB, path.join(root2, 'b.wav')),
  ]);
  const succeeded = both.filter((r) => r.status === 'fulfilled').length;
  check('two overlapping synthesizes stop at the dollar cap', succeeded === 1 && hits === 1 && spent(file2) === 1000000, { succeeded, hits, spent: spent(file2), reasons: both.map((r) => r.status === 'rejected' ? String(r.reason && r.reason.message).slice(0, 80) : 'ok') });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(root2, { recursive: true, force: true });
}

function staleLock() {
  const root = dir();
  const lock = path.join(root, 'usage.json.lock');
  const flag = path.join(root, 'held');
  const child = spawn(process.execPath, ['-e', `
    const { withFileLock } = require(${JSON.stringify(path.join(ROOT, 'news-launch/azure-tts/budget.js'))});
    const fs = require('fs');
    withFileLock(${JSON.stringify(lock)}, () => {
      fs.writeFileSync(${JSON.stringify(flag)}, 'in');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 32000);
      fs.writeFileSync(${JSON.stringify(flag)}, 'done');
    });
  `], { stdio: 'ignore' });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(flag) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 31000);
  let entered = false;
  let err = null;
  try { withFileLock(lock, () => { entered = true; }); }
  catch (e) { err = e.message; }
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
  check('a lock older than 30 seconds can be taken while the holder is still inside it', entered === true && fs.readFileSync(flag, 'utf8') === 'in', { entered, flag: fs.existsSync(flag) ? fs.readFileSync(flag, 'utf8') : null, err });
  fs.rmSync(root, { recursive: true, force: true });
}

async function approvalAndNetwork() {
  const root = dir();
  let fetches = 0;
  let keys = 0;
  const refused = provider(root, {
    paidEnabled: false,
    paidApproval: null,
    getKey: async () => { keys += 1; return KEY; },
    fetchFn: async () => { fetches += 1; return wavOk(); },
  });
  let msg = null;
  try { await refused.synthesize('hello', path.join(root, 'a.wav')); } catch (e) { msg = e.message; }
  check('paidEnabled false does not read the key or call the mock', /S0 calls are refused/.test(msg || '') && fetches === 0 && keys === 0, { msg, fetches, keys });

  const forgedFile = path.join(root, 'voice.json');
  fs.writeFileSync(forgedFile, JSON.stringify({
    status: 'candidate', engine: 'kokoro', voice: 'am_michael', gender: 'male', rate: 0.95,
    model: { file: '/no/such/model.onnx', sha256: 'ab'.repeat(32) }, voicesFile: '/no/voices',
  }));
  const mv = new MasterVoice({ file: forgedFile, env: {} });
  mv.setCandidate({
    engine: 'azure', enabled: true, gender: 'male', voice: 'en-US-AndrewMultilingualNeural',
    tier: 'S0', region: 'uaenorth', paidEnabled: true,
    paidApproval: { at: '2026-01-01T00:00:00Z', by: 'agent' },
    monthlyBudgetUsd: 1, pricePerMillionChars: 15, rate: 0.95,
    stateFile: path.join(root, 'mv-usage.json'),
  }, 'agent');
  const locked = mv.lock('agent');
  const saved = JSON.parse(fs.readFileSync(forgedFile, 'utf8'));
  check('setCandidate plus lock accepts an agent-written approval with no owner session', locked.status === 'locked' && locked.lockedBy === 'agent' && saved.paidEnabled === true && saved.paidApproval.by === 'agent', { status: saved.status, by: saved.paidApproval && saved.paidApproval.by });
  let forgedFetches = 0;
  const forged = new MasterVoice({ file: forgedFile, env: {} }).createTTS();
  forged.fetchFn = async () => { forgedFetches += 1; return wavOk(); };
  forged.getKey = async () => KEY;
  forged.runFn = async (cmd, args) => { fs.writeFileSync(args[args.length - 1], 'wav'); };
  forged.probeDurationFn = async () => 1;
  await forged.synthesize('forged', path.join(root, 'forged.wav'));
  check('the forged approval is enough for the provider to call the mock', forgedFetches === 1, { forgedFetches });

  let f0 = 0;
  const headers = [];
  let body = null;
  const free = provider(root, {
    tier: 'F0', paidEnabled: false, paidApproval: null, allowPaid: false,
    fetchFn: async (url, init) => { f0 += 1; headers.push(Object.keys(init.headers).sort()); body = init.body; return wavOk(); },
  });
  await free.synthesize('free tier', path.join(root, 'f0.wav'));
  check('tier F0 calls the mock while paidEnabled is false', f0 === 1, { f0 });
  check('the request headers do not name a pricing tier or SKU', headers[0] && !headers[0].some((h) => /tier|sku|quota/i.test(h)), { headers: headers[0] });
  check('the SSML body does not name F0 or S0', typeof body === 'string' && !/F0|S0/.test(body), { sample: typeof body === 'string' ? body.slice(0, 80) : typeof body });

  let hd = null;
  try { resolveCap({ tier: 'F0', voice: 'en-US-Andrew:DragonHDLatestNeural' }); } catch (e) { hd = e.message; }
  let s1 = null;
  try { resolveCap({ tier: 'S1', voice: 'en-US-AndrewMultilingualNeural', paidEnabled: true, paidApproval: APPROVAL }); } catch (e) { s1 = e.message; }
  let missing = null;
  try { resolveCap({ voice: 'en-US-AndrewMultilingualNeural' }); } catch (e) { missing = e.message; }
  check('HD on F0, tier S1, and a missing tier are refused', /HD voice/.test(hd || '') && /unknown/.test(s1 || '') && /unknown/.test(missing || '') && isHdVoice('en-US-Andrew:DragonHDLatestNeural'), { hd, s1, missing });
  fs.rmSync(root, { recursive: true, force: true });
}

async function countingAndCache() {
  const root = dir();
  const voice = 'en-US-AndrewMultilingualNeural';
  const emoji = 'Hello 😀';
  const ru = 'Привет MOONKATTY';
  const han = '你好';
  const samples = { emoji, ru, han, plain: 'Hello' };
  const lens = {};
  for (const [name, text] of Object.entries(samples)) {
    const ssml = buildSsml(text, { voice, rate: 0.95 });
    let points = 0;
    for (const ch of ssml) points += 1;
    lens[name] = { text: text.length, ssml: ssml.length, utf8: Buffer.byteLength(ssml), points, hanUnits: name === 'han' ? han.length : undefined };
  }
  check('emoji UTF-16 length is above its Unicode code points', lens.emoji.ssml > lens.emoji.points, lens.emoji);
  check('a Han character is one UTF-16 unit', han.length === 2 && [...han].length === 2, { units: han.length, points: [...han].length });

  let fetches = 0;
  const p = provider(root, {
    maxAttempts: 3,
    fetchFn: async () => {
      fetches += 1;
      if (fetches < 3) return { ok: false, status: 500, text: async () => `err ${KEY}` };
      return wavOk();
    },
  });
  const result = await p.synthesize('retry me', path.join(root, 'r.wav'));
  const per = costMicro(buildSsml('retry me', { voice, rate: 0.95 }).length, 15);
  check('three attempts are all reserved, including two HTTP 500s', fetches === 3 && result.attempts === 3 && spent(p.stateFile) === per * 3, { fetches, attempts: result.attempts, spent: spent(p.stateFile), per });
  const ledger = fs.readFileSync(path.join(root, 'ledger-2026-10.jsonl'), 'utf8');
  check('the ledger has no key and no script after a body that contained the key', !ledger.includes(KEY) && !ledger.includes('retry me'), null);

  const poisonHash = require(path.join(ROOT, 'news-launch/azure-tts/provider')).requestHash({
    text: 'cached line', voice, rate: 0.95, ssml: buildSsml('cached line', { voice, rate: 0.95 }),
  });
  fs.mkdirSync(p.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(p.cacheDir, poisonHash), Buffer.from('POISON-AUDIO'));
  let poisonFetches = 0;
  const p2 = provider(root, {
    stateFile: p.stateFile,
    cacheDir: p.cacheDir,
    fetchFn: async () => { poisonFetches += 1; return wavOk(); },
  });
  const poisoned = await p2.synthesize('cached line', path.join(root, 'poison.wav'));
  const episode = path.join(root, 'episode.json');
  const session = new VoiceSession({
    azure: p2, local: { name: 'kokoro:am_michael', synthesize: async () => { throw new Error('local'); } },
    episodeFile: episode, summary: 'Markets', showCaption: true,
  });
  const spoken = await session.render('cached line', path.join(root, 'poison2.wav'), { episodeId: 'ep', final: true });
  check('a prewritten cache file is returned as Azure with no mock call', poisoned.cached === true && poisonFetches === 0 && spoken.voice === voice && spoken.final === true && spoken.review == null, { cached: poisoned.cached, poisonFetches, voice: spoken.voice, final: spoken.final });
  fs.rmSync(root, { recursive: true, force: true });
  return lens;
}

async function secretsAndDisclosure(lens) {
  const root = dir();
  const calls = [];
  const spawnFn = (cmd, args) => {
    const rec = { cmd, args: args.slice(), stdin: '' };
    calls.push(rec);
    return {
      stdin: { write(s) { rec.stdin += s; }, end() {} },
      stdout: { on(ev, fn) { if (ev === 'data') fn(Buffer.from(KEY + '\n')); } },
      stderr: { on() {} },
      on(ev, fn) { if (ev === 'close') queueMicrotask(() => fn(0)); },
    };
  };
  const read = await readKey({ spawnFn, platform: 'darwin' });
  check('readKey returns the secret and its argv has no secret', read === KEY && calls[0].args.join(' ').includes(KEY) === false && calls[0].args[0] === 'find-generic-password', { args: calls[0].args });
  await storeKey(KEY, { spawnFn, platform: 'darwin' });
  check('storeKey argv is only security -i and the secret is on stdin', calls[1].args.join(' ') === '-i' && calls[1].stdin.includes(KEY) && calls[1].args.join(' ').includes(KEY) === false, { args: calls[1].args });

  let fetches = 0;
  const p = provider(root, {
    maxAttempts: 1,
    fetchFn: async () => { fetches += 1; return { ok: false, status: 401, text: async () => `denied ${KEY}` }; },
  });
  let thrown = null;
  try { await p.synthesize('leak check', path.join(root, 'a.wav')); } catch (e) { thrown = e; }
  const tree = [];
  const walk = (d) => { for (const name of fs.readdirSync(d)) { const f = path.join(d, name); if (fs.statSync(f).isDirectory()) walk(f); else tree.push(fs.readFileSync(f, 'utf8')); } };
  walk(root);
  const hay = tree.join('\n') + String(thrown && thrown.message) + String(thrown && thrown.stack);
  check('the thrown error and the state files do not contain the key', fetches === 1 && !hay.includes(KEY) && /401/.test(thrown.message), { fetches });
  const argvHay = JSON.stringify(p._runArgs);
  check('ffmpeg argv was not built for the failed request', argvHay === '[]', null);

  const noteFile = path.join(root, 'note.json');
  const noted = new UsdBudget({ stateFile: noteFile, monthlyBudgetUsd: 1, pricePerMillionChars: 15, now: () => new Date('2026-10-21T12:00:00Z') });
  noted.reconcile({ actualUsd: 0.2, by: 'owner', note: `portal ${KEY}` });
  const noteRaw = fs.readFileSync(noteFile, 'utf8');
  check('reconcile stores a pasted key in the usage file', noteRaw.includes(KEY), null);

  const long = 'M'.repeat(5000);
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('LIVE'); };
  let posts;
  let short;
  try {
    posts = await dryRunAzureEpisode({ outDir: path.join(root, 'dry'), summary: long, showCaption: false });
    short = await dryRunAzureEpisode({ outDir: path.join(root, 'dry2'), summary: 'Markets moved.', showCaption: false });
  } finally { globalThis.fetch = orig; }
  const desc = posts.posts[0].payload.description;
  check('a 5000 character summary drops the disclosure from the dry-run payload', desc.length === 5000 && !desc.includes(AZURE_DISCLOSURE), { len: desc.length, tail: desc.slice(-40) });
  check('a short summary keeps the disclosure in the description', short.posts[0].payload.description.includes(AZURE_DISCLOSURE) && short.posts[0].payload.caption == null, null);

  const episode = path.join(root, 'ep.json');
  const disabled = new AzureSpeechProvider({ enabled: false, tier: 'S0', region: 'uaenorth', stateFile: path.join(root, 'off.json'), fetchFn: async () => { throw new Error('LIVE'); } });
  const noLocal = new VoiceSession({ azure: disabled, episodeFile: episode, summary: 'Markets' });
  let previewErr = null;
  try { await noLocal.render('hello', path.join(root, 'p.wav'), { episodeId: 'ep', final: false }); } catch (e) { previewErr = e.message; }
  const saved = JSON.parse(fs.readFileSync(episode, 'utf8'));
  check('a preview with no local engine is stored final with voice fallback', /disabled/.test(previewErr || '') && saved.voice === 'fallback' && saved.final === true && saved.review === 'owner-review', saved);

  fs.writeFileSync(path.join(OUT, 'lengths.json'), JSON.stringify(lens, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  await budgetAttacks();
  await parallelBudget();
  staleLock();
  await approvalAndNetwork();
  const lens = await countingAndCache();
  await secretsAndDisclosure(lens);
  const findingNames = [
    'clock back to January spends again and drops the February total',
    'deleting usage.json starts the month at the new charge',
    'a missing spentMicro is treated as zero and the call is reserved',
    'a different month string in the file resets the current month',
    'a dust price rounds to zero micro-dollars',
    'dust price lets a second half-million characters through with spend still zero',
    'a dust-price provider still calls the mock',
    'a lock older than 30 seconds can be taken while the holder is still inside it',
    'setCandidate plus lock accepts an agent-written approval with no owner session',
    'the forged approval is enough for the provider to call the mock',
    'tier F0 calls the mock while paidEnabled is false',
    'the request headers do not name a pricing tier or SKU',
    'the SSML body does not name F0 or S0',
    'a prewritten cache file is returned as Azure with no mock call',
    'reconcile stores a pasted key in the usage file',
    'a 5000 character summary drops the disclosure from the dry-run payload',
    'a preview with no local engine is stored final with voice fallback',
  ];
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  const summary = { commit: 'baf8cff403c96c17923bb6735cf6f832ad81d700', controls: results.length, failed, findings: results.filter((r) => findingNames.includes(r.name) && r.ok).map((r) => r.name) };
  fs.writeFileSync(path.join(OUT, 'attack.json'), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

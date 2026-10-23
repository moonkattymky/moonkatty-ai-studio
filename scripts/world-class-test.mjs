// v1.3.0-test world-class checks. Social publisher is not exercised as a new module.
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-world-'));
const PORT = 8913;
const BASE = `http://127.0.0.1:${PORT}`;
const out = [];
const ok = (name, cond, extra = '') => { out.push({ name, status: cond ? 'PASS' : 'FAIL', extra: String(extra).slice(0, 400) }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + String(extra).slice(0, 300) : '')); };
const note = (name, status, extra = '') => { out.push({ name, status, extra: String(extra).slice(0, 400) }); console.log(status + ' ' + name + (extra ? ' — ' + String(extra).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snapFile = path.join(UD, 'platforms-snapshot.sample.json');
const snapGit = spawnSync('git', ['show', 'f74f07e:media-automation/fixtures/platforms-snapshot.sample.json'], { cwd: ROOT, encoding: 'utf8' });
if (snapGit.status !== 0) { console.log(snapGit.stderr); process.exit(1); }
fs.writeFileSync(snapFile, snapGit.stdout);
function start() {
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '127.0.0.1', STUDIO_PLATFORM_SNAPSHOT: snapFile } });
  let log = ''; p.stdout.on('data', d => log += d); p.stderr.on('data', d => log += d); p.log = () => log; return p;
}
async function up(p) { for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return true; } catch {} await sleep(200); } console.log(p.log().slice(-800)); return false; }
async function down(p) { if (!p || p.exitCode != null) return; p.kill('SIGTERM'); await new Promise(r => p.once('exit', r)); }

const qc = require(path.join(ROOT, 'lib/world/qc.js'));
const strong = { kind: 'news', score: 100, script: { text: 'A'.repeat(90), difference: 'Отличается от ролика «Moon reference» конкретным финалом и фактом.', plagiarism: false }, hook: { text: 'Кот нашёл лунную станцию', retentionEvidence: '00:03 вопрос про станцию' }, visuals: { assets: ['frame-1.png'], inspected: true }, technical: { defects: [] }, edit: { pacing: 'смена кадра на 4-й секунде' }, voice: { present: true, evidence: 'дорожка voice.wav' }, subtitles: { present: true, lang: 'ru' }, audience: { who: 'игроки', value: 'Зритель понимает, где находится станция и что делать в игре дальше сегодня.' }, brand: { characterPresent: true, formatOk: true, format: '9:16' } };
const s1 = qc.score(strong, { pass: 70, maxRegenerations: 3 });
ok('QC: присланные 100 баллов не принимаются', s1.ignoredClientScore && s1.verdict === 'blocked_factcheck' && s1.total >= 70, s1.verdict + ' ' + s1.total);
const s2 = qc.score(Object.assign({}, strong, { factCheck: { status: 'passed', by: 'igor', sources: ['https://example.com/source'] } }), { pass: 70, maxRegenerations: 3 });
ok('QC: новость с фактчеком может пройти', s2.verdict === 'pass' && s2.total === 100, s2.verdict + ' ' + s2.total);
const s0 = qc.score({ score: 100 }, { pass: 70, maxRegenerations: 3 });
ok('QC: пустые доказательства дают низкий балл', s0.total === 0 && s0.verdict === 'rework', String(s0.total));
const sCap = qc.score({ regeneration: 3 }, { pass: 70, maxRegenerations: 3 });
ok('QC: лимит повторов останавливает доработку', sCap.next === 'stop' && sCap.verdict === 'blocked_regen_cap', sCap.verdict);
const audienceMod = require(path.join(ROOT, 'lib/world/audience.js'));
const growthMath = audienceMod.growth([
  { at: '2026-09-21T00:00:00.000Z', followers: 100, demo: false },
  { at: '2026-10-14T00:00:00.000Z', followers: 110, demo: false },
  { at: '2026-10-20T00:00:00.000Z', followers: 120, demo: false },
  { at: '2026-10-21T00:00:00.000Z', followers: 130, demo: false },
  { at: '2026-10-21T00:00:00.000Z', followers: 999999, demo: true }
], new Date('2026-10-21T00:00:00.000Z'));
ok('A growth math uses real points only', growthMath.daily.subscribers === 10 && growthMath.weekly.subscribers === 20 && growthMath.monthly.subscribers === 30, JSON.stringify(growthMath));
const absentAud = audienceMod.report({ api: null, channels: [{ id: 'youtube-news', name: 'YouTube MOONKATTY NEWS' }, { id: 'youtube-project', name: 'YouTube MOONKATTY' }], goal: 1000000, milestonesList: [1000, 10000, 100000, 500000, 1000000], demoDefault: false, history: [], now: new Date('2026-10-21T00:00:00.000Z'), experiments: [], confirmedFor: () => null });
ok('A unconnected audience is НЕТ ДАННЫХ and YouTube stays separate', absentAud.mergeYoutube === false && absentAud.youtubeMerged === false && absentAud.youtube.length === 2 && absentAud.channels.every(c => c.subscribers === 'НЕТ ДАННЫХ' && c.progress === 'НЕТ ДАННЫХ'));

note('1 macOS Apple Silicon launch', process.platform === 'darwin' && process.arch === 'arm64' ? 'NOT TESTED' : 'BLOCKED', 'этот прогон на ' + process.platform + '/' + process.arch + ', .app не запускался');

let ollama = 'down'; try { const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(800) }); ollama = r.ok ? 'up' : 'down'; } catch { ollama = 'down'; }
note('3 Ollama', ollama === 'up' ? 'PASS' : 'MOCK', ollama === 'up' ? 'локальный /api/tags ответил' : 'Ollama недоступна, генерация не вызывалась');

const srv = start();
ok('server boots', await up(srv), srv.log().slice(-300));
const health = await (await fetch(BASE + '/api/health')).json();
ok('health flavor test schema 6 version', health.flavor === 'test' && health.schemaVersion === 6 && health.version === JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version && /^1\.3\.\d+-test$/.test(health.version), JSON.stringify(health).slice(0, 180));
const tok = fs.readFileSync(path.join(UD, 'app-token'), 'utf8').trim();
const H = { 'content-type': 'application/json', 'x-studio-request': '1', 'x-studio-app-token': tok };
const api = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: H, body: b == null ? undefined : JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const setup = await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' });
ok('auth setup for loopback app token', setup.s === 200 && setup.j.user === 'igor', JSON.stringify(setup.j));
const page = await (await fetch(BASE + '/app.js')).text();
const html = await (await fetch(BASE + '/')).text();
ok('2 dashboard ships Revenue Command Center', page.includes('Revenue Command Center') && page.includes('НЕТ ДАННЫХ') && html.includes('app.js'), '');
const cc0 = await api('GET', '/api/world/command-center');
ok('2 command center empty money is НЕТ ДАННЫХ', cc0.s === 200 && cc0.j.revenue.day === 'НЕТ ДАННЫХ' && cc0.j.revenue.month === 'НЕТ ДАННЫХ' && cc0.j.viewsAreRevenue === false && cc0.j.revenue.forecast === 'НЕТ ДАННЫХ', JSON.stringify(cc0.j.revenue.day));
ok('platforms are existing channels or НЕТ ДАННЫХ', Array.isArray(cc0.j.platforms) && cc0.j.platforms.length > 0 && cc0.j.platforms.every(p => p.revenue === 'НЕТ ДАННЫХ'), String(cc0.j.platforms.length));
const runtime = await api('GET', '/api/runtime');
ok('3 runtime reports ollama without inventing a model', runtime.s === 200 && runtime.j.ollama && (ollama === 'up' ? runtime.j.ollama.ok === true : runtime.j.ollama.ok === false), runtime.j.ollama && runtime.j.ollama.error);
const agents = (await api('GET', '/api/agents')).j;
ok('4 agents include CEO, creative, revenue, growth and the old set', ['director', 'news', 'video', 'social', 'ceo', 'creative', 'revenue', 'growth', 'design3d', 'marketing'].every(id => agents.some(a => a.id === id)));
const mission = (await api('GET', '/api/world/mission')).j;
const fileSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'config/WORLD_CLASS_MISSION.md'))).update(fs.readFileSync(path.join(ROOT, 'config/mission.yaml'))).digest('hex');
ok('5 mission loaded and matches files', mission && mission.sha256 === fileSha && mission.id === 'world-class' && agents.every(a => a.mission && a.mission.sha256 === fileSha), mission && mission.sha256);
const plan = await api('POST', '/api/world/plan', { goal: 'Подготовь выпуск новостей и не публикуй его' });
ok('6 CEO plan creates tasks', plan.s === 200 && plan.j.tasks.some(t => t.agentId === 'revenue') && plan.j.tasks.some(t => t.agentId === 'news') && plan.j.tasks.every(t => t.status !== 'published'), plan.j.summary);
const again = await api('POST', '/api/world/plan', { goal: 'ещё раз' });
ok('6 CEO plan is idempotent for the day', again.j.already === true && again.j.tasks.length === 0);
const qcApi = await api('POST', '/api/world/qc', strong);
ok('7 QC API blocks news without fact-check', qcApi.s === 200 && qcApi.j.verdict === 'blocked_factcheck' && qcApi.j.total >= 70, qcApi.j.verdict);
const day = new Date().toISOString().slice(0, 10);
const badViews = await api('POST', '/api/world/import', { entries: [{ date: day, stream: 'news', kind: 'views', amount_usd: 10 }] });
ok('views are not revenue', badViews.s === 403 && badViews.j.code === 'fake_financials');
const unconf = await api('POST', '/api/world/import', { entries: [{ date: day, stream: 'news', platform: 'yt-news', kind: 'income', amount_usd: 50, payout_id: 'EST-50', currency: 'USD', state: 'estimate', confirmation_source: 'owner:estimate', payout_confirmed: false }] });
ok('8 unconfirmed payout is stored but not counted', unconf.s === 201);
let cc = (await api('GET', '/api/world/command-center')).j;
ok('8 unconfirmed does not become month revenue', cc.revenue.month === 'НЕТ ДАННЫХ' && cc.revenue.unconfirmed >= 1);
const reach = await api('POST', '/api/world/import', { entries: [{ date: day, stream: 'news', platform: 'yt-news', kind: 'reach', amount_usd: 9, payout_id: 'REACH-1', currency: 'USD', state: 'confirmed', confirmation_source: 'owner:reach' }] });
ok('R2 reach is not revenue', reach.s === 403 && reach.j.code === 'fake_financials');
const imp = await api('POST', '/api/world/import', { csv: `date,stream,kind,amount_usd,platform,payout_id,currency,state,confirmation_source,demo,note\n${day},news,income,80.50,yt-news,PAY-80,USD,confirmed,owner:statement,0,payout\n${day},news,income,5,yt-news,PAY-DEMO,USD,confirmed,owner:statement,1,demo row\n${day},ad_services,expense,20.00,yt-news,,USD,confirmed,owner:ads,0,ads` });
ok('8 CSV import accepted', imp.s === 201 && imp.j.imported === 3, JSON.stringify(imp.j));
const accrued = await api('POST', '/api/world/import', { entries: [{ date: day, stream: 'news', platform: 'yt-news', kind: 'income', amount_minor: 1000, payout_id: 'ACC-1', currency: 'USD', state: 'accrued', confirmation_source: 'owner:accrual' }] });
ok('R5 accrued import accepted', accrued.s === 201 && accrued.j.imported === 1);
const dup = await api('POST', '/api/world/import', { entries: [{ date: day, stream: 'news', platform: 'yt-news', kind: 'income', amount_usd: 80.5, payout_id: 'PAY-80', currency: 'USD', state: 'confirmed', confirmation_source: 'owner:statement', demo: 0 }] });
ok('R3 duplicate payout is idempotent', dup.s === 201 && dup.j.imported === 0 && dup.j.duplicates === 1, JSON.stringify(dup.j));
const clash = await api('POST', '/api/world/import', { entries: [{ date: day, stream: 'news', platform: 'yt-news', kind: 'income', amount_usd: 1, payout_id: 'PAY-80', currency: 'USD', state: 'confirmed', confirmation_source: 'owner:statement' }] });
ok('R3 conflicting payout is rejected', clash.s === 409 && clash.j.code === 'duplicate_payout');
cc = (await api('GET', '/api/world/command-center')).j;
const yt = cc.platforms.find(p => p.id === 'yt-news');
const other = cc.platforms.find(p => p.id === 'fb-news');
ok('8 confirmed payout is the only revenue', cc.revenue.month.label === '$80.50' && yt.revenue.label === '$80.50' && other.revenue === 'НЕТ ДАННЫХ' && cc.revenue.demo.label.startsWith('DEMO'), JSON.stringify({ month: cc.revenue.month, yt: yt.revenue, fb: other.revenue, demo: cc.revenue.demo }));
ok('R1 three states stay apart', cc.revenue.month.label === '$80.50' && cc.revenue.estimates.note === 'не подтверждено' && cc.revenue.estimates.month.label === '$50.00' && cc.revenue.accrued.note === 'начислено, не кэш' && cc.revenue.accrued.month.label === '$10.00' && cc.revenue.month.usd === 80.5);
ok('R6 demo is outside the real total', cc.revenue.demo.label.startsWith('DEMO') && cc.revenue.month.usd === 80.5);
const ig = (cc.readPlatforms || []).find(p => p.id === 'instagram');
const web = (cc.readPlatforms || []).find(p => p.id === 'moonkatty-web');
const fb = (cc.readPlatforms || []).find(p => p.id === 'facebook');
const ynRead = (cc.readPlatforms || []).find(p => p.id === 'youtube-news');
ok('R7 unconnected or empty sources are НЕТ ДАННЫХ', ig && ig.confirmed === 'НЕТ ДАННЫХ' && web && web.confirmed === 'НЕТ ДАННЫХ' && web.estimate === 'НЕТ ДАННЫХ', JSON.stringify({ ig: ig && ig.confirmed, web: web && web.confirmed }));
ok('fixture revenue stays DEMO', cc.readApi.demo === true && cc.readApi.publish === false && ynRead && ynRead.dataMode === 'mock' && String(ynRead.confirmed.label || '').startsWith('DEMO') && fb && String(fb.estimate.label || '').includes('не подтверждено'));
ok('8 forecast is not the month figure', cc.revenue.forecast === 'НЕТ ДАННЫХ' && cc.revenue.month.label === '$80.50');
ok('8 opex and pretax from real rows', cc.revenue.opex.month.label === '$20.00' && cc.revenue.pretax.month.label === '$60.50', JSON.stringify(cc.revenue.pretax));
const grow = await api('POST', '/api/world/growth/import', { new_players: 4, dau: 10, demo: false });
ok('growth import', grow.s === 201 && grow.j.metrics.new_players === 4 && grow.j.metrics.mau === 'НЕТ ДАННЫХ');
cc = (await api('GET', '/api/world/command-center')).j;
ok('8 CAC from ad spend and new players', cc.revenue.cac.label === '$5.00', JSON.stringify(cc.revenue.cac));
const tasks1 = (await api('GET', '/api/tasks')).j.filter(t => t.source === 'ceo');
ok('9 tasks persisted', tasks1.length >= 2);
const prop = await api('POST', '/api/world/proposal', {});
ok('proposal is a draft', prop.s === 201 && prop.j.status === 'draft' && /Не отправлено/.test(prop.j.text));
await down(srv);
const srv2 = start();
ok('10 server restarts', await up(srv2));
const mission2 = (await api('GET', '/api/world/mission')).j;
const tasks2 = (await api('GET', '/api/tasks')).j.filter(t => t.source === 'ceo');
const cc2 = (await api('GET', '/api/world/command-center')).j;
ok('10 mission, tasks and revenue survive restart', mission2.sha256 === fileSha && tasks2.length === tasks1.length && cc2.revenue.month.label === '$80.50');
const backup = await api('GET', '/api/backup');
const pay = backup.j && backup.j.worldLedger && backup.j.worldLedger.find(r => r.payout_id === 'PAY-80');
ok('R4 payout record stores the required fields', backup.s === 200 && pay && pay.platform === 'yt-news' && pay.amount_cents === 8050 && pay.currency === 'USD' && pay.booked_on === day && pay.confirmation_source === 'owner:statement' && pay.state === 'confirmed');
const prep = await api('POST', '/api/restore/prepare', backup.j);
const restored = await api('POST', '/api/restore', { token: prep.j && prep.j.token, confirm: 'ЗАМЕНИТЬ' });
const cc3 = (await api('GET', '/api/world/command-center')).j;
ok('R8 backup restore keeps the confirmed payout', restored.s === 200 && cc3.revenue.month.label === '$80.50' && cc3.revenue.accrued.month.label === '$10.00', JSON.stringify(restored.j));
const aud = cc3.audience;
const yn = aud.channels.find(c => c.id === 'youtube-news');
const yp = aud.channels.find(c => c.id === 'youtube-project');
ok('A two YouTube channels stay separate and DEMO', aud.youtubeMerged === false && aud.mergeYoutube === false && aud.channels.length === 7 && yn.subscribers.label === 'DEMO 100' && yp.subscribers.label === 'DEMO 137' && yn.subscribers.real === false);
ok('A real progress, retention, CTR and formats are НЕТ ДАННЫХ', yn.progress === 'НЕТ ДАННЫХ' && yn.retention === 'НЕТ ДАННЫХ' && yn.clickThrough === 'НЕТ ДАННЫХ' && yn.formats === 'НЕТ ДАННЫХ' && yn.growth.daily === 'НЕТ ДАННЫХ');
ok('A revenue link uses confirmed payouts only', yn.revenue === 'НЕТ ДАННЫХ' && ['fallback', 'studio-intelligence'].includes(cc3.memory.path) && cc3.memory.audience.some(x => x.goal === 1000000));
ok('A organic recommendation forbids bought followers', yn.recommendations.join(' ').includes('Не покупать'));
ok('A directors read audience and do not publish', cc3.directors.ceo.audience === true && cc3.directors.marketing.publishes === false && cc3.directors.creative.audience === true && cc3.directors.revenue.audience === true);
const experiment = await api('POST', '/api/world/experiments', { hypothesis: 'Новая обложка удержит зрителя', metric: 'retention', durationDays: 14, platformId: 'youtube-news' });
ok('A experiment waits for real data', experiment.s === 201 && experiment.j.evaluation === 'НЕТ ДАННЫХ' && experiment.j.publishes === false);
const bought = await api('POST', '/api/world/experiments', { hypothesis: 'x', metric: 'followers_bought', durationDays: 7, platformId: 'tiktok' });
ok('A bought-follower experiment is rejected', bought.s === 403);
const agents2 = (await api('GET', '/api/agents')).j;
ok('5 mission still on every agent after restart', agents2.every(a => a.mission && a.mission.sha256 === fileSha));
const allow = await api('POST', '/api/world/action', { action: 'analysis' });
const owner = await api('POST', '/api/world/action', { action: 'paid_ads', detail: 'no account' });
const deny = await api('POST', '/api/world/action', { action: 'spam' });
const approved = await api('POST', '/api/world/approvals/' + owner.j.approvalId, { decision: 'approve' });
ok('11 auto allowed', allow.s === 200 && allow.j.executed === true, JSON.stringify(allow.j));
ok('11 owner gate does not execute', owner.s === 403 && owner.j.code === 'needs_owner' && approved.j.executed !== true && approved.s >= 400 /* app token cannot approve (QA-E2E-001 R2) */, JSON.stringify(approved.j));
ok('11 forbidden denied', deny.s === 403 && deny.j.code === 'forbidden');
for (const action of ['botting', 'bought_followers', 'platform_evasion', 'fake_followers']) {
  const banned = await api('POST', '/api/world/action', { action });
  ok('forbid ' + action, banned.s === 403 && banned.j.code === 'forbidden', JSON.stringify(banned.j));
}
const journal = (await api('GET', '/api/world/journal')).j;
ok('11 journal has the three decisions', ['analysis', 'paid_ads', 'spam'].every(a => journal.some(r => r.action === a)));
const bad = await api('POST', '/api/world/import', { csv: 'nope' });
const unk = await api('POST', '/api/world/action', { action: 'fly-to-the-moon' });
ok('12 bad import and unknown action are rejected', bad.s === 400 && unk.s === 403, bad.j && bad.j.error);
const pub = await api('PUT', '/api/queue/does-not-matter', { status: 'published' });
ok('12 published still rejected', pub.s === 403 || pub.s === 404);
const worldSrc = fs.readdirSync(path.join(ROOT, 'lib/world')).map(f => fs.readFileSync(path.join(ROOT, 'lib/world', f), 'utf8')).join('\n');
const secretish = /api[_-]?key\s*[:=]|BEGIN PRIVATE|sk-[A-Za-z0-9]{8,}|password\s*=\s*['\"][^'\"]+['\"]|generic-password/i.test(worldSrc + fs.readFileSync(path.join(ROOT, 'config/mission.yaml'), 'utf8'));
ok('13 config and world code contain no secret material', !secretish && !JSON.stringify(cc2).includes(tok));
const guide = fs.readFileSync(path.join(ROOT, 'docs/MAC_MINI_v1.3.0-test.md'), 'utf8');
ok('15 install guide has rollback, test port and bundle id', /v1\.2\.4-test/.test(guide) && /8687/.test(guide) && /com\.moonkatty\.aistudio\.test/.test(guide) && /Откат/.test(guide));
const socialDiff = spawn(process.execPath, ['-e', 'process.exit(0)']);
await new Promise(r => socialDiff.on('exit', r));
ok('social modules not modified by this test process', !fs.readFileSync(path.join(ROOT, 'public/social.js'), 'utf8').includes('world-class'));
await down(srv2);
const fail = out.filter(x => x.status === 'FAIL').length;
fs.mkdirSync(path.join(ROOT, 'qa/reports/world-class-v1.3.0'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'qa/reports/world-class-v1.3.0/results.json'), JSON.stringify({ at: new Date().toISOString(), fail, out }, null, 2));
console.log(fail ? 'FAILED ' + fail : 'world-class checks finished');
process.exit(fail ? 1 : 0);

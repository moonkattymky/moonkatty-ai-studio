// NEWS → VIDEO end-to-end (feat/e2e-news-video-3d).
//   1. POST /api/newsvideo/search        — real public RSS (fixed server-side allowlist, no user URLs → no SSRF) via media-automation NewsEngine
//                                          (dedup, multi-source verification, date checks, credibility). Each run persisted with errors.
//   2. POST /api/newsvideo/drafts        — episode script from selected stories (Ollama if available, else local extractive; provider recorded)
//   3. PUT  /api/newsvideo/drafts/:id    — owner edits; any edit returns the draft to status «draft» (re-approval required)
//   4. POST /api/newsvideo/drafts/:id/approve — owner approval → writes <dataDir>/media/episodes/<ref>.json (VIDEO hand-off)
//   5. POST /api/newsvideo/drafts/:id/render  — creates the existing `video_render` job (heavy lock, TTS, ffmpeg, MP4/SRT/JPG)
//   6. GET  /api/newsvideo/drafts/:id/file?kind=mp4|srt|jpg — preview/export of the job artifacts (path-checked)
// NO publishing anywhere in this module. All routes are mounted after the /api auth middleware (session or app token) + CSRF check.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFile } = require('child_process');
const { NewsEngine } = require('../media-automation/src/news');
const { JsonStore } = require('../media-automation/src/store');
const { writeEpisode } = require('../media-automation/src/jobs/video-render-executor');
const { pickFact } = require('../media-automation/src/orchestrator/facts');
const videoDeps = require('./video-deps');

// Allowed public sources (owner-editable only in code). trust = editorial credibility weight 0..1; official = primary source.
const SOURCES = Object.freeze([
  { id: 'nasa', name: 'NASA News Releases', url: 'https://www.nasa.gov/news-release/feed/', kind: 'official', trust: 0.95, primary: true },
  { id: 'esa', name: 'ESA Space News', url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News', kind: 'official', trust: 0.95, primary: true },
  { id: 'bbc-science', name: 'BBC Science & Environment', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', kind: 'rss', trust: 0.85 },
  { id: 'npr-science', name: 'NPR Science', url: 'https://feeds.npr.org/1007/rss.xml', kind: 'rss', trust: 0.8 },
  { id: 'guardian-science', name: 'The Guardian Science', url: 'https://www.theguardian.com/science/rss', kind: 'rss', trust: 0.8 },
  { id: 'sciencedaily-space', name: 'ScienceDaily Space & Time', url: 'https://www.sciencedaily.com/rss/space_time.xml', kind: 'rss', trust: 0.7 }
]);
const ALLOWED_HOSTS = new Set(SOURCES.map(s => new URL(s.url).hostname));
const MAX_FEED = 3 * 1024 * 1024;
// https only, allowlisted hosts only, redirects followed manually and only to allowlisted https hosts, size-capped.
// QA-NV-005: the cap is enforced while streaming (no content-length → we still stop at MAX_FEED and cancel the body).
async function readCapped(r, max) {
  if (!r.body || !r.body.getReader) { const t = await r.text(); if (Buffer.byteLength(t) > max) throw new Error('feed too large'); return t; }
  const rd = r.body.getReader(); const chunks = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.byteLength; if (n > max) { try { await rd.cancel(); } catch {} throw new Error('feed too large'); } chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks).toString('utf8');
}
async function safeFetch(url, opts = {}) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) throw new Error('source not allowed: ' + u.hostname);
    const r = await fetch(u, { ...opts, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
    const len = +r.headers.get('content-length') || 0; if (len > MAX_FEED) throw new Error('feed too large');
    const text = await readCapped(r, MAX_FEED);
    return { ok: r.ok, status: r.status, text: async () => text };
  }
  throw new Error('too many redirects');
}

const ID = /^[a-z0-9]{6,40}$/;
const STATUSES = ['draft', 'approved', 'rendering', 'rendered', 'render_failed'];
const LIMITS = Object.freeze({ maxDrafts: 100, maxRendersPerDraft: 20, draftTimeoutMs: 6 * 60000 });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
const sha = s => crypto.createHash('sha1').update(s).digest('hex');

function credibility(story, srcById) {
  const v = story.verification || {}; const base = { confirmed: 0.6, primary_only: 0.45, unconfirmed: 0.2, disputed: 0 }[v.status] ?? 0.1;
  const trust = Math.max(0, ...story.items.map(i => (srcById[i.sourceId] || {}).trust || 0.3));
  const datePenalty = (v.dateIssues || []).some(d => d.issue === 'future_date' || d.issue === 'unparseable_date') ? 0.4 : (v.dateIssues || []).some(d => d.issue === 'stale') ? 0.15 : 0;
  const score = Math.max(0, Math.min(1, +(base + 0.4 * trust - datePenalty).toFixed(2)));
  return { score, level: score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low', status: v.status || 'unknown', independentOrigins: v.independentOrigins || 0, dateIssues: v.dateIssues || [], contradictions: v.contradictions || [], reasons: v.reasons || [] };
}
// QA-NV-002: approval is bound to a hash of exactly the content that will be voiced/rendered.
const contentHash = d => crypto.createHash('sha256').update(JSON.stringify({ t: d.title, s: d.stories.map(x => [x.id, x.headline, x.text]) })).digest('hex').slice(0, 32);
// Fact-check aid (NOT a verifier): each sentence is linked to the source items that support it by word overlap, and
// flagged when support is weak or it contains capitalised names/numbers absent from every source. The owner must still check.
const words = t => (String(t).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'were', 'will', 'their', 'which', 'about', 'into', 'also', 'after', 'over', 'more', 'than', 'they', 'said', 'news']);
function factCheck(story) {
  const items = story.sourceItems || (story.sources || []).map(x => ({ name: x.name, url: x.url, text: '' }));
  const all = items.map(i => i.text).join(' '); const allW = new Set(words(all)); const hasText = !!all.trim();
  const sentences = String(story.text || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean).map(text => {
    const w = words(text).filter(x => !STOP.has(x)); const per = items.map(i => { const iw = new Set(words(i.text)); const hit = w.filter(x => iw.has(x)).length; return { name: i.name, url: i.url, support: w.length ? +(hit / w.length).toFixed(2) : 0 }; });
    const support = per.length ? Math.max(...per.map(p => p.support)) : 0;
    const names = (text.match(/\b[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)*/gu) || []).filter(n => !n.split(/\s+/).every(x => allW.has(x.toLowerCase()) || x.length < 4));
    const nums = (text.match(/\d+(?:[.,]\d+)?/g) || []).filter(n => !all.includes(n));
    const links = per.filter(p => p.support >= 0.25).sort((a, b) => b.support - a.support); const flags = [];
    if (!hasText) flags.push('нет текста источника'); else if (support < 0.5) flags.push('слабая опора в источниках'); if (names.length) flags.push('имена не найдены в источниках: ' + names.join(', ')); if (nums.length) flags.push('числа не найдены в источниках: ' + nums.join(', '));
    return { text, support, sources: links.length ? links : per.map(p => ({ ...p, support: 0 })), flags };
  });
  return { sentences, flagged: sentences.filter(x => x.flags.length).length };
}
function latest(story) { const t = story.items.map(i => Date.parse(i.published)).filter(Number.isFinite); return t.length ? new Date(Math.max(...t)).toISOString() : null; }

module.exports = function mountNewsVideo({ app, dataDir, services, log, runner, fetchFn = safeFetch, now = () => new Date() }) {
  const root = path.join(dataDir, 'media'); const nvDir = path.join(root, 'newsvideo'); fs.mkdirSync(path.join(nvDir, 'cards'), { recursive: true, mode: 0o700 });
  const store = new JsonStore(path.join(nvDir, 'state.json'));
  const srcById = Object.fromEntries(SOURCES.map(s => [s.id, s]));
  const engine = new NewsEngine({ statePath: path.join(nvDir, 'news-engine.json'), sources: SOURCES, retries: 2, backoffMs: 500, minSources: 2, verifyOptions: { maxAgeHours: 72, primaryDomains: ['nasa.gov', 'esa.int'] },
    fetchFn: (u, o) => fetchFn(u, o), now: () => now().toISOString() });
  let searching = null;
  const view = s => ({ id: s.id, headline: s.headline, summary: s.summary, category: s.category, published: latest(s), breaking: s.breaking, controversial: s.controversial, reviewStatus: s.reviewStatus,
    reviewReasons: s.reviewReasons, sources: s.items.map(i => ({ id: i.sourceId, name: i.sourceName, url: i.link, published: i.published, official: i.kind === 'official' })), credibility: credibility(s, srcById) });
  const candidates = () => engine.stories().map(view).filter(s => s.published).sort((a, b) => b.credibility.score - a.credibility.score || b.published.localeCompare(a.published));
  const drafts = () => store.get('drafts', {}); const getDraft = id => drafts()[id] || null;
  const saveDraft = d => { d.updatedAt = now().toISOString(); store.update('drafts', x => ({ ...x, [d.id]: d }), {}); return d; };
  const hist = (d, event, extra = {}) => { d.history = [...(d.history || []), { at: now().toISOString(), event, ...extra }].slice(-200); };

  async function search(user) {
    if (searching) return searching;
    searching = (async () => {
      const run = { id: sha(now().toISOString() + Math.random()).slice(0, 12), at: now().toISOString(), by: user || null, status: 'running' };
      // QA-NV-009: counters come from the store delta (new stories / items actually added), not from per-item return codes.
      const nStories = () => Object.keys(engine.store.get('stories', {})).length, nSeen = () => Object.keys(engine.store.get('seen', {})).length; const s0 = nStories(), i0 = nSeen();
      try { const rep = await engine.run(); const newStories = nStories() - s0, newItems = nSeen() - i0;
        Object.assign(run, { status: rep.errors.length === SOURCES.length ? 'failed' : rep.errors.length ? 'partial' : 'ok', fetched: rep.fetched, new: newStories, newItems, merged: Math.max(0, newItems - newStories), duplicates: Math.max(0, rep.fetched - newItems), errors: rep.errors }); }
      catch (e) { Object.assign(run, { status: 'failed', errors: [{ source: '*', error: e.message }] }); }
      run.finishedAt = now().toISOString(); run.candidates = candidates().length;
      store.update('runs', r => [run, ...(r || [])].slice(0, 100), []);
      log(run.status === 'failed' ? 'error' : run.errors?.length ? 'warn' : 'info', 'news', `Автопоиск: ${run.status}, получено ${run.fetched || 0}, новых ${run.new || 0}, ошибок ${(run.errors || []).length}`, user);
      return run;
    })().finally(() => { searching = null; });
    return searching;
  }

  // Script: Ollama rewrites ONLY the source text (facts never invented; numbers are cross-checked), else extractive.
  const usedModels = new Set(); // models THIS flow loaded into Ollama (QA-NV-003: only these are unloaded before render)
  async function storyText(s, signal) {
    const src = s.items.map(i => `${i.title}. ${i.summary || ''}`).join('\n').slice(0, 3000); const fallback = { text: clean(s.summary || s.headline, 600), provider: 'local-extractive' };
    let st; try { st = await runner.ollamaStatus(); } catch { st = { ok: false }; } if (!st || !st.ok) return { ...fallback, fallbackReason: 'ollama unavailable' };
    try {
      const r = await runner.ollamaJson(`You are a news anchor script writer. Rewrite the SOURCE into 2-3 short spoken English sentences for a TV news read. Use ONLY facts in the SOURCE. Do not add numbers, names or claims not present. Reply as JSON {"text":"..."}.\nSOURCE:\n${src}`, signal);
      const text = clean(r && r.json && r.json.text, 600); if (!text) return { ...fallback, fallbackReason: 'empty llm output' };
      const nums = t => (t.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.')); const srcNums = new Set(nums(src));
      const bad = nums(text).filter(n => !srcNums.has(n)); if (bad.length) return { ...fallback, fallbackReason: 'llm introduced numbers not in sources: ' + bad.join(',') };
      if (r.model) usedModels.add(r.model); return { text, provider: 'ollama:' + (r.model || '?') };
    } catch (e) { if (signal && signal.aborted) throw e; return { ...fallback, fallbackReason: 'ollama error: ' + String(e.message).slice(0, 160) }; }
  }
  let creating = null; // QA-NV-004: one draft generation at a time, cancellable, with an overall timeout
  function cancelCreate(user) { if (!creating) return { cancelled: false }; creating.ac.abort(new Error('cancelled by ' + (user || 'owner'))); log('warn', 'news', 'Создание черновика отменено', user); return { cancelled: true }; }
  async function createDraft(ids, user) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 6) throw Object.assign(new Error('Выберите от 1 до 6 новостей'), { status: 400 });
    if (creating) throw Object.assign(new Error('Черновик уже создаётся — дождитесь или отмените'), { status: 409 });
    if (Object.keys(drafts()).length >= LIMITS.maxDrafts) throw Object.assign(new Error(`Лимит черновиков (${LIMITS.maxDrafts}) — удалите старые`), { status: 429 });
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(new Error('timeout')), LIMITS.draftTimeoutMs); creating = { ac, at: now().toISOString(), user };
    try { return await createDraftInner(ids, user, ac.signal); }
    catch (e) { if (ac.signal.aborted) throw Object.assign(new Error('Создание черновика прервано: ' + (ac.signal.reason?.message || 'cancelled')), { status: 409 }); throw e; }
    finally { clearTimeout(timer); creating = null; }
  }
  async function createDraftInner(ids, user, signal) {
    const stories = ids.map(id => engine.story(String(id))); if (stories.some(s => !s)) throw Object.assign(new Error('Новость не найдена'), { status: 404 });
    const blocked = stories.map(s => view(s)).filter(v => ['disputed'].includes(v.credibility.status) || v.credibility.dateIssues.some(d => d.issue === 'future_date' || d.issue === 'unparseable_date'));
    if (blocked.length) throw Object.assign(new Error('Нельзя: спорные новости или неверные даты — ' + blocked.map(b => b.headline).join('; ')), { status: 422 });
    const out = []; for (const s of stories) { if (signal.aborted) throw signal.reason || new Error('aborted'); const t = await storyText(s, signal); const v = view(s);
      out.push({ id: s.id, category: s.category || 'science', headline: clean(s.headline, 110), text: t.text, provider: t.provider, fallbackReason: t.fallbackReason || null, fact: pickFact(s.items), sources: v.sources, credibility: v.credibility, published: v.published,
        sourceItems: s.items.map(i => ({ name: i.sourceName, url: i.link, text: clean(`${i.title}. ${i.summary || ''}`, 1500) })) }); }
    if (signal.aborted) throw signal.reason || new Error('aborted');
    const id = sha(ids.join(',') + now().toISOString() + Math.random()).slice(0, 16); const d = new Date(now());
    const draft = { id, ref: 'nv-' + id, status: 'draft', title: 'MOONKATTY News', dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }), stories: out, createdAt: now().toISOString(), createdBy: user || null, renders: [], history: [] };
    hist(draft, 'created', { by: user, providers: [...new Set(out.map(o => o.provider))] }); log('info', 'news', `Черновик сценария ${id}: ${out.length} новостей`, user); return saveDraft(draft);
  }
  function editDraft(d, b, user) {
    if (d.status === 'rendering') throw Object.assign(new Error('Идёт рендер — редактирование недоступно'), { status: 409 });
    if (b.title != null) d.title = clean(b.title, 80) || d.title;
    if (Array.isArray(b.stories)) { const byId = Object.fromEntries(d.stories.map(s => [s.id, s]));
      const next = b.stories.map(x => { const s = byId[String(x && x.id)]; if (!s) throw Object.assign(new Error('Неизвестная новость в сценарии'), { status: 400 }); return { ...s, headline: clean(x.headline ?? s.headline, 110), text: clean(x.text ?? s.text, 1200), edited: true }; });
      if (!next.length) throw Object.assign(new Error('Сценарий пуст'), { status: 400 }); d.stories = next; }
    d.status = 'draft'; for (const k of ['approvedAt', 'approvedBy', 'approvedHash', 'factCheckedAt', 'factCheckedBy']) delete d[k]; hist(d, 'edited', { by: user, contentHash: contentHash(d) }); return saveDraft(d);
  }
  const run = (bin, args) => new Promise((res, rej) => execFile(bin, args, { timeout: 60000 }, (e, so, se) => e ? rej(new Error(`${bin}: ${String(se || e.message).slice(-300)}`)) : res(so)));
  const COLORS = { space: ['0x0b1030', '0x3a1c71'], science: ['0x082032', '0x2c5364'], climate: ['0x0f2027', '0x2c7744'], tech: ['0x141e30', '0x243b55'] };
  async function card(storyId, category) { // locally generated background card (no third-party image → no licensing question)
    const f = path.join(nvDir, 'cards', storyId.replace(/[^a-z0-9]/gi, '') + '.v2.png'); if (fs.existsSync(f)) return f;
    const [a, b] = COLORS[category] || COLORS.science;
    // textured (grain + star points + soft rings) so Ken Burns motion is visible and the factory's frozen-frame QA can pass
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `gradients=s=2400x1400:c0=${a}:c1=${b}:x0=0:y0=0:x1=2400:y1=1400:d=1`,
      '-f', 'lavfi', '-i', "nullsrc=s=2400x1400,geq=lum='255*gt(random(1),0.996)+40*pow(sin(hypot(X-1700,Y-500)/38),8)':cb=128:cr=128",
      '-filter_complex', '[1:v]format=gray,gblur=sigma=1.2,format=rgb24[s];[0:v]format=rgb24,noise=alls=14:allf=u[g];[g][s]blend=all_mode=screen,format=rgb24', '-frames:v', '1', f]); return f;
  }
  async function approve(d, user, body = {}) {
    if (d.status === 'rendering') throw Object.assign(new Error('Идёт рендер'), { status: 409 });
    const h = contentHash(d);
    if (body.factChecked !== true) throw Object.assign(new Error('Отметьте «Факты проверены по источникам» — без проверки фактов утверждение невозможно'), { status: 422, code: 'fact_check_required' });
    if (body.contentHash !== h) throw Object.assign(new Error('Сценарий изменился после открытия — обновите и проверьте текущую версию'), { status: 409, code: 'content_changed' });
    const empty = d.stories.filter(s => !s.text || s.text.length < 10); if (empty.length) throw Object.assign(new Error('Пустой текст у новости: ' + empty.map(s => s.headline).join('; ')), { status: 422 });
    const stories = []; for (const s of d.stories) { const lp = await card(s.id, s.category);
      stories.push({ id: s.id, category: s.category, headline: s.headline, text: s.text, fact: s.fact || undefined, asset: { id: 'card-' + s.id, localPath: lp, width: 2400, height: 1400, attribution: 'Background: MOONKATTY generated', license: 'own' } }); }
    const sources = []; const seen = new Set(); for (const s of d.stories) for (const x of s.sources) if (!seen.has(x.url)) { seen.add(x.url); sources.push({ name: x.name, url: x.url }); }
    const episode = { title: d.title, dateLabel: d.dateLabel, stories, sources, rights: ['Backgrounds: MOONKATTY generated'], approvedBy: user, approvedAt: now().toISOString(), draftId: d.id, contentHash: h, factCheckedBy: user };
    const file = writeEpisode(dataDir, d.ref, episode);
    Object.assign(d, { status: 'approved', approvedAt: episode.approvedAt, approvedBy: user, approvedHash: h, factCheckedAt: episode.approvedAt, factCheckedBy: user, episodeFile: path.relative(dataDir, file) }); hist(d, 'approved', { by: user, contentHash: h, factChecked: true }); log('info', 'news', `Сценарий ${d.id} утверждён → ${d.ref}.json`, user); return saveDraft(d);
  }
  function sync(d) { // reflect job state into the draft (persisted)
    const last = d.renders[d.renders.length - 1]; if (!last) return d; const j = services.jobsApi.getJob(last.jobId); if (!j) return d;
    const st = j.status === 'succeeded' ? 'rendered' : ['failed', 'cancelled'].includes(j.status) ? 'render_failed' : 'rendering';
    // QA-NV-002: the job state drives the draft status only while the draft is still the approved content the job rendered.
    // After an edit (approvedHash cleared / changed) the draft stays «draft»; the old render is kept but marked stale.
    const current = !!d.approvedHash && last.contentHash === d.approvedHash && d.approvedHash === contentHash(d);
    const nextStatus = current || d.status === 'rendering' ? st : d.status;
    if (last.status !== j.status || d.status !== nextStatus) { const changedJob = last.status !== j.status; last.status = j.status; last.error = j.error || null; last.attempt = j.attempt;
      last.artifacts = (j.artifacts || []).map(a => ({ kind: a.kind, name: a.name, size: a.size, sha256: a.sha256 })); d.status = nextStatus; if (changedJob) hist(d, 'render_' + j.status, j.error ? { error: String(j.error).slice(0, 300) } : {}); saveDraft(d); }
    return d;
  }
  function render(d, preset, user) {
    if (!['approved', 'rendered', 'render_failed'].includes(d.status) || !d.approvedHash) throw Object.assign(new Error('Сначала утвердите сценарий'), { status: 409 });
    const h = contentHash(d); let ep = null; try { ep = JSON.parse(fs.readFileSync(path.join(dataDir, d.episodeFile || ''), 'utf8')); } catch {}
    if (d.approvedHash !== h || !ep || ep.contentHash !== h) throw Object.assign(new Error('Утверждённая версия не совпадает с текущим текстом — утвердите заново'), { status: 409, code: 'approval_stale' });
    if (d.renders.length >= LIMITS.maxRendersPerDraft) throw Object.assign(new Error(`Лимит рендеров на выпуск (${LIMITS.maxRendersPerDraft})`), { status: 429 });
    if (!['youtube', 'shorts'].includes(preset)) throw Object.assign(new Error('preset: youtube|shorts'), { status: 400 });
    { const vd = videoDeps.check(); if (!vd.ok) throw videoDeps.depsError(vd); } // 424 video_deps_missing: no job, draft status unchanged
    const n = d.renders.length + 1; const runId = `${d.ref}-r${n}`; const r = services.jobsApi.createJob({ type: 'video_render', agent: 'video', input: { runId, preset, episodeRef: d.ref }, maxAttempts: 2 });
    d.renders.push({ jobId: r.jobId, runId, preset, status: 'queued', at: now().toISOString(), by: user, contentHash: h }); d.status = 'rendering'; hist(d, 'render_requested', { by: user, preset, jobId: r.jobId }); log('info', 'video', `Рендер ${runId} (${preset})`, user); return saveDraft(d);
  }

  const out = d => { const h = contentHash(d); const last = [...d.renders].reverse().find(x => x.status === 'succeeded');
    return { ...d, stories: d.stories.map(s => { const { sourceItems, ...rest } = s; return { ...rest, factCheck: factCheck(s) }; }), contentHash: h,
      factCheck: { required: true, checked: !!d.approvedHash && d.approvedHash === h, by: d.factCheckedBy || null, at: d.factCheckedAt || null },
      staleRender: !!last && last.contentHash !== h }; };
  function del(d, user) { if (d.status === 'rendering') throw Object.assign(new Error('Идёт рендер'), { status: 409 }); store.update('drafts', x => { const y = { ...x }; delete y[d.id]; return y; }, {}); log('info', 'news', `Черновик ${d.id} удалён`, user); return { ok: true }; }
  async function unloadOwnModels(ollamaUrl) { // QA-NV-003: unload only models this flow loaded, loopback Ollama only
    const url = String(ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '').replace('localhost', '127.0.0.1'); if (!/^http:\/\/(127\.0\.0\.1|\[::1\]):11434$/.test(url)) throw new Error('Ollama unload: только loopback');
    if (!usedModels.size) return { unloaded: [] }; const ps = await (await fetch(url + '/api/ps', { signal: AbortSignal.timeout(3000) })).json(); const loaded = new Set((ps.models || []).map(m => m.name || m.model));
    // keep_alive=0 is an unload, not a generation; called by the video_render executor already inside withHeavy('video_render:<id>') (nesting would deadlock).
    const mine = [...usedModels].filter(m => loaded.has(m)); for (const m of mine) await fetch(url + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m, keep_alive: 0 }), signal: AbortSignal.timeout(10000) });
    usedModels.clear(); return { unloaded: mine }; }
  const wrap = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: String(e.message).slice(0, 500), code: e.code, ...(e.details ? { details: e.details } : {}) }); } };
  const draftOr404 = req => { if (!ID.test(req.params.id)) throw Object.assign(new Error('bad id'), { status: 400 }); const d = getDraft(req.params.id); if (!d) throw Object.assign(new Error('not found'), { status: 404 }); return d; };
  app.get('/api/newsvideo/status', wrap(async () => { const MV = require('../media-automation/src/video'); let tts; try { tts = { ok: true, engine: (await MV.detectTTS()).name }; } catch (e) { tts = { ok: false, error: e.message }; }
    const vd = videoDeps.check(); // resolution only (PATH + Homebrew dirs), nothing executed
    let ollama; try { ollama = await runner.ollamaStatus(); } catch (e) { ollama = { ok: false, error: e.message }; }
    return { tts, ffmpeg: !!vd.found.ffmpeg, ffprobe: !!vd.found.ffprobe, rsvg: !!vd.found['rsvg-convert'], videoDeps: { ok: vd.ok, missing: vd.missing, hint: vd.hint, message: vd.message }, renderReady: vd.ok && !!tts.ok, ollama: { ok: !!ollama.ok, model: ollama.model || null, error: ollama.error || null }, renderExecutor: services.videoRender.hasExecutor(), sources: SOURCES.map(s => ({ id: s.id, name: s.name, url: s.url, trust: s.trust, official: s.kind === 'official' })), sourceHealth: engine.store.get('sourceHealth', {}), searching: !!searching }; }));
  app.post('/api/newsvideo/search', wrap(async req => ({ run: await search(req.user), candidates: candidates().slice(0, 40) })));
  app.get('/api/newsvideo/stories', wrap(async () => ({ candidates: candidates().slice(0, 40), runs: store.get('runs', []).slice(0, 20) })));
  app.get('/api/newsvideo/drafts', wrap(async () => Object.values(drafts()).map(sync).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(out)));
  app.post('/api/newsvideo/drafts', wrap(async req => out(await createDraft((req.body || {}).storyIds, req.user))));
  app.post('/api/newsvideo/drafts/cancel', wrap(async req => cancelCreate(req.user)));
  app.get('/api/newsvideo/drafts/:id', wrap(async req => out(sync(draftOr404(req)))));
  app.delete('/api/newsvideo/drafts/:id', wrap(async req => del(sync(draftOr404(req)), req.user)));
  app.put('/api/newsvideo/drafts/:id', wrap(async req => out(editDraft(sync(draftOr404(req)), req.body || {}, req.user))));
  app.post('/api/newsvideo/drafts/:id/approve', wrap(async req => out(await approve(sync(draftOr404(req)), req.user, req.body || {}))));
  app.post('/api/newsvideo/drafts/:id/render', wrap(async req => out(render(sync(draftOr404(req)), String((req.body || {}).preset || 'youtube'), req.user))));
  app.get('/api/newsvideo/drafts/:id/file', (req, res) => { try { const d = sync(draftOr404(req)); const kind = String(req.query.kind || 'mp4'); if (!['mp4', 'srt', 'jpg'].includes(kind)) return res.status(400).json({ error: 'kind: mp4|srt|jpg' });
      const r = [...d.renders].reverse().find(x => x.status === 'succeeded'); if (!r) return res.status(404).json({ error: 'Нет готового рендера' });
      const a = (services.jobsApi.getJob(r.jobId).artifacts || []).find(x => x.kind === kind); if (!a) return res.status(404).json({ error: 'not found' });
      const real = fs.realpathSync(a.path), rr = fs.realpathSync(root); if (!real.startsWith(rr + path.sep)) return res.status(403).json({ error: 'outside media root' });
      if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${path.basename(real).replace(/[^\w.-]/g, '_')}"`);
      res.sendFile(real); } catch (e) { res.status(e.status || 500).json({ error: String(e.message).slice(0, 300) }); } });
  return { engine, search, createDraft, cancelCreate, editDraft, approve, render, sync, getDraft, candidates, unloadOwnModels, usedModels, SOURCES, LIMITS, contentHash };
};
module.exports.SOURCES = SOURCES; module.exports.safeFetch = safeFetch; module.exports.credibility = credibility; module.exports.STATUSES = STATUSES; module.exports.contentHash = contentHash; module.exports.factCheck = factCheck; module.exports.readCapped = readCapped; module.exports.LIMITS = LIMITS;

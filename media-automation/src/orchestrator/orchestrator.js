'use strict';
const fs = require('fs'); const path = require('path');
const { JsonStore } = require('../store'); const { pickFact, mediaQueries } = require('./facts'); const { tokens, jaccard } = require('../news/dedup'); const { visemeTimeline, cuesFor } = require('../host3d'); const { stripMarkup } = require('../video/speech');
const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * Pipeline: Scheduler slot -> NewsEngine.run -> select (confirmed + cleared) -> AI Editor (fact-checked) -> Media (licensed) -> Video (JobQueue heavy) -> QA
 *           -> Approval Center (human) -> Publisher (dry-run unless owner enables live per platform).
 * Each step persists its output; a restart resumes at the first unfinished step. Every event is appended to <logDir>/<runId>.jsonl.
 */
class Orchestrator {
  constructor({ stateDir, news, editor, media, factory, jobQueue, approval, publisher, music, voice, presets = ['youtube', 'shorts'], storyCount = 3, minStories = 2, stepAttempts = 2, retryMs = 1000, publishTargets, clock = () => new Date() }) {
    fs.mkdirSync(path.join(stateDir, 'runs'), { recursive: true });
    this.panelFallback = arguments[0].panelFallback || null;
    Object.assign(this, { stateDir, news, editor, media, factory, jobQueue, approval, publisher, music, voice, presets, storyCount, minStories, stepAttempts, retryMs, clock });
    this.store = new JsonStore(path.join(stateDir, 'orchestrator.json'));
    this.publishTargets = publishTargets || { youtube: ['youtube-news'], shorts: ['youtube-news', 'tiktok-news', 'instagram-news', 'facebook-news'] };
    jobQueue.registerHandler('video_render', async ({ runId, preset }) => { const r = this.run(runId); return this.factory.render(r.steps.media.output.episode, { preset, outDir: r.dir, basename: `${runId}-${preset}`, music: this.music }); });
  }
  _log(runId, event, data) { fs.appendFileSync(path.join(this.stateDir, 'runs', `${runId}.jsonl`), JSON.stringify({ at: this.clock().toISOString(), runId, event, ...data }) + '\n'); }
  run(id) { return this.store.get('runs', {})[id] || null; }
  _save(r) { this.store.update('runs', x => ({ ...x, [r.id]: r }), {}); }
  async _step(r, name, fn) {
    const s = r.steps[name] || (r.steps[name] = { status: 'pending', attempts: 0 });
    if (s.status === 'done') { this._log(r.id, 'step_skipped_done', { step: name }); return s.output; }
    for (;;) {
      s.attempts++; s.status = 'running'; s.startedAt = this.clock().toISOString(); this._save(r); this._log(r.id, 'step_start', { step: name, attempt: s.attempts });
      try { const out = await fn(); s.status = 'done'; s.output = out; s.finishedAt = this.clock().toISOString(); this._save(r); this._log(r.id, 'step_done', { step: name }); return out; }
      catch (e) { s.error = e.message; this._log(r.id, 'step_error', { step: name, attempt: s.attempts, error: e.message.slice(0, 500) });
        if (s.attempts >= this.stepAttempts || e.permanent) { s.status = 'failed'; r.status = 'failed'; this._save(r); throw e; } this._save(r); await sleep(this.retryMs * s.attempts); }
    }
  }
  /** Run or resume a video issue. Idempotent per runId. */
  async runIssue(runId, { title = 'MOONKATTY NEWS', dateLabel } = {}) {
    let r = this.run(runId);
    if (!r) { r = { id: runId, status: 'running', createdAt: this.clock().toISOString(), dir: path.join(this.stateDir, 'runs', runId), steps: {} }; fs.mkdirSync(r.dir, { recursive: true }); this._save(r); this._log(runId, 'run_created', {}); }
    else { this._log(runId, 'run_resumed', { status: r.status }); if (r.status === 'failed') { r.status = 'running'; for (const s of Object.values(r.steps)) if (s.status !== 'done') { s.status = 'pending'; s.attempts = 0; } } }
    for (const s of Object.values(r.steps)) if (s.status === 'running') s.status = 'pending'; // interrupted
    const fetched = await this._step(r, 'fetch', async () => { const rep = await this.news.run(); if (rep.fetched === 0 && rep.errors.length) throw new Error('all sources failed'); return rep; });
    const selected = await this._step(r, 'select', async () => {
      const used = new Set(this.store.get('usedStories', []));
      const c = this.news.stories().filter(s => s.corroboration === 'confirmed' && ['auto_approved', 'approved'].includes(s.reviewStatus) && !used.has(s.id) && (s.summary || '').length > 60)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      const GENERIC = new Set(['NASA', 'ESA', 'BBC', 'The', 'New', 'US', 'UK']); const names = h => new Set((String(h).match(/\b[A-Z][A-Za-z0-9-]{2,}/g) || []).map(w => w.replace(/[’']s$/, '')).filter(w => !GENERIC.has(w)));
      const picked = []; for (const s of c) { const tk = tokens(s.headline); const nm = names(s.headline); if (picked.some(p => jaccard(tk, tokens(p.headline)) > 0.2 || [...names(p.headline)].some(n => nm.has(n)))) continue; picked.push(s); if (picked.length >= this.storyCount * 2) break; } // topic diversity
      c.length = 0; c.push(...picked);
      if (c.length < this.minStories) { const e = new Error(`only ${c.length} cleared stories`); e.permanent = true; throw e; }
      return c.map(s => ({ id: s.id, category: s.category, headline: s.headline, summary: s.summary, items: s.items.map(i => ({ sourceId: i.sourceId, sourceName: i.sourceName, title: i.title, summary: i.summary, link: i.link })) }));
    });
    const edited = await this._step(r, 'edit', async () => {
      const out = [];
      for (const s of selected) { const texts = s.items.map(i => i.summary || i.title);
        const h = await this.editor.headline({ title: s.headline, texts }); const sc = await this.editor.videoScript({ issueTitle: title, stories: [{ id: s.id, category: s.category, headline: s.headline, texts }] });
        const script = trimScript(sc.scenes[1].text);
        out.push({ ...s, editedHeadline: h.text.slice(0, 90), script, scriptProvider: sc.scenes[1].provider, headlineProvider: h.provider, fact: pickFact(s.items) }); }
      return { stories: out, rejections: this.editor.log.slice(-20) };
    });
    const media = await this._step(r, 'media', async () => {
      const stories = [];
      for (const s of edited.stories) { if (stories.length >= this.storyCount) break; let [a] = await this.media.findForNews(s.id, mediaQueries(s), { count: 1 }).catch(() => []);
        if (!a) { if (!this.panelFallback) { this._log(runId, 'story_dropped_no_media', { storyId: s.id }); continue; }
          a = await this.panelFallback({ story: s, headline: s.editedHeadline, fact: s.fact }); this._log(runId, 'media_fallback_panel', { storyId: s.id, assetId: a.id }); }
        stories.push({ id: s.id, category: s.category, headline: s.editedHeadline, text: s.script, asset: a, fact: s.fact, sources: s.items.map(i => ({ name: i.sourceName, url: i.link })) }); }
      if (stories.length < this.minStories) { const e = new Error(`only ${stories.length} stories with licensed media`); e.permanent = true; throw e; }
      const sources = [...new Map(stories.flatMap(s => s.sources).map(x => [x.name + x.url, x])).values()];
      const episode = { title, dateLabel: dateLabel || this.clock().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).toUpperCase().replace(/,/g, ' ·'), stories, sources, rights: stories.map(s => s.asset.attribution) };
      const rights = this.media.rightsReport(stories.map(s => s.asset.id), { runId, music: this.music ? { title: this.music.title, license: this.music.license, licenseUrl: this.music.licenseUrl } : null, voice: this.voice || null, newsSources: sources });
      fs.writeFileSync(path.join(r.dir, 'rights.json'), JSON.stringify(rights, null, 2)); return { episode, rightsFile: path.join(r.dir, 'rights.json') };
    });
    const renders = await this._step(r, 'render', async () => {
      const out = {}; for (const preset of this.presets) out[preset] = await this.jobQueue.runExclusive({ type: 'video_render', agent: 'orchestrator', input: { runId, preset }, timeoutSec: 1800, maxAttempts: 1, idempotencyKey: `${runId}:${preset}` }); return out;
    });
    await this._step(r, 'qa', async () => { const bad = Object.entries(renders).filter(([, m]) => !m.qa?.ok); if (bad.length) throw Object.assign(new Error('QA failed: ' + bad.map(b => b[0]).join(',')), { permanent: true }); return Object.fromEntries(Object.entries(renders).map(([k, m]) => [k, m.qa.checks.map(c => `${c.name}:${c.ok}`)])); });
    const handoff = await this._step(r, 'handoff', async () => {
      const f = path.join(r.dir, 'lipsync-handoff.json'); const m = renders[this.presets[0]];
      const byId = Object.fromEntries(media.episode.stories.map(s => [s.id, s])); const segs = [];
      for (const sg of m.segments) { const st = sg.storyId && byId[sg.storyId]; const visemes = st ? (await visemeTimeline(stripMarkup(st.text), sg.duration, { leadSec: 0.25 }).catch(e => ({ error: e.message }))) : null;
        segs.push({ ...sg, text: st ? stripMarkup(st.text) : null, visemes: Array.isArray(visemes) ? visemes.map(v => ({ ...v, t: +(v.t + sg.start).toFixed(3) })) : visemes, cues: st ? cuesFor(st, sg.duration).map(c => ({ ...c, t: +(c.t + sg.start).toFixed(3) })) : null }); }
      const h = { contract: 'host3d.render_segment/v2 (proposal)', runId, anchorAudio: m.files.anchorAudio, format: 'wav 48kHz mono s16 (-16 LUFS)', voiceProfileId: this.voice?.voiceProfileId || null, voice: this.voice,
        timingNote: 'viseme timing approximate (uniform per phoneme within measured segment duration)', segments: segs }; fs.writeFileSync(f, JSON.stringify(h, null, 2)); return { file: f };
    });
    const approvalIds = await this._step(r, 'approval', async () => {
      const ep = media.episode; const desc = describe(ep, this.music, this.voice);
      return this.presets.map(p => this.approval.submit({ id: `${runId}-${p}`, kind: 'video', title: `${ep.title} — ${ep.dateLabel}${p !== 'youtube' ? ' #Shorts' : ''}`, headline: ep.stories[0].headline,
        description: desc, videoPath: renders[p].files.video, thumbPath: renders[p].files.thumbnail, sources: ep.sources, licenses: JSON.parse(fs.readFileSync(media.rightsFile, 'utf8')).assets.map(a => ({ title: a.title, author: a.author, license: a.license, licenseUrl: a.licenseUrl, pageUrl: a.pageUrl, attribution: a.attribution })),
        music: renders[p].music, qa: renders[p].qa.ok, preset: p, runId, targets: this.publishTargets[p] || [], publish: { status: 'awaiting_approval' }, meta: { handoff: handoff.file } }).id);
    });
    this.store.update('usedStories', u => [...new Set([...(u || []), ...media.episode.stories.map(s => s.id)])], []);
    r = this.run(runId); r.status = 'awaiting_approval'; r.approvalIds = approvalIds; this._save(r); this._log(runId, 'awaiting_approval', { approvalIds });
    return this.publishApproved(runId);
  }
  /** Daytime text news (X with image + Telegram) -> Approval Center only. */
  async runText(runId, { targets = ['x-news', 'telegram-news'] } = {}) {
    if (this.approval.get(runId)) return this.approval.get(runId);
    await this.news.run(); const used = new Set(this.store.get('usedText', []));
    const s = this.news.stories().find(x => x.corroboration === 'confirmed' && ['auto_approved', 'approved'].includes(x.reviewStatus) && !used.has(x.id)); if (!s) { this._log(runId, 'text_no_story', {}); return null; }
    const h = await this.editor.headline({ title: s.headline, texts: s.items.map(i => i.summary || i.title) });
    const [a] = await this.media.findForNews(s.id, mediaQueries(s), { count: 1 }).catch(() => []);
    const link = s.items[0].link; let text = `${h.text}\n\n${s.summary}`; const tail = `\n${link}`; if ((text + tail).length > 280) text = text.slice(0, 276 - tail.length).replace(/\s+\S*$/, '') + '…';
    const it = this.approval.submit({ id: runId, kind: 'text', title: h.text, headline: h.text, text: text + tail, thumbPath: a?.localPath, sources: s.items.map(i => ({ name: i.sourceName, url: i.link })),
      licenses: a ? [{ title: a.title, author: a.author, license: a.license, licenseUrl: a.licenseUrl, pageUrl: a.pageUrl, attribution: a.attribution }] : [], targets, publish: { status: 'awaiting_approval' }, storyId: s.id });
    this.store.update('usedText', u => [...(u || []), s.id], []); this._log(runId, 'text_submitted', { item: it.id }); return it;
  }
  /** After owner approval: enqueue to Publisher (dry-run unless live enabled) — idempotent per (account, item). */
  async publishApproved(runId) {
    const r = this.run(runId); if (!r?.approvalIds) return r; let all = true;
    for (const id of r.approvalIds) {
      const it = this.approval.get(id); if (it.status !== 'approved') { all = false; continue; }
      const results = [];
      for (const acc of it.targets || []) { const platform = this.publisher.accounts.get(acc)?.platform;
        const payload = it.kind === 'text' ? (platform === 'x' ? { text: it.text, imagePath: it.thumbPath } : { text: it.text, imagePath: it.thumbPath }) : platform === 'youtube' ? { videoPath: it.videoPath, title: it.title.slice(0, 100), description: it.description, shorts: it.preset !== 'youtube', privacy: 'private' }
          : platform === 'tiktok' ? { videoPath: it.videoPath, title: `${it.headline}\n${it.description}`.slice(0, 2200) }
          : { targetId: 'CONFIGURE', videoUrl: 'https://example.invalid/needs-public-hosting.mp4', caption: `${it.headline}\n\n${it.description}`.slice(0, 2200) };
        try { this.publisher.enqueue({ accountId: acc, contentId: it.id, payload, content: { reviewStatus: 'approved', storyId: it.id } }); } catch (e) { results.push({ acc, error: e.message }); } }
      const processed = await this.publisher.processDue();
      it.publish = { status: processed.every(p => p.status === 'dry_run') ? 'dry_run_done' : 'processed', posts: this.publisher.posts({ contentId: it.id }).map(p => ({ account: p.accountId, status: p.status, error: p.error })), errors: results };
      this.approval._save(it); this._log(runId, 'publish_processed', { item: id, publish: it.publish });
    }
    if (all) { r.status = 'published_or_dry_run'; this._save(r); }
    return this.run(runId);
  }
}
function trimScript(t, maxWords = 34) { const sents = String(t).split(/(?<=[.!?])\s+/); let out = ''; for (const x of sents) { if ((out + ' ' + x).split(/\s+/).length > maxWords && out) break; out = (out + ' ' + x).trim(); }
  return out.split(/\s+/).length > maxWords ? out.split(/\s+/).slice(0, maxWords).join(' ') + '.' : out; }
function describe(ep, music, voice) {
  return [`${ep.title} — ${ep.dateLabel}`, '', ...ep.stories.map(s => `• ${s.headline}`), '', 'Sources:', ...ep.sources.map(s => `${s.name}: ${s.url}`), '', 'Images:', ...ep.rights,
    ...(music ? ['', `Music: ${music.title} — ${music.license}`] : []), '', `Narration: synthetic voice${voice ? ` (${voice.voiceId})` : ''}. Script AI-assisted and fact-checked against the listed sources.`].join('\n').slice(0, 4900);
}
module.exports = { Orchestrator, describe };

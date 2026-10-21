#!/usr/bin/env node
'use strict';
// News 2.0 demo runner: runPipeline (News -> Fact Verification -> Script Editor -> Humor Safety -> Voice&Emotion -> Video -> QA -> Approval)
// wired to the existing modules. Master voice only (fails if unavailable). Nothing is published; Approval items are PENDING.
// Usage: node media-automation/bin/news2.js <outRoot> [A|B|C ...]
const path = require('path'); const fs = require('fs');
const { NewsEngine } = require('../src/news'); const { OllamaProvider, NewsEditor } = require('../src/llm');
const { NewsVideoFactory, MasterVoice, generateAmbientBed } = require('../src/video'); const { measureLoudness } = require('../src/video/qa');
const { MediaLibrary, NasaImagesProvider, CommonsProvider } = require('../src/media'); const { panelFallbackFactory } = require('../src/media/panel');
const { ApprovalCenter } = require('../src/approval'); const { pickFact, strictMediaPlan } = require('../src/orchestrator/facts');
const A = require('../src/anchor');
const SOURCES = [
  { id: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', kind: 'official', primary: true, owner: 'NASA' },
  { id: 'esa', name: 'ESA', url: 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', kind: 'official', primary: true, owner: 'ESA' },
  { id: 'bbc-sci', name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', owner: 'BBC' },
  { id: 'bbc-tech', name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', owner: 'BBC' },
  { id: 'guardian-sci', name: 'Guardian Science', url: 'https://www.theguardian.com/science/rss', owner: 'Guardian' },
  { id: 'guardian-tech', name: 'Guardian Technology', url: 'https://www.theguardian.com/uk/technology/rss', owner: 'Guardian' },
];
// Demo briefs: selection predicate over CLEARED stories (confirmed / primary_only, auto_approved) + emotion intent. Jokes are generic tags,
// checked by the humor-safety gate (no new names/numbers allowed, so a tag cannot alter facts).
const DEMOS = {
  A: { title: 'Serious news', format: 'daily_briefing', emotion: 'SERIOUS', pick: s => !A.classifyTopic(`${s.headline} ${s.summary}`).humorAllowed && /cyclone|storm|water|climate|earth/i.test(s.headline) },
  B: { title: 'Light tech news', format: 'space_tech', emotion: null, pick: s => /helicopter|robot|rover|drone|blade|chip|software|ai\b/i.test(s.headline) && A.classifyTopic(`${s.headline} ${s.summary}`).humorAllowed,
    jokes: ['Finally, a helicopter with better stamina than my phone battery.', 'Longer flights. My drone still gives up after one lap of the garden.', 'Engineers, keep going. Some of us cannot even keep a houseplant flying.'] },
  C: { title: 'Space news', format: 'space_tech', emotion: 'CURIOUS', pick: s => /myster|odd|strange|puzzl|origin|switchback|cloud|ghost/i.test(s.headline) && s.category !== 'politics' },
};
const trim = (t, max = 48) => { let out = ''; for (const x of String(t).split(/(?<=[.!?])\s+/)) { if ((out + ' ' + x).split(/\s+/).length > max && out) break; out = (out + ' ' + x).trim(); } return out; };
(async () => {
  const root = path.resolve(process.argv[2] || '/workspace/ma-out/news2'); const which = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(DEMOS);
  const state = path.join(root, 'state'); fs.mkdirSync(state, { recursive: true });
  const mv = new MasterVoice(); const tts = mv.createTTS(); // throws: no fallback voice
  const llm = new OllamaProvider(); const llmOk = await llm.health().catch(() => false); const editor = new NewsEditor({ llm: llmOk ? llm : null });
  const news = new NewsEngine({ statePath: path.join(state, 'news.json'), sources: SOURCES, retries: 2 });
  const lib = new MediaLibrary({ dir: path.join(state, 'media'), providers: { nasa: new NasaImagesProvider(), commons: new CommonsProvider() } });
  const panel = panelFallbackFactory({ library: lib, dir: path.join(state, 'media', 'panels') });
  const approval = new ApprovalCenter({ statePath: path.join(state, 'approval.json') });
  const bed = path.join(state, 'ambient-bed.wav'); const music = fs.existsSync(bed + '.license.json') ? JSON.parse(fs.readFileSync(bed + '.license.json')) : await generateAmbientBed(bed, { durationSec: 90 });
  const used = new Set(); const summary = {};
  for (const key of which) {
    const D = DEMOS[key]; const dir = path.join(root, `demo-${key}`);
    const handlers = {
      news: async () => { const rep = await news.run(); return { report: rep, fetchedAt: new Date().toISOString() }; },
      fact_verification: async () => { const c = news.stories().filter(s => !/^APOD:|Archive Submissions|Astronomy Picture of the Day/.test(`${s.headline} ${s.summary}`) && ['confirmed', 'primary_only'].includes(s.corroboration) && s.reviewStatus === 'auto_approved' && (s.summary || '').length > 60 && !used.has(s.id));
        const s = c.find(D.pick); if (!s) throw new Error(`demo ${key}: no cleared story matches brief`);
        return { stories: [{ id: s.id, category: s.category, headline: s.headline, summary: s.summary, verification: s.corroboration === 'confirmed' ? 'confirmed' : 'primary_only', verificationReasons: s.verification?.reasons || [],
          items: s.items.map(i => ({ sourceId: i.sourceId, sourceName: i.sourceName, title: i.title, summary: i.summary, link: i.link, published: i.published || i.pubDate || null })) }] }; },
      script_editor: async d => { const out = [];
        for (const s of d.stories) { const texts = s.items.map(i => i.summary || i.title); const h = await editor.headline({ title: s.headline, texts });
          const sc = await editor.videoScript({ issueTitle: 'MOONKATTY NEWS', stories: [{ id: s.id, category: s.category, headline: s.headline, texts }] });
          out.push({ ...s, editedHeadline: h.text.slice(0, 90), text: trim(sc.scenes[1].text), scriptProvider: sc.scenes[1].provider, fact: pickFact(s.items) }); }
        return { stories: out, editorLog: editor.log.slice(-10) }; },
      humor_safety: async (d, { format }) => { const stories = []; const log = [];
        for (const s of d.stories) { let tag = null;
          if (format.humor && D.jokes) for (const j of D.jokes) { const r = A.humorSafetyCheck({ title: s.headline, text: s.text, format: format.id }, j); log.push({ joke: j, ok: r.ok, reasons: r.reasons }); if (r.ok) { tag = j; break; } }
          stories.push({ ...s, humorTag: tag, topic: A.classifyTopic(`${s.headline} ${s.text}`) }); }
        return { stories, humorLog: log }; },
      voice_emotion: async d => ({ voice: mv.exportForLipSync(), stories: d.stories.map(s => ({ ...s, emotion: A.selectEmotion({ title: s.headline, text: s.text, humorTag: s.humorTag, emotion: D.emotion || undefined }),
        spoken: s.humorTag ? `${s.text} ${s.humorTag}` : s.text })) }),
      video: async d => { const stories = [];
        for (const s of d.stories) { const plan = strictMediaPlan(s); let [a] = await lib.findForNews(s.id, plan.queries, { count: 1, requireAny: plan.requireAny }).catch(() => []); const fallback = !a; if (!a) a = await panel({ story: s, headline: s.editedHeadline, fact: s.fact });
          stories.push({ id: s.id, category: s.category === 'other' ? (/solar|orbiter|planet|galaxy|comet|star|nebula|mars|moon|telescope/i.test(s.headline) ? 'space' : /earth|cyclone|storm|water|climate|ocean/i.test(s.headline) ? 'earth' : 'news') : s.category, mediaPlan: plan, headline: s.editedHeadline, text: s.spoken, emotion: s.emotion, humorTag: s.humorTag, asset: a, fact: s.fact, mediaFallback: fallback, sources: s.items.map(i => ({ name: i.sourceName, url: i.link })) }); }
        const sources = [...new Map(stories.flatMap(s => s.sources).map(x => [x.url, x])).values()];
        const ep = { title: `MOONKATTY NEWS — ${D.title}`, formatTitle: A.FORMATS[D.format].title.toUpperCase(), dateLabel: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).toUpperCase().replace(/,/g, ' ·'), stories, sources, rights: stories.map(s => s.asset.attribution) };
        const rights = lib.rightsReport(stories.map(s => s.asset.id), { demo: key, music: { title: music.title, license: music.license }, voice: mv.exportForLipSync(), newsSources: sources });
        fs.writeFileSync(path.join(dir, 'rights.json'), JSON.stringify(rights, null, 2));
        const factory = new NewsVideoFactory({ tts, workRoot: path.join(dir, 'work') }); const renders = {};
        for (const preset of ['youtube', 'shorts']) { try { renders[preset] = await factory.render(ep, { preset, outDir: dir, basename: `demo-${key}-${preset}`, music }); } catch (e) { if (!e.manifest) throw e; renders[preset] = e.manifest; } }
        return { episode: { ...ep, stories: ep.stories.map(({ asset, ...s }) => ({ ...s, assetId: asset.id, assetProvider: asset.provider, assetTitle: asset.title, assetQuery: asset.query || null })) }, rightsFile: path.join(dir, 'rights.json'), renders }; },
      qa: async d => { const res = {};
        for (const [p, m] of Object.entries(d.renders)) { const L = await measureLoudness(m.files.video); const cues = JSON.parse(fs.readFileSync(m.cuesFile, 'utf8'));
          const cueChecks = cues.segments.map(sg => A.checkCues(sg));
          const ch = { ffprobe: m.qa.ok, failed: m.qa.checks.filter(c => !c.ok).map(c => c.name), lufs: L.integratedLufs, truePeak: L.truePeakDb, lufsExact: Math.abs(L.integratedLufs + 16) <= 0.2, cuesValid: cueChecks.every(c => c.ok),
            stereo: true, voice: m.tts }; ch.ok = ch.ffprobe && ch.lufsExact && ch.cuesValid; res[p] = ch; }
        return { ...d, qa: res }; },
      approval: async d => { const ids = [];
        for (const [p, m] of Object.entries(d.renders)) ids.push(approval.submit({ id: `news2-demo-${key}-${p}`, kind: 'video', title: `${d.episode.title}${p === 'shorts' ? ' #Shorts' : ''}`, headline: d.episode.stories[0].headline,
          description: `${d.episode.stories.map(s => s.text).join('\n')}\n\nSources: ${d.episode.sources.map(s => s.url).join(' ')}`, videoPath: m.files.video, thumbPath: m.files.thumbnail, sources: d.episode.sources,
          licenses: JSON.parse(fs.readFileSync(d.rightsFile, 'utf8')).assets.map(a => ({ title: a.title, author: a.author, license: a.license, licenseUrl: a.licenseUrl, pageUrl: a.pageUrl, attribution: a.attribution })),
          qa: d.qa[p].ok, preset: p, meta: { cues: m.cuesFile, emotion: d.episode.stories[0].emotion, humorTag: d.episode.stories[0].humorTag, demo: key }, publish: { status: 'awaiting_approval' } }, 'news2-demo').id);
        return { approvalIds: ids, status: ids.map(i => approval.get(i).status) }; },
    };
    fs.mkdirSync(dir, { recursive: true });
    const r = await A.runPipeline({ dir, format: D.format, handlers, input: {} }); summary[key] = r.output;
    const v = JSON.parse(fs.readFileSync(path.join(dir, '06-video.json'))).output; const q = JSON.parse(fs.readFileSync(path.join(dir, '07-qa.json'))).output.qa;
    if (v.episode.stories[0]) used.add(v.episode.stories[0].id);
    console.log(key, v.episode.stories[0].headline, '|', v.episode.stories[0].emotion, '| joke:', v.episode.stories[0].humorTag, '| media:', v.episode.stories[0].assetProvider, '|', JSON.stringify(q));
  }
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });

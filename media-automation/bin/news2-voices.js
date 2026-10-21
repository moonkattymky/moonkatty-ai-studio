#!/usr/bin/env node
'use strict';
// VOICE COMPARISON renders (explicit override; the pinned MOONKATTY_NEWS_MASTER_VOICE config is NOT changed or used here).
// Same verified stories + same LLM script (scripts/demo-X.script.json) rendered with pure stock Kokoro voices, 16:9 + 9:16,
// QA'd and submitted to Approval Center as PENDING comparison items. Nothing is published.
// Usage: node media-automation/bin/news2-voices.js <outRoot> <news2Root> [voices=am_michael,am_adam,am_fenrir] [demos=ABC]
const path = require('path'); const fs = require('fs'); const crypto = require('crypto');
const { NewsVideoFactory, KokoroBlendTTS, generateAmbientBed } = require('../src/video'); const { measureLoudness } = require('../src/video/qa');
const { ApprovalCenter } = require('../src/approval'); const A = require('../src/anchor');
const [outRoot = '/workspace/ma-out/news2-voices', n2 = '/workspace/ma-out/news2', vArg = 'am_michael,am_adam,am_fenrir', dArg = 'ABC'] = process.argv.slice(2);
const VOICES = vArg.split(','); const env = process.env;
const FORMAT = { A: 'daily_briefing', B: 'space_tech', C: 'space_tech' }; const TITLE = { A: 'Serious news', B: 'Light tech news', C: 'Space news' };
const read = f => JSON.parse(fs.readFileSync(f, 'utf8')).output;
(async () => {
  const state = path.join(outRoot, 'state'); fs.mkdirSync(state, { recursive: true });
  const approval = new ApprovalCenter({ statePath: path.join(n2, 'state', 'approval.json') }); // same Approval Center as the master-voice demos
  const lib = JSON.parse(fs.readFileSync(path.join(n2, 'state', 'media', 'library.json'), 'utf8')).assets;
  const bed = path.join(n2, 'state', 'ambient-bed.wav'); const music = fs.existsSync(bed + '.license.json') ? JSON.parse(fs.readFileSync(bed + '.license.json')) : await generateAmbientBed(bed, { durationSec: 90 });
  for (const key of dArg.split('')) {
    const src = path.join(n2, `demo-${key}`); const script = JSON.parse(fs.readFileSync(path.join(outRoot, 'scripts', `demo-${key}.script.json`), 'utf8'));
    const v06 = read(path.join(src, '06-video.json')); const st0 = v06.episode.stories[0]; const asset = { ...lib[st0.assetId] }; if (!asset.localPath) throw new Error('asset missing ' + st0.assetId);
    for (const voice of VOICES) {
      const dir = path.join(outRoot, `demo-${key}`, voice); fs.mkdirSync(dir, { recursive: true });
      const override = { voice, engine: 'kokoro-82m', blend: { [voice]: 1 }, speed: 1.0, pitchSemitones: 0, emotionPitch: false, comparisonRender: true, masterVoiceUnchanged: 'MOONKATTY_NEWS_MASTER_VOICE (B) config untouched', reason: 'owner-requested voice comparison 2026-10-21' };
      const tts = new KokoroBlendTTS({ python: env.MA_KOKORO_PYTHON || 'python3', model: env.MA_KOKORO_MODEL, voices: env.MA_KOKORO_VOICES, blend: { [voice]: 1 }, speed: 1.0, pitchSemitones: 0, name: `comparison:kokoro:${voice}` });
      const handlers = {
        news: async () => read(path.join(src, '01-news.json')),
        fact_verification: async () => read(path.join(src, '02-fact_verification.json')),
        script_editor: async d => ({ ...d, script }),
        humor_safety: async d => ({ ...d, humorTag: script.humorTag, humorLog: script.humorLog }),
        voice_emotion: async d => ({ ...d, voiceOverride: override, emotion: st0.emotion }),
        video: async d => {
          const story = { id: st0.id, category: st0.category, headline: st0.headline, text: script.spoken, lines: script.lines, emotion: st0.emotion, humorTag: script.humorTag, asset, fact: st0.fact };
          const ep = { ...v06.episode, stories: [story], title: `MOONKATTY NEWS — ${TITLE[key]}` };
          fs.copyFileSync(path.join(src, 'rights.json'), path.join(dir, 'rights.json'));
          const rj = JSON.parse(fs.readFileSync(path.join(dir, 'rights.json'))); rj.voice = override; rj.script = { provider: script.provider, factCheck: script.factCheck }; fs.writeFileSync(path.join(dir, 'rights.json'), JSON.stringify(rj, null, 2));
          const f = new NewsVideoFactory({ tts, workRoot: path.join(dir, 'work'), emotionPitch: false, voiceOverride: override }); const renders = {};
          for (const preset of ['youtube', 'shorts']) { try { renders[preset] = await f.render(ep, { preset, outDir: dir, basename: `demo-${key}-${voice}-${preset}`, music }); } catch (e) { if (!e.manifest) throw e; renders[preset] = e.manifest; } }
          return { ...d, episode: { ...ep, stories: [{ ...story, asset: undefined, assetId: asset.id }] }, rightsFile: path.join(dir, 'rights.json'), renders };
        },
        qa: async d => { const qa = {};
          for (const [p, m] of Object.entries(d.renders)) { const L = await measureLoudness(m.files.video); const cues = JSON.parse(fs.readFileSync(m.cuesFile, 'utf8')); const by = Object.fromEntries(m.qa.checks.map(c => [c.name, c]));
            qa[p] = { ok: m.qa.ok && Math.abs(L.integratedLufs + 16) <= 0.2 && L.truePeakDb <= -1 && cues.segments.every(s => A.checkCues(s).ok), lufs: L.integratedLufs, truePeak: L.truePeakDb, res: by.resolution.actual,
              black: by.no_black_frames.ok, freeze: by.no_frozen_frames.ok, avStart: by.av_sync_start.actual, avDur: by.av_sync_duration.actual, duration: by.duration.actual, cuesValid: cues.segments.every(s => A.checkCues(s).ok), failed: m.qa.checks.filter(c => !c.ok).map(c => c.name) }; }
          return { ...d, qa }; },
        approval: async d => ({ ...d, approvalIds: Object.entries(d.renders).map(([p, m]) => approval.submit({ id: `news2-voicecmp-${key}-${voice}-${p}`, kind: 'video',
          title: `[VOICE COMPARISON ${voice}] MOONKATTY NEWS — ${TITLE[key]}${p === 'shorts' ? ' #Shorts' : ''}`, headline: st0.headline, description: `${script.spoken}\n\nSources: ${script.sources.map(s => s.url).join(' ')}\n\nComparison render — voice override ${voice}; master voice unchanged.`,
          videoPath: m.files.video, thumbPath: m.files.thumbnail, sources: script.sources, qa: d.qa[p].ok, preset: p, comparisonRender: true, voiceOverride: override,
          licenses: JSON.parse(fs.readFileSync(d.rightsFile, 'utf8')).assets.map(a => ({ title: a.title, author: a.author, license: a.license, licenseUrl: a.licenseUrl, pageUrl: a.pageUrl, attribution: a.attribution })),
          meta: { cues: m.cuesFile, demo: key, script: path.join(outRoot, 'scripts', `demo-${key}.script.json`) }, publish: { status: 'awaiting_approval' } }, 'news2-voice-comparison').id) }),
      };
      const r = await A.runPipeline({ dir, format: FORMAT[key], handlers, input: {} });
      console.log(key, voice, JSON.stringify(Object.fromEntries(Object.entries(r.output.qa).map(([p, q]) => [p, { ok: q.ok, lufs: q.lufs, tp: q.truePeak }]))));
    }
  }
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });

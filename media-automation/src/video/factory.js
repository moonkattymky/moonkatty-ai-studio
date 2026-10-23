'use strict';
const fs = require('fs');
const path = require('path');
const { run, probeDuration } = require('./exec');
const { getPreset } = require('./presets');
const { buildSrt } = require('./subtitles');
const { validateSrt } = require('./srtcheck');
const { StubCharacter3D } = require('./character3d');
const { validateMusic } = require('./music');
const { qaVideo } = require('./qa');

const FONT_CANDIDATES = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'];
const defaultFont = () => FONT_CANDIDATES.find(f => fs.existsSync(f)) || null;

/**
 * script: { title, scenes:[{ text, heading?, background? }], sources?:[{name,url}], intro?:{title,tagline,durationSec}|false, outro?:{text,durationSec}|false }
 */
function validateScript(s) {
  if (!s || !s.title || !Array.isArray(s.scenes) || !s.scenes.length) throw new Error('script needs title and scenes[]');
  s.scenes.forEach((sc, i) => { if (!sc.text || !String(sc.text).trim()) throw new Error(`scene ${i} has no text`); });
  return s;
}
const wrap = (text, n) => { const out = []; let cur = ''; for (const w of require('./subtitles').splitWords(text, n)) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out.join('\n'); };

class VideoFactory {
  constructor({ tts, character3d = new StubCharacter3D(), runFn = run, font = defaultFont(), brand = {}, transitionSec = 0.5, transition = 'fade',
    targetLufs = -16, qa = true } = {}) {
    if (!tts || typeof tts.synthesize !== 'function') throw new Error('VideoFactory: a real TTS provider is required (use detectTTS())');
    Object.assign(this, { tts, character3d, runFn, font, transitionSec, transition, targetLufs, qa });
    this.brand = { name: 'MOONKATTY', colors: ['0x14112b', '0x1f2a5a', '0x3a1f5a'], accent: '0xffd23f', textColor: 'white', ...brand };
  }
  _ff(args, cwd) { return this.runFn('ffmpeg', ['-y', '-v', 'error', ...args], cwd ? { cwd } : {}); }
  _font() { return this.font ? `fontfile='${this.font}'` : 'font=Sans'; }
  _dt(file, { size, color = this.brand.textColor, y, box = 0.35 }) {
    return `drawtext=${this._font()}:textfile='${file}':fontcolor=${color}:fontsize=${size}:line_spacing=${Math.round(size * 0.3)}:x=(w-text_w)/2:y=${y}:box=1:boxcolor=black@${box}:boxborderw=${Math.round(size * 0.35)}`;
  }

  _segments(script, m) {
    const segs = [];
    if (script.intro !== false) { const i = script.intro || {}; segs.push({ kind: 'intro', heading: i.title || script.title, body: i.tagline || `${this.brand.name} · ${new Date().toISOString().slice(0, 10)}`, duration: i.durationSec || 3, color: this.brand.colors[0] }); }
    script.scenes.forEach((sc, k) => segs.push({ kind: 'scene', heading: sc.heading || '', text: sc.text, background: sc.background, color: this.brand.colors[(k + 1) % this.brand.colors.length], storyId: sc.storyId }));
    const credit = [];
    if (script.sources?.length) credit.push('Sources:', ...script.sources.slice(0, 8).map(s => `${s.name}${s.url ? ' — ' + new URL(s.url).host : ''}`));
    if (m) credit.push('', `Music: ${m.title || 'untitled'}${m.artist ? ' by ' + m.artist : ''} (${m.license})`);
    credit.push('', `Voice: ${this.tts.name} (synthetic)`);
    segs.push({ kind: 'credits', heading: 'Credits', body: credit.join('\n'), duration: 4, color: '0x0b0b14', small: true });
    if (script.outro !== false) { const o = script.outro || {}; segs.push({ kind: 'outro', heading: this.brand.name, body: o.text || 'Thanks for watching', duration: o.durationSec || 2.5, color: this.brand.colors[0] }); }
    return segs;
  }

  /** Render script to MP4 + SRT + thumbnail + manifest (+ QA report) for a preset. */
  async render(script, { preset = 'youtube', outDir, music, basename = 'video' } = {}) {
    validateScript(script); const P = typeof preset === 'string' ? getPreset(preset) : preset; const m = validateMusic(music);
    if (!outDir) throw new Error('outDir required');
    const work = path.join(outDir, `${basename}.work`); fs.mkdirSync(work, { recursive: true });
    const W = P.width, H = P.height, base = Math.round(Math.min(W, H) * 0.06), T = this.transitionSec, wrapN = W > H ? 40 : 22;
    const segs = this._segments(script, m);
    // 1) audio per segment (TTS for scenes, silence for cards)
    let t = 0;
    for (const [i, s] of segs.entries()) {
      s.wav = path.join(work, `a${i}.wav`);
      if (s.text) { const r = await this.tts.synthesize(s.text, s.wav); s.speech = r.durationSec; s.duration = Math.max(1.5, r.durationSec + 0.5); }
      else await this._ff(['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`, '-t', s.duration.toFixed(3), s.wav]);
      s.start = t; t += s.duration;
    }
    const total = t;
    if (P.maxDurationSec && total > P.maxDurationSec) throw new Error(`duration ${total.toFixed(1)}s exceeds ${P.name} limit ${P.maxDurationSec}s`);
    // 2) subtitles (spoken only) + validation
    const srt = path.join(outDir, `${basename}.srt`);
    const srtText = buildSrt(segs.filter(s => s.text).map(s => ({ text: s.text, start: s.start, duration: s.speech + 0.2 })), { maxChars: W > H ? 42 : 26 });
    const srtCheck = validateSrt(srtText, { maxChars: W > H ? 42 : 26, totalSec: total });
    if (!srtCheck.ok) throw new Error('subtitle validation failed: ' + srtCheck.errors.join('; '));
    fs.writeFileSync(srt, srtText);
    // 3) clips (each extended by T for xfade, except last)
    const clips = [];
    for (const [i, s] of segs.entries()) {
      const L = s.duration + (i < segs.length - 1 ? T : 0); const clip = path.join(work, `v${i}.mp4`);
      const char = s.text ? await this.character3d.renderSegment({ script: s.text, audioPath: s.wav, durationSec: s.duration, aspect: P.aspect, outPath: path.join(work, `char${i}.mov`), preset: { width: W, height: H, fps: P.fps } }) : null;
      const inputs = s.background && fs.existsSync(s.background) ? ['-loop', '1', '-t', L.toFixed(3), '-i', s.background] : ['-f', 'lavfi', '-t', L.toFixed(3), '-i', `color=c=${s.color}:s=${W}x${H}:r=${P.fps}`];
      let vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${P.fps}`;
      if (s.heading) { const f = path.join(work, `h${i}.txt`); fs.writeFileSync(f, wrap(s.heading, wrapN)); vf += ',' + this._dt(f, { size: s.kind === 'intro' || s.kind === 'outro' ? Math.round(base * 1.5) : base, color: s.kind === 'scene' ? this.brand.textColor : this.brand.accent, y: s.kind === 'scene' ? 'h*0.15' : s.small ? 'h*0.12' : '(h/2)-text_h' }); }
      if (s.body) { const f = path.join(work, `b${i}.txt`); fs.writeFileSync(f, s.small ? s.body : wrap(s.body, wrapN)); vf += ',' + this._dt(f, { size: Math.round(base * (s.small ? 0.55 : 0.8)), y: s.small ? 'h*0.25' : '(h/2)+40', box: 0 }); }
      vf += '[bg]'; const args = [...inputs];
      const vid = char && (char.videoPath || char.file);
      if (vid) { args.push('-i', vid); vf += `;[1:v]scale=${Math.round(W * 0.5)}:-1[ch];[bg][ch]overlay=(W-w)/2:H-h[v]`; } else vf += ';[bg]null[v]';
      args.push('-filter_complex', vf, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(P.fps), '-t', L.toFixed(3), clip);
      await this._ff(args); clips.push(clip);
    }
    // 4) xfade chain
    const silent = path.join(work, 'joined.mp4');
    if (clips.length === 1) fs.copyFileSync(clips[0], silent);
    else {
      const parts = []; let prev = '[0:v]';
      for (let i = 1; i < clips.length; i++) { const off = segs[i].start; const out = i === clips.length - 1 ? '[vout]' : `[x${i}]`;
        parts.push(`${prev}[${i}:v]xfade=transition=${this.transition}:duration=${T}:offset=${off.toFixed(3)}${out}`); prev = out; }
      await this._ff([...clips.flatMap(c => ['-i', c]), '-filter_complex', parts.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', silent]);
    }
    // 5) audio: concat narration, duck music under voice, two-pass loudnorm to target LUFS
    const narr = path.join(work, 'narr.wav');
    const af = segs.map((s, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=mono,apad=whole_dur=${s.duration.toFixed(3)}[a${k}]`).join(';') + ';' + segs.map((_, k) => `[a${k}]`).join('') + `concat=n=${segs.length}:v=0:a=1[out]`;
    await this._ff([...segs.flatMap(s => ['-i', s.wav]), '-filter_complex', af, '-map', '[out]', '-ac', '2', narr]);
    const mix = path.join(work, 'mix.wav');
    if (m) await this._ff(['-i', narr, '-stream_loop', '-1', '-i', m.file, '-filter_complex',
      `[1:a]aresample=44100,volume=${m.volume},atrim=0:${total.toFixed(3)}[mu];[mu][0:a]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];[0:a][duck]amix=inputs=2:duration=first:normalize=0[o]`, '-map', '[o]', '-t', total.toFixed(3), mix]);
    else fs.copyFileSync(narr, mix);
    const norm = path.join(work, 'norm.wav'); const ln = `loudnorm=I=${this.targetLufs}:TP=-1.5:LRA=11`;
    const { stderr } = await this.runFn('ffmpeg', ['-hide_banner', '-nostats', '-i', mix, '-af', `${ln}:print_format=json`, '-f', 'null', '-']);
    const meas = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
    await this._ff(['-i', mix, '-af', `${ln}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true,aresample=48000`, norm]);
    // 6) final mux with burned subtitles
    const out = path.join(outDir, `${basename}.mp4`);
    const style = `FontName=DejaVu Sans,FontSize=${W > H ? 20 : 13},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,MarginV=${W > H ? 40 : 110}`;
    const { escapeFilterValue } = require('./burn');
    await this._ff(['-i', silent, '-i', norm, '-filter_complex', `[0:v]subtitles=filename=${escapeFilterValue(path.basename(srt))}:force_style='${style}'[v]`, '-map', '[v]', '-map', '1:a',
      '-c:v', P.vcodec, '-crf', String(P.crf), '-pix_fmt', P.pixfmt, '-r', String(P.fps), '-c:a', 'aac', '-b:a', P.abitrate, '-ar', '48000', '-t', total.toFixed(3), '-movflags', '+faststart', out], outDir);
    // 7) thumbnail
    const thumb = path.join(outDir, `${basename}.jpg`); const tt = path.join(work, 'thumb.txt'); fs.writeFileSync(tt, wrap(script.title, wrapN));
    await this._ff(['-ss', (segs[1]?.start + 1 || 0.5).toFixed(2), '-i', silent, '-frames:v', '1', '-vf', this._dt(tt, { size: Math.round(base * 1.4), color: 'yellow', y: '(h-text_h)/2', box: 0.6 }), '-q:v', '3', thumb]);
    const durationSec = await probeDuration(out, this.runFn);
    const qa = this.qa ? await qaVideo(out, { width: W, height: H, fps: P.fps, durationSec: total, targetLufs: this.targetLufs, runFn: this.runFn }) : null;
    const manifest = { title: script.title, preset: P.name, platform: P.platform, width: W, height: H, aspect: P.aspect, durationSec,
      files: { video: out, subtitles: srt, thumbnail: thumb }, tts: this.tts.name, character3d: this.character3d.name, transition: { type: this.transition, sec: T },
      segments: segs.map(s => ({ kind: s.kind, start: +s.start.toFixed(3), duration: +s.duration.toFixed(3), storyId: s.storyId })),
      sources: script.sources || [], music: m ? { title: m.title, artist: m.artist, license: m.license, licenseUrl: m.licenseUrl, attributionRequired: m.attributionRequired } : null,
      loudness: { target: this.targetLufs, measuredInput: +meas.input_i }, subtitles: srtCheck, qa, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(outDir, `${basename}.json`), JSON.stringify(manifest, null, 2));
    fs.rmSync(work, { recursive: true, force: true });
    if (qa && !qa.ok) { const e = new Error('QA failed: ' + qa.checks.filter(c => !c.ok).map(c => `${c.name}=${c.actual} (want ${c.expected})`).join(', ')); e.manifest = manifest; throw e; }
    return manifest;
  }
}
module.exports = { VideoFactory, validateScript };

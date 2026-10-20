'use strict';
const fs = require('fs');
const path = require('path');
const { run, probeDuration } = require('./exec');
const { getPreset } = require('./presets');
const { buildSrt } = require('./subtitles');
const { StubCharacter3D } = require('./character3d');
const { validateMusic } = require('./music');

const FONT_CANDIDATES = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'];
const defaultFont = () => FONT_CANDIDATES.find(f => fs.existsSync(f)) || null;

/** script: { title, scenes:[{ text, heading?, background? }] } */
function validateScript(s) {
  if (!s || !s.title || !Array.isArray(s.scenes) || !s.scenes.length) throw new Error('script needs title and scenes[]');
  s.scenes.forEach((sc, i) => { if (!sc.text || !String(sc.text).trim()) throw new Error(`scene ${i} has no text`); });
  return s;
}

class VideoFactory {
  constructor({ tts, character3d = new StubCharacter3D(), runFn = run, font = defaultFont(), brand = {} } = {}) {
    if (!tts || typeof tts.synthesize !== 'function') throw new Error('VideoFactory: a real TTS provider is required (use detectTTS())');
    Object.assign(this, { tts, character3d, runFn, font });
    this.brand = { colors: ['0x14112b', '0x1f2a5a', '0x3a1f5a'], textColor: 'white', ...brand };
  }
  _ff(args, cwd) { return this.runFn('ffmpeg', ['-y', '-v', 'error', ...args], cwd ? { cwd } : {}); }
  _fontArg() { return this.font ? `fontfile='${this.font.replace(/'/g, "\\'")}'` : 'font=Sans'; }

  /** Render script to MP4 + SRT + thumbnail for a preset. Returns manifest. */
  async render(script, { preset = 'youtube', outDir, music, basename = 'video' } = {}) {
    validateScript(script); const P = typeof preset === 'string' ? getPreset(preset) : preset;
    const m = validateMusic(music);
    if (!outDir) throw new Error('outDir required');
    const work = path.join(outDir, `${basename}.work`); fs.mkdirSync(work, { recursive: true });
    const W = P.width, H = P.height, fs_ = Math.round(Math.min(W, H) * 0.06);
    // 1) TTS per scene
    const segs = []; let t = 0;
    for (const [i, sc] of script.scenes.entries()) {
      const wav = path.join(work, `scene${i}.wav`);
      const r = await this.tts.synthesize(sc.text, wav);
      const dur = Math.max(1, r.durationSec + 0.3);
      segs.push({ i, text: sc.text, heading: sc.heading || (i === 0 ? script.title : ''), wav, start: t, duration: dur, background: sc.background });
      t += dur;
    }
    const total = t;
    if (P.maxDurationSec && total > P.maxDurationSec) throw new Error(`duration ${total.toFixed(1)}s exceeds ${P.name} limit ${P.maxDurationSec}s`);
    // 2) subtitles
    const srt = path.join(outDir, `${basename}.srt`); fs.writeFileSync(srt, buildSrt(segs, { maxChars: W > H ? 48 : 26 }));
    // 3) scene clips (+ optional 3D segment)
    const clips = [];
    for (const s of segs) {
      const clip = path.join(work, `scene${s.i}.mp4`);
      const char = await this.character3d.renderSegment({ sceneId: s.i, text: s.text, audioFile: s.wav, durationSec: s.duration, preset: { width: W, height: H, fps: P.fps }, outFile: path.join(work, `char${s.i}.mov`) });
      const color = this.brand.colors[s.i % this.brand.colors.length];
      const inputs = s.background && fs.existsSync(s.background)
        ? ['-loop', '1', '-t', s.duration.toFixed(2), '-i', s.background]
        : ['-f', 'lavfi', '-t', s.duration.toFixed(2), '-i', `color=c=${color}:s=${W}x${H}:r=${P.fps}`];
      let vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${P.fps}`;
      if (s.heading) { const tf = path.join(work, `head${s.i}.txt`); fs.writeFileSync(tf, s.heading);
        vf += `,drawtext=${this._fontArg()}:textfile='${tf}':fontcolor=${this.brand.textColor}:fontsize=${fs_}:x=(w-text_w)/2:y=h*0.18:box=1:boxcolor=black@0.35:boxborderw=20`; }
      vf += '[bg]';
      const args = [...inputs];
      if (char && char.file) { args.push('-i', char.file); vf += `;[1:v]scale=${Math.round(W * 0.5)}:-1[ch];[bg][ch]overlay=(W-w)/2:H-h[v]`; } else vf += ';[bg]null[v]';
      args.push('-filter_complex', vf, '-map', '[v]', '-an', '-c:v', P.vcodec, '-pix_fmt', P.pixfmt, '-r', String(P.fps), '-t', s.duration.toFixed(2), clip);
      await this._ff(args); clips.push(clip);
    }
    // 4) concat video, concat narration (+pad), mix music
    const list = path.join(work, 'clips.txt'); fs.writeFileSync(list, clips.map(c => `file '${path.basename(c)}'`).join('\n'));
    const silent = path.join(work, 'silent.mp4'); await this._ff(['-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-c', 'copy', 'silent.mp4'], work);
    const narr = path.join(work, 'narration.wav');
    const ain = segs.flatMap(s => ['-i', s.wav]);
    const af = segs.map((s, k) => `[${k}:a]aresample=44100,apad=whole_dur=${s.duration.toFixed(2)}[a${k}]`).join(';') + ';' + segs.map((_, k) => `[a${k}]`).join('') + `concat=n=${segs.length}:v=0:a=1[out]`;
    await this._ff([...ain, '-filter_complex', af, '-map', '[out]', '-ac', '2', narr]);
    // 5) final: burn subtitles + audio
    const out = path.join(outDir, `${basename}.mp4`);
    const subStyle = `FontName=DejaVu Sans,FontSize=${W > H ? 22 : 14},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,MarginV=${W > H ? 40 : 120}`;
    const fargs = ['-i', silent, '-i', narr];
    let fc = `[0:v]subtitles='${path.basename(srt)}':force_style='${subStyle}'[v]`;
    if (m) { fargs.push('-stream_loop', '-1', '-i', m.file); fc += `;[2:a]volume=${m.volume}[mu];[1:a][mu]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`; }
    else fc += ';[1:a]anull[a]';
    fargs.push('-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', P.vcodec, '-crf', String(P.crf), '-pix_fmt', P.pixfmt, '-c:a', 'aac', '-b:a', P.abitrate, '-t', total.toFixed(2), '-movflags', '+faststart', out);
    await this._ff(fargs, outDir);
    // 6) thumbnail
    const thumb = path.join(outDir, `${basename}.jpg`); const tt = path.join(work, 'thumb.txt'); fs.writeFileSync(tt, script.title);
    await this._ff(['-ss', Math.min(0.5, total / 2).toFixed(2), '-i', silent, '-frames:v', '1', '-vf',
      `drawtext=${this._fontArg()}:textfile='${tt}':fontcolor=yellow:fontsize=${Math.round(fs_ * 1.4)}:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6:boxborderw=30`, '-q:v', '3', thumb]);
    const durationSec = await probeDuration(out, this.runFn);
    const manifest = { title: script.title, preset: P.name, platform: P.platform, width: W, height: H, aspect: P.aspect, durationSec,
      files: { video: out, subtitles: srt, thumbnail: thumb }, tts: this.tts.name, character3d: this.character3d.name,
      music: m ? { title: m.title, artist: m.artist, license: m.license, licenseUrl: m.licenseUrl, attributionRequired: m.attributionRequired } : null,
      createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(outDir, `${basename}.json`), JSON.stringify(manifest, null, 2));
    fs.rmSync(work, { recursive: true, force: true });
    return manifest;
  }
}
module.exports = { VideoFactory, validateScript };

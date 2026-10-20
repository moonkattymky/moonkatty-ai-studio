'use strict';
const fs = require('fs'); const path = require('path');
const { run, probeDuration } = require('./exec'); const { getPreset } = require('./presets');
const { buildSrt } = require('./subtitles'); const { parseSrt, validateSrt } = require('./srtcheck'); const { buildAss } = require('./ass');
const { validateMusic } = require('./music'); const { qaVideo } = require('./qa'); const { stripMarkup } = require('./speech');
const G = require('./graphics'); const { layoutFor } = require('../media/library'); const { StubHost3D } = require('../host3d');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const TRANSITIONS = ['smoothleft', 'circleopen', 'slideup', 'dissolve', 'wiperight', 'radial', 'smoothup', 'fade'];

/**
 * NewsVideoFactory (v2): real licensed stills with Ken Burns (no upscaling) or blurred-fill, animated lower-thirds,
 * verified-number info panels, logo bug, image credit tag, animated intro/outro with official logo, credits card with attributions,
 * styled ASS subtitles, varied xfade, ducked CC0 bed, 2-pass loudnorm, extended QA.
 * episode: { title, dateLabel, stories:[{ id, category, headline, text (spoken, may contain [pause]), asset:{localPath,width,height,attribution,...}, fact?:{value,label,source} }], sources:[{name,url}], rights:[attribution lines] }
 */
class NewsVideoFactory {
  constructor({ tts, host3d = new StubHost3D(), runFn = run, transitionSec = 0.6, targetLufs = -16, workRoot = null } = {}) {
    if (!tts || typeof tts.synthesize !== 'function') throw new Error('NewsVideoFactory: real TTS required');
    Object.assign(this, { tts, host3d, runFn, T: transitionSec, targetLufs, workRoot });
  }
  _ff(args, cwd) { return this.runFn('ffmpeg', ['-y', '-v', 'error', ...args], cwd ? { cwd } : {}); }
  async _clip({ out, L, W, H, fps, bg, overlays }) {
    // bg: {type:'kenburns'|'blurfill'|'stars', file, ...}; overlays: [{file, x, y, start, fadeIn, slide?, scaleIn?}]
    const N = Math.ceil(L * fps); const inputs = ['-loop', '1', '-framerate', String(fps), '-t', L.toFixed(3), '-i', bg.file]; let f = '';
    if (bg.type === 'kenburns') { // prescale DOWN to cover*zoom, then zoompan within it (crop window >= output => no upscale of content)
      const z = bg.zoom; const dir = bg.dir % 4;
      const px = ['iw/2-(iw/zoom/2)', '(iw-iw/zoom)*on/' + N, '(iw-iw/zoom)*(1-on/' + N + ')', 'iw/2-(iw/zoom/2)'][dir];
      const py = ['ih/2-(ih/zoom/2)', 'ih/2-(ih/zoom/2)', '(ih-ih/zoom)*on/' + N, '(ih-ih/zoom)*(1-on/' + N + ')'][dir];
      const zexp = dir % 2 === 0 ? `1+${(z - 1).toFixed(4)}*on/${N}` : `${z.toFixed(4)}`;
      f = `[0:v]scale=${Math.ceil(W * z)}:${Math.ceil(H * z)}:force_original_aspect_ratio=increase,crop=${Math.ceil(W * z)}:${Math.ceil(H * z)},zoompan=z='${zexp}':x='${px}':y='${py}':d=1:s=${W}x${H}:fps=${fps},setsar=1[bg0]`;
    } else if (bg.type === 'blurfill') { // background: blurred cover (decorative); foreground: native/downscaled image centered with slow drift
      f = `[0:v]split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.18:saturation=1.2,scale=${Math.round(W * 1.15)}:-2,crop=${W}:${H}:'(iw-${W})*t/${L.toFixed(2)}':'(ih-${H})/2'[bb];` +
        `[b]scale=w='trunc(${bg.fgWidth}*(0.9+0.1*t/${L.toFixed(2)})/2)*2':h=-2:eval=frame[fg];[bb][fg]overlay=x='(W-w)/2':y='(H-h)/2-${Math.round(H * (H > W ? 0.06 : 0.04))}',setsar=1,fps=${fps}[bg0]`;
    } else { // stars: slow drift
      f = `[0:v]crop=${W}:${H}:'(iw-${W})*t/${(L * 6).toFixed(2)}':'(ih-${H})/2+20*sin(t)',setsar=1,fps=${fps}[bg0]`;
    }
    let last = 'bg0';
    overlays.forEach((o, i) => {
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', L.toFixed(3), '-i', o.file); const k = i + 1; const st = o.start || 0, fi = o.fadeIn || 0.4;
      let pre = `[${k}:v]format=rgba`;
      if (o.scaleIn) pre += `,scale=w='iw*min(1,0.6+0.4*t/${fi})':h=-1:eval=frame`;
      pre += `,fade=t=in:st=${st}:d=${fi}:alpha=1`; if (o.fadeOut) pre += `,fade=t=out:st=${(L - o.fadeOut - 0.1).toFixed(2)}:d=${o.fadeOut}:alpha=1`;
      const x = o.slide ? `'if(lt(t,${st}),-w,${o.x}-(1-min(1,(t-${st})/${fi}))*(w+${o.x}))'` : `'${o.x}'`;
      f += `;${pre}[o${k}];[${last}][o${k}]overlay=x=${x}:y='${o.y}':eval=frame[v${k}]`; last = `v${k}`;
    });
    await this._ff([...inputs, '-filter_complex', f, '-map', `[${last}]`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', L.toFixed(3), out]);
  }

  async render(ep, { preset = 'youtube', outDir, music, basename = 'episode' } = {}) {
    if (!ep?.stories?.length) throw new Error('episode needs stories'); const P = typeof preset === 'string' ? getPreset(preset) : preset; const m = validateMusic(music);
    const W = P.width, H = P.height, fps = P.fps, T = this.T, V = H > W;
    const work = path.join(this.workRoot || outDir, `${basename}.work`); fs.mkdirSync(work, { recursive: true });
    const stars = await G.makeStarfield(path.join(this.workRoot || outDir, 'starfield.png'));
    const logoBig = await G.logoPng(path.join(ASSETS, 'moonkatty-logo.svg'), path.join(work, 'logo-big.png'), Math.round(Math.min(W, H) * 0.32));
    const logoBug = await G.logoPng(path.join(ASSETS, 'moonkatty-logo.svg'), path.join(work, 'logo-bug.png'), Math.round(Math.min(W, H) * 0.085));
    const png = async (name, svg) => G.svgToPng(svg, path.join(work, name + '.png'), this.runFn);
    const dims = f => this.runFn('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).then(r => r.stdout.trim().split(',').map(Number));
    // ---- segments
    const segs = [];
    segs.push({ kind: 'intro', duration: 3.6 });
    for (const s of ep.stories) {
      const lay = layoutFor(s.asset, W, H); if (lay.mode === 'reject') throw new Error(`asset ${s.asset.id} rejected for ${P.name}: ${lay.reason}`);
      segs.push({ kind: 'story', story: s, layout: lay });
    }
    segs.push({ kind: 'credits', duration: 5 }); segs.push({ kind: 'outro', duration: 3 });
    // ---- audio
    let t = 0; const cues = [];
    for (const [i, s] of segs.entries()) {
      s.wav = path.join(work, `a${i}.wav`);
      if (s.kind === 'story') { const r = await this.tts.synthesize(`[pause 250] ${s.story.text} [pause 350]`, s.wav); s.duration = r.durationSec; s.speech = r.durationSec; }
      else await this._ff(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', s.duration.toFixed(3), s.wav]);
      s.start = t; t += s.duration;
      if (s.kind === 'story') { const srt = buildSrt([{ text: stripMarkup(s.story.text), start: s.start + 0.25, duration: s.speech - 0.6 }], { maxChars: V ? 28 : 46 }); cues.push(...parseSrt(srt).map(c => ({ start: c.start, end: c.end, text: c.lines.join('\n') }))); }
    }
    const total = t; const lufs = P.targetLufs ?? this.targetLufs; if (P.maxDurationSec && total > P.maxDurationSec) throw new Error(`duration ${total.toFixed(1)}s exceeds ${P.name} limit`);
    const srtText = cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join('\n');
    const check = validateSrt(srtText, { maxChars: V ? 28 : 46, totalSec: total }); if (!check.ok) throw new Error('subtitle validation failed: ' + check.errors.join('; '));
    const srt = path.join(outDir, `${basename}.srt`); fs.writeFileSync(srt, srtText);
    const ass = path.join(work, 'subs.ass'); fs.writeFileSync(ass, buildAss(cues, { W, H }));
    // ---- clips
    const clips = []; const pad = Math.round(Math.min(W, H) * 0.04);
    for (const [i, s] of segs.entries()) {
      const L = s.duration + (i < segs.length - 1 ? T : 0); const out = path.join(work, `v${i}.mp4`); const ov = [];
      if (s.kind === 'intro') {
        const title = await png('title', G.titleSvg({ W, H, title: 'MOONKATTY NEWS', subtitle: ep.dateLabel || '' })); const [tw, th] = await dims(title); const [lw, lh] = await dims(logoBig);
        ov.push({ file: logoBig, x: `(W-w)/2`, y: `${Math.round(H * (V ? 0.3 : 0.18))}+(${lh}-h)/2`, start: 0.1, fadeIn: 0.9, scaleIn: true });
        ov.push({ file: title, x: Math.round((W - tw) / 2), y: Math.round(H * (V ? 0.3 : 0.18) + lh + pad), start: 0.9, fadeIn: 0.7, slide: false });
        await this._clip({ out, L, W, H, fps, bg: { type: 'stars', file: stars }, overlays: ov });
      } else if (s.kind === 'story') {
        const st = s.story; const lt = await png(`lt${i}`, G.lowerThirdSvg({ W, H, category: st.category || 'news', headline: st.headline })); const [, lth] = await dims(lt);
        const ltY = V ? Math.round(H * 0.58) : H - lth - Math.round(H * 0.16);
        ov.push({ file: lt, x: pad, y: ltY, start: 0.35, fadeIn: 0.5, slide: true });
        if (st.fact) { const ip = await png(`ip${i}`, G.infoPanelSvg({ W, H, ...st.fact })); const [iw] = await dims(ip);
          ov.push({ file: ip, x: W - iw - pad, y: V ? Math.round(H * 0.12) : Math.round(H * 0.1), start: Math.min(2.2, s.duration * 0.3), fadeIn: 0.5 }); }
        const ct = await png(`ct${i}`, G.creditTagSvg({ W, H, text: st.asset.attribution })); const [, cth] = await dims(ct);
        ov.push({ file: ct, x: pad, y: V ? Math.round(H * 0.555) - cth : pad, start: 0.6, fadeIn: 0.4 });
        const [bw] = await dims(logoBug); ov.push({ file: logoBug, x: W - bw - pad, y: V ? Math.round(H * 0.035) : pad, start: 0, fadeIn: 0.3 });
        const bg = s.layout.mode === 'kenburns' ? { type: 'kenburns', file: st.asset.localPath, zoom: 1.1, dir: i } : { type: 'blurfill', file: st.asset.localPath, fgWidth: s.layout.fgWidth, fgHeight: s.layout.fgHeight };
        await this._clip({ out, L, W, H, fps, bg, overlays: ov });
        const seg3d = await this.host3d.renderSegment({ script: stripMarkup(st.text), audioPath: s.wav, durationSec: s.duration, aspect: P.aspect, outPath: path.join(work, `char${i}.mov`) });
        if (seg3d?.videoPath) s.host3d = seg3d.videoPath; // overlay integration happens when Studio delivers alpha video
      } else if (s.kind === 'credits') {
        const lines = ['Sources:', ...(ep.sources || []).map(x => `• ${x.name} — ${hostOf(x.url)}`), 'Images:', ...(ep.rights || []).map(r => '• ' + r)];
        if (m) lines.push('Music:', `• ${m.title} — ${m.artist} (${m.license})`); lines.push('Voice:', `• Synthetic voice (${this.tts.name}). Script AI-assisted, fact-checked against sources.`);
        const card = await png('credits', G.cardSvg({ W, H, heading: 'Sources & Credits', lines }));
        ov.push({ file: card, x: Math.round(W * 0.05), y: Math.round(H * 0.08), start: 0.1, fadeIn: 0.5 });
        await this._clip({ out, L, W, H, fps, bg: { type: 'stars', file: stars }, overlays: ov });
      } else {
        const t2 = await png('outro', G.titleSvg({ W, H, title: 'MOONKATTY NEWS', subtitle: 'SUBSCRIBE · MOONKATTY.COM' })); const [tw] = await dims(t2); const [, lh] = await dims(logoBig);
        ov.push({ file: logoBig, x: `(W-w)/2`, y: Math.round(H * (V ? 0.3 : 0.15)), start: 0, fadeIn: 0.5 }); ov.push({ file: t2, x: Math.round((W - tw) / 2), y: Math.round(H * (V ? 0.3 : 0.15) + lh + pad), start: 0.3, fadeIn: 0.5 });
        await this._clip({ out, L, W, H, fps, bg: { type: 'stars', file: stars }, overlays: ov });
      }
      clips.push(out);
    }
    // ---- xfade chain with varied transitions
    const joined = path.join(work, 'joined.mp4'); const parts = []; let prev = '[0:v]'; const used = [];
    for (let i = 1; i < clips.length; i++) { const tr = TRANSITIONS[(i - 1) % TRANSITIONS.length]; used.push(tr); const o = i === clips.length - 1 ? '[vout]' : `[x${i}]`;
      parts.push(`${prev}[${i}:v]xfade=transition=${tr}:duration=${T}:offset=${segs[i].start.toFixed(3)}${o}`); prev = o; }
    await this._ff([...clips.flatMap(c => ['-i', c]), '-filter_complex', parts.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', joined]);
    // ---- audio: narration, anchor export (48k mono), music duck, loudnorm
    const narr = path.join(work, 'narr.wav');
    const af = segs.map((s, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=mono,apad=whole_dur=${s.duration.toFixed(3)}[a${k}]`).join(';') + ';' + segs.map((_, k) => `[a${k}]`).join('') + `concat=n=${segs.length}:v=0:a=1[out]`;
    await this._ff([...segs.flatMap(s => ['-i', s.wav]), '-filter_complex', af, '-map', '[out]', narr]);
    const anchor = path.join(outDir, `${basename}.anchor.wav`); await this._ff(['-i', narr, '-af', `loudnorm=I=${lufs}:TP=-1.5:LRA=11`, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', anchor]);
    const mix = path.join(work, 'mix.wav');
    if (m) await this._ff(['-i', narr, '-stream_loop', '-1', '-i', m.file, '-filter_complex', `[0:a]aformat=channel_layouts=stereo[n];[1:a]aresample=44100,volume=${m.volume},atrim=0:${total.toFixed(3)}[mu];[mu][n]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[d];[n][d]amix=inputs=2:duration=first:normalize=0[o]`, '-map', '[o]', '-t', total.toFixed(3), mix]);
    else await this._ff(['-i', narr, '-ac', '2', mix]);
    const norm = path.join(work, 'norm.wav'); const ln = `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
    const { stderr } = await this.runFn('ffmpeg', ['-hide_banner', '-nostats', '-i', mix, '-af', `${ln}:print_format=json`, '-f', 'null', '-']); const me = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
    await this._ff(['-i', mix, '-af', `${ln}:measured_I=${me.input_i}:measured_TP=${me.input_tp}:measured_LRA=${me.input_lra}:measured_thresh=${me.input_thresh}:offset=${me.target_offset}:linear=true,aresample=48000`, norm]);
    // ---- final
    const out = path.join(outDir, `${basename}.mp4`);
    await this._ff(['-i', joined, '-i', norm, '-filter_complex', `[0:v]ass='${path.basename(ass)}',scale=out_range=tv,format=yuv420p[v]`, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', String(P.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', total.toFixed(3), '-movflags', '+faststart', out], work);
    const thumb = path.join(outDir, `${basename}.jpg`); await this._ff(['-ss', (segs[1].start + 1.6).toFixed(2), '-i', out, '-frames:v', '1', '-q:v', '2', thumb]);
    const qa = await qaVideo(out, { width: W, height: H, fps, durationSec: total, targetLufs: lufs, runFn: this.runFn, visual: true });
    const manifest = { title: ep.title, preset: P.name, platform: P.platform, width: W, height: H, fps, loudnessLufs: lufs, durationSec: await probeDuration(out, this.runFn), files: { video: out, subtitles: srt, thumbnail: thumb, anchorAudio: anchor },
      tts: this.tts.name, transitions: used, segments: segs.map(s => ({ kind: s.kind, storyId: s.story?.id, assetId: s.story?.asset.id, layout: s.layout?.mode, start: +s.start.toFixed(3), duration: +s.duration.toFixed(3) })),
      sources: ep.sources, rights: ep.rights, music: m && { title: m.title, artist: m.artist, license: m.license }, subtitles: check, qa, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(outDir, `${basename}.json`), JSON.stringify(manifest, null, 2)); if (!process.env.MA_KEEP_WORK) fs.rmSync(work, { recursive: true, force: true });
    if (!qa.ok) { const e = new Error('QA failed: ' + qa.checks.filter(c => !c.ok).map(c => `${c.name}=${JSON.stringify(c.actual)}`).join(', ')); e.manifest = manifest; throw e; }
    return manifest;
  }
}
const fmt = s => { const ms = Math.round(s * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u || ''; } };
module.exports = { NewsVideoFactory, TRANSITIONS };

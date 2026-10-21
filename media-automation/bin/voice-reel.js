#!/usr/bin/env node
'use strict';
// Vertical comparison reel: same demo rendered with several voices, played back to back with a "VOICE n: <id>" label. Local ffmpeg only.
// Usage: node media-automation/bin/voice-reel.js <news2VoicesRoot> <demo=B> <out.mp4> [voices...]
const path = require('path'); const fs = require('fs'); const { execFileSync } = require('child_process');
const [root = '/workspace/ma-out/news2-voices', demo = 'B', out = path.join(root, `voice-reel-demo-${demo}.mp4`), ...vs] = process.argv.slice(2);
const voices = vs.length ? vs : ['am_michael', 'am_adam', 'am_fenrir']; const font = process.env.MA_REEL_FONT || 'Inter'; // fontconfig family name
const ins = voices.map(v => path.join(root, `demo-${demo}`, v, `demo-${demo}-${v}-shorts.mp4`)); ins.forEach(f => { if (!fs.existsSync(f)) throw new Error('missing ' + f); });
const lab = voices.map((v, i) => `[${i}:v]drawbox=x=0:y=ih*0.12:w=iw:h=ih*0.05:color=black@0.55:t=fill,drawtext=font='${font}':text='VOICE ${i + 1}/${voices.length}\\: ${v} (comparison)':fontcolor=0xF5C542:fontsize=h*0.026:x=(w-text_w)/2:y=h*0.12+(h*0.05-text_h)/2[v${i}]`).join(';');
const cat = voices.map((_, i) => `[v${i}][${i}:a]`).join('') + `concat=n=${voices.length}:v=1:a=1[v][a0];[a0]loudnorm=I=-16:TP=-1.5:LRA=11,volume=0.5dB,alimiter=limit=0.79:level=disabled,aresample=48000[a]`;
execFileSync('ffmpeg', ['-y', '-v', 'error', ...ins.flatMap(f => ['-i', f]), '-filter_complex', `${lab};${cat}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', out]);
console.log(out);

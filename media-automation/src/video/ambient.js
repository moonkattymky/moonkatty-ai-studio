'use strict';
const fs = require('fs');
const { run } = require('./exec');
/** Generate a self-made ambient pad (sine chord + slow tremolo + echo). Our own work -> CC0. Writes <out>.license.json. */
async function generateAmbientBed(outWav, { durationSec = 60, runFn = run } = {}) {
  const expr = '0.12*sin(2*PI*110*t)+0.09*sin(2*PI*164.81*t)+0.08*sin(2*PI*220*t)+0.05*sin(2*PI*277.18*t)';
  await runFn('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${durationSec}`,
    '-af', 'tremolo=f=0.15:d=0.5,aecho=0.8:0.7:400|900:0.3|0.2,lowpass=f=1800,afade=t=in:d=2,afade=t=out:st=' + (durationSec - 2) + ':d=2,volume=0.8', '-ac', '2', outWav]);
  const meta = { file: outWav, title: 'MOONKATTY Ambient Bed (generated)', artist: 'MOONKATTY AI STUDIO (procedural, ffmpeg)', license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false, generatedAt: new Date().toISOString() };
  fs.writeFileSync(outWav + '.license.json', JSON.stringify(meta, null, 2)); return meta;
}
module.exports = { generateAmbientBed };

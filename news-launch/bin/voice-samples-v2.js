#!/usr/bin/env node
'use strict';
/**
 * Local Kokoro samples for an owner listening pass.
 * Does not lock MasterVoice. Does not call a paid service. Does not publish.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KokoroTTS } = require('../../media-automation/src/video/tts');
const { run } = require('../../media-automation/src/video/exec');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'voice-samples-v2');
const MODEL = path.join(ROOT, 'models', 'kokoro', 'kokoro-v1.0.onnx');
const VOICES = path.join(ROOT, 'models', 'kokoro', 'voices-v1.0.bin');
const TEXT = fs.readFileSync(path.join(OUT, 'sample.txt'), 'utf8').trim();
const TARGET_LUFS = -16;
const VOICE_IDS = ['am_michael', 'am_adam', 'am_fenrir'];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function synthesize(voice, speed, outWav) {
  const tts = new KokoroTTS({ python: 'python3', model: MODEL, voices: VOICES, voice, speed, lang: 'en-us' });
  return tts.synthesize(TEXT, outWav);
}

async function probeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  return parseFloat(JSON.parse(stdout).format.duration);
}

/** Integrated LUFS and true peak from ffprobe's lavfi ebur128 metadata. */
async function probeLoudness(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-f', 'lavfi', '-i', `amovie=${file},ebur128=peak=true:metadata=1`,
    '-show_frames', '-show_entries', 'frame_tags=lavfi.r128.I,lavfi.r128.true_peaks_ch0',
    '-of', 'json',
  ]);
  const frames = JSON.parse(stdout).frames || [];
  let integrated = null;
  let truePeak = null;
  for (const frame of frames) {
    const tags = frame.tags || {};
    if (tags['lavfi.r128.I'] != null) integrated = parseFloat(tags['lavfi.r128.I']);
    if (tags['lavfi.r128.true_peaks_ch0'] != null) {
      const db = 20 * Math.log10(parseFloat(tags['lavfi.r128.true_peaks_ch0']));
      if (Number.isFinite(db)) truePeak = Math.max(truePeak == null ? -Infinity : truePeak, db);
    }
  }
  if (!Number.isFinite(integrated)) throw new Error(`ffprobe ebur128 missing integrated loudness for ${file}`);
  return { integratedLufs: +integrated.toFixed(1), truePeakDb: truePeak == null ? null : +truePeak.toFixed(1) };
}

async function loudnorm(input, output) {
  const ln = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `${ln}:print_format=json`, '-f', 'null', '-']);
  const meas = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', input, '-af',
    `${ln}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`,
    '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
}

async function toMp3(wav, mp3) {
  await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '1', mp3]);
}

/**
 * Higher Kokoro speed is a faster read. Voices already inside 25–32s get a
 * small lift toward 29s, capped at 1.08 so the copy stays intelligible.
 * A voice that is under 25s at speed 1 is slowed toward 27s.
 */
function speedFor(durationAtUnity) {
  if (durationAtUnity >= 25 && durationAtUnity <= 32) {
    const lifted = Math.min(1.08, Math.max(1, durationAtUnity / 29));
    return Math.round(lifted * 100) / 100;
  }
  const target = durationAtUnity > 32 ? 30 : 27;
  const speed = durationAtUnity / target;
  return Math.round(Math.min(1.25, Math.max(0.68, speed)) * 100) / 100;
}

async function renderVoice(voice) {
  const raw = path.join(OUT, `.${voice}.raw.wav`);
  const atUnity = await synthesize(voice, 1, raw);
  let speed = speedFor(atUnity.durationSec);
  let take = atUnity;
  if (speed !== 1) take = await synthesize(voice, speed, raw);
  let duration = take.durationSec;
  if (duration < 25 || duration > 35) {
    const target = duration < 25 ? 27 : 30;
    speed = Math.round(Math.min(1.3, Math.max(0.65, speed * (duration / target))) * 100) / 100;
    take = await synthesize(voice, speed, raw);
    duration = take.durationSec;
  }
  if (duration < 25 || duration > 35) throw new Error(`${voice} duration ${duration.toFixed(2)}s is outside 25–35s at speed ${speed}`);
  const wav = path.join(OUT, `kokoro-${voice}.wav`);
  const mp3 = path.join(OUT, `kokoro-${voice}.mp3`);
  await loudnorm(raw, wav);
  await toMp3(wav, mp3);
  fs.rmSync(raw, { force: true });
  const wavDur = await probeDuration(wav);
  const wavLoud = await probeLoudness(wav);
  let mp3Loud = await probeLoudness(mp3);
  if (Math.abs(mp3Loud.integratedLufs - TARGET_LUFS) > 0.4) {
    const gain = (TARGET_LUFS - mp3Loud.integratedLufs).toFixed(2);
    await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', wav, '-af', `volume=${gain}dB`, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '1', mp3]);
    mp3Loud = await probeLoudness(mp3);
  }
  const mp3Dur = await probeDuration(mp3);
  return {
    voice,
    speed,
    lang: 'en-us',
    wav: path.basename(wav),
    mp3: path.basename(mp3),
    wavDurationSec: +wavDur.toFixed(2),
    mp3DurationSec: +mp3Dur.toFixed(2),
    wavLufs: wavLoud.integratedLufs,
    wavTruePeakDb: wavLoud.truePeakDb,
    mp3Lufs: mp3Loud.integratedLufs,
    mp3TruePeakDb: mp3Loud.truePeakDb,
  };
}

function writeReport(rows) {
  const lines = [
    '# Voice samples v2',
    '',
    'Listening set only. No voice is approved. `MasterVoice` is not locked. These files are not a bulletin and they are not published.',
    '',
    'Engine: local Kokoro-82M through `media-automation/tools/kokoro_tts.py` (`kokoro-onnx`). No paid speech service.',
    '',
    'The three files speak the same English text. The only per-voice control is Kokoro `speed` (higher is a faster read). This bridge does not expose pitch.',
    '',
    '## Exact text',
    '',
    '```',
    TEXT,
    '```',
    '',
    'The news paragraph is example copy. It names no real incident. The sign-off is one light joke on the house line, 9 Lives. One Moon.',
    '',
    '## Parameters',
    '',
    '| Voice | Lang | Speed | WAV | MP3 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(r => `| \`${r.voice}\` | ${r.lang} | ${r.speed.toFixed(2)} | \`${r.wav}\` | \`${r.mp3}\` |`),
    '',
    'Shared settings: `lang=en-us`. Two-pass ffmpeg `loudnorm=I=-16:TP=-1.5:LRA=11:linear=true`. Output is 48 kHz mono PCM WAV, then 192 kbps mono MP3 (`libmp3lame`) from that WAV.',
    '',
    '## Measurements',
    '',
    'Duration is `ffprobe -show_entries format=duration`. Loudness is `ffprobe` lavfi `ebur128=peak=true` (`lavfi.r128.I`, true peak from `lavfi.r128.true_peaks_ch0`).',
    '',
    '| File | Duration | Integrated loudness | True peak |',
    '| --- | --- | --- | --- |',
    ...rows.flatMap(r => [
      `| \`${r.wav}\` | ${r.wavDurationSec.toFixed(2)} s | ${r.wavLufs.toFixed(1)} LUFS | ${r.wavTruePeakDb.toFixed(1)} dBFS |`,
      `| \`${r.mp3}\` | ${r.mp3DurationSec.toFixed(2)} s | ${r.mp3Lufs.toFixed(1)} LUFS | ${r.mp3TruePeakDb.toFixed(1)} dBFS |`,
    ]),
    '',
    `Target loudness is ${TARGET_LUFS} LUFS. WAV true peak is held at or under −1.5 dBTP by the loudnorm limiter.`,
    '',
    '## Licenses',
    '',
    `- Model weights: Kokoro-82M v1.0, Apache-2.0. https://huggingface.co/hexgrad/Kokoro-82M`,
    `- Local file \`news-launch/models/kokoro/kokoro-v1.0.onnx\` sha256 \`${sha256(MODEL)}\`. Gitignored. Not a paid download.`,
    `- Voice pack \`voices-v1.0.bin\` sha256 \`${sha256(VOICES)}\`. Ids used: \`am_michael\`, \`am_adam\`, \`am_fenrir\`.`,
    '- Phonemizer: espeak-ng (GPL-3.0) on this machine. The binary is not committed. The WAV and MP3 are synthesized audio, not a copy of espeak-ng.',
    '- Training-card notes for the CC BY audio inside Kokoro v1.0 (Koniwa `tnc`, SIWIS) are in `news-launch/VOICE_REPORT.md`. This sample set does not lock a commercial voice.',
    '',
    '## Wordmark',
    '',
    'A temporary text logo, not final and with no character, is in `news-launch/branding/temp/`.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'SAMPLES.md'), lines.join('\n'));
}

async function main() {
  if (!fs.existsSync(MODEL) || !fs.existsSync(VOICES)) throw new Error('local Kokoro files missing');
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const voice of VOICE_IDS) {
    process.stderr.write(`render ${voice}\n`);
    rows.push(await renderVoice(voice));
    process.stderr.write(JSON.stringify(rows[rows.length - 1]) + '\n');
  }
  writeReport(rows);
  const locked = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'media-automation', 'config', 'master-voice.json'), 'utf8'));
  if (locked.status !== 'candidate' || locked.lockedBy) throw new Error('master voice status changed during sampling');
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });

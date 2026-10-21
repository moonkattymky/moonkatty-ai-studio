'use strict';
/**
 * Emotion Engine. One voice across all modes; modes change only prosody that Kokoro-82M actually exposes or that
 * we can post-process: speed (native), inter-sentence/comma pauses (we synthesize per sentence and insert silence),
 * pitch (ffmpeg asetrate+atempo post-shift, small, preserves duration), energy (gain dB). Kokoro has NO emotion/style
 * control token; perceived emotion comes mostly from text + pacing. See docs/media-automation/EMOTION_ENGINE.md.
 */
const { classifyTopic } = require('./humor');
const MODES = {
  SERIOUS:    { speed: 0.92, sentencePauseMs: 480, commaPauseMs: 180, pitchSemitones: -0.5, gainDb: -1, smile: 0.0, blinkRate: 0.20, gesture: 'none' },
  NEUTRAL:    { speed: 1.00, sentencePauseMs: 360, commaPauseMs: 140, pitchSemitones: 0,    gainDb: 0,  smile: 0.2, blinkRate: 0.30, gesture: 'rest' },
  EXCITED:    { speed: 1.10, sentencePauseMs: 240, commaPauseMs: 90,  pitchSemitones: 0.8,  gainDb: 1.5, smile: 0.8, blinkRate: 0.40, gesture: 'paws_open' },
  CURIOUS:    { speed: 0.98, sentencePauseMs: 420, commaPauseMs: 160, pitchSemitones: 0.4,  gainDb: 0,  smile: 0.4, blinkRate: 0.35, gesture: 'head_tilt' },
  PLAYFUL:    { speed: 1.06, sentencePauseMs: 300, commaPauseMs: 110, pitchSemitones: 0.6,  gainDb: 1,  smile: 0.9, blinkRate: 0.45, gesture: 'paw_wave' },
  WITTY:      { speed: 1.02, sentencePauseMs: 520, commaPauseMs: 140, pitchSemitones: 0.2,  gainDb: 0.5, smile: 0.6, blinkRate: 0.30, gesture: 'ear_flick', punchlinePauseMs: 650 },
  EMPATHETIC: { speed: 0.90, sentencePauseMs: 520, commaPauseMs: 200, pitchSemitones: -0.3, gainDb: -1.5, smile: 0.1, blinkRate: 0.25, gesture: 'paws_together' },
};
const NAMES = Object.keys(MODES);
/** Choose mode for a story. Rules: breaking -> SERIOUS; denied (tragic) topic -> EMPATHETIC/SERIOUS; humor tag -> WITTY/PLAYFUL. */
function selectEmotion(story = {}, opts = {}) {
  const fmt = story.format || opts.format; const text = `${story.title || ''} ${story.text || ''}`;
  const topic = classifyTopic(text);
  if (story.emotion && NAMES.includes(story.emotion)) {
    // explicit override cannot make a tragic or breaking story light
    const light = ['EXCITED', 'PLAYFUL', 'WITTY'].includes(story.emotion);
    if (!(light && (fmt === 'breaking' || topic.denied.length))) return story.emotion;
  }
  if (fmt === 'breaking') return 'SERIOUS';
  if (topic.denied.length) return /victim|died|dead|death|killed|injured|survivor|toll/i.test(text) ? 'EMPATHETIC' : 'SERIOUS';
  if (story.humorTag) return fmt === 'shorts' ? 'PLAYFUL' : 'WITTY';
  if (/\b(record|first ever|breakthrough|launch(es|ed)?|unveil\w*|wins?)\b/i.test(text)) return 'EXCITED';
  if (/\?|\b(mystery|why|how|puzzl\w*|unknown|scientists (are )?(asking|wonder))\b/i.test(text)) return 'CURIOUS';
  return 'NEUTRAL';
}
function prosody(mode) { const m = MODES[mode]; if (!m) throw new Error(`unknown emotion mode ${mode}`); return { mode, ...m }; }
/** ffmpeg filter for pitch shift without duration change (base sample rate sr). */
function pitchFilter(semitones, sr = 24000) {
  if (!semitones) return null; const f = Math.pow(2, semitones / 12);
  return `asetrate=${Math.round(sr * f)},aresample=${sr},atempo=${(1 / f).toFixed(5)}`;
}
module.exports = { MODES, NAMES, selectEmotion, prosody, pitchFilter };

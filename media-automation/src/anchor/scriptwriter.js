'use strict';
/**
 * AnchorScriptWriter: charismatic cat-anchor scripts from verified source text via a LOCAL LLM (Ollama), with a strict
 * fact-preservation gate (strictFactCheck: numbers, number words, dates, relative dates, names). Rejected drafts are retried with
 * the rejection list as feedback; after maxAttempts the deterministic source-text script is used. Humor is NOT written by the LLM
 * into the body: an optional tag is proposed separately and must pass humorSafetyCheck (topic deny/allow + no new facts).
 * Output: { lines:[{text, emotion, role:'hook'|'body'|'tag'|'signoff'}], spoken, provider, attempts, rejections }
 */
const { strictFactCheck } = require('../llm/factcheck'); const { humorSafetyCheck, classifyTopic } = require('./humor');
const SYSTEM = `You write spoken scripts for MOONKATTY NEWS, presented by Katty, a charismatic, warm, quick-witted cat news anchor.
HARD RULES: Use ONLY facts in SOURCE. Never add numbers, dates, names, places, organisations, quotes or claims that are not in SOURCE.
Do not mention when something happened unless SOURCE says it. Do not speculate. Natural spoken American English, short sentences (max 18 words),
varied rhythm, vivid but accurate verbs. Write for the ear: contractions, smooth transitions ("Here's the thing", "And", "Now"), complete grammatical sentences, use articles ("an extratropical cyclone"). No hashtags, no emojis, no stage directions, no markdown.
You ARE Katty: never say your own name and never address yourself; address viewers as "friends" at most once. Credit every finding to the mission, agency or researchers in SOURCE — never "we" or "us" for research. Do not repeat the same fact twice. No sign-off and no "stay tuned" (added separately). Do not say "now" or "currently" about events — SOURCE gives no timing.`;
const MODE_HINT = {
  SERIOUS: 'Tone: calm, serious, respectful. NO jokes, no puns, no playful words.',
  WITTY: 'Tone: upbeat, light and friendly. You may be playful in wording, but facts stay exact. Do NOT write a joke; one is added separately.',
  CURIOUS: 'Tone: curious and full of wonder. Use one rhetorical question. No jokes.',
  NEUTRAL: 'Tone: friendly and clear.', EXCITED: 'Tone: energetic.', PLAYFUL: 'Tone: playful but factual.', EMPATHETIC: 'Tone: gentle and caring. No jokes.',
};
const SIGNOFF = { SERIOUS: 'Stay safe, and stay curious. This is MOONKATTY NEWS.', WITTY: 'That’s your tech treat for today. Stay curious, friends.', CURIOUS: 'The Sun still has secrets. We will keep watching. Stay curious.' };
function parseJson(t) { const m = String(t).match(/\{[\s\S]*\}/); if (!m) throw new Error('no JSON in LLM output'); return JSON.parse(m[0]); }
class AnchorScriptWriter {
  constructor({ llm = null, maxAttempts = 6, maxBodyWords = 70 } = {}) { Object.assign(this, { llm, maxAttempts, maxBodyWords }); }
  /** Second LLM pass as a strict verifier: lists claims in the draft not stated in SOURCE (style/tone words are fine). */
  async _judge(src, draft) {
    const prompt = `SOURCE:\n${src}\n\nSCRIPT:\n${draft}\n\nList only claims in SCRIPT that ADD information beyond SOURCE (new effects, causes, impacts, locations, times, quantities, consequences, opinions presented as fact). The SOURCE headline counts as SOURCE. Paraphrases and vivid rewording of SOURCE facts are SUPPORTED. Ignore greetings, sign-offs, tone and rhetorical questions. Answer JSON: {"unsupported_claims": ["..."]} and use an empty list if everything is supported.`;
    try { const { text } = await this.llm.generate({ system: 'You are a meticulous fact-checker. Be strict.', prompt, json: true, temperature: 0, maxTokens: 200 });
      const srcW = new Set(src.toLowerCase().match(/[a-z]{4,}/g) || []); const STOPW = new Set('this that with from have into their there about which what when will been were more than they them your just like'.split(' '));
      // paraphrase filter: a "claim" whose content words are >= 75% present in SOURCE is a rewording, not new information
      return [].concat(parseJson(text).unsupported_claims || []).map(String).filter(x => x.trim()).filter(c => { const w = (c.toLowerCase().match(/[a-z]{4,}/g) || []).filter(x => !STOPW.has(x)); if (!w.length) return false;
        const stem = x => x.replace(/(ing|ed|es|s)$/, ''); const hit = w.filter(x => srcW.has(x) || [...srcW].some(y => stem(y) === stem(x))).length; return hit / w.length < 0.75; }); } catch (e) { return [`verifier error: ${e.message}`]; }
  }
  async write({ story, emotion, sources, jokeCandidates = [], format = 'daily_briefing' }) {
    const srcTexts = [story.headline, ...sources.map(s => `${s.sourceName}: ${s.title}. ${s.summary || ''}`)]; const src = srcTexts.join('\n');
    const rejections = []; let draft = null; let attempts = 0;
    if (this.llm) {
      for (attempts = 1; attempts <= this.maxAttempts; attempts++) {
        const fb = rejections.length ? `\nYour previous draft was REJECTED because it contained facts not in SOURCE: ${rejections[rejections.length - 1].unsupported.map(u => u.value).join(', ')}. Remove them.` : '';
        const prompt = `SOURCE (${sources.map(s => s.sourceName).join(', ')}):\n${src}\n\n${MODE_HINT[emotion] || ''}\nWrite JSON: {"hook": "one punchy opening line that pulls the viewer in", "body": ["3 to 5 short spoken sentences covering the facts in SOURCE, with a natural transition word between ideas"], "accent": "the single most striking phrase copied from body, for emphasis"}. Mention the source organisation (${sources[0].sourceName}) once.${fb}`;
        try { const { text } = await this.llm.generate({ system: SYSTEM, prompt, json: true, temperature: 0.6, maxTokens: 360, seed: 42 + attempts * 7 }); // new seed per retry
          const j = parseJson(text); const body = [].concat(j.body || []).map(String).map(x => x.trim()).filter(Boolean); const hook = String(j.hook || '').trim();
          if (!hook || body.length < 2) throw new Error('incomplete draft');
          const all = [hook, ...body].join(' '); if (all.split(/\s+/).length > this.maxBodyWords + 20) throw new Error('draft too long');
          const chk = strictFactCheck(all, srcTexts); if (!chk.ok) { rejections.push({ attempt: attempts, draft: all, unsupported: chk.unsupported }); continue; }
          const srcWords = new Set(src.toLowerCase().match(/[a-z]{4,}/g) || []); const st = x => x.replace(/(ing|ed|es|s|ly)$/, '');
          const srcStems = new Set([...srcWords].map(st)); const SKIP = new Set('this that with from have into their there about which what when will been were more than they them your just like these those its it\'s'.split(' '));
          const novel = body.find(b => { const w = (b.toLowerCase().match(/[a-z]{4,}/g) || []).filter(x => !SKIP.has(x)); return w.length >= 3 && w.filter(x => srcStems.has(st(x))).length / w.length < 0.4; });
          const dup = body.some(b => b.toLowerCase() === hook.toLowerCase()) || new Set(body.map(b => b.toLowerCase())).size < body.length;
          if (novel || dup) { rejections.push({ attempt: attempts, draft: all, unsupported: [{ type: novel ? 'novel-content' : 'duplicate', value: novel || 'repeated sentence' }] }); continue; }
          const voiceIssue = /\bKatty\b/i.test(all) ? 'anchor names itself' : /\b(we|we've|we have|our team|us)\b[^.?!]*\b(trac|discover|found|find|measur|detect|stud|analy|develop)/i.test(all) ? 'research credited to "we"' : null;
          if (voiceIssue) { rejections.push({ attempt: attempts, draft: all, unsupported: [{ type: 'attribution', value: voiceIssue }] }); continue; }
          if (emotion === 'SERIOUS' && /\b(purr|paws?|meow|fun|funny|lol|haha|whisker)/i.test(all)) { rejections.push({ attempt: attempts, draft: all, unsupported: [{ type: 'tone', value: 'playful word in SERIOUS' }] }); continue; }
          if (hook.split(/\s+/).length > 16 || !/[.!?]$/.test(hook) || /[.!?]\s+\S/.test(hook)) { rejections.push({ attempt: attempts, draft: all, unsupported: [{ type: 'style', value: 'hook too long' }] }); continue; }
          const claims = await this._judge(src, body.join(' ')); // hook = rhetorical opener: token-checked above, not claim-judged if (claims.length) { rejections.push({ attempt: attempts, draft: all, unsupported: claims.map(c => ({ type: 'claim', value: c })) }); continue; }
          draft = { hook, body, accent: String(j.accent || '') }; break;
        } catch (e) { rejections.push({ attempt: attempts, error: e.message }); }
      }
    }
    const provider = draft ? this.llm.name : 'local-deterministic';
    if (!draft) { const sents = String(story.summary).split(/(?<=[.!?])\s+/); draft = { hook: `Here is the latest from ${sources[0].sourceName}.`, body: sents.slice(0, 3), accent: '' }; }
    const lines = [{ role: 'hook', text: draft.hook, emotion: emotion === 'WITTY' ? 'EXCITED' : emotion }, ...draft.body.map((t, i) => ({ role: 'body', text: t, emotion: i === draft.body.length - 1 && emotion === 'CURIOUS' ? 'CURIOUS' : emotion === 'WITTY' ? 'NEUTRAL' : emotion }))];
    let tag = null; const humorLog = [];
    if (classifyTopic(`${story.headline} ${story.summary}`).humorAllowed && format !== 'breaking' && emotion === 'WITTY')
      for (const j of jokeCandidates) { const r = humorSafetyCheck({ title: story.headline, text: draft.body.join(' '), format }, j); humorLog.push({ joke: j, ok: r.ok, reasons: r.reasons }); if (r.ok) { tag = j; break; } }
    if (tag) lines.push({ role: 'tag', text: tag, emotion: 'WITTY' });
    lines.push({ role: 'signoff', text: SIGNOFF[emotion] || 'Stay curious. This is MOONKATTY NEWS.', emotion: emotion === 'SERIOUS' ? 'SERIOUS' : 'NEUTRAL' });
    const final = strictFactCheck(lines.filter(l => l.role !== 'tag' && l.role !== 'signoff').map(l => l.text).join(' '), srcTexts);
    if (!final.ok) throw new Error('script failed final fact check: ' + JSON.stringify(final.unsupported));
    return { lines, spoken: lines.map(l => l.text).join(' '), provider, attempts, rejections, humorLog, humorTag: tag, factCheck: final, sources: sources.map(s => ({ name: s.sourceName, url: s.link, published: s.published })) };
  }
}
module.exports = { AnchorScriptWriter, SYSTEM };

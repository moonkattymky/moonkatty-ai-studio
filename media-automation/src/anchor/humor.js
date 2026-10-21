'use strict';
/** Humor Engine: topic classifier (deny-list wins over allow-list) + separate humor-safety check. Never edits facts. */
const DENY = {
  death: /\b(dead|death|deaths|died|dies|dying|killed|kills?|fatal(ity|ities)?|obituar\w*|funeral|corpse|bod(y|ies) (found|recovered)|suicide|passed away)\b/i,
  war: /\b(war|wars|warfare|invasion|invade[ds]?|airstrikes?|missiles?|shelling|troops|military offensive|battlefield|ceasefire|hostages?|bombing|bombed)\b/i,
  terror: /\b(terror\w*|extremis\w*|jihad\w*|mass shooting|gunman|shooter|hostage)\b/i,
  epidemic: /\b(epidemic|pandemic|outbreak|virus spread|cholera|ebola|covid|measles|plague|infections? (rise|surge))\b/i,
  disaster_victims: /\b(earthquake|tsunami|hurricane|typhoon|cyclone|flood(s|ing)?|wildfire|landslide|avalanche|crash(ed)?|derail\w*|collapse[ds]?|explosion)\b.*\b(victims?|dead|injured|missing|casualt\w*|killed|toll|survivors?)\b|\b(victims?|casualt\w*|death toll)\b/i,
  crime_people: /\b(murder\w*|homicide|rape\w*|sexual assault|abuse[ds]?|assault\w*|stabb\w*|shot|kidnap\w*|trafficking|child (abuse|exploitation)|domestic violence|hate crime)\b/i,
};
const ALLOW = {
  science: /\b(scientists?|research(ers)?|study|discover\w*|physics|biology)\b/i,
  space: /\b(space|nasa|esa|rocket|mars|moon|planet|asteroid|telescope|orbit|astronaut|satellite)\b/i,
  tech: /\b(robot\w*|ai|software|app|gadget|smartphone|computer|chip|startup|internet)\b/i,
  animals: /\b(cat|cats|dog|dogs|panda|penguin|zoo|animal|wildlife|bird)\b/i,
  culture: /\b(festival|movie|film|music|art|museum|game|gaming|sport|record)\b/i,
  food: /\b(coffee|pizza|food|chef|recipe|chocolate)\b/i,
  weather_mild: /\b(sunny|heatwave ends|first snow|rainbow)\b/i,
};
function classifyTopic(text) {
  const t = String(text || '');
  const denied = Object.entries(DENY).filter(([, r]) => r.test(t)).map(([k]) => k);
  const allowed = Object.entries(ALLOW).filter(([, r]) => r.test(t)).map(([k]) => k);
  return { denied, allowed, humorAllowed: denied.length === 0 && allowed.length > 0 };
}
const JOKE_DENY = /\b(stupid|idiot|ugly|fat|retard\w*|kill|die|dead|bomb|terror\w*|hate|religion|muslim|christian|jew\w*|hindu|race|racist|gay|immigrant\w*|women are|men are)\b/i;
/**
 * Separate humor-safety gate. Inputs: story {text, facts?:string[], format}, joke string, ctx {jokesSoFar, storiesSinceJoke}.
 * Returns {ok, reasons[]}. Joke must be short, must not contain numbers/names absent from story (no new facts), must not restate facts differently.
 */
function humorSafetyCheck(story, joke, ctx = {}, policy = {}) {
  const p = { maxJokeWords: 22, maxJokesPerBriefing: 2, minStoriesBetweenJokes: 2, ...policy };
  const reasons = []; const j = String(joke || '').trim();
  if (!j) return { ok: false, reasons: ['empty joke'] };
  if (story.format === 'breaking') reasons.push('format breaking: no humor');
  const topic = classifyTopic(`${story.title || ''} ${story.text || ''}`);
  if (topic.denied.length) reasons.push(`denied topic: ${topic.denied.join(',')}`);
  if (!topic.allowed.length) reasons.push('topic not on allow-list');
  if (classifyTopic(j).denied.length || JOKE_DENY.test(j)) reasons.push('joke contains unsafe language');
  if (j.split(/\s+/).length > p.maxJokeWords) reasons.push('joke too long');
  const src = `${story.title || ''} ${story.text || ''}`;
  const nums = j.match(/\d[\d.,%]*/g) || [];
  if (nums.some(n => !src.includes(n))) reasons.push('joke introduces numbers not in story (alters facts)');
  const names = (j.match(/(?<!^|[.!?]\s)\b[A-Z][a-z]{2,}\b/g) || []).filter(n => !src.includes(n));
  if (names.length) reasons.push(`joke introduces names not in story: ${names.join(',')}`);
  if ((ctx.jokesSoFar || 0) >= p.maxJokesPerBriefing) reasons.push('joke budget exhausted');
  if (ctx.storiesSinceJoke !== undefined && ctx.storiesSinceJoke < p.minStoriesBetweenJokes) reasons.push('too soon after previous joke');
  return { ok: reasons.length === 0, reasons, topic };
}
/** Apply jokes to a script: story.text is never modified; approved joke goes to story.humorTag. */
function applyHumor(stories, jokes, format, policy) {
  let jokesSoFar = 0, since = Infinity; const log = [];
  const out = stories.map((s, i) => {
    const joke = jokes[i]; const st = { ...s, format: s.format || format };
    if (!joke) { since++; return st; }
    const r = humorSafetyCheck(st, joke, { jokesSoFar, storiesSinceJoke: since === Infinity ? 99 : since }, policy);
    log.push({ index: i, joke, ...r, topic: undefined });
    if (r.ok) { jokesSoFar++; since = 0; return { ...st, humorTag: joke }; }
    since++; return st;
  });
  return { stories: out, log };
}
module.exports = { classifyTopic, humorSafetyCheck, applyHumor, DENY, ALLOW };

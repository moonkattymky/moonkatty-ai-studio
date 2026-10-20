'use strict';
const { assertSchema, SCHEMAS } = require('./schemas');
const { chatJson, listModels, chooseModel } = require('./ollama');

const ALLOW = new Set(('moonkatty news this that with from have been were said says after will into over under about their there they them your more most some other than then also just report reports reported according edition sources listed waiting approval published three world stories each checked against least independent these accounts come named corroborated the and both not has for are was is').split(' '));

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}
function shortHeading(story) {
  const names = story.sources.slice(0, 2).map(s => {
    const parts = String(s.publisher || '').split(/\s+/).filter(w => w && !/^(the|a|an)$/i.test(w));
    return (parts[0] || s.org || 'Source').slice(0, 14);
  });
  return names.join(' · ').slice(0, 28);
}
function longLine(story) {
  const [a, b] = story.sources;
  return clean(`${a.publisher} reports: ${a.title}. ${b.publisher} reports: ${b.title}.`);
}
function shortLine(story) {
  const [a, b] = story.sources;
  return clean(`${a.publisher} reports: ${a.title}. Corroborated by ${b.publisher}.`);
}

const BOILER = {
  longIntro: 'This is MOONKATTY NEWS. Three world stories, each checked against at least two independent sources.',
  shortIntro: 'This is MOONKATTY NEWS.',
  longOutro: 'These accounts come from the sources named in this edition. This edition is waiting for approval and has not been published.',
  shortOutro: 'This edition is waiting for approval and has not been published.',
};

function assemble(stories, { intro, outro, line }) {
  const scenes = [
    { id: 'intro', kind: 'intro', heading: 'MOONKATTY NEWS', text: intro },
    ...stories.map(story => ({
      id: story.storyId, kind: 'story', storyId: story.storyId, heading: shortHeading(story), text: line(story),
    })),
    { id: 'outro', kind: 'outro', heading: 'Sources', text: outro },
  ];
  return { title: 'MOONKATTY NEWS', lang: 'en', scenes };
}

function extractiveVariants(stories) {
  return [
    assemble(stories, { intro: BOILER.longIntro, outro: BOILER.longOutro, line: longLine }),
    assemble(stories, { intro: BOILER.longIntro, outro: BOILER.shortOutro, line: longLine }),
    assemble(stories, { intro: BOILER.shortIntro, outro: BOILER.shortOutro, line: longLine }),
    assemble(stories, { intro: BOILER.longIntro, outro: BOILER.shortOutro, line: shortLine }),
    assemble(stories, { intro: BOILER.shortIntro, outro: BOILER.shortOutro, line: shortLine }),
  ];
}

function sourceBlob(stories) {
  return stories.map(st => st.sources.map(s => [s.title, s.summary, s.publisher, s.org, s.url].join(' ')).join(' ')).join(' ').toLowerCase();
}

function groundingProblems(script, stories) {
  const blob = sourceBlob(stories);
  const problems = [];
  for (const sc of script.scenes) {
    if (sc.kind !== 'story') continue;
    for (const n of sc.text.match(/\d[\d,.]*/g) || []) {
      const norm = n.replace(/[.,]/g, '');
      if (!blob.includes(n.toLowerCase()) && !blob.includes(norm)) problems.push(`number ${n} not in sources`);
    }
    for (const w of (sc.text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) || [])) {
      const bare = w.replace(/'/g, '');
      if (ALLOW.has(bare)) continue;
      if (!blob.includes(bare)) problems.push(`word "${bare}" not in sources`);
    }
  }
  return problems;
}

function assertGrounded(script, stories) {
  const problems = groundingProblems(script, stories);
  if (problems.length) {
    const err = new Error('script failed grounding check: ' + problems.slice(0, 6).join('; '));
    err.problems = problems;
    throw err;
  }
  return script;
}

function promptFor(stories) {
  const blocks = stories.map(s => {
    const lines = s.sources.map(src => `PUBLISHER: ${src.publisher}\nURL: ${src.url}\nTITLE: ${src.title}\nEXCERPT: ${src.summary || '(no excerpt)'}`).join('\n');
    return `STORY ${s.storyId}\n${lines}`;
  }).join('\n\n');
  return `You write a short English news script for MOONKATTY NEWS.
Use ONLY words and numbers that appear in the titles, excerpts, or publisher names below.
Do not add causes, quotes, ages, places, or figures that are not written there.
For each story output one sentence pair that copies the headlines and names both publishers.
Reply with JSON only: {"scenes":[{"storyId":"...","text":"..."}]}
One scene per story, in the same order. No intro, no outro.

${blocks}`;
}

async function maybeOllama(stories, { baseUrl, fetchFn, prefer }) {
  const names = await listModels(baseUrl, fetchFn);
  const model = chooseModel(names, prefer || 'qwen3:8b');
  if (!model) throw new Error('Ollama has no models');
  const drafted = await chatJson({ baseUrl, model, fetchFn, prompt: promptFor(stories) });
  const byId = new Map((drafted.scenes || []).map(s => [s.storyId, clean(s.text)]));
  if (stories.some(s => !byId.get(s.storyId))) throw new Error('Ollama omitted a story');
  const script = assemble(stories, {
    intro: BOILER.longIntro,
    outro: BOILER.shortOutro,
    line: s => byId.get(s.storyId),
  });
  assertGrounded(script, stories);
  script.llm = { mode: 'ollama', model, adapter: null, reason: null };
  return script;
}

function withLlm(script, llm) {
  script.llm = llm;
  return assertSchema(script, SCHEMAS.script, 'NewsScript');
}

/**
 * Prefer a loopback Ollama model (qwen3:8b when it is installed).
 * If Ollama is down, or its script fails the grounding check, use the extractive adapter.
 * The adapter copies headlines. It does not invent facts. It is labeled temporary.
 */
async function writeScript(stories, opts = {}) {
  if (!opts.skipOllama && opts.ollamaUrl) {
    try {
      return assertSchema(await maybeOllama(stories, { baseUrl: opts.ollamaUrl, fetchFn: opts.fetchFn, prefer: opts.prefer }), SCHEMAS.script, 'NewsScript');
    } catch (e) {
      const fallback = extractiveVariants(stories)[0];
      assertGrounded(fallback, stories);
      return withLlm(fallback, {
        mode: 'temporary-adapter',
        model: null,
        adapter: 'TEMPORARY_ADAPTER:extractive-headlines',
        reason: e.message,
      });
    }
  }
  const script = extractiveVariants(stories)[0];
  assertGrounded(script, stories);
  return withLlm(script, {
    mode: 'temporary-adapter',
    model: null,
    adapter: 'TEMPORARY_ADAPTER:extractive-headlines',
    reason: opts.skipOllama ? 'Ollama skipped' : 'Ollama URL not configured',
  });
}

module.exports = {
  writeScript, extractiveVariants, assertGrounded, groundingProblems, longLine, shortLine, BOILER, assemble,
};

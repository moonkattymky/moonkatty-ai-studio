'use strict';

/**
 * Corrected bulletin. Written by the news-launch editor from primary statements.
 * Ollama was not running on the render machine. This is not the extractive adapter.
 * On-screen text stays in normal spelling. Phonetic hints are applied only at TTS time.
 */
const SCRIPT = {
  title: 'MOONKATTY NEWS',
  lang: 'en',
  llm: {
    mode: 'editor',
    model: null,
    adapter: null,
    reason: 'Written by the news-launch editor from the primary statements in news-launch/artifacts/test-episode/FACTCHECK.md. Ollama was not used. This is not TEMPORARY_ADAPTER:extractive-headlines.',
  },
  scenes: [
    {
      id: 'intro',
      kind: 'intro',
      heading: 'MOONKATTY NEWS',
      text: 'This is MOONKATTY NEWS.',
    },
    {
      id: 'alberta',
      kind: 'story',
      storyId: 'alberta-referendum-2026-10-19',
      heading: 'Alberta',
      text: 'On October nineteenth, Elections Alberta held a referendum. Question ten: remain in Canada, or start the legal process for a separation vote. Official results are due October twenty-ninth. No winner is called.',
    },
    {
      id: 'ebola',
      kind: 'story',
      storyId: 'nigeria-ebola-2026-10-20',
      heading: 'Abuja',
      text: 'Nigeria\'s health ministry confirmed one Ebola case in the FCT on October twentieth. A woman from Uganda is in isolation. Officials list forty-four close contacts. Minister Muhammad Ali Pate issued the statement.',
    },
    {
      id: 'jets',
      kind: 'story',
      storyId: 'uk-saudi-typhoon-2026-10-20',
      heading: 'Saudi Arabia',
      text: 'Britain\'s Defence Ministry says Typhoon jets will defend Saudi cities and will not conduct offensive strikes against the Houthis. Wes Streeting approved that on October twentieth.',
    },
    {
      id: 'outro',
      kind: 'outro',
      heading: 'Sources',
      text: 'Sources are official statements. This edition awaits approval and is not published.',
    },
  ],
};

const SAMPLE_TEXT = 'This is MOONKATTY NEWS. Nigeria\'s health ministry confirmed one Ebola case in Abuja on October twentieth. A woman who flew in from Uganda is in isolation. Officials list forty-four close contacts. Minister Muhammad Ali Pate issued the statement.';

function editorialScript() {
  return JSON.parse(JSON.stringify(SCRIPT));
}

module.exports = { editorialScript, SAMPLE_TEXT, SCRIPT };

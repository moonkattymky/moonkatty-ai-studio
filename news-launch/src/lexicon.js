'use strict';

/**
 * Spoken forms for the corrected bulletin. The on-screen script and the SRT
 * keep the written spelling. Only the text sent to TTS is rewritten.
 * Longer keys are applied first.
 */
const LEXICON = [
  ['Muhammad Ali Pate', 'Moo-hah-mud Ah-lee Pah-tay'],
  ['Wes Streeting', 'Wes Street-ing'],
  ['King Khalid', 'King Kuh-leed'],
  ['Houthis', 'Hoo-theez'],
  ['Houthi', 'Hoo-thee'],
  ['Typhoon', 'Ty-foon'],
  ['Riyadh', 'Ree-yahd'],
  ['Alberta', 'Al-ber-tuh'],
  ['Abuja', 'Ah-boo-jah'],
  ['Ebola', 'Ee-boh-lah'],
  ['Uganda', 'Yoo-gan-duh'],
  ['Saudi', 'Saw-dee'],
  ['NCDC', 'N C D C'],
  ['FCT', 'F C T'],
  ['A400M', 'A four hundred M'],
];

function applyLexicon(text, lexicon = LEXICON) {
  let out = String(text);
  const ordered = lexicon.slice().sort((a, b) => b[0].length - a[0].length);
  for (const [word, spoken] of ordered) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, spoken);
  }
  return out;
}

module.exports = { LEXICON, applyLexicon };

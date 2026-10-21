'use strict';
const CATEGORIES = ['politics', 'economy', 'tech', 'science', 'space', 'sports', 'entertainment'];
const KW = {
  politics: ['election', 'president', 'parliament', 'minister', 'government', 'senate', 'congress', 'vote', 'policy', 'diplomat', 'sanction', 'treaty', 'prime minister', 'law'],
  economy: ['economy', 'inflation', 'market', 'stocks', 'gdp', 'bank', 'interest rate', 'trade', 'tariff', 'oil price', 'jobs', 'unemployment', 'earnings', 'recession'],
  tech: ['ai', 'artificial intelligence', 'software', 'smartphone', 'apple', 'google', 'microsoft', 'chip', 'startup', 'cyber', 'app', 'robot', 'semiconductor'],
  science: ['study', 'researchers', 'scientists', 'climate', 'vaccine', 'species', 'physics', 'biology', 'medical', 'discovery', 'disease'],
  space: ['nasa', 'esa', 'spacex', 'rocket', 'orbit', 'mars', 'moon', 'asteroid', 'satellite', 'telescope', 'astronaut', 'launch pad', 'galaxy'],
  sports: ['football', 'soccer', 'nba', 'tennis', 'olympic', 'match', 'championship', 'league', 'cup', 'goal', 'tournament', 'coach'],
  entertainment: ['film', 'movie', 'music', 'album', 'celebrity', 'netflix', 'series', 'oscar', 'concert', 'box office', 'actor', 'singer'],
};
const BREAKING = ['breaking', 'just in', 'urgent', 'developing'];
const CONTROVERSIAL = ['war', 'attack', 'killed', 'terror', 'protest', 'scandal', 'allegation', 'abortion', 'shooting', 'riot', 'coup', 'genocide', 'accused'];
const has = (t, w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i').test(t);
function categorize(text) {
  let best = 'other', score = 0;
  for (const c of CATEGORIES) { const s = KW[c].filter(w => has(text, w)).length; if (s > score) { score = s; best = c; } }
  return best;
}
const isBreaking = t => BREAKING.some(w => has(t, w));
const isControversial = t => CONTROVERSIAL.some(w => has(t, w));
module.exports = { CATEGORIES, categorize, isBreaking, isControversial };

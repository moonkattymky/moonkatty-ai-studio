'use strict';

/**
 * Reputable feeds actually reachable from this environment (probed 2026-10-20).
 * AP News RSS returned HTTP 403 and is not listed.
 * `org` is the independence key: two BBC feeds are one publisher.
 * `kind: official` is recorded for NASA, but a single official source is NOT enough
 * for the launch fact-check (the News Engine would have counted it).
 */
const REPUTABLE_SOURCES = [
  { id: 'bbc-world', org: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', trust: 0.9 },
  { id: 'bbc-top', org: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml', trust: 0.9 },
  { id: 'bbc-science', org: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/science_and_environment/rss.xml', trust: 0.9 },
  { id: 'guardian-world', org: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', trust: 0.85 },
  { id: 'guardian-us', org: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/us-news/rss', trust: 0.85 },
  { id: 'guardian-science', org: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/science/rss', trust: 0.85 },
  { id: 'npr-world', org: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml', trust: 0.85 },
  { id: 'npr-news', org: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', trust: 0.85 },
  { id: 'aljazeera', org: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', trust: 0.8 },
  { id: 'dw-world', org: 'dw', name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-world', trust: 0.85 },
  { id: 'france24', org: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss', trust: 0.8 },
  { id: 'abc-intl', org: 'abc', name: 'ABC News', url: 'https://abcnews.go.com/abcnews/internationalheadlines', trust: 0.8 },
  { id: 'cbs-world', org: 'cbs', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/world', trust: 0.8 },
  { id: 'nasa', org: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/feed/', kind: 'official', trust: 0.95 },
];

function orgById(sources = REPUTABLE_SOURCES) {
  return Object.fromEntries(sources.map(s => [s.id, s.org]));
}

function isNewsLaunchPrompt(text) {
  const t = String(text || '');
  const aboutNews = /новост|news|выпуск|bulletin/i.test(t);
  const aboutScope = /moonkatty|трёх|трех|three|мир|world/i.test(t);
  return aboutNews && aboutScope;
}

module.exports = { REPUTABLE_SOURCES, orgById, isNewsLaunchPrompt };

'use strict';
// Minimal RSS 2.0 / Atom parser (no deps).
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const strip = s => decode(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}
function attr(block, name, a) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${a}=["']([^"']+)["']`, 'i'));
  return m ? decode(m[1]) : '';
}
function parseFeed(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const re = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  for (const b of xml.match(re) || []) {
    const link = isAtom ? (attr(b, 'link', 'href') || strip(tag(b, 'link'))) : (strip(tag(b, 'link')) || strip(tag(b, 'guid')));
    items.push({
      title: strip(tag(b, 'title')),
      link,
      guid: strip(tag(b, isAtom ? 'id' : 'guid')) || link,
      summary: strip(tag(b, isAtom ? 'summary' : 'description') || tag(b, 'content')),
      published: strip(tag(b, isAtom ? 'updated' : 'pubDate') || tag(b, 'published')),
      license: strip(tag(b, 'dc:rights') || tag(b, 'rights') || tag(b, 'copyright')) || null,
      mediaUrl: attr(b, 'media:content', 'url') || attr(b, 'enclosure', 'url') || null,
    });
  }
  const channelLicense = strip(tag(xml, 'copyright') || tag(xml, 'rights')) || null;
  return { items, channelLicense };
}
module.exports = { parseFeed, strip };

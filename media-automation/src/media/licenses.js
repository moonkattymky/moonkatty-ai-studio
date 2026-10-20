'use strict';
/**
 * License policy for visuals used in monetizable news videos.
 * ALLOW: Public Domain / CC0 / PD-USGov / NASA (with NASA media guidelines), CC BY *, CC BY-SA * (incl. ESA CC BY-SA 3.0 IGO).
 * REJECT: NC (non-commercial), ND (no derivatives — we crop/zoom), unknown, fair use, all-rights-reserved, logos/insignia (NASA guidelines).
 */
function classify(raw, { source } = {}) {
  const s = String(raw || '').trim(); const l = s.toLowerCase().replace(/[_\s]+/g, ' ');
  const R = (id, extra = {}) => ({ id, raw: s, commercialOk: true, derivativesOk: true, attributionRequired: false, shareAlike: false, ok: true, ...extra });
  const bad = (reason) => ({ id: 'rejected', raw: s, ok: false, reason });
  if (!l) return source === 'nasa' ? R('NASA-media', { attributionRequired: true, note: 'NASA media guidelines: credit NASA, no endorsement implied, no logos/insignia' }) : bad('unknown license');
  if (/\bnc\b|non-?commercial/.test(l)) return bad('non-commercial license');
  if (/\bnd\b|no ?deriv/.test(l)) return bad('no-derivatives license');
  if (/fair use|all rights reserved|copyright(ed)?\b(?!.*cc)|non-?free/.test(l) && !/public domain|cc/.test(l)) return bad('not freely licensed');
  if (/cc0|cc-zero|public domain|^pd\b|pd-|no restrictions|pdm/.test(l)) return R(/cc0/.test(l) ? 'CC0-1.0' : 'Public-Domain');
  let m = l.match(/cc[ -]?by[ -]?sa[ -]?(\d\.\d)?(?:[ -]?(igo))?/);
  if (m) return R(`CC-BY-SA-${m[1] || '4.0'}${m[2] ? '-IGO' : ''}`, { attributionRequired: true, shareAlike: true });
  m = l.match(/cc[ -]?by[ -]?(\d\.\d)?/);
  if (m) return R(`CC-BY-${m[1] || '4.0'}`, { attributionRequired: true });
  if (source === 'nasa' || /nasa/.test(l)) return R('NASA-media', { attributionRequired: true, note: 'NASA media guidelines' });
  return bad('unrecognized license: ' + s);
}
const LICENSE_URLS = { 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'Public-Domain': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'NASA-media': 'https://www.nasa.gov/nasa-brand-center/images-and-media/', 'CC-BY-SA-3.0-IGO': 'https://creativecommons.org/licenses/by-sa/3.0/igo/' };
function licenseUrl(id) { if (LICENSE_URLS[id]) return LICENSE_URLS[id]; const m = id.match(/^CC-(BY(?:-SA)?)-(\d\.\d)$/); return m ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/` : null; }
/** Human attribution line, e.g. "Photo: Jane Doe / NASA (Public Domain)". */
function attributionLine(a) { const who = [a.author, a.credit].filter(Boolean).join(' / ') || a.source; return `${a.kind === 'video' ? 'Video' : 'Image'}: ${who} — ${a.license}${a.title ? ` — “${a.title}”` : ''}`; }
module.exports = { classify, licenseUrl, attributionLine };

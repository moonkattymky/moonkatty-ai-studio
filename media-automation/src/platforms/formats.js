'use strict';
/** Format adapters: validate + build Graph API payloads for IG/FB. Pure functions, no network. */
const { META } = require('./capabilities');
const IG = META.instagram.limits, FB = META.facebook.limits;
const countTags = (s, ch) => (String(s || '').match(new RegExp('(^|\\s)' + (ch === '#' ? '#' : '@') + '[\\p{L}\\p{N}_.]+', 'gu')) || []).length;
function buildCaption({ text = '', hashtags = [] }, { maxChars = IG.captionMaxChars, maxTags = IG.hashtagsMax } = {}) {
  const tags = [...new Set(hashtags.map(h => '#' + String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(h => h.length > 1))];
  const inText = countTags(text, '#'); const keep = tags.slice(0, Math.max(0, maxTags - inText));
  let cap = keep.length ? `${text}\n\n${keep.join(' ')}` : String(text);
  if (cap.length > maxChars) cap = cap.slice(0, maxChars - 1) + '…';
  return { caption: cap, hashtagsUsed: keep.length + inText, droppedHashtags: tags.length - keep.length };
}
function checkCaption(c, platform) {
  const e = []; if (platform === 'instagram') { if (c.length > IG.captionMaxChars) e.push(`caption > ${IG.captionMaxChars} chars`);
    if (countTags(c, '#') > IG.hashtagsMax) e.push(`> ${IG.hashtagsMax} hashtags`); if (countTags(c, '@') > IG.mentionsMax) e.push(`> ${IG.mentionsMax} @mentions`); }
  else if (c.length > FB.postMaxChars) e.push(`message > ${FB.postMaxChars} chars`);
  return e;
}
const ratio = m => m.width && m.height ? m.width / m.height : null;
function checkVideo(m, spec) {
  const e = []; if (!m) return ['media required'];
  if (!m.url && !m.path) e.push('media url or path required');
  if (m.durationSec != null && (m.durationSec < spec.durationSec[0] || m.durationSec > spec.durationSec[1])) e.push(`duration ${m.durationSec}s outside ${spec.durationSec.join('..')}s`);
  if (m.fps != null && (m.fps < spec.fps[0] || m.fps > spec.fps[1])) e.push(`fps ${m.fps} outside ${spec.fps.join('..')}`);
  if (spec.maxBytes && m.bytes > spec.maxBytes) e.push('file too large');
  if (spec.maxWidth && m.width > spec.maxWidth) e.push(`width > ${spec.maxWidth}`);
  return e;
}
const near916 = r => r != null && Math.abs(r - 9 / 16) < 0.01;
const FORMATS = {
  'ig-reel': { platform: 'instagram', aspect: '9:16', validate(p) { const e = [...checkVideo(p.media, META.instagram.media.reels), ...checkCaption(p.caption || '', 'instagram')];
      if (p.media && ratio(p.media) != null && !near916(ratio(p.media))) e.push('IG Reel must be 9:16 in our pipeline'); return e; },
    payload: (p, igUserId) => ({ path: `/${igUserId}/media`, body: { media_type: 'REELS', video_url: p.media.url, caption: p.caption || '', share_to_feed: p.shareToFeed !== false, ...(p.coverUrl ? { cover_url: p.coverUrl } : {}) }, then: 'media_publish' }) },
  'ig-image': { platform: 'instagram', aspect: '4:5..1.91:1', validate(p) { const e = checkCaption(p.caption || '', 'instagram'); const m = p.media || {}; const s = META.instagram.media.feedImage;
      if (!m.url) e.push('image_url required'); if (m.mime && m.mime !== 'image/jpeg') e.push('JPEG only'); const r = ratio(m); if (r != null && (r < s.aspect[0] - 1e-3 || r > s.aspect[1] + 1e-3)) e.push('aspect outside 4:5..1.91:1');
      if (m.bytes > s.maxBytes) e.push('image > 8MB'); return e; },
    payload: (p, igUserId) => ({ path: `/${igUserId}/media`, body: { image_url: p.media.url, caption: p.caption || '', ...(p.altText ? { alt_text: p.altText } : {}) }, then: 'media_publish' }) },
  'ig-carousel': { platform: 'instagram', aspect: '4:5..1.91:1', validate(p) { const e = checkCaption(p.caption || '', 'instagram'); const items = p.items || [];
      if (items.length < 2 || items.length > IG.carouselMaxItems) e.push(`carousel needs 2..${IG.carouselMaxItems} items`);
      items.forEach((it, i) => { const sub = FORMATS['ig-image'].validate({ media: it }); if (it.kind !== 'video') sub.forEach(x => e.push(`item ${i}: ${x}`)); }); return e; },
    payload: (p, igUserId) => ({ path: `/${igUserId}/media`, children: p.items.map(it => ({ is_carousel_item: true, ...(it.kind === 'video' ? { media_type: 'VIDEO', video_url: it.url } : { image_url: it.url }) })), body: { media_type: 'CAROUSEL', caption: p.caption || '' }, then: 'media_publish' }) },
  'fb-reel': { platform: 'facebook', aspect: '9:16', validate(p) { const s = META.facebook.media.reels; const e = [...checkVideo(p.media, { ...s, maxWidth: null }), ...checkCaption(p.caption || '', 'facebook')];
      if (p.media && ratio(p.media) != null && !near916(ratio(p.media))) e.push('FB Reel must be 9:16'); if (p.media?.height && p.media.height < 960) e.push('FB Reel min 540x960'); return e; },
    payload: (p, pageId) => ({ path: `/${pageId}/video_reels`, phases: ['start', 'upload', 'finish'], body: { description: p.caption || '', video_state: 'PUBLISHED' } }) },
  'fb-video': { platform: 'facebook', aspect: '16:9..9:16', validate(p) { const e = checkCaption(p.caption || '', 'facebook'); if (!p.media?.url && !p.media?.path) e.push('media url or path required');
      const r = p.media && ratio(p.media); if (r != null && (r > 16 / 9 + 1e-3 || r < 9 / 16 - 1e-3)) e.push('FB video aspect must be between 16:9 and 9:16'); return e; },
    payload: (p, pageId) => ({ path: `/${pageId}/videos`, body: { file_url: p.media.url, description: p.caption || '', ...(p.title ? { title: p.title } : {}) } }) },
  'fb-post': { platform: 'facebook', aspect: null, validate(p) { const e = checkCaption(p.caption || '', 'facebook'); if (!p.caption && !p.link) e.push('message or link required'); return e; },
    payload: (p, pageId) => ({ path: `/${pageId}/feed`, body: { message: p.caption || '', ...(p.link ? { link: p.link } : {}) } }) },
};
function adapt(formatId, input) { const f = FORMATS[formatId]; if (!f) throw new Error('unknown format ' + formatId);
  const lim = f.platform === 'instagram' ? {} : { maxChars: FB.postMaxChars, maxTags: 30 };
  const c = buildCaption({ text: input.text || '', hashtags: input.hashtags || [] }, lim); const p = { ...input, caption: c.caption };
  return { format: formatId, platform: f.platform, aspect: f.aspect, post: p, errors: f.validate(p), captionInfo: c }; }
module.exports = { FORMATS, adapt, buildCaption, checkCaption, countTags };

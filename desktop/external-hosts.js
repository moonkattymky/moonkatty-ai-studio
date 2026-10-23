'use strict';
// HTTPS hosts the packaged shell may open in the system browser.
// News article hosts are listed explicitly so a source link from NASA/ESA (and the other fixed feeds)
// opens. Everything else stays blocked. No http, no userinfo, no wildcard.
const SOCIAL_HOSTS = [
  'www.facebook.com', 'facebook.com', 'business.facebook.com', 'developers.facebook.com',
  'www.instagram.com', 'instagram.com', 'github.com', 'moonkatty.com', 'www.moonkatty.com',
  't.me', 'ollama.com', 'tailscale.com', 'opencode.ai', 'nodejs.org', 'support.apple.com'
];
const NEWS_HOSTS = [
  'www.nasa.gov', 'nasa.gov', 'science.nasa.gov', 'images.nasa.gov', 'images-api.nasa.gov',
  'www.esa.int', 'esa.int',
  'feeds.bbci.co.uk', 'www.bbc.co.uk', 'bbc.co.uk',
  'feeds.npr.org', 'www.npr.org', 'npr.org',
  'www.theguardian.com', 'theguardian.com',
  'www.sciencedaily.com', 'sciencedaily.com'
];
const EXTERNAL_HOSTS = new Set([...SOCIAL_HOSTS, ...NEWS_HOSTS]);
function externalHref(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !EXTERNAL_HOSTS.has(u.hostname) || u.username || u.password) return null;
  return u.href;
}
module.exports = { EXTERNAL_HOSTS, NEWS_HOSTS, externalHref };

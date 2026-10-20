// HTTP hardening for the local server: Host allowlist (DNS-rebinding), Origin + custom-header CSRF checks,
// security headers / CSP, log redaction. See docs/SECURITY_AUDIT.md.
'use strict';
function allowedHosts(port) {
  const extra = String(process.env.STUDIO_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...extra]);
}
function hostCheck(port) {
  const ok = allowedHosts(port);
  return (req, res, next) => {
    const h = String(req.headers.host || '').toLowerCase();
    if (!ok.has(h)) return res.status(421).type('text/plain').send('Misdirected request: host not allowed');
    next();
  };
}
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
// State-changing API calls must (a) carry X-Studio-Request: 1 (a cross-site form/no-cors request cannot set it
// without a CORS preflight, which this server never grants) and (b) if an Origin is present, match an allowed host.
function csrfCheck(port) {
  const ok = allowedHosts(port);
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const o = req.headers.origin;
    if (o && o !== 'null') { let host = ''; try { host = new URL(o).host.toLowerCase(); } catch {} if (!ok.has(host)) return res.status(403).json({ error: 'Cross-origin request rejected' }); }
    else if (o === 'null') return res.status(403).json({ error: 'Cross-origin request rejected' });
    const sfs = req.headers['sec-fetch-site']; if (sfs && !['same-origin', 'none'].includes(sfs)) return res.status(403).json({ error: 'Cross-site request rejected' });
    if (req.headers['x-studio-request'] !== '1') return res.status(403).json({ error: 'CSRF check failed (missing X-Studio-Request header)' });
    next();
  };
}
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "media-src 'self' blob:",
  "connect-src 'self'", "font-src 'self' data:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
function headers(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}
// Uploaded files: never rendered as active content on our origin.
function filesHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  if (!/\.(png|jpe?g|gif|webp|mp3|wav|m4a|ogg|mp4|webm|mov|srt|vtt|txt)$/i.test(req.path)) res.setHeader('Content-Disposition', 'attachment');
  next();
}
const REDACT = [
  [/(access_token|client_secret|fb_exchange_token|input_token|appsecret_proof|password|token|secret)=([^&\s"']+)/gi, '$1=[REDACTED]'],
  [/("(?:access_token|client_secret|appSecret|password|token|secret|authorization)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"'],
  [/\bEA[A-Za-z0-9]{20,}\b/g, '[REDACTED_META_TOKEN]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GH_TOKEN]'],
  [/\b[a-f0-9]{64}\b/gi, '[REDACTED_HEX64]']
];
const redact = s => REDACT.reduce((t, [re, r]) => t.replace(re, r), String(s ?? ''));
module.exports = { hostCheck, csrfCheck, headers, filesHeaders, redact, allowedHosts, CSP };

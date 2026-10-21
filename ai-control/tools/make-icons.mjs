// Renders the PWA / apple-touch icons from the MOONKATTY neon cat-head logo (as drawn in the approved
// reference, top-left of «Главная»). Run: node tools/make-icons.mjs  (needs Playwright Chromium).
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const svg = (maskable) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#14306e"/><stop offset=".55" stop-color="#071538"/><stop offset="1" stop-color="#01061a"/></radialGradient>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="moon" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#e0a93a"/></radialGradient></defs>
<rect width="512" height="512" fill="url(#bg)"/>
${[[60,80,1.6],[440,70,1.2],[400,160,1],[90,420,1.3],[460,430,1.5],[150,140,.9],[330,460,1]].map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r*2}" fill="#cfe0ff" opacity=".7"/>`).join('')}
<g transform="translate(256 262) scale(${maskable ? 0.72 : 0.9}) translate(-256 -262)">
<circle cx="256" cy="118" r="24" fill="url(#moon)"/><circle cx="268" cy="110" r="21" fill="#0a1a44"/>
<g filter="url(#glow)" fill="none" stroke="#5fb4ff" stroke-width="20" stroke-linejoin="round" stroke-linecap="round">
<path d="M92 96 L196 182 H316 L420 96 L404 290 C404 384 336 438 256 438 C176 438 108 384 108 290 Z"/>
<path d="M170 300 L222 316 M342 300 L290 316 M232 372 L256 386 L280 372" stroke-width="16"/></g></g></svg>`;
const b = await chromium.launch();
const p = await b.newPage();
for (const [name, size, mask] of [['apple-touch-icon.png', 180, false], ['icon-180.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:#01061a">${svg(mask).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: path.join(dir, name), omitBackground: false });
}
await b.close();
console.log('icons written to', dir);

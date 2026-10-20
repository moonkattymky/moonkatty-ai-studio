'use strict';
const fs = require('fs'); const path = require('path');
const { run } = require('./exec');
/** Cosmic palette */
const PALETTE = { deep: '#0b0b2a', navy: '#141a4a', purple: '#3b1f6e', violet: '#8b5cf6', blue: '#3b82f6', gold: '#f5c542', goldDeep: '#d4a017', white: '#ffffff', ink: '#0b0b10' };
const HEAD = "Oswald, 'Bebas Neue', 'Helvetica Neue', Arial, sans-serif"; const BODY = "Inter, 'Helvetica Neue', Arial, sans-serif";
const X = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function wrapWords(text, maxChars, maxLines = 3) { const out = []; let cur = '';
  for (const w of String(text).split(/\s+/)) { if ((cur + ' ' + w).trim().length > maxChars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur); if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\W*\S*$/, '') + '…'; } return out; }
async function svgToPng(svg, outPng, runFn = run) { const f = outPng.replace(/\.png$/, '.svg'); fs.writeFileSync(f, svg); await runFn('rsvg-convert', ['-o', outPng, f]); return outPng; }

/** Lower-third: gold category chip + headline on translucent navy panel. */
function lowerThirdSvg({ W, H, category, headline }) {
  const vertical = H > W; const pw = Math.round(W * (vertical ? 0.92 : 0.66)); const fs1 = Math.round(Math.min(W, H) * (vertical ? 0.05 : 0.048));
  const lines = wrapWords(headline, vertical ? 26 : 40, vertical ? 3 : 2); const ph = Math.round(fs1 * (1.25 * lines.length + 1.9)); const chipW = Math.round(fs1 * 0.62 * (category.length + 2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw + 20}" height="${ph + 20}">
  <defs><linearGradient id="p" x1="0" x2="1"><stop offset="0" stop-color="${PALETTE.navy}" stop-opacity=".94"/><stop offset="1" stop-color="${PALETTE.purple}" stop-opacity=".82"/></linearGradient>
  <linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${PALETTE.gold}"/><stop offset="1" stop-color="${PALETTE.goldDeep}"/></linearGradient></defs>
  <rect x="10" y="${Math.round(fs1 * 0.75)}" width="${pw}" height="${ph - Math.round(fs1 * 0.75)}" rx="14" fill="url(#p)"/>
  <rect x="10" y="${Math.round(fs1 * 0.75)}" width="8" height="${ph - Math.round(fs1 * 0.75)}" fill="url(#g)"/>
  <rect x="34" y="0" width="${chipW}" height="${Math.round(fs1 * 1.35)}" rx="8" fill="url(#g)"/>
  <text x="${34 + chipW / 2}" y="${Math.round(fs1 * 1.0)}" font-family="${HEAD}" font-weight="700" font-size="${Math.round(fs1 * 0.78)}" fill="${PALETTE.ink}" text-anchor="middle" letter-spacing="2">${X(category.toUpperCase())}</text>
  ${lines.map((l, i) => `<text x="40" y="${Math.round(fs1 * (2.55 + i * 1.25))}" font-family="${HEAD}" font-weight="600" font-size="${fs1}" fill="${PALETTE.white}">${X(l)}</text>`).join('\n  ')}
</svg>`;
}
/** Info panel for a verified number. */
function infoPanelSvg({ W, H, value, label, source }) {
  const s = Math.round(Math.min(W, H) * 0.05); const w = Math.round(s * 7.2), h = Math.round(s * 3.6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="16" fill="${PALETTE.deep}" fill-opacity=".86" stroke="${PALETTE.gold}" stroke-width="3"/>
  <text x="${w / 2}" y="${Math.round(s * 1.75)}" font-family="${HEAD}" font-weight="700" font-size="${Math.round(s * 1.5)}" fill="${PALETTE.gold}" text-anchor="middle">${X(value)}</text>
  <text x="${w / 2}" y="${Math.round(s * 2.55)}" font-family="${BODY}" font-weight="600" font-size="${Math.round(s * 0.55)}" fill="${PALETTE.white}" text-anchor="middle">${X(label.toUpperCase())}</text>
  <text x="${w / 2}" y="${Math.round(s * 3.15)}" font-family="${BODY}" font-size="${Math.round(s * 0.36)}" fill="#c4b5fd" text-anchor="middle">Source: ${X(source)}</text>
</svg>`;
}
function creditTagSvg({ W, H, text }) {
  const s = Math.round(Math.min(W, H) * 0.019); const t = text.length > 90 ? text.slice(0, 88) + '…' : text; const w = Math.round(s * 0.56 * t.length + 2 * s);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(s * 1.9)}"><rect width="100%" height="100%" rx="6" fill="#000" fill-opacity=".5"/>
  <text x="${s}" y="${Math.round(s * 1.3)}" font-family="${BODY}" font-size="${s}" fill="#e5e7eb">${X(t)}</text></svg>`;
}
function titleSvg({ W, H, title, subtitle }) {
  const s = Math.round(Math.min(W, H) * (H > W ? 0.11 : 0.1)); const w = Math.round(W * 0.95), h = Math.round(s * 2.4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="${PALETTE.goldDeep}"/></linearGradient></defs>
  <text x="${w / 2}" y="${s}" font-family="${HEAD}" font-weight="700" font-size="${s}" fill="url(#g)" text-anchor="middle" letter-spacing="${Math.round(s * 0.06)}">${X(title)}</text>
  <text x="${w / 2}" y="${Math.round(s * 1.85)}" font-family="${BODY}" font-weight="500" font-size="${Math.round(s * 0.32)}" fill="#c4b5fd" text-anchor="middle" letter-spacing="4">${X(subtitle)}</text></svg>`;
}
function cardSvg({ W, H, heading, lines }) {
  const s = Math.round(Math.min(W, H) * 0.032); const w = Math.round(W * 0.9); const max = H > W ? 38 : 80;
  const body = lines.flatMap(l => wrapWords(l, max, 2)).slice(0, H > W ? 22 : 14); const h = Math.round(s * (3 + body.length * 1.45));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <text x="0" y="${Math.round(s * 1.6)}" font-family="${HEAD}" font-weight="700" font-size="${Math.round(s * 1.6)}" fill="${PALETTE.gold}">${X(heading)}</text>
  ${body.map((l, i) => `<text x="0" y="${Math.round(s * (3.2 + i * 1.45))}" font-family="${BODY}" font-size="${s}" fill="${/^(Sources|Images|Music|Voice)/.test(l) ? '#c4b5fd' : '#f3f4f6'}">${X(l)}</text>`).join('\n  ')}</svg>`;
}
/** Starfield background (deep blue -> purple gradient + stars), generated once. */
async function makeStarfield(out, { size = 2600, runFn = run } = {}) {
  if (fs.existsSync(out)) return out;
  await runFn('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `gradients=s=${size}x${size}:c0=0x0b0b2a:c1=0x2a1460:c2=0x141a4a:x0=0:y0=0:x1=${size}:y1=${size}:nb_colors=3:d=1`,
    '-f', 'lavfi', '-i', `nullsrc=s=${size}x${size},geq=lum='255*gt(random(1),0.9988)':cb=128:cr=128`, '-filter_complex', '[1:v]format=gray,gblur=sigma=0.7,format=rgb24[s];[0:v]format=rgb24[g];[g][s]blend=all_mode=screen,format=rgb24', '-frames:v', '1', out]);
  return out;
}
async function logoPng(svgFile, out, width, runFn = run) { if (!fs.existsSync(out)) await runFn('rsvg-convert', ['-w', String(width), '-o', out, svgFile]); return out; }
module.exports = { PALETTE, lowerThirdSvg, infoPanelSvg, creditTagSvg, titleSvg, cardSvg, svgToPng, makeStarfield, logoPng, wrapWords };

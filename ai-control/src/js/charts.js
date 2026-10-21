/* Tiny SVG chart helpers (attributes only — no inline style, CSP-safe). */
let gid = 0;
const pts = (vals, w, h, pad, max) => vals.map((v, i) => [pad + (i * (w - 2 * pad)) / (vals.length - 1), h - pad - (v / max) * (h - 2 * pad)]);
const path = (p) => p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');

export function sparkline(vals, color, w = 72, h = 22) {
  const max = Math.max(...vals) * 1.1, min = Math.min(...vals) * .8;
  const p = vals.map((v, i) => [2 + i * (w - 4) / (vals.length - 1), h - 2 - ((v - min) / (max - min)) * (h - 4)]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${path(p)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function lineChart(series, hidden = new Set(), w = 330, h = 150) {
  const vis = series.filter((s) => !hidden.has(s.id));
  const max = Math.max(10, ...vis.flatMap((s) => s.series)) * 1.12;
  const padL = 22, padB = 14, pad = 6;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = pad + i * (h - pad - padB) / 4;
    g += `<line x1="${padL}" x2="${w - 4}" y1="${y}" y2="${y}" stroke="rgba(120,160,255,.13)" stroke-width="1"/>`;
    g += `<text x="2" y="${y + 3}" fill="#6f7ea6" font-size="8">${Math.round(max * (1 - i / 4) * 10)}</text>`;
  }
  const lines = vis.map((s) => {
    const p = s.series.map((v, i) => [padL + i * (w - padL - 6) / (s.series.length - 1), pad + (1 - v / max) * (h - pad - padB)]);
    const id = 'lg' + (++gid);
    const area = path(p) + ` L${p[p.length - 1][0]} ${h - padB} L${p[0][0]} ${h - padB} Z`;
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`
      + `<path d="${area}" fill="url(#${id})"/><path d="${path(p)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const labels = ['01', '05', '10', '15', '20', '25', '30'].map((t, i) => `<text x="${padL + i * (w - padL - 14) / 6}" y="${h - 2}" fill="#6f7ea6" font-size="8">${t}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="DEMO chart">${g}${lines}${labels}</svg>`;
}

export function barChart(vals, w = 330, h = 110, { labels = true, gap = .38 } = {}) {
  const max = Math.max(...vals) * 1.08, n = vals.length, bw = (w - 8) / n;
  const id = 'bg' + (++gid);
  let s = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc4ff"/><stop offset="1" stop-color="#1d6fe0"/></linearGradient></defs>`;
  for (let i = 0; i <= 3; i++) { const y = 4 + i * (h - 18) / 3; s += `<line x1="0" x2="${w}" y1="${y}" y2="${y}" stroke="rgba(120,160,255,.10)"/>`; }
  vals.forEach((v, i) => {
    const bh = (v / max) * (h - 18), x = 4 + i * bw + bw * gap / 2, y = h - 14 - bh;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * (1 - gap)).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="url(#${id})"/>`;
    if (labels && i % 2 === 0) s += `<text x="${(x + 1).toFixed(1)}" y="${h - 3}" fill="#6f7ea6" font-size="8">${String(i + 1).padStart(2, '0')}</text>`;
  });
  return `<svg class="chart bars" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="DEMO chart">${s}</svg>`;
}

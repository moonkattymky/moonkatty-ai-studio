#!/usr/bin/env node
// Writes desktop/build-info.json (packaged into app.asar via build.files "desktop/**"). Update Center reads its builtAt for the
// anti-rollback "older build" check. Used by scripts/build-mac.sh and scripts/package-mac-on-linux.sh.
// Usage: node scripts/write-build-info.mjs --builder macos|linux [--out <file>]   (env: COMMIT, SOURCE_DATE_EPOCH, NODE_VERSION)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const epoch = Number(process.env.SOURCE_DATE_EPOCH); if (!Number.isInteger(epoch) || epoch <= 0) { console.error('write-build-info: SOURCE_DATE_EPOCH обязателен'); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const info = { commit: process.env.COMMIT || 'unknown', builtAt: new Date(epoch * 1000).toISOString(), version: pkg.version, electron: pkg.build.electronVersion, node: process.env.NODE_VERSION || 'v24.22.0', builder: arg('builder') || 'unknown' };
const out = path.resolve(arg('out') || path.join(ROOT, 'desktop/build-info.json')); fs.writeFileSync(out, JSON.stringify(info));
console.log(`build-info: ${out} builtAt=${info.builtAt}`);

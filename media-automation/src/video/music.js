'use strict';
const fs = require('fs');
/** Music slot: { file, title, artist, license, licenseUrl?, attributionRequired?, volume? } — license is mandatory. */
function validateMusic(m) {
  if (!m) return null;
  if (!m.file || !fs.existsSync(m.file)) throw new Error('music.file missing');
  if (!m.license || !String(m.license).trim()) throw new Error('music.license is required (license metadata)');
  return { title: m.title || null, artist: m.artist || null, license: m.license, licenseUrl: m.licenseUrl || null,
    attributionRequired: !!m.attributionRequired, volume: m.volume ?? 0.15, file: m.file };
}
module.exports = { validateMusic };

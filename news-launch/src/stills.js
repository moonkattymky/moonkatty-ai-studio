'use strict';
const { MediaLibrary, layoutFor } = require('../../media-automation/src/media/library');
const { CommonsProvider, NasaImagesProvider } = require('../../media-automation/src/media/providers');
const { getPreset } = require('../../media-automation/src/video/presets');

function fitsBoth(asset) {
  return ['youtube', 'shorts'].every(name => {
    const preset = getPreset(name);
    return layoutFor(asset, preset.width, preset.height).mode !== 'reject';
  });
}

function blocked(asset) {
  const blob = `${asset.title || ''} ${asset.description || ''}`;
  return /\b(logo|insignia|emblem|seal|coat of arms|flag of|plan|drawing|diagram|blueprint|schematic|basement)\b/i.test(blob);
}

/**
 * Download Commons/NASA stills and keep the first one that passes their layout
 * for both 1920x1080 and 1080x1920. Returns null when none qualify.
 */
async function findStill(newsId, queries, dir, { skip } = {}) {
  const lib = new MediaLibrary({
    dir,
    providers: { commons: new CommonsProvider(), nasa: new NasaImagesProvider() },
    minShortSide: 720,
  });
  const assets = await lib.findForNews(newsId, queries, { count: 8 });
  const asset = assets.find(a => !blocked(a) && !(skip && skip.test(`${a.title} ${a.description || ''}`)) && fitsBoth(a)) || null;
  return { asset, considered: assets, rejections: lib.rejections() };
}

module.exports = { findStill, fitsBoth };

'use strict';
const fs = require('fs');
const path = require('path');
const { Publisher, DEFAULT_ACCOUNTS } = require('../../media-automation/src/publish/publisher');
const { defaultAdapters } = require('../../media-automation/src/publish');

/** Transparency note, 21 October 2026: disclose that the voice is synthetic. */
const AZURE_DISCLOSURE = 'Voice: AI-generated (Microsoft Azure)';

function withDisclosure(description) {
  const base = String(description || '').trim();
  if (base.includes(AZURE_DISCLOSURE)) return base;
  return base ? `${base}\n\n${AZURE_DISCLOSURE}` : AZURE_DISCLOSURE;
}

function episodeRecord({ episodeId, engine, voice, final = false, summary = '', showCaption = false, azureStatus = null } = {}) {
  const azure = voice !== 'fallback';
  return {
    episodeId: episodeId || null,
    voice,
    engine,
    final: final === true,
    review: voice === 'fallback' ? 'owner-review' : null,
    azureStatus,
    syntheticVoice: azure,
    disclosure: azure ? AZURE_DISCLOSURE : null,
    description: azure ? withDisclosure(summary) : String(summary || ''),
    caption: azure && showCaption ? AZURE_DISCLOSURE : null,
  };
}

function writeEpisodeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return record;
}

/**
 * Dry-run the YouTube description. Default accounts are live:false, so processDue stops at dry_run.
 */
async function dryRunAzureEpisode({ outDir, episodeId = 'episode-azure', title = 'MOONKATTY NEWS', summary = '', videoPath, showCaption = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const video = videoPath || path.join(outDir, 'episode.mp4');
  if (!fs.existsSync(video)) fs.writeFileSync(video, '');
  const description = withDisclosure(summary);
  const publisher = new Publisher({
    statePath: path.join(outDir, 'publisher.json'),
    adapters: defaultAdapters(),
    accounts: DEFAULT_ACCOUNTS,
    liveFlags: {},
  });
  const payload = {
    videoPath: video,
    title: String(title).slice(0, 100),
    description: description.slice(0, 5000),
  };
  if (showCaption) payload.caption = AZURE_DISCLOSURE;
  publisher.enqueue({
    accountId: 'youtube-news',
    contentId: `${episodeId}:youtube`,
    payload,
    content: { reviewStatus: 'pending', storyId: episodeId },
  });
  const posts = await publisher.processDue();
  return { description, posts, publisher };
}

module.exports = { AZURE_DISCLOSURE, withDisclosure, episodeRecord, writeEpisodeRecord, dryRunAzureEpisode };

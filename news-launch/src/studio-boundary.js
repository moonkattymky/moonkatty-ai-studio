'use strict';
const path = require('path');
const { StudioJobQueueAdapter, NotConnectedError } = require('../../media-automation/src/jobs/studio-adapter');

/**
 * feat/v1.2.0 owns server/jobs* and server/blender*.
 * This launch never creates or writes those trees. The studio queue is used
 * only through an injected client (createJob/getJob/cancelJob/listJobs).
 * Blender is never invoked from here.
 */
const OWNED = [
  /(?:^|\/)server\/jobs(?:\/|$)/,
  /(?:^|\/)server\/blender(?:\/|$)/,
];

function isStudioOwned(target) {
  const abs = path.resolve(String(target || '')).replace(/\\/g, '/');
  return OWNED.some(re => re.test(abs));
}

function assertLaunchPaths(paths) {
  for (const target of paths) {
    if (target && isStudioOwned(target)) {
      const err = new Error(`Refusing to write studio-owned path ${target}. Use the injected job or Blender client.`);
      err.code = 'studio_owned_path';
      throw err;
    }
  }
  return paths;
}

async function probeStudioJobs(client) {
  const adapter = new StudioJobQueueAdapter({ client: client || null });
  try {
    await adapter.listJobs({});
    return { adapter, mode: 'studio-client', connected: true, error: null };
  } catch (e) {
    if (e instanceof NotConnectedError || e.code === 'NOT_CONNECTED') {
      return {
        adapter, mode: 'TEMPORARY_ADAPTER:studio-job-queue-not-connected', connected: false,
        error: 'Studio job client is not injected. feat/v1.2.0 is on origin (00b63fc, docs/JOBS_API.md). This launch does not open that database and does not write server/jobs or server/blender.',
      };
    }
    throw e;
  }
}

module.exports = { isStudioOwned, assertLaunchPaths, probeStudioJobs, NotConnectedError };

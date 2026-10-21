'use strict';
/** News 2.0 stage runner: fixed order, every stage output persisted to <dir>/<nn>-<stage>.json; resumable. */
const fs = require('fs'); const path = require('path');
const { PIPELINE, FORMATS } = require('./formats');
async function runPipeline({ dir, format, handlers, input }) {
  if (!FORMATS[format]) throw new Error(`unknown format ${format}`);
  fs.mkdirSync(dir, { recursive: true }); let data = input; const done = [];
  for (const [i, stage] of PIPELINE.entries()) {
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}-${stage}.json`);
    if (fs.existsSync(file)) { data = JSON.parse(fs.readFileSync(file, 'utf8')).output; done.push(stage); continue; }
    const h = handlers[stage]; if (!h) throw new Error(`missing handler for stage ${stage}`);
    data = await h(data, { format: FORMATS[format], stage });
    if (format === 'breaking' && stage === 'fact_verification' && (data.stories || []).some(s => s.verification !== 'confirmed'))
      throw new Error('breaking format requires confirmed-only stories');
    fs.writeFileSync(file, JSON.stringify({ stage, format, at: new Date().toISOString(), output: data }, null, 2));
    done.push(stage);
  }
  return { output: data, stages: done };
}
module.exports = { runPipeline };

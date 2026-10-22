/**
 * Read a script package or a correction record and write the QC JSON.
 *
 *   node qa/content/cli.mjs qa/content/fixtures/good-script.json
 *   node qa/content/cli.mjs --correction record.json
 *   node qa/content/cli.mjs --probe package.json
 *
 * --probe performs HTTP GET against each source url. The default uses only
 * the status and text stored in the package.
 */
import fs from 'node:fs';
import { reviewScript, reviewScriptLive } from './review.mjs';
import { verifyCorrection } from './corrections.mjs';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const args = process.argv.slice(2);
const correction = args.includes('--correction');
const probe = args.includes('--probe');
const file = args.find(arg => !arg.startsWith('--'));
if (!file) {
  console.error('usage: node qa/content/cli.mjs [--probe] [--correction] <package.json>');
  process.exit(2);
}
const input = readJson(file);
const verdict = correction
  ? verifyCorrection(input)
  : probe
    ? await reviewScriptLive(input)
    : reviewScript(input);
process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
process.exitCode = verdict.publish === false || verdict.verified === false ? 1 : 0;

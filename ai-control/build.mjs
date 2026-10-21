// Static build: copies src/ → dist/, stamps a content-hash version into sw.js and writes its precache list.
import { readdir, readFile, writeFile, mkdir, rm, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src'), dist = path.join(root, 'dist');

async function walk(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base)); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}
export async function build({ quiet = false } = {}) {
  await rm(dist, { recursive: true, force: true });
  const files = await walk(src);
  const hash = createHash('sha256');
  for (const f of files) {
    await mkdir(path.dirname(path.join(dist, f)), { recursive: true });
    if (f !== 'sw.js') { await copyFile(path.join(src, f), path.join(dist, f)); hash.update(f).update(await readFile(path.join(src, f))); }
  }
  const version = hash.digest('hex').slice(0, 12);
  const precache = ['./', ...files.filter((f) => f !== 'sw.js')].map((f) => (f === './' ? f : './' + f));
  const sw = (await readFile(path.join(src, 'sw.js'), 'utf8')).replace('__BUILD_VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 0));
  await writeFile(path.join(dist, 'sw.js'), sw);
  let bytes = 0; for (const f of files) bytes += (await stat(path.join(dist, f))).size;
  if (!quiet) console.log(`[build] ${files.length} files, ${(bytes / 1024).toFixed(0)} KB → dist/  (cache aic-static-${version})`);
  return { version, files: files.length, bytes };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();

/**
 * Clone a Horizons checkout (read-only) and serve it on 127.0.0.1.
 * moonkatty-horizons is attempted first (branch master). If GitHub returns
 * not-found, the playable static build moonkatty-horizons-play is used.
 * A package.json "build" script is run when the checkout has one.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function git(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error((err || out || `git ${args.join(' ')} failed`).trim()));
    });
  });
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error((err || out || `${cmd} failed`).slice(0, 2000)));
    });
  });
}

async function cloneRepo(cacheDir, repo, branch) {
  const dir = path.join(cacheDir, repo);
  const url = `https://github.com/moonkattymky/${repo}.git`;
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git(['clone', '--depth', '1', '--branch', branch, url, dir]);
  } else {
    await git(['-C', dir, 'fetch', '--depth', '1', 'origin', branch]);
    await git(['-C', dir, 'checkout', '--detach', 'FETCH_HEAD']);
  }
  const sha = await git(['-C', dir, 'rev-parse', 'HEAD']);
  const subject = await git(['-C', dir, 'log', '-1', '--format=%s']);
  return { repo, branch, url, dir, sha, subject };
}

async function buildIfNeeded(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { serveDir: dir, build: 'no package.json — serving the checkout as a static build' };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts || !pkg.scripts.build) {
    return { serveDir: dir, build: 'package.json has no build script — serving the checkout' };
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) await run(npm, ['ci'], dir);
  else await run(npm, ['install'], dir);
  await run(npm, ['run', 'build'], dir);
  for (const rel of ['dist', 'build', 'public']) {
    if (fs.existsSync(path.join(dir, rel, 'index.html'))) {
      return { serveDir: path.join(dir, rel), build: `npm run build → ${rel}/` };
    }
  }
  return { serveDir: dir, build: 'npm run build finished; index.html stayed at the checkout root' };
}

export async function prepareHorizons(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const attempts = [
    { repo: 'moonkatty-horizons', branch: 'master' },
    { repo: 'moonkatty-horizons-play', branch: 'main' }
  ];
  const notes = [];
  for (const attempt of attempts) {
    try {
      const cloned = await cloneRepo(cacheDir, attempt.repo, attempt.branch);
      const built = await buildIfNeeded(cloned.dir);
      notes.push(`${attempt.repo}@${cloned.sha.slice(0, 12)} (${attempt.branch})`);
      return { ...cloned, ...built, notes, fallback: attempt.repo !== 'moonkatty-horizons' };
    } catch (error) {
      notes.push(`${attempt.repo}: ${error.message.split('\n')[0]}`);
    }
  }
  const failure = new Error('Could not prepare a Horizons build');
  failure.notes = notes;
  throw failure;
}

export function serveStatic(root) {
  const rootNorm = path.resolve(root);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(rootNorm, '.' + rel);
    if (!file.startsWith(rootNorm + path.sep) && file !== rootNorm) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

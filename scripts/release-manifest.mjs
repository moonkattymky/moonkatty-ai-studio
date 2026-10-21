// Machine-readable release manifest (format: docs/RELEASE_MANIFEST.md). Usage: node scripts/release-manifest.mjs <zip> <prod|test>
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { execFileSync } from 'child_process'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const [zip, flavor = 'prod'] = process.argv.slice(2);
const C0 = require(process.cwd() + '/lib/studio-config.js'); const C = { ...(flavor === 'test' ? C0.TEST : C0.PROD), PROD: C0.PROD };
const src = fs.readFileSync('server.js', 'utf8'); const dbSchemaVersion = +(/const DB_SCHEMA_VERSION = (\d+)/.exec(src) || [])[1];
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const git = (...a) => execFileSync('git', a).toString().trim();
const dir = path.dirname(zip); const asset = n => { const f = path.join(dir, n); const b = fs.readFileSync(f); return { name: n, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; };
const names = [path.basename(zip), path.basename(zip) + '.sha256', 'MANIFEST.sha256', 'sbom.cdx.json', 'BUILD-INFO.txt'].filter(n => fs.existsSync(path.join(dir, n)));
const m = {
  manifestVersion: 1,
  version: pkg.version,
  channel: flavor === 'test' ? 'test' : (/-/.test(pkg.version) ? 'preview' : 'stable'),
  sourceCommit: git('rev-parse', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  arch: 'arm64', platform: 'darwin',
  bundleId: C.appId, appName: C.product, dataDirName: C.product,
  dataDir: '~/Library/Application Support/' + C.product + '/', logDir: '~/Library/Logs/' + C.product + '/',
  launchdLabel: C.launchdLabel, keychainServicePrefix: C.keychainService,
  keychainItems: [{ service: C.keychainService, account: C.kcAccountMasterKey }, { service: C.keychainService, account: C.kcAccountOpencode }],
  defaultPort: C.defaultPort, opencodeUrl: C.opencodeUrl,
  dbSchemaVersion,
  minUpgradeFrom: flavor === 'test' ? null : '1.1.2', // TEST build never upgrades anything: fresh, separate data dir
  isolated: flavor === 'test',
  isolatedFrom: flavor === 'test' ? [C.PROD.appId] : [],
  electron: pkg.build.electronVersion,
  signing: 'adhoc', notarized: false,
  assets: names.map(asset),
};
process.stdout.write(JSON.stringify(m, null, 2) + '\n');

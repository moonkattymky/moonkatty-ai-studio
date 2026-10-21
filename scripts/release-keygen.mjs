#!/usr/bin/env node
// OFFLINE release-key generation (owner step). Run on an offline Mac; --out must be OUTSIDE the repository
// (e.g. an encrypted USB volume). Writes an Ed25519 private key encrypted with your passphrase (PKCS#8, AES-256-CBC, 0600)
// and the public key. Prints the keyring.json entry to commit together with the .pub.pem. NEVER commit the private key.
// Usage: node scripts/release-keygen.mjs --channel prod|test --out /Volumes/KEYS/moonkatty [--json]
// Passphrase: RELEASE_KEY_PASSPHRASE env or interactive prompt (min 12 chars).
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import readline from 'readline'; import { fileURLToPath } from 'url';
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const die = m => { console.error('release-keygen: ' + m); process.exit(1); };
const channel = arg('channel'), outArg = arg('out'), json = process.argv.includes('--json');
if (!['prod', 'test'].includes(channel)) die('--channel prod|test');
if (!outArg) die('--out <папка вне репозитория>');
const out = path.resolve(outArg); const real = p => { let d = p; while (!fs.existsSync(d)) d = path.dirname(d); return path.join(fs.realpathSync(d), path.relative(d, p)); };
if ((real(out) + path.sep).startsWith(fs.realpathSync(ROOT) + path.sep)) die('папка --out внутри репозитория — приватный ключ не должен попасть в git');
async function passphrase() {
  if (process.env.RELEASE_KEY_PASSPHRASE) return process.env.RELEASE_KEY_PASSPHRASE;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true }); const ask = q => new Promise(r => rl.question(q, r));
  const a = await ask('Пароль для приватного ключа: '), b = await ask('Повторите: '); rl.close(); if (a !== b) die('пароли не совпадают'); return a;
}
const pass = await passphrase(); if (String(pass).length < 12) die('пароль: минимум 12 символов');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keyId = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const priv = path.join(out, `release-${channel}-${keyId}.key`), pub = path.join(out, `release-${channel}-${keyId}.pub.pem`);
if (fs.existsSync(priv) || fs.existsSync(pub)) die('файлы уже существуют');
fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass }), { mode: 0o600, flag: 'wx' });
fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
const keyringEntry = { file: path.basename(pub), set: channel, status: 'next', createdAt: new Date().toISOString() };
if (json) process.stdout.write(JSON.stringify({ keyId, privateKeyFile: priv, publicKeyFile: pub, keyringEntry }) + '\n');
else console.log(`keyId: ${keyId}\nприватный (НЕ коммитить, хранить офлайн + резервная копия): ${priv}\nпубличный (скопировать в lib/ops/update-keys/): ${pub}\nзапись для keyring.json → "keys":\n  "${keyId}": ${JSON.stringify(keyringEntry)}\nСтатус "next"; после первого релиза с этим keyring смените на "active".`);

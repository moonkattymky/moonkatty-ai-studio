#!/usr/bin/env node
// Sign release-manifest.json with an offline release key → release-manifest.json.sig = {"v":1,"alg":"ed25519","keyId","sig"}.
// Usage: node scripts/release-sign.mjs --key /Volumes/KEYS/moonkatty/release-prod-<id>.key --manifest dist/release-manifest.json
// Passphrase: RELEASE_KEY_PASSPHRASE env or interactive prompt. The signature is verified with the public key before writing.
import fs from 'fs'; import crypto from 'crypto'; import readline from 'readline';
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const die = m => { console.error('release-sign: ' + m); process.exit(1); };
const keyFile = arg('key'), mf = arg('manifest'); if (!keyFile || !mf) die('--key <файл> --manifest <release-manifest.json>');
const bytes = fs.readFileSync(mf); let m; try { m = JSON.parse(bytes); } catch { die('manifest не JSON'); }
if (!['test', 'preview', 'stable'].includes(m.channel)) die('manifest.channel должен быть test|preview|stable');
let pass = process.env.RELEASE_KEY_PASSPHRASE; if (!pass) { const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true }); pass = await new Promise(r => rl.question('Пароль ключа: ', r)); rl.close(); }
const priv = crypto.createPrivateKey({ key: fs.readFileSync(keyFile), passphrase: pass }); if (priv.asymmetricKeyType !== 'ed25519') die('ключ не Ed25519');
const pub = crypto.createPublicKey(priv); const keyId = crypto.createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
const sig = crypto.sign(null, bytes, priv); if (!crypto.verify(null, bytes, pub, sig)) die('самопроверка подписи не прошла');
fs.writeFileSync(mf + '.sig', JSON.stringify({ v: 1, alg: 'ed25519', keyId, sig: sig.toString('base64') }) + '\n');
console.log(`подписано: ${mf}.sig (keyId ${keyId}, канал ${m.channel}). Ключ должен быть в наборе «${m.channel === 'test' ? 'test' : 'prod'}» keyring.json.`);

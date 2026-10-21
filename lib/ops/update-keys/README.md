# Trusted release keys (Ed25519) — `keyring.json`

* Two independent sets: **prod** (manifest channels `preview`, `stable`) and **test** (channel `test`). A key belongs to exactly one set.
* Every signature is `release-manifest.json.sig` = JSON `{"v":1,"alg":"ed25519","keyId":"<16 hex>","sig":"<base64>"}`.
  `keyId` = first 16 hex chars of SHA-256 of the key's SPKI DER. Only the named key is tried; a signature without `keyId` is rejected.
* `status`: `active` (signs now) · `next` (pre-published for rotation, already trusted) · `retired` (no longer trusted).
  `revoked`: keyIds that are never trusted again, even if still listed.
* `stub: true` marks the committed **placeholder** key (`stub-test-ed25519.pub.pem`): its private half was discarded, so it verifies
  nothing. Stub keys are refused for the prod set by code. **The prod set is empty** until the owner adds a real key.
* Owner step (offline): `node scripts/release-keygen.mjs --channel prod --out /Volumes/<encrypted-usb>/moonkatty-keys` → commit only the
  printed `.pub.pem` + keyring entry. Private keys never enter git. Signing: `node scripts/release-sign.mjs --key <file> --manifest release-manifest.json`.
* Rotation: generate next key → add as `next` → release signed by old key ships the new keyring → switch signing to the new key and mark it
  `active` → mark the old key `retired` or add it to `revoked` (compromise).

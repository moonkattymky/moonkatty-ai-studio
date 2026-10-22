# QA report — NODE 0.2.2 r5 (feat/nodes-022-final; code eeef764, archives 11f6618eed6ce93392ed2e472267d530fc2ce6f8, final 46752adc30ab34a18a6ce71b2f8bf61c6ee6ac2a)
Date: 2026-10-22. Independent QA (Grok Bot). Fresh clone, token-free remote, git 2.47.3, Node v22.23.4.

## Overall: PASS — QA-R4-001 CLOSED. Real-Mac checks BLOCKED.

## Tests (Node 22) — all PASS, match claims
ops 145/0/2 · ops:studio 4/0/0 · UC 79/0 · nodes 52/0 · security 52/0 · isolation 65/0 · publish-guard 59/0 (bundle SKIP) · policy 46/46 · node-pkg-repro 1/0 · node-advice-scan 3/0.
Advice scanner run against e562345 (r4 tree): FAILS (1 pass / 2 fail): 7 source + 7 built-package violations (agent.js, enroll.html, env.example ×3, plist, fetch-ffprobe.sh xattr) + legacy-doc banner assertion (NEWS_NODE_IMAC.md) = 15, consistent with claim.

## Hashes (/workspace/dist-node-final5) — all match; independent rebuild from 11f6618 byte-identical
darwin-x64 f084c926…4227 · monterey db42b61b…2db4 · js-only 048606f4…9473 · source zip d97a0336…c7c5 (git 2.47.3). verify-source-zip.sh: OK 628 files. Install doc (46752ad) carries r5 hashes; send/nodes-022-final-r5 copy identical; FINAL/ARCHIVE_COMMIT correct. eeef764..11f6618 = one doc line.

## Review e562345..46752ad
- No changes in lib/, server.js: authNode, Ed25519 verify, timingSafeEqual, ±30 s, nonce single-use, replay floor — untouched. Coordinator web-panel Serve path / iPhone HTTPS / STUDIO_ALLOWED_HOSTS host check (lib/security.js, server.js) untouched; security suite passes.
- NODE_TLS_MODE≠pinned rejected in config(), client() and enroll() (E_TLS_MODE); tests assert it, incl. *.ts.net URL. Fingerprint mandatory for every https URL.
- Pinned verification is real: agent/enroll https.Agent use ca=pinned PEM + checkServerIdentity exact SHA-256 compare. The only rejectUnauthorized:false is enroll.js fetchPinnedCert, which rejects unless the peer cert SHA-256 equals the 64-hex pin before anything is sent — acceptable (pin-fetch).
- fetch-ffprobe.sh no longer strips quarantine. No `xattr -d com.apple.quarantine` / `spctl --master-disable` instructions anywhere except prohibitions in docs/comments.
- Archives: remaining "Serve"/"tailscale" mentions are prohibitions/rejection messages only. Legacy 0.2.0 docs carry УСТАРЕЛО banner.
- Secrets: none (only the known fake `ghs_…` fixture description).

## Findings
- INFO: scripts/node/studio-connection-test.mjs still has dead `cfg.tlsMode === 'tailscale'` branches and accepts *.ts.net hosts in the address check; unreachable since config() rejects that mode. Cleanup suggested.
- INFO: studio-connection-test uses checkServerIdentity=()=>undefined with pinned CA, then compares fingerprint explicitly — diagnostic only, fine.
- LOW (carried): FS without directory fsync support refuses signed requests (fail closed, documented).

# QA report — NODE 0.2.2 r4 (feat/nodes-022-final; code/archives e36420e7e7db5b9bfece42933dec1e8e936d6b99, final e562345c3ee2444059193028530a95c53c63a3e8)
Date: 2026-10-22. Independent QA (Grok Bot). Fresh clone, token-free remote, git 2.47.3, Node v22.23.4.

## Overall: PASS (real-Mac checks BLOCKED); 1 MEDIUM non-blocking doc/config defect (QA-R4-001)

## Tests (Node 22)
ops 142/0/2 · ops:studio 4/0/0 · UC 79/0 · nodes 52/0 · security 52/0 · isolation 65/0 · publish-guard 59/0 (bundle SKIP) · policy 46/46 · node-pkg-repro 1/0 — all PASS, all match claims. Real Mac: BLOCKED.

## Hashes (/workspace/dist-node-final4) — all match claims; independent rebuild from e36420e byte-identical
darwin-x64 71ec7da7…92c8 · monterey 1ab595d4…ac44 · js-only 2a171d3c…a05f · source zip 971b215a…61d5 (git 2.47.3). verify-source-zip.sh: OK 627 files. Install doc hashes match.

## Diff review 5bd0d84..e562345
- Only lib/ops/nodes.js persistFloor/raiseFloor changed (+ injectable floorFs for tests). authNode, Ed25519 verify, timingSafeEqual token check, ±30 s window, NONCE_RE, nonce single-use, bootFloor/bootScopes checks: unchanged. Not weakened.
- Dir fsync failure now throws → 429 (fail closed). open/write/fsync/chmod/rename failures: fd closed, .tmp unlinked, original replay-floor.json untouched (rename never reached). Dir-fsync failure after rename leaves the new (higher) floor — safe direction.
- floorDirty persists across requests; every request refused until a confirmed write. r4 injected-failure test passes.
- e36420e..e562345: docs/NODES_INSTALL_RU.md only. Node 22 requirement documented.
- Secrets: none in code, archives, send/nodes-022-final-r4 (only fake fixtures / redaction regexes).

## Findings
- QA-R4-001 MEDIUM (non-blocking): node-agent/node-agent.env.example (shipped in node archives) labels `tailscale serve` (NODE_TLS_MODE=tailscale, :8443 *.ts.net URL) as "Вариант A (рекомендуется)", while NODES_INSTALL_RU.md forbids `tailscale serve` (lines 14, 82). Operator following the template either cannot connect or enables serve against policy (serve also activates the trustServeHeaders path). Not a code vuln (tailnet-only, no funnel), but contradictory guidance in a shipped artifact. Fix: make pinned mode Variant A / mark serve as not used in this deployment.
- LOW: filesystems rejecting directory fsync (some network/FUSE) will refuse all signed node requests — documented, fail-closed by design.

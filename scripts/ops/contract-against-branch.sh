#!/usr/bin/env bash
# Run our contract + ops tests against another branch WITHOUT touching it: temporary git worktree, our test files copied in, removed afterwards.
# Usage: scripts/ops/contract-against-branch.sh feat/v1.2.0   (read-only for that branch: nothing is committed or pushed)
set -euo pipefail
BR="${1:?branch}"; ROOT="$(git rev-parse --show-toplevel)"; WT="$(mktemp -d "${TMPDIR:-/tmp}/mk-contract-XXXXXX")"
cleanup() { git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; }; trap cleanup EXIT
git -C "$ROOT" fetch -q origin "$BR" 2>/dev/null || true
REF="$(git -C "$ROOT" rev-parse --verify -q "origin/$BR" || git -C "$ROOT" rev-parse --verify "$BR")"
git -C "$ROOT" worktree add -q --detach "$WT" "$REF"
mkdir -p "$WT/lib/ops" "$WT/test"; cp -n "$ROOT"/lib/ops/*.js "$WT/lib/ops/" 2>/dev/null || true; cp -r "$ROOT/test/contract" "$WT/test/"
cd "$WT"; [ -d node_modules ] || [ "${SKIP_NPM:-}" = 1 ] || npm ci --ignore-scripts --no-audit --no-fund >/dev/null
echo "== contract tests on $BR @ $REF"; node --test test/contract/

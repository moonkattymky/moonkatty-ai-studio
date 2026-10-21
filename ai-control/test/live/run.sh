#!/bin/sh
# LIVE-mode tests: build once, then run Playwright with 2 temp TEST Studios + 3 proxies inside a private net namespace.
#   sh test/live/run.sh [playwright args…]
set -e
cd "$(dirname "$0")/../.."
export PATH=/home/box/node22/bin:$PATH
node build.mjs
mkdir -p /workspace/out/ai-control/stage2/logs
/workspace/mk-iso.sh sh -c 'npx playwright test -c test/live/live.config.mjs "$@"; rc=$?; cp /tmp/aic-live/logs/*.log /workspace/out/ai-control/stage2/logs/ 2>/dev/null; exit $rc' sh "$@"

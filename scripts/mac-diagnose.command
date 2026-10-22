#!/bin/bash
# Double-click entry for the read-only diagnostics. Terminal runs this file; it only starts mac-diagnose.sh.
set +e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec /bin/bash "${DIR}/mac-diagnose.sh"

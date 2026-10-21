#!/bin/sh
# Store the Azure Speech key in the macOS Keychain. The key is read from stdin
# and is not accepted as an argument. Do not run this until an F0 resource exists.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
exec node "$root/news-launch/azure-tts/keychain-cli.js" store

#!/bin/sh
# Store the Azure Speech key in the macOS Keychain. The key is read from stdin
# and is not accepted as an argument. Do not run this until the owner has set
# an Azure spending limit. A config tier of F0 is still drawn against the local USD guard.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
exec node "$root/news-launch/azure-tts/keychain-cli.js" store

#!/usr/bin/env bash
# Copies the shared Lumen web UI into each native app so it can be bundled.
# Run from the repo root after changing anything in src/ or web/.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"   # brightspace-wrapper/
copy() {
  local dest="$1"; rm -rf "$dest"; mkdir -p "$dest"
  cp -R "$here/src" "$here/web" "$here/demo" "$here/assets" "$dest/"
  # index.html for the apps lives at web/index.html; paths there are ../src etc., which hold.
  echo "synced → $dest"
}
copy "$here/native/ios/Lumen/WebAssets"
copy "$here/native/android/app/src/main/assets/lumen"
copy "$here/native/windows/Lumen/WebAssets"

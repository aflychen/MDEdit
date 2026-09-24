#!/usr/bin/env bash
set -euo pipefail

version="$(node -p "require('./package.json').version")"
export CSC_IDENTITY_AUTO_DISCOVERY=false

npx electron-builder --mac --dir --arm64 --publish never --config.mac.notarize=false
codesign --force --deep --sign - --options runtime dist/mac-arm64/MDEdit.app
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/MDEdit.app
codesign -dv --verbose=2 dist/mac-arm64/MDEdit.app 2>&1 | grep -q 'Signature=adhoc'

npx electron-builder --prepackaged dist/mac-arm64/MDEdit.app --mac dmg --arm64 --publish never \
  --config.mac.notarize=false "--config.artifactName=MDEdit-${version}-arm64-adhoc.\${ext}"
hdiutil verify "dist/MDEdit-${version}-arm64-adhoc.dmg"

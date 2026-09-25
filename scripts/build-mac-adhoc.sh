#!/usr/bin/env bash
set -euo pipefail

version="$(node -p "require('./package.json').version")"
export CSC_IDENTITY_AUTO_DISCOVERY=false

npx electron-builder --mac --dir --arm64 --publish never --config.mac.notarize=false \
  --config.mac.entitlements=build/entitlements.mac-adhoc.plist \
  --config.mac.entitlementsInherit=build/entitlements.mac-adhoc.plist
codesign --force --deep --sign - --options runtime \
  --entitlements build/entitlements.mac-adhoc.plist dist/mac-arm64/MDEdit.app
codesign --verify --deep --strict --verbose=2 dist/mac-arm64/MDEdit.app
codesign -dv --verbose=2 dist/mac-arm64/MDEdit.app 2>&1 | grep -q 'Signature=adhoc'
codesign --display --entitlements - --xml dist/mac-arm64/MDEdit.app 2>/dev/null \
  | plutil -convert json -o - - \
  | grep -Fq '"com.apple.security.cs.disable-library-validation":true'

npx electron-builder --prepackaged dist/mac-arm64/MDEdit.app --mac dmg --arm64 --publish never \
  --config.mac.notarize=false "--config.artifactName=MDEdit-${version}-arm64-adhoc.\${ext}"
hdiutil verify "dist/MDEdit-${version}-arm64-adhoc.dmg"

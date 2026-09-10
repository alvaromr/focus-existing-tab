#!/usr/bin/env bash
# Builds dist/focus-existing-tab-<version>.zip with only the files the extension needs.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/focus-existing-tab-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
zip -q -r "$OUT" manifest.json _locales icons src options popup -x '*.DS_Store'
echo "$OUT ($(du -h "$OUT" | cut -f1))"

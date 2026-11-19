#!/usr/bin/env bash
# Builds the release zip, unpacks it into an empty temporary directory and runs the e2e against
# that copy: the extension exactly as a user installs it, without the repository around it.
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP=$(bash scripts/package.sh | cut -d' ' -f1)
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
unzip -q "$ZIP" -d "$DIR"
EXTENSION_DIR="$DIR" node test/e2e/smoke.js

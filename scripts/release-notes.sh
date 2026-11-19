#!/usr/bin/env bash
# Prints the CHANGELOG.md section of one version (without its heading), for the GitHub Release.
# Usage: scripts/release-notes.sh 1.2.3
set -euo pipefail
cd "$(dirname "$0")/.."

notes=$(awk -v v="$1" '
  $0 ~ "^## \\[" v "\\]" { on = 1; next }
  on && /^## \[/ { exit }
  on { print }
' CHANGELOG.md)
if [ -z "${notes//[[:space:]]/}" ]; then
  echo "CHANGELOG.md has no notes for version $1" >&2
  exit 1
fi
printf '%s\n' "$notes"

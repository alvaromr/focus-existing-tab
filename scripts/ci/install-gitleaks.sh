#!/usr/bin/env bash
# Installs gitleaks on a Linux x64 CI runner, pinned by version and by the SHA-256 that the
# release's gitleaks_<version>_checksums.txt lists. Local machines install it themselves.
set -euo pipefail

VERSION=8.30.1
SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"

DIR=$(mktemp -d)
curl -fsSL -o "$DIR/$ARCHIVE" "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ARCHIVE}"
echo "${SHA256}  $DIR/$ARCHIVE" | sha256sum -c -
tar -xzf "$DIR/$ARCHIVE" -C "$DIR" gitleaks
sudo install "$DIR/gitleaks" /usr/local/bin/gitleaks
gitleaks version

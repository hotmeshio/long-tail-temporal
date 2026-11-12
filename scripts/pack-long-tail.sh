#!/bin/sh
# Packs a local long-tail checkout into vendor/ so the image installs it instead of the npm release.
set -eu
SOURCE="${1:-../long-tail}"
rm -f vendor/*.tgz
npm pack "$SOURCE" --pack-destination vendor >/dev/null
ls vendor/*.tgz

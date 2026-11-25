#!/usr/bin/env bash
# Zero-downtime deploy for a static site (Astro, Vite, Next export, Hugo...)
# served from a directory by OpenLiteSpeed, `serve`, nginx or anything else.
#
# Most build tools wipe their output directory first. Building straight into
# the directory you serve means every URL 404s for as long as the build takes.
# Instead: build into a staging directory, check it, then swap it in atomically.
#
# Usage: deploy-static.sh <live-dir> <build command...>
#   e.g. deploy-static.sh /var/www/site/dist npx astro build --outDir /var/www/site/dist.next
#
# The build command must write into "<live-dir>.next". Set MIN_FILES to fail
# the deploy if the build produced fewer files than expected (default 1).
set -euo pipefail

LIVE_DIR="${1:?usage: deploy-static.sh <live-dir> <build command...>}"
shift
[ "$#" -gt 0 ] || { echo "deploy-static.sh: no build command given" >&2; exit 2; }
LIVE_DIR="${LIVE_DIR%/}"
NEXT_DIR="$LIVE_DIR.next"
MIN_FILES="${MIN_FILES:-1}"
SWAP="$(dirname "$0")/atomic-swap"

rm -rf "$NEXT_DIR"
"$@"

# Check the result on disk rather than trusting the build's exit code.
[ -f "$NEXT_DIR/index.html" ] || { echo "deploy: $NEXT_DIR/index.html is missing, live site untouched" >&2; exit 1; }
count=$(find "$NEXT_DIR" -type f | wc -l)
[ "$count" -ge "$MIN_FILES" ] || { echo "deploy: only $count files (want >= $MIN_FILES), live site untouched" >&2; exit 1; }

if [ -e "$LIVE_DIR" ]; then
  "$SWAP" "$NEXT_DIR" "$LIVE_DIR"
  rm -rf "$NEXT_DIR"   # now the previous release; keep it instead if you want instant rollback
else
  mv "$NEXT_DIR" "$LIVE_DIR"
fi
echo "deploy: $count files live in $LIVE_DIR"

#!/usr/bin/env bash
# Package listings.db + wacli.db + media files into a shareable tarball.
#
# Usage:
#   ./share.sh              # full package with media
#   ./share.sh --no-media   # listings + wacli.db only
#   ./share.sh --out FILE   # custom output name

set -eu

INCLUDE_MEDIA=1
OUT_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-media) INCLUDE_MEDIA=0; shift ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

LISTINGS_DB="${LISTINGS_DB:-$SCRIPT_DIR/listings.db}"

WACLI_DB="${WACLI_DB:-$HOME/.wacli-pro/wacli.db}"
if [ ! -f "$WACLI_DB" ] && [ -f "/c/Users/$USER/.wacli-pro/wacli.db" ]; then
  WACLI_DB="/c/Users/$USER/.wacli-pro/wacli.db"
fi

MEDIA_DIR="$(dirname "$WACLI_DB")/media"

if [ ! -f "$LISTINGS_DB" ]; then
  echo "✗ listings.db not found at $LISTINGS_DB" >&2
  exit 1
fi
if [ ! -f "$WACLI_DB" ]; then
  echo "✗ wacli.db not found at $WACLI_DB" >&2
  exit 1
fi

if [ -z "$OUT_FILE" ]; then
  OUT_FILE="$SCRIPT_DIR/listings_share_$(date +%Y%m%d_%H%M).tar.gz"
fi

# Stage inside the project dir — /tmp is unreliable under UCRT64.
STAGE="$SCRIPT_DIR/.share_stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "→ Exporting listings.db…"
# Use a Windows-friendly absolute path so sqlite3.exe can write it.
STAGE_WIN="$(cygpath -w "$STAGE" 2>/dev/null || echo "$STAGE")"
sqlite3 "$LISTINGS_DB" ".backup '$(cygpath -w "$STAGE/listings.db" 2>/dev/null || echo "$STAGE/listings.db")'"

echo "→ Exporting wacli.db…"
sqlite3 "$WACLI_DB" ".backup '$(cygpath -w "$STAGE/wacli.db" 2>/dev/null || echo "$STAGE/wacli.db")'"

if [ "$INCLUDE_MEDIA" = "1" ] && [ -d "$MEDIA_DIR" ]; then
  MEDIA_SIZE=$(du -sh "$MEDIA_DIR" 2>/dev/null | cut -f1)
  echo "→ Copying media ($MEDIA_SIZE)…"
  mkdir -p "$STAGE/media"
  cp -r "$MEDIA_DIR/." "$STAGE/media/"
else
  echo "→ Skipping media"
fi

echo "→ Writing $OUT_FILE…"
tar -czf "$OUT_FILE" -C "$STAGE" .

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo
echo "✓ Done: $OUT_FILE ($SIZE)"
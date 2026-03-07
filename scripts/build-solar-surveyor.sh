#!/usr/bin/env bash
#
# Build Solar Surveyor and copy into public/solar-surveyor/
#
# Usage:
#   ./scripts/build-solar-surveyor.sh [path-to-solar-surveyor-repo]
#
# Defaults to ../Solar Surveyor V12/website if no path given.
# Cleans stale hashed assets before copying fresh build.

set -euo pipefail

SOLAR_DIR="${1:-$(dirname "$0")/../../Solar Surveyor V12/website}"
TARGET_DIR="$(dirname "$0")/../public/solar-surveyor"

# Resolve to absolute paths
SOLAR_DIR="$(cd "$SOLAR_DIR" && pwd)"
TARGET_DIR="$(cd "$(dirname "$TARGET_DIR")" && pwd)/$(basename "$TARGET_DIR")"

echo "Solar Surveyor source: $SOLAR_DIR"
echo "Target directory:      $TARGET_DIR"

# Verify source exists
if [ ! -f "$SOLAR_DIR/package.json" ]; then
  echo "ERROR: Solar Surveyor not found at $SOLAR_DIR"
  exit 1
fi

# Build
echo ""
echo "Building Solar Surveyor..."
cd "$SOLAR_DIR"
npx vite build

echo ""
echo "Build complete. Copying to PB Ops..."

# Clean target (remove stale hashed assets)
if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  echo "Cleaned stale $TARGET_DIR"
fi

# Copy fresh build
cp -R "$SOLAR_DIR/dist/" "$TARGET_DIR/"

echo ""
echo "Done. Contents:"
find "$TARGET_DIR" -type f | sort | while read -r f; do
  size=$(wc -c < "$f" | tr -d ' ')
  echo "  $(basename "$f") (${size} bytes)"
done

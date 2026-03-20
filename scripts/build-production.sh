#!/usr/bin/env bash
set -e

# Resonant IDE — Production Build Script
# Builds a standalone .app for macOS (arm64 and x64)

ROOT=$(dirname "$(dirname "$(realpath "$0")")")
cd "$ROOT"

echo "=== Resonant IDE Production Build ==="
echo "Root: $ROOT"
echo "Node: $(node --version)"
echo ""

# Step 1: Verify Xcode
echo "[1/5] Checking Xcode..."
if ! xcrun --find actool &>/dev/null; then
  echo "ERROR: Full Xcode is required (not just Command Line Tools)."
  echo "Install from App Store or: xcode-select --install"
  exit 1
fi
echo "  ✓ Xcode found"

# Step 2: Build .car icon asset
echo "[2/5] Building icon asset catalog..."
XCASSETS="$ROOT/resources/darwin/AppIcon.xcassets"
if [ ! -f "$ROOT/resources/darwin/code.car" ] || [ "$1" == "--rebuild-icons" ]; then
  if [ -d "$XCASSETS" ]; then
    xcrun actool --compile "$ROOT/resources/darwin" \
      --platform macosx \
      --minimum-deployment-target 10.15 \
      --app-icon AppIcon \
      --output-partial-info-plist /dev/null \
      "$XCASSETS"
    # actool outputs Assets.car, rename to code.car
    if [ -f "$ROOT/resources/darwin/Assets.car" ]; then
      mv "$ROOT/resources/darwin/Assets.car" "$ROOT/resources/darwin/code.car"
    fi
    echo "  ✓ code.car built"
  else
    echo "  ERROR: $XCASSETS not found"
    exit 1
  fi
else
  echo "  ✓ code.car already exists (use --rebuild-icons to rebuild)"
fi

# Step 3: Compile TypeScript
echo "[3/5] Compiling source..."
npm run gulp compile 2>&1 | tail -3

# Step 4: Build production package
ARCH="${BUILD_ARCH:-arm64}"
echo "[4/5] Building production .app (darwin-$ARCH)..."
npx gulp "vscode-darwin-${ARCH}-min" 2>&1 | tail -10

# Step 5: Verify output
OUTPUT_DIR="$(dirname "$ROOT")/VSCode-darwin-${ARCH}"
if [ -d "$OUTPUT_DIR" ]; then
  APP_NAME=$(ls "$OUTPUT_DIR" | grep ".app$" | head -1)
  if [ -n "$APP_NAME" ]; then
    echo ""
    echo "=== BUILD SUCCESS ==="
    echo "App: $OUTPUT_DIR/$APP_NAME"
    echo "Size: $(du -sh "$OUTPUT_DIR/$APP_NAME" | awk '{print $1}')"
    echo ""
    echo "To run: open \"$OUTPUT_DIR/$APP_NAME\""
    echo "To create DMG: create-dmg \"$OUTPUT_DIR/$APP_NAME\" \"$OUTPUT_DIR/\""
  else
    echo "ERROR: No .app found in $OUTPUT_DIR"
    exit 1
  fi
else
  echo "ERROR: Build output not found at $OUTPUT_DIR"
  echo "Check build logs above for errors."
  exit 1
fi

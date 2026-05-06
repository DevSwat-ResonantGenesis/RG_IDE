#!/usr/bin/env bash
# DevSwat IDE — One-line installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/DevSwat-ResonantGenesis/RG_IDE/main/scripts/install.sh)
set -e

echo "══════════════════════════════════════════════════"
echo "  DevSwat IDE — Installer"
echo "══════════════════════════════════════════════════"

# ── 1. nvm ──
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "→ Installing nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"

# ── 2. Clone or update ──
INSTALL_DIR="${DEVSWAT_IDE_DIR:-$HOME/DevSwatIDE}"
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing install at $INSTALL_DIR..."
  cd "$INSTALL_DIR"
  # Stash any local changes before pulling
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "→ Stashing local changes..."
    git stash push -m "Auto-stash before update $(date)"
  fi
  git fetch origin
  git reset --hard origin/main
else
  echo "→ Cloning DevSwat IDE to $INSTALL_DIR..."
  git clone https://github.com/DevSwat-ResonantGenesis/RG_IDE.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── 3. Node ──
echo "→ Installing Node.js (from .nvmrc)..."
nvm install
nvm use

echo "  Node: $(node -v)  npm: $(npm -v)"

# ── 4. Dependencies ──
echo "→ Installing dependencies..."
npm install

# ── 5. Extension ──
echo "→ Building Resonant AI extension..."
cd extensions/resonant-ai
npm install
npx tsc -p tsconfig.json
cd ../..

# ── 6. Compile ──
echo "→ Compiling IDE (this takes ~2 minutes)..."
npm run compile

# ── 7. Create .app wrapper ──
APP_NAME="DevSwat IDE"
APP_DIR="$INSTALL_DIR/$APP_NAME.app"
echo "→ Creating $APP_NAME.app..."

mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Launcher script
cat > "$APP_DIR/Contents/MacOS/DevSwat IDE" << 'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$DIR"
nvm use --silent 2>/dev/null || true
exec "$DIR/scripts/code.sh" "$@"
LAUNCHER
chmod +x "$APP_DIR/Contents/MacOS/DevSwat IDE"

# Info.plist
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>DevSwat IDE</string>
  <key>CFBundleDisplayName</key>
  <string>DevSwat IDE</string>
  <key>CFBundleIdentifier</key>
  <string>com.devswat.ide</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>DevSwat IDE</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# Icon — use existing favicon if available, otherwise skip
if [ -f "$INSTALL_DIR/resources/darwin/code.icns" ]; then
  cp "$INSTALL_DIR/resources/darwin/code.icns" "$APP_DIR/Contents/Resources/icon.icns"
elif [ -f "$INSTALL_DIR/resources/linux/code.png" ]; then
  cp "$INSTALL_DIR/resources/linux/code.png" "$APP_DIR/Contents/Resources/icon.png"
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✓ DevSwat IDE installed successfully!"
echo ""
echo "  Location: $INSTALL_DIR"
echo "  App:      $APP_DIR"
echo ""
echo "  Launch:   double-click '$APP_NAME.app' in Finder"
echo "            or run: $INSTALL_DIR/scripts/code.sh"
echo "══════════════════════════════════════════════════"
echo ""

# ── 8. Launch ──
echo "→ Launching DevSwat IDE..."
exec "$INSTALL_DIR/scripts/code.sh"

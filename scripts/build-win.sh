#!/usr/bin/env bash
# Build Deck OS desktop app (api-server + frontend → deck-win)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Deck OS — Desktop Build Script     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# 1. Build API server
echo "  [1/4] Building API server..."
(cd "$ROOT/core/server" && pnpm run build)
echo "        Done."

# 2. Build frontend
echo "  [2/4] Building frontend (deck-os)..."
(cd "$ROOT/interfaces/desktop" && pnpm run build)
echo "        Done."

# 3. Copy outputs into deck-win
echo "  [3/4] Copying build outputs to deck-win..."
DECK_WIN="$ROOT/interfaces/electron"

rm -rf "$DECK_WIN/api-dist" "$DECK_WIN/frontend-dist"
cp -r "$ROOT/core/server/dist" "$DECK_WIN/api-dist"
cp -r "$ROOT/interfaces/desktop/dist"    "$DECK_WIN/frontend-dist"
echo "        Done."

# 4. Install deck-win deps and build distributable
echo "  [4/4] Building Electron distributable..."
(cd "$DECK_WIN" && npm install && npm run build)

echo ""
echo "  Build complete!  Output: interfaces/electron/dist-win/"
echo ""

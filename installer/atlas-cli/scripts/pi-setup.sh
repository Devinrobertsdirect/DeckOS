#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atlas Pi setup — turn a fresh Raspberry Pi (OS Lite/Desktop, Pi 4 or 5) into a
# SELF-CONTAINED Atlas robot brain: installs Node + pnpm + pigpio, builds Atlas,
# enables GPIO, and installs a systemd service so Atlas auto-starts on boot.
#
# Run it ON the Pi:
#   curl -fsSL https://raw.githubusercontent.com/Devinrobertsdirect/DeckOS/atlas/installer/atlas-cli/scripts/pi-setup.sh | bash
# or, from a copy of the repo on the Pi:
#   bash installer/atlas-cli/scripts/pi-setup.sh
#
# Idempotent — safe to re-run. Note: written for Pi OS (Debian/aarch64); needs a
# real Pi to validate end to end.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${ATLAS_REPO_URL:-https://github.com/Devinrobertsdirect/DeckOS.git}"
BRANCH="${ATLAS_BRANCH:-atlas}"
REPO_DIR="${ATLAS_REPO:-$HOME/DeckOS-Atlas}"

say() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }

say "Atlas Pi setup"
if ! grep -qiE 'raspberry pi|bcm2' /proc/cpuinfo /proc/device-tree/model 2>/dev/null; then
  echo "  Heads-up: this doesn't look like a Raspberry Pi — continuing anyway."
fi

say "1/7 System packages"
sudo apt-get update -y
sudo apt-get install -y git build-essential pigpio

say "2/7 Node.js 22"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

say "3/7 pnpm"
command -v pnpm >/dev/null 2>&1 || sudo npm i -g pnpm

say "4/7 Fetch Atlas"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch origin "$BRANCH" && git -C "$REPO_DIR" checkout "$BRANCH" && git -C "$REPO_DIR" pull --ff-only || true
else
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

say "5/7 Install + build"
pnpm install
pnpm --filter @workspace/deck-os build
( cd core/server && node ./build.mjs )
# pigpio node binding — needed to drive motors/e-stop straight off Pi GPIO.
( cd core/server && npm i pigpio >/dev/null 2>&1 ) || echo "  (pigpio node binding optional — install later for GPIO driving)"

say "6/7 Enable GPIO daemon"
sudo systemctl enable --now pigpiod || true

say "7/7 Autostart service"
SVC=/etc/systemd/system/atlas.service
# A placeholder DATABASE_URL just satisfies the import check; Atlas runs fully
# DB-less (config persists to ~/.atlas/config.json), so no Postgres is required.
sudo tee "$SVC" >/dev/null <<UNIT
[Unit]
Description=Atlas — DeckOS robot brain
After=network-online.target pigpiod.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$REPO_DIR/core/server
ExecStart=/usr/bin/node --max-old-space-size=1024 $REPO_DIR/core/server/dist/index.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=ATLAS_DATA_DIR=$HOME/.atlas
Environment=DATABASE_URL=postgresql://localhost/atlas
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now atlas.service

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Done"
echo "  Atlas is running and will start on every boot."
echo "  Open it:   http://$(hostname).local:8080   (or  http://${IP:-<pi-ip>}:8080)"
echo "  Logs:      journalctl -u atlas -f"
echo "  Free local brain (optional):  cd $REPO_DIR/installer/atlas-cli && node bin/atlas.mjs brain --install"
echo "  Flash a body board (optional): node bin/atlas.mjs flash"

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atlas Pi setup — turn a fresh Raspberry Pi (OS Lite/Desktop, Pi 4 or 5, 64-bit)
# into a SELF-CONTAINED, HEADLESS Atlas robot brain: installs Node + pnpm +
# pigpio, builds Atlas natively for arm64, and installs a systemd service so
# Atlas auto-starts on boot and is reachable at http://<host>.local:8080.
#
# Run it ON the Pi (download-then-run, so sudo can prompt for a password):
#   curl -fsSL https://raw.githubusercontent.com/Devinrobertsdirect/DeckOS/atlas/installer/atlas-cli/scripts/pi-setup.sh -o /tmp/atlas-pi-setup.sh && bash /tmp/atlas-pi-setup.sh
# or, from a copy of the repo on the Pi:
#   bash installer/atlas-cli/scripts/pi-setup.sh
#
# Idempotent — safe to re-run (it hard-resets the checkout to origin each time).
# Targets Raspberry Pi OS (Debian Bookworm, aarch64).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

REPO_URL="${ATLAS_REPO_URL:-https://github.com/Devinrobertsdirect/DeckOS.git}"
BRANCH="${ATLAS_BRANCH:-atlas}"
REPO_DIR="${ATLAS_REPO:-$HOME/DeckOS-Atlas}"

say()  { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$1"; }

say "Atlas Pi setup — headless brain"

# ── Preconditions ────────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || { echo "  Need 'curl' first: sudo apt-get install -y curl"; exit 1; }
if ! grep -qiE 'raspberry pi|bcm2' /proc/cpuinfo /proc/device-tree/model 2>/dev/null; then
  warn "This doesn't look like a Raspberry Pi — continuing anyway (arm64 assumed)."
fi

# sudo up front (so a password prompt happens now, not mid-build), then keep the
# credential warm in the background — the arm64 build can outlast sudo's cache.
if ! sudo -v; then echo "  This setup needs sudo access."; exit 1; fi
( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
SUDO_KEEPALIVE_PID=$!
trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true' EXIT

# ── 1/8 System packages ──────────────────────────────────────────────────────
say "1/8 System packages"
sudo apt-get update -y
# build-essential + python3 = node-gyp toolchain for the pigpio native addon.
sudo apt-get install -y git build-essential python3 pigpio

# ── 2/8 Swap (so the arm64 Vite/Rollup build doesn't OOM on a 1–2GB Pi) ───────
say "2/8 Swap headroom"
RAM_MB="$(free -m | awk '/^Mem:/{print $2}')"; RAM_MB="${RAM_MB:-1024}"
SWAP_MB="$(free -m | awk '/^Swap:/{print $2}')"; SWAP_MB="${SWAP_MB:-0}"
echo "  RAM: ${RAM_MB}MB, swap: ${SWAP_MB}MB"
if [ "$RAM_MB" -lt 2600 ] && [ "$SWAP_MB" -lt 1500 ]; then
  if [ ! -f /swapfile ]; then
    echo "  Adding a 2GB swapfile for the build…"
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile 2>/dev/null || true
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ── 3/8 Node.js 22 ───────────────────────────────────────────────────────────
say "3/8 Node.js 22"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  [ "${NODE_MAJOR:-0}" -ge 20 ] && NEED_NODE=0
fi
if [ "$NEED_NODE" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "  node $(node -v), npm $(npm -v)"

# ── 4/8 pnpm ─────────────────────────────────────────────────────────────────
say "4/8 pnpm"
command -v pnpm >/dev/null 2>&1 || sudo npm i -g pnpm
echo "  pnpm $(pnpm -v)"

# ── 5/8 Fetch Atlas (idempotent hard-reset to origin) ────────────────────────
say "5/8 Fetch Atlas ($BRANCH)"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$REPO_DIR" checkout -q "$BRANCH" 2>/dev/null || git -C "$REPO_DIR" checkout -qB "$BRANCH" "origin/$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

# ── 6/8 Install + build (arm64-native) ───────────────────────────────────────
say "6/8 Install + build (this is the slow part on a Pi — grab that coffee)"
# Only the two packages the brain actually runs — skips the mobile/Expo toolchain.
pnpm install --filter "@workspace/api-server..." --filter "@workspace/deck-os..."

# Size V8's heap to the box (RAM + the swap we just added) so Rollup/esbuild finish.
if   [ "$RAM_MB" -le 1200 ]; then BUILD_HEAP=1536; RUN_HEAP=512;
elif [ "$RAM_MB" -le 2600 ]; then BUILD_HEAP=2048; RUN_HEAP=768;
else                              BUILD_HEAP=3072; RUN_HEAP=1024; fi

NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP" pnpm --filter @workspace/deck-os build
( cd core/server && NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP" node ./build.mjs )

# pigpio native addon — GPIO motor/e-stop driving. Optional: the brain boots
# without it, it just can't move a body. Errors are shown, not hidden.
say "   pigpio (GPIO driving — optional)"
if pnpm --filter @workspace/api-server add pigpio; then
  pnpm --filter @workspace/api-server rebuild pigpio || warn "pigpio built with warnings."
else
  warn "pigpio install failed — Atlas still runs; GPIO body driving will be unavailable."
fi

mkdir -p "$HOME/.atlas"

# ── 7/8 GPIO daemon ──────────────────────────────────────────────────────────
say "7/8 GPIO daemon"
sudo systemctl enable --now pigpiod || warn "pigpiod not enabled (no GPIO driving until it is)."

# ── 8/8 Autostart service ────────────────────────────────────────────────────
say "8/8 Autostart service (boots straight into the brain)"
SVC=/etc/systemd/system/atlas.service
# Placeholder DATABASE_URL only satisfies the import guard; Atlas runs fully
# DB-less (config persists to ~/.atlas/config.json), so no Postgres is required.
sudo tee "$SVC" >/dev/null <<UNIT
[Unit]
Description=Atlas — DeckOS robot brain
After=network-online.target pigpiod.service
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$USER
WorkingDirectory=$REPO_DIR/core/server
ExecStart=/usr/bin/node --max-old-space-size=$RUN_HEAP $REPO_DIR/core/server/dist/index.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=ATLAS_DATA_DIR=$HOME/.atlas
Environment=DATABASE_URL=postgresql://localhost/atlas
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now atlas.service

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
say "Done — Atlas is live and will start on every boot"
echo "  Open it:   http://$(hostname).local:8080   (or  http://${IP:-<pi-ip>}:8080)"
echo "  Status:    systemctl status atlas"
echo "  Logs:      journalctl -u atlas -f"
echo "  Free offline brain (optional):  cd $REPO_DIR/installer/atlas-cli && node bin/atlas.mjs brain --install"
echo "  Flash a body board (optional):  cd $REPO_DIR/installer/atlas-cli && node bin/atlas.mjs flash"

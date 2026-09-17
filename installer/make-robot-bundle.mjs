#!/usr/bin/env node
/*
 * make-robot-bundle.mjs — build ATLAS v0.9, the robot-only distribution.
 *
 * The robot doesn't get the desktop app: it gets ONLY the parts a robot needs —
 * the self-contained server brain, the face/dashboard UI it serves, the body
 * firmware, hardware profiles, and a no-git installer (customers can't clone
 * the private repo; this tarball IS the distribution).
 *
 *   node installer/make-robot-bundle.mjs        →  dist-robot/Atlas-0.9-robot.tar.gz
 *
 * Prereqs: core/server built (node build.mjs) and the frontend built
 * (pnpm --filter @workspace/deck-os build) — run scripts/pack.mjs --stage-only
 * in interfaces/electron, or build both directly.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.9.0";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "dist-robot");
const ROOT = join(OUT, "atlas-robot");

const serverDist = join(REPO, "core", "server", "dist");
const uiDist = join(REPO, "interfaces", "desktop", "dist", "public");
for (const [p, hint] of [
  [join(serverDist, "index.mjs"), "build the server: cd core/server && node build.mjs"],
  [join(uiDist, "index.html"), "build the UI: pnpm --filter @workspace/deck-os build"],
]) {
  if (!existsSync(p)) { console.error(`missing ${p}\n  → ${hint}`); process.exit(1); }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });

// ── only the parts the robot needs ───────────────────────────────────────────
cpSync(serverDist, join(ROOT, "server"), { recursive: true });
cpSync(uiDist, join(ROOT, "ui"), { recursive: true });
cpSync(join(REPO, "robotics", "firmware"), join(ROOT, "firmware"), { recursive: true });
if (existsSync(join(REPO, "robotics", "profiles")))
  cpSync(join(REPO, "robotics", "profiles"), join(ROOT, "profiles"), { recursive: true });
// pi-ops = the die-often resilience kit (kiosk supervisor, watchdog setup,
// CDP eval, chaos test) — proven on the first live robot; every robot gets it.
if (existsSync(join(REPO, "robotics", "pi-ops")))
  cpSync(join(REPO, "robotics", "pi-ops"), join(ROOT, "pi-ops"), { recursive: true });

writeFileSync(join(ROOT, "VERSION"), `${VERSION}\n`);

// ── install.sh — run ON the robot's Pi; no git, no build, no private repo ────
writeFileSync(join(ROOT, "install.sh"), `#!/usr/bin/env bash
# ATLAS v${VERSION} — robot brain installer. Run ON the robot's Pi (or any
# Debian-ish Linux):  bash install.sh
# Installs Node if needed, the serial/GPIO natives, and a systemd service so the
# brain starts on every boot at http://<robot>:8080. Idempotent.
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
say(){ printf '\\n\\033[1;36m== %s ==\\033[0m\\n' "$1"; }

say "ATLAS v${VERSION} — robot brain"
IS_PI=0; grep -qiE 'raspberry pi|bcm2' /proc/cpuinfo /proc/device-tree/model 2>/dev/null && IS_PI=1

say "1/5 Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\\([0-9]*\\).*/\\1/')" -lt 20 ]; then
  # nodejs.org tarball into /opt — far lighter than the NodeSource apt repo on
  # the small SD cards robots ship with (proven on the first live robot).
  NODEVER=v22.12.0
  case "$(uname -m)" in aarch64|arm64) NARCH=arm64 ;; x86_64) NARCH=x64 ;; *) NARCH="" ;; esac
  if [ -n "$NARCH" ]; then
    curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/$NODEVER/node-$NODEVER-linux-$NARCH.tar.xz"
    sudo mkdir -p /opt/nodejs
    sudo tar -xJf /tmp/node.tar.xz -C /opt/nodejs --strip-components=1 && rm -f /tmp/node.tar.xz
    sudo ln -sf /opt/nodejs/bin/node /usr/local/bin/node
    sudo ln -sf /opt/nodejs/bin/npm  /usr/local/bin/npm
    sudo ln -sf /opt/nodejs/bin/npx  /usr/local/bin/npx
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
  fi
fi
node -v

say "2/5 Hardware natives (GPIO + I2C for motor HATs; serial body link)"
cd "$DIR/server"
[ -f package.json ] || echo '{"name":"atlas-robot-server","private":true,"version":"${VERSION}"}' > package.json
npm install --no-save --omit=dev serialport@^13 >/dev/null 2>&1 || echo "  (serialport skipped — USB body link unavailable)"
if [ "$IS_PI" = 1 ]; then
  # Debian trixie DROPPED the pigpio apt package — apt first, source as fallback.
  if ! ldconfig -p 2>/dev/null | grep -q libpigpio; then
    sudo apt-get install -y pigpio >/dev/null 2>&1 || {
      say "  building pigpio from source (trixie has no apt package)"
      curl -fsSL -o /tmp/pigpio.tar.gz https://github.com/joan2937/pigpio/archive/refs/tags/v79.tar.gz
      tar xzf /tmp/pigpio.tar.gz -C /tmp
      make -C /tmp/pigpio-79 -j4 >/dev/null 2>&1 && sudo make -C /tmp/pigpio-79 install >/dev/null 2>&1 && sudo ldconfig
      rm -rf /tmp/pigpio.tar.gz /tmp/pigpio-79
    }
  fi
  npm install --no-save --omit=dev pigpio i2c-bus >/dev/null 2>&1 || echo "  (pigpio/i2c-bus skipped — GPIO/I2C driving unavailable)"
  sudo raspi-config nonint do_i2c 0 2>/dev/null || true
fi

say "3/5 Data dir"
mkdir -p "$HOME/.atlas"

say "4/5 Face kiosk + resilience kit"
if [ -d "$DIR/pi-ops" ]; then
  mkdir -p "$HOME/pi-ops"
  cp -f "$DIR/pi-ops/"* "$HOME/pi-ops/"
  chmod +x "$HOME/pi-ops/"*.sh
  cp -f "$HOME/pi-ops/neura-kiosk.sh" "$HOME/neura-kiosk.sh" && chmod +x "$HOME/neura-kiosk.sh"
  mkdir -p "$HOME/.config/autostart"
  tee "$HOME/.config/autostart/neura-face.desktop" >/dev/null <<DESK
[Desktop Entry]
Type=Application
Name=Nobi Face
Exec=$HOME/neura-kiosk.sh
X-GNOME-Autostart-enabled=true
DESK
  sudo bash "$HOME/pi-ops/setup-hardening.sh" || true
fi

say "5/5 Autostart service"
sudo tee /etc/systemd/system/atlas.service >/dev/null <<UNIT
[Unit]
Description=ATLAS v${VERSION} — Nobi robot brain
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$USER
WorkingDirectory=$DIR/server
ExecStart=$(command -v node) --max-old-space-size=768 $DIR/server/index.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=ATLAS_DATA_DIR=$HOME/.atlas
Environment=DATABASE_URL=postgresql://127.0.0.1/neura
Environment=ELECTRON_STATIC=1
Environment=ELECTRON_FRONTEND_DIST=$DIR/ui
# Driving an Adeept Motor HAT V2? Uncomment the profile and switch User= to
# root (the pigpio C lib needs /dev/mem for its PWM timing):
#Environment=ATLAS_PROFILE=adeept-motorhat-v2
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now atlas.service

say "Bluetooth auto-reconnect (mic + speaker)"
# Keep the paired headset/speaker connected on its own — connects it within
# seconds of being powered on, selects the HFP profile so the mic works, and
# makes it the default sink+source. Generated with this box's user/home/uid.
if [ -f "$HOME/pi-ops/neura-bt-reconnect.sh" ]; then
  sudo tee /etc/systemd/system/neura-bt-reconnect.service >/dev/null <<UNIT
[Unit]
Description=Nobi Bluetooth auto-reconnect (mic + speaker)
After=bluetooth.target
Wants=bluetooth.target

[Service]
Type=simple
User=$USER
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
ExecStart=/usr/bin/env bash $HOME/pi-ops/neura-bt-reconnect.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now neura-bt-reconnect.service || true
  echo "  bluetooth auto-reconnect: enabled"
fi

say "Done — the brain is live"
echo "  Open:   http://$(hostname).local:8080   (robot face + full dashboard)"
echo "  Logs:   journalctl -u atlas -f"
echo "  Kiosk face on an attached screen:  chromium-browser --kiosk http://localhost:8080"
`, { mode: 0o755 });

// ── run.sh — foreground run (bench testing) ──────────────────────────────────
writeFileSync(join(ROOT, "run.sh"), `#!/usr/bin/env bash
# Run the ATLAS brain in the foreground (bench testing; Ctrl-C stops it).
# NODE_ENV=production is REQUIRED: the bundle is cross-built, and the dev-only
# pretty-logger transport bakes the build machine's absolute worker path into
# the bundle — on any other machine it crashes at boot. Production skips it.
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/server"
NODE_ENV=production \\
PORT=\${PORT:-8080} ATLAS_DATA_DIR="\${ATLAS_DATA_DIR:-$HOME/.atlas}" \\
DATABASE_URL="\${DATABASE_URL:-postgresql://127.0.0.1/neura}" \\
ELECTRON_STATIC=1 ELECTRON_FRONTEND_DIST="$DIR/ui" \\
exec node index.mjs
`, { mode: 0o755 });

// ── README ───────────────────────────────────────────────────────────────────
writeFileSync(join(ROOT, "README.md"), `# ATLAS v${VERSION} — robot brain

This is the robot-only build of the Nobi system: exactly the parts a robot
needs, nothing else.

- \`server/\`   — the brain (self-contained Node bundle: chat, memory, skills,
  voice, the AI router, and the hardware layer that drives bodies over the
  Atlas Wire Protocol).
- \`ui/\`       — the face + dashboard the brain serves at port 8080.
- \`firmware/\` — body sketches for Arduino Nano / ESP32 drive bases and the
  ESP32 face panel (flash with Arduino IDE or the \`atlas flash\` tool).
- \`profiles/\` — hardware profiles.
- \`install.sh\` — one-command setup on the robot's Pi (Node, natives, autostart).
- \`run.sh\`    — foreground run for bench testing.

## Quick start (on the robot's Raspberry Pi)

\`\`\`bash
tar xzf Atlas-${VERSION}-robot.tar.gz
cd atlas-robot
bash install.sh
\`\`\`

Then open \`http://<robot>.local:8080\`. The brain auto-connects to a plugged-in
body board, runs fully offline out of the box, and gets smarter when you add
cloud AI keys in Settings. Your companion is a Nobi — name it once and it
answers to that name (and to "Nobi") everywhere, including here.
`);

// ── tarball ──────────────────────────────────────────────────────────────────
const tarName = `Atlas-${VERSION}-robot.tar.gz`;
const tar = process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
execFileSync(tar, ["-czf", join(OUT, tarName), "-C", OUT, "atlas-robot"], { stdio: "inherit" });
console.log(`\n✓ ${join(OUT, tarName)}`);

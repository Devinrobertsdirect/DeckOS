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

say "1/4 Node.js"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\\([0-9]*\\).*/\\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
fi
node -v

say "2/4 Hardware natives (serial body link; GPIO on a Pi)"
cd "$DIR/server"
[ -f package.json ] || echo '{"name":"atlas-robot-server","private":true,"version":"${VERSION}"}' > package.json
npm install --no-save --omit=dev serialport@^13 >/dev/null 2>&1 || echo "  (serialport skipped — USB body link unavailable)"
if [ "$IS_PI" = 1 ]; then
  sudo apt-get install -y pigpio >/dev/null 2>&1 || true
  sudo systemctl enable --now pigpiod 2>/dev/null || true
  npm install --no-save --omit=dev pigpio >/dev/null 2>&1 || echo "  (pigpio skipped — GPIO driving unavailable)"
fi

say "3/4 Data dir"
mkdir -p "$HOME/.atlas"

say "4/4 Autostart service"
sudo tee /etc/systemd/system/atlas.service >/dev/null <<UNIT
[Unit]
Description=ATLAS v${VERSION} — Neura robot brain
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
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now atlas.service

say "Done — the brain is live"
echo "  Open:   http://$(hostname).local:8080   (robot face + full dashboard)"
echo "  Logs:   journalctl -u atlas -f"
echo "  Kiosk face on an attached screen:  chromium-browser --kiosk http://localhost:8080"
`, { mode: 0o755 });

// ── run.sh — foreground run (bench testing) ──────────────────────────────────
writeFileSync(join(ROOT, "run.sh"), `#!/usr/bin/env bash
# Run the ATLAS brain in the foreground (bench testing; Ctrl-C stops it).
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/server"
PORT=\${PORT:-8080} ATLAS_DATA_DIR="\${ATLAS_DATA_DIR:-$HOME/.atlas}" \\
DATABASE_URL="\${DATABASE_URL:-postgresql://127.0.0.1/neura}" \\
ELECTRON_STATIC=1 ELECTRON_FRONTEND_DIST="$DIR/ui" \\
exec node index.mjs
`, { mode: 0o755 });

// ── README ───────────────────────────────────────────────────────────────────
writeFileSync(join(ROOT, "README.md"), `# ATLAS v${VERSION} — robot brain

This is the robot-only build of the Neura system: exactly the parts a robot
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
cloud AI keys in Settings. Your companion is a Neura — name it once and it
answers to that name (and to "Neura") everywhere, including here.
`);

// ── tarball ──────────────────────────────────────────────────────────────────
const tarName = `Atlas-${VERSION}-robot.tar.gz`;
const tar = process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";
execFileSync(tar, ["-czf", join(OUT, tarName), "-C", OUT, "atlas-robot"], { stdio: "inherit" });
console.log(`\n✓ ${join(OUT, tarName)}`);

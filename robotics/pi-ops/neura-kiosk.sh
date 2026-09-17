#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# neura-kiosk.sh v3 — Chromium kiosk SUPERVISOR for the Nobi face (480x480
# round screen, Wayland/labwc, user devindungeon). The robot gets power-yanked
# constantly in the field, so this never trusts a single launch:
#   boot:  wait for the brain (/api/healthz, max 120s) AND for the cold-boot
#          launch storm to settle (1-min loadavg < 1.5, max ~80s) — launching
#          into the storm is how you get white screens.
#   then:  loop forever — sanitize the Chromium profile (no "restore pages?"
#          bubble after a hard cut), launch, wait, log the death to
#          ~/kiosk-boot.log, relaunch after 3s.
# v3: supervision replaces the old insurance-reload hack — it's gone.
# Start from labwc autostart:  ~/pi-ops/neura-kiosk.sh &
# ─────────────────────────────────────────────────────────────────────────────
set -u

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
HOME="${HOME:-/home/devindungeon}"

HEALTH_URL="http://localhost:8080/api/healthz"
LOG="$HOME/kiosk-boot.log"
CHROME_DIR="$HOME/.config/chromium"
PREFS="$CHROME_DIR/Default/Preferences"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

# Debian ships `chromium`, Raspberry Pi OS ships `chromium-browser` — take either.
CHROMIUM="$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || true)"
[ -n "$CHROMIUM" ] || { log "FATAL: no chromium binary on PATH"; exit 1; }

CHROME_ARGS=(
  --kiosk
  --ozone-platform=wayland
  --app="http://localhost:8080/?screen=round"
  --noerrdialogs
  --disable-infobars
  --no-first-run
  --disable-session-crashed-bubble
  --disable-features=Translate
  --password-store=basic
  --check-for-update-interval=31536000
  --remote-debugging-port=9222
  --use-fake-ui-for-media-stream
  --autoplay-policy=no-user-gesture-required
)

log "supervisor v3 up (pid $$) — waiting for the brain"

# ── Boot gate 1: the brain answers (max 120s, then launch anyway) ────────────
waited=0
until curl -fsS -m 2 "$HEALTH_URL" >/dev/null 2>&1; do
  waited=$((waited + 2))
  if [ "$waited" -ge 120 ]; then log "healthz not up after 120s — launching anyway"; break; fi
  sleep 2
done
[ "$waited" -lt 120 ] && log "healthz up after ~${waited}s"

# ── Boot gate 2: cold-boot launch storm settled (loadavg < 1.5, max ~80s) ────
waited=0
while :; do
  load="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)"
  if awk -v l="$load" 'BEGIN{exit (l < 1.5) ? 0 : 1}'; then log "loadavg $load — clear to launch"; break; fi
  waited=$((waited + 4))
  if [ "$waited" -ge 80 ]; then log "loadavg still $load after ${waited}s — launching anyway"; break; fi
  sleep 4
done

# ── Supervise forever: sanitize → launch → wait → log death → relaunch ───────
while :; do
  # A hard power cut leaves "crashed" state behind; scrub it so Chromium comes
  # up clean instead of showing the session-restore bubble (or refusing the lock).
  if [ -f "$PREFS" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/g; s/"exit_type":"[^"]*"/"exit_type":"Normal"/g' "$PREFS" 2>/dev/null || true
  fi
  rm -f "$CHROME_DIR"/Singleton* 2>/dev/null || true

  "$CHROMIUM" "${CHROME_ARGS[@]}" >/dev/null 2>&1 &
  chrome_pid=$!
  log "chromium launched (pid $chrome_pid)"
  wait "$chrome_pid"
  rc=$?
  log "chromium died (exit $rc) — relaunch in 3s"
  sleep 3
done

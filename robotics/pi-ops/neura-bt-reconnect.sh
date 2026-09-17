#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# neura-bt-reconnect.sh — keep Nobi's Bluetooth audio (mic + speaker) connected.
#
# bluez auto-reconnects a trusted device only when the DEVICE initiates; a headset
# powered on after the robot booted won't. So the robot initiates: every INTERVAL
# it (re)connects trusted audio devices — the LAST one it used first (affinity) —
# then hands off to bt-audio-route.mjs to select the HFP profile (mic works) and
# make it the default sink + source. Net effect: unplug the robot, plug it back
# in, flip the headphones on five minutes later, and it connects on its own.
#
# Runs as a systemd service (User=devindungeon, XDG_RUNTIME_DIR set for wpctl).
# Env: NEURA_BT_INTERVAL (default 15s).
# ─────────────────────────────────────────────────────────────────────────────
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
HOME="${HOME:-/home/devindungeon}"
INTERVAL="${NEURA_BT_INTERVAL:-15}"
STATE="$HOME/.atlas/bt-last-audio"
ROUTE="$HOME/pi-ops/bt-audio-route.mjs"
NODE="$(command -v node 2>/dev/null || echo /opt/nodejs/bin/node)"

log() { printf '[bt-reconnect] %s\n' "$*"; }
bctl() { bluetoothctl "$@" 2>/dev/null; }

mkdir -p "$(dirname "$STATE")"

# Paired MACs that are audio devices (headset / speaker / headphones).
audio_macs() {
  bctl devices Paired | awk '{print $2}' | while read -r m; do
    [ -n "$m" ] || continue
    if bctl info "$m" | grep -qiE 'Icon: audio|Audio Sink|Audio Source|Headset|Handsfree|Headphone'; then
      echo "$m"
    fi
  done
}
is_connected() { bctl info "$1" | grep -q 'Connected: yes'; }

log "up — interval ${INTERVAL}s"
last=""; [ -f "$STATE" ] && last="$(cat "$STATE" 2>/dev/null)"
prev=""

while :; do
  # Controller must be powered.
  bctl show | grep -q 'Powered: yes' || bctl power on >/dev/null

  # Ordered candidates: last-used first (affinity), then any other audio device.
  ordered="$(printf '%s\n%s\n' "$last" "$(audio_macs)" | awk 'NF' | awk '!seen[$0]++')"

  connected=""
  for mac in $ordered; do
    if is_connected "$mac"; then connected="$mac"; break; fi
    bctl trust "$mac" >/dev/null
    if bctl connect "$mac" | grep -qiE 'Connection successful|Connected: yes'; then
      log "connected $mac"
      sleep 2
      connected="$mac"
      break
    fi
  done

  # On a NEW connection (or first detection), select HFP + default routing once.
  if [ -n "$connected" ] && [ "$connected" != "$prev" ]; then
    "$NODE" "$ROUTE" "$connected" >/dev/null 2>&1 && log "routed $connected (HFP mic + default sink/source)"
    echo "$connected" > "$STATE"
    last="$connected"
  fi
  prev="$connected"

  sleep "$INTERVAL"
done

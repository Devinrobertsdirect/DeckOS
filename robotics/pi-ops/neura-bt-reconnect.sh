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
# Env: NEURA_BT_INTERVAL (default 15s), NEURA_BT_SCAN_S (discovery burst when nothing
# is connected, default 5s), NEURA_BT_SCAN_EVERY (seconds between bursts, default 45).
#
# The discovery burst is kept to a LOW duty cycle on purpose: Bluetooth discovery
# and WiFi share the Pi's 2.4 GHz radio, and an 8s scan every 15s cycle measured
# 12-27% WiFi packet loss (SSH sessions dying, cloud brain calls stalling). 5s
# every 45s (~11%) still catches a speaker in pairing mode within a minute.
# ─────────────────────────────────────────────────────────────────────────────
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
HOME="${HOME:-/home/devindungeon}"
INTERVAL="${NEURA_BT_INTERVAL:-15}"
SCAN_S="${NEURA_BT_SCAN_S:-5}"
SCAN_EVERY="${NEURA_BT_SCAN_EVERY:-45}"
# Boot pairing window (Devin: "built in pairing when it starts up for 120 seconds").
# For this long after start the robot is openly in pairing mode: discoverable,
# scanning nearly continuously, retrying every few seconds. A speaker switched
# on at the same time as the robot pairs itself before anyone thinks about it.
# After the window it drops back to the low-duty cycle that keeps WiFi healthy.
BOOT_WINDOW="${NEURA_BT_BOOT_WINDOW:-120}"
BOOT_INTERVAL="${NEURA_BT_BOOT_INTERVAL:-5}"
BOOT_SCAN_EVERY="${NEURA_BT_BOOT_SCAN_EVERY:-8}"
# …and the same fast search for this long after a speaker DROPS (Devin: "if it
# disconnects it should search for a new connection for the following 60s").
LOST_WINDOW="${NEURA_BT_LOST_WINDOW:-60}"
started=$(date +%s)
window_until=$(( started + BOOT_WINDOW ))
last_scan=0
STATE="$HOME/.atlas/bt-last-audio"
ROUTE="$HOME/pi-ops/bt-audio-route.mjs"
NODE="$(command -v node 2>/dev/null || echo /opt/nodejs/bin/node)"

log() { printf '[bt-reconnect] %s\n' "$*"; }
bctl() { bluetoothctl "$@" 2>/dev/null; }
# connect/pair block for MINUTES on a paired device that is switched off, which
# stalls the whole loop — cap them so an absent speaker costs seconds, not cycles.
bctl_try() { timeout "$1" bluetoothctl "${@:2}" 2>/dev/null; }

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

log "up — pairing window ${BOOT_WINDOW}s (every ${BOOT_INTERVAL}s), then interval ${INTERVAL}s"
last=""; [ -f "$STATE" ] && last="$(cat "$STATE" 2>/dev/null)"
prev=""
in_window=1
power_fail=0

while :; do
  # Still inside the boot window? Everything is faster and the robot is discoverable.
  if [ "$in_window" = 1 ] && [ $(date +%s) -ge "$window_until" ]; then
    in_window=0
    bctl discoverable off >/dev/null
    log "search window closed — normal cadence (${INTERVAL}s, scan every ${SCAN_EVERY}s)"
  fi
  if [ "$in_window" = 1 ]; then cycle="$BOOT_INTERVAL"; scan_every="$BOOT_SCAN_EVERY"; else cycle="$INTERVAL"; scan_every="$SCAN_EVERY"; fi

  # Controller must be powered. If it will not power on, the chip's firmware has
  # hung (HCI_Reset times out) and only a reboot brings it back — say so loudly
  # rather than retrying in silence for hours.
  if ! bctl show | grep -q 'Powered: yes'; then
    if bctl power on | grep -q 'Changing power on succeeded'; then power_fail=0
    else
      power_fail=$((power_fail + 1))
      [ "$power_fail" = 3 ] && log "BLUETOOTH CONTROLLER WEDGED — power on keeps failing; a reboot is the only fix"
      sleep "$cycle"; continue
    fi
  fi
  if [ "$in_window" = 1 ]; then bctl discoverable on >/dev/null; bctl pairable on >/dev/null; fi

  # Ordered candidates: last-used first (affinity), then any other audio device.
  ordered="$(printf '%s\n%s\n' "$last" "$(audio_macs)" | awk 'NF' | awk '!seen[$0]++')"

  connected=""
  for mac in $ordered; do
    if is_connected "$mac"; then connected="$mac"; break; fi
    bctl trust "$mac" >/dev/null
    if bctl_try 12 connect "$mac" | grep -qiE 'Connection successful|Connected: yes'; then
      log "connected $mac"
      sleep 2
      connected="$mac"
      break
    fi
  done

  # Nothing on? Go looking. Any speaker/headphones in pairing mode gets paired,
  # trusted and connected — audio-class devices only (Audio Sink / Headset), never
  # a phone or laptop. Runs every cycle while unconnected = "always in pairing".
  if [ -z "$connected" ] && [ $(( $(date +%s) - last_scan )) -ge "$scan_every" ]; then
    last_scan=$(date +%s)
    bctl --timeout "$SCAN_S" scan on >/dev/null 2>&1 || true
    for mac in $(bctl devices | awk '{print $2}'); do
      info="$(bctl info "$mac")"
      echo "$info" | grep -q 'Paired: yes' && continue
      echo "$info" | grep -qiE 'Audio Sink|Headset|Handsfree|Headphone|Icon: audio' || continue
      name="$(echo "$info" | sed -n 's/^[[:space:]]*Name: //p' | head -1)"
      log "pairing with $name ($mac)"
      if bctl_try 25 pair "$mac" | grep -qiE 'Pairing successful|AlreadyExists'; then
        bctl trust "$mac" >/dev/null
        if bctl_try 12 connect "$mac" | grep -qiE 'Connection successful|Connected: yes'; then
          log "connected NEW device $name ($mac)"
          sleep 2
          connected="$mac"
          break
        fi
      fi
    done
  fi

  # Route on any (re)connection, not only a new address: a speaker that drops
  # and comes back keeps its MAC, and a route set up before the drop is gone.
  # Also re-route whenever PipeWire's default sink is no longer this device —
  # that is exactly the "connected but Nobi can't hear or speak" state.
  if [ -n "$connected" ]; then
    name="$(bctl info "$connected" | sed -n 's/^[[:space:]]*Name: //p' | head -1)"
    routed=0
    wpctl status 2>/dev/null | awk '/Sinks:/{f=1} /Sources:/{f=0} f' | grep -F '*' | grep -qF "${name:-bluez}" && routed=1
    if [ "$connected" != "$prev" ] || [ "$routed" = 0 ]; then
      "$NODE" "$ROUTE" "$connected" >/dev/null 2>&1 && log "routed $connected ${name:+($name)} (HFP mic + default sink/source)"
      echo "$connected" > "$STATE"
      last="$connected"
    fi
  elif [ -n "$prev" ]; then
    # a drop opens a fresh fast-search window: discoverable, quick retries, scanning
    window_until=$(( $(date +%s) + LOST_WINDOW )); in_window=1; last_scan=0
    log "lost $prev — searching hard for ${LOST_WINDOW}s (every ${BOOT_INTERVAL}s, scan every ${BOOT_SCAN_EVERY}s)"
  fi
  prev="$connected"

  sleep "$cycle"
done

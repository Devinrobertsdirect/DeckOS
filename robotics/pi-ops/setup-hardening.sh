#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-hardening.sh — one-time Pi hardening for a robot that gets its power
# yanked in the field. Run ON the Pi:  sudo bash setup-hardening.sh
#   (a) hardware watchdog: dtparam=watchdog=on + systemd RuntimeWatchdogSec so
#       a wedged kernel/userland reboots itself instead of sitting dark
#   (b) journald to RAM (Storage=volatile) — hard cuts stop eating the SD card
#   (c) verify fsck.repair=yes is in cmdline.txt (report only, never edits)
# Idempotent — re-running reports "already set" instead of re-writing.
# Targets Raspberry Pi OS / Debian trixie (/boot/firmware layout).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo bash $0"; exit 1; }

CHANGED=()
ALREADY=()

# Write $2 to $1 only if it differs; track which bucket it landed in.
write_conf() {
  if [ -f "$1" ] && [ "$(cat "$1")" = "$2" ]; then
    ALREADY+=("$1")
  else
    mkdir -p "$(dirname "$1")"
    printf '%s\n' "$2" > "$1"
    CHANGED+=("wrote $1")
  fi
}

say "1/3 Hardware watchdog"
CONFIG=/boot/firmware/config.txt
if [ ! -f "$CONFIG" ]; then
  warn "$CONFIG not found — not a /boot/firmware Pi? Skipping dtparam."
elif grep -qE '^[[:space:]]*dtparam=watchdog=on' "$CONFIG"; then
  ALREADY+=("dtparam=watchdog=on in $CONFIG")
else
  printf '\n# Hardware watchdog (added by setup-hardening.sh)\ndtparam=watchdog=on\n' >> "$CONFIG"
  CHANGED+=("added dtparam=watchdog=on to $CONFIG")
fi
# systemd pets the watchdog every 15s; a hung boot/shutdown hard-reboots in 2min.
write_conf /etc/systemd/system.conf.d/10-watchdog.conf \
'[Manager]
RuntimeWatchdogSec=15s
RebootWatchdogSec=2min'

say "2/3 Journald SD-card protection"
write_conf /etc/systemd/journald.conf.d/10-volatile.conf \
'[Journal]
Storage=volatile
RuntimeMaxUse=32M'
systemctl restart systemd-journald 2>/dev/null || warn "journald restart failed — takes effect on reboot."

say "3/3 fsck on boot (verify only)"
CMDLINE=/boot/firmware/cmdline.txt
if [ -f "$CMDLINE" ] && grep -qE '(^| )fsck\.repair=yes( |$)' "$CMDLINE"; then
  ALREADY+=("fsck.repair=yes in $CMDLINE")
else
  warn "fsck.repair=yes MISSING from $CMDLINE — add it manually (single line, space-separated)."
fi

say "Summary"
if [ "${#CHANGED[@]}" -gt 0 ]; then
  for c in "${CHANGED[@]}"; do echo "  changed:     $c"; done
else
  echo "  changed:     nothing"
fi
if [ "${#ALREADY[@]}" -gt 0 ]; then
  for a in "${ALREADY[@]}"; do echo "  already set: $a"; done
fi
[ "${#CHANGED[@]}" -gt 0 ] && echo "  Reboot to arm the watchdog:  sudo reboot"
exit 0

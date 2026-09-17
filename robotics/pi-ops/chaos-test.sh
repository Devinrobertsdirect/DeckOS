#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# chaos-test.sh — prove the die-often story: kill -9 Chromium N times (default
# 3) and verify the supervisor resurrects the Nobi face every time.
# Per cycle: pkill -9 → wait ≤60s for DevTools (:9222) to show the kiosk page
# → cdp-eval "document.title" must contain "Nobi". Run ON the Pi:
#   bash chaos-test.sh [cycles]
# Exit 0 only if every cycle passes.
# ─────────────────────────────────────────────────────────────────────────────
set -u

CYCLES="${1:-3}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

for n in $(seq 1 "$CYCLES"); do
  echo "── cycle $n/$CYCLES ──"
  pkill -9 chromium 2>/dev/null || true   # matches chromium and chromium-browser
  sleep 2

  # Wait for the supervisor to relaunch and DevTools to expose the kiosk page
  up=0 waited=0
  while [ "$waited" -lt 60 ]; do
    if curl -fsS -m 2 http://127.0.0.1:9222/json 2>/dev/null | grep -q 'localhost:8080'; then
      up=1
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done

  ok=0 title=""
  if [ "$up" = 1 ]; then
    title="$(node "$DIR/cdp-eval.mjs" 'document.title' 2>/dev/null || true)"
    case "$title" in *Nobi*) ok=1 ;; esac
  fi

  if [ "$ok" = 1 ]; then
    echo "  PASS — face back in ~${waited}s, title checks out"
  else
    echo "  FAIL — devtools up=$up after ${waited}s, title: ${title:-n/a}"
    FAIL=$((FAIL + 1))
  fi
done

echo
if [ "$FAIL" -eq 0 ]; then
  echo "chaos-test: $CYCLES/$CYCLES PASS — the face always comes back"
  exit 0
else
  echo "chaos-test: $((CYCLES - FAIL))/$CYCLES pass, $FAIL FAIL"
  exit 1
fi

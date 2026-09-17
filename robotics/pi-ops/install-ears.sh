#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-ears.sh — one-time, idempotent setup for Nobi's local ears (Vosk STT).
# The robot's Chromium can't transcribe on Linux, so we run STT on-device. Run
# ON the Pi:  bash install-ears.sh
#   (a) python venv at ~/.atlas/ears-venv with vosk + requests
#   (b) small English model unzipped + FLATTENED into ~/.atlas/vosk-model
#       (model files — am/ conf/ graph/ … — sit directly in that dir, no nesting)
# Re-running is safe: an existing venv/model is detected and left alone.
#
# MODEL: defaults to the accurate 'lgraph' English model (~128MB) — it hears full
# sentences far better than the tiny model, which is what makes Nobi a good
# listener. Override with NEURA_MODEL_URL (e.g. the ~50MB small model on a very
# tight card). Force a re-download after changing it with: rm -rf ~/.atlas/vosk-model
# Footprint: lgraph model ~150MB + venv ~70MB ≈ 220MB of ~680MB free — mind the card.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ATLAS_DIR="$HOME/.atlas"
VENV="$ATLAS_DIR/ears-venv"
MODEL_DIR="$ATLAS_DIR/vosk-model"
MODEL_URL="${NEURA_MODEL_URL:-https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip}"

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$1"; }

mkdir -p "$ATLAS_DIR"

say "1/2 Python venv (vosk + requests)"
if [ -x "$VENV/bin/python" ]; then
  echo "  already: $VENV"
else
  python3 -m venv "$VENV"
  echo "  created: $VENV"
fi
# pip is idempotent — this only pulls what's missing/outdated.
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet vosk requests
echo "  vosk + requests present"

say "2/2 Vosk English model"
# conf/ is mandatory in a flattened Vosk model — its presence means we're done.
if [ -d "$MODEL_DIR/conf" ]; then
  echo "  already: $MODEL_DIR"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "  downloading $(basename "$MODEL_URL") ..."
  curl -fL# -o "$tmp/model.zip" "$MODEL_URL"
  echo "  unzipping ..."
  unzip -q "$tmp/model.zip" -d "$tmp"
  # The zip holds a single top dir (vosk-model-small-en-us-0.15/); flatten it so
  # Vosk's Model() can point straight at $MODEL_DIR.
  inner="$(find "$tmp" -maxdepth 1 -type d -name 'vosk-model-*' | head -n1)"
  [ -n "$inner" ] || { warn "unexpected zip layout — no vosk-model-* dir inside"; exit 1; }
  rm -rf "$MODEL_DIR"            # clear any partial dir from a failed run
  mkdir -p "$MODEL_DIR"
  mv "$inner"/* "$MODEL_DIR"/    # move CONTENTS up (am/ conf/ graph/ … → MODEL_DIR)
  echo "  installed: $MODEL_DIR"
fi

say "Sizes"
du -sh "$VENV" "$MODEL_DIR" 2>/dev/null || true

echo
echo "done"

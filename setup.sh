#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deck OS — Local Setup Script
# Supports Linux and macOS (bash 4+)
#
# Usage:
#   bash setup.sh              — bare-metal setup (Node + pnpm + Postgres)
#   bash setup.sh --start      — bare-metal setup then start dev servers
#   bash setup.sh --docker     — Docker Compose setup (recommended, easiest)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"; RESET="\033[0m"

log()  { echo -e "${BOLD}${CYAN}[deck-os]${RESET} $*"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $*"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $*"; }
fail() { echo -e "${RED}  ✗ ERROR:${RESET} $*" >&2; exit 1; }

START_SERVERS=false
USE_DOCKER=false
for arg in "$@"; do
  [[ "$arg" == "--start"  ]] && START_SERVERS=true
  [[ "$arg" == "--docker" ]] && USE_DOCKER=true
done

echo ""
echo -e "${BOLD}${CYAN}  ██████╗ ███████╗ ██████╗██╗  ██╗     ██████╗ ███████╗${RESET}"
echo -e "${BOLD}${CYAN}  ██╔══██╗██╔════╝██╔════╝██║ ██╔╝    ██╔═══██╗██╔════╝${RESET}"
echo -e "${BOLD}${CYAN}  ██║  ██║█████╗  ██║     █████╔╝     ██║   ██║███████╗${RESET}"
echo -e "${BOLD}${CYAN}  ██║  ██║██╔══╝  ██║     ██╔═██╗     ██║   ██║╚════██║${RESET}"
echo -e "${BOLD}${CYAN}  ██████╔╝███████╗╚██████╗██║  ██╗    ╚██████╔╝███████║${RESET}"
echo -e "${BOLD}${CYAN}  ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝     ╚═════╝ ╚══════╝${RESET}"
echo ""
log "JARVIS Command Center — Local Setup"
echo ""

# ─────────────────────────────────────
# Docker Compose fast-path
# ─────────────────────────────────────
if [[ "$USE_DOCKER" == true ]]; then
  log "Docker Compose mode selected"

  if ! command -v docker &>/dev/null; then
    fail "Docker not found. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
  fi
  ok "Docker found: $(docker --version | head -1)"

  if ! docker info &>/dev/null; then
    fail "Docker daemon is not running. Start Docker Desktop and try again."
  fi
  ok "Docker daemon is running"

  if [[ ! -f .env ]]; then
    cp .env.example .env
    ok "Created .env from .env.example"
    warn "Edit .env to add optional API keys (Ollama is auto-detected on the host)."
    echo ""
    read -r -p "  Press ENTER to continue, or Ctrl+C to edit .env first: "
  else
    ok ".env already exists (skipping copy)"
  fi

  log "Starting all services via Docker Compose..."
  echo "  (Building images on first run — this may take a few minutes)"
  echo ""
  docker compose up -d --build

  echo ""
  echo -e "${GREEN}${BOLD}  ✓ Deck OS is running!${RESET}"
  echo ""
  echo "  Frontend   →  http://localhost:3000"
  echo "  API server →  http://localhost:8080"
  echo "  Logs:          docker compose logs -f"
  echo "  Stop:          docker compose down"
  echo ""
  exit 0
fi

# ─────────────────────────────────────
# 1. Node.js
# ─────────────────────────────────────
log "Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org"
fi
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node.js 20+ required (found v${NODE_VERSION}). Upgrade from https://nodejs.org"
fi
ok "Node.js v${NODE_VERSION}"

# ─────────────────────────────────────
# 2. pnpm
# ─────────────────────────────────────
log "Checking pnpm..."
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found. Installing via corepack..."
  corepack enable
  corepack prepare pnpm@latest --activate || npm install -g pnpm
fi
PNPM_VERSION=$(pnpm --version)
ok "pnpm v${PNPM_VERSION}"

# ─────────────────────────────────────
# 3. PostgreSQL
# ─────────────────────────────────────
log "Checking PostgreSQL..."
if command -v pg_isready &>/dev/null; then
  if pg_isready -q 2>/dev/null; then
    ok "PostgreSQL is running"
    # Try to provision DB/user (no-ops silently if they already exist)
    if command -v psql &>/dev/null; then
      psql -U postgres -c "CREATE ROLE deckos WITH LOGIN PASSWORD 'deckos';" 2>/dev/null && ok "Created DB user 'deckos'" || true
      psql -U postgres -c "CREATE DATABASE deckos OWNER deckos;" 2>/dev/null && ok "Created database 'deckos'" || true
    fi
  else
    warn "PostgreSQL found but not responding. Make sure it is started:"
    warn "  macOS (Homebrew):   brew services start postgresql@16"
    warn "  Linux (systemd):    sudo systemctl start postgresql"
    warn "  Docker:             docker-compose up -d postgres"
  fi
elif command -v psql &>/dev/null; then
  warn "psql found but pg_isready not in PATH. Assuming Postgres is available."
  psql -U postgres -c "CREATE ROLE deckos WITH LOGIN PASSWORD 'deckos';" 2>/dev/null && ok "Created DB user 'deckos'" || true
  psql -U postgres -c "CREATE DATABASE deckos OWNER deckos;" 2>/dev/null && ok "Created database 'deckos'" || true
else
  warn "PostgreSQL client tools not found."
  warn "Install:  brew install postgresql@16  (macOS)"
  warn "          sudo apt install postgresql  (Ubuntu/Debian)"
  warn "          Or use Docker: docker-compose up -d postgres"
fi

# ─────────────────────────────────────
# 4. Ollama (optional)
# ─────────────────────────────────────
log "Checking Ollama (optional)..."
if command -v ollama &>/dev/null; then
  OLLAMA_VER=$(ollama --version 2>/dev/null | head -1 || echo "unknown")
  ok "Ollama found: ${OLLAMA_VER}"
  if ! curl -s --max-time 2 http://localhost:11434/api/tags &>/dev/null; then
    warn "Ollama is installed but not running."
    warn "Start it with:  ollama serve"
  else
    ok "Ollama is running"
    log "  Tip: pull the default models if you haven't already:"
    echo "       ollama pull gemma4"
    echo "       ollama pull phi3"
  fi
else
  warn "Ollama not found. Deck OS will run in rule-engine fallback mode."
  warn "Install from: https://ollama.com"
fi

# ─────────────────────────────────────
# 5. .env file
# ─────────────────────────────────────
log "Setting up environment..."
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok "Created .env from .env.example"
  warn "Edit .env and set DATABASE_URL before continuing."
  echo ""
  read -r -p "  Press ENTER after editing .env to continue, or Ctrl+C to stop now: "
else
  ok ".env already exists (skipping copy)"
fi

# Load .env into the current shell so DATABASE_URL is available for migrations
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  ok "Loaded environment from .env"
fi

# ─────────────────────────────────────
# 6. Dependencies
# ─────────────────────────────────────
log "Installing dependencies..."
pnpm install --frozen-lockfile 2>&1 | tail -5
ok "Dependencies installed"

# ─────────────────────────────────────
# 7. Database migrations
# ─────────────────────────────────────
log "Running database migrations..."
if pnpm --filter @workspace/db run push 2>&1; then
  ok "Database schema up to date"
else
  fail "Migration failed. Check DATABASE_URL in .env and ensure Postgres is running.
       Then fix the issue and re-run: source .env && pnpm --filter @workspace/db run push"
fi

# ─────────────────────────────────────
# 7b. Seed (no-op — Deck OS self-seeds on first API start)
# ─────────────────────────────────────
log "Seed: none required — Deck OS auto-seeds all tables on first API server start."
ok "Seed step skipped (handled by API bootstrap)"

# ─────────────────────────────────────
# 8. Done / optional start
# ─────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ✓ Setup complete!${RESET}"
echo ""

if [[ "$START_SERVERS" == true ]]; then
  log "Starting dev servers..."
  echo "  API server → http://localhost:8080"
  echo "  Deck OS    → http://localhost:5173"
  echo "  Press Ctrl+C to stop both servers"
  echo ""
  # Each service needs its own PORT.
  # The API reads PORT from the loaded .env (default 8080).
  # The Vite frontend requires PORT and BASE_PATH; we inject dedicated values
  # so there is no port conflict regardless of what .env sets.
  (PORT="${PORT:-8080}" pnpm --filter @workspace/api-server run dev) &
  API_PID=$!
  (PORT=5173 BASE_PATH="${BASE_PATH:-/}" pnpm --filter @workspace/deck-os run dev) &
  WEB_PID=$!
  trap 'kill $API_PID $WEB_PID 2>/dev/null; exit' INT TERM
  wait $API_PID $WEB_PID
else
  echo "  To start Deck OS manually:"
  echo ""
  echo "    # API server (uses PORT from .env):"
  echo "    pnpm --filter @workspace/api-server run dev"
  echo ""
  echo "    # Frontend (requires PORT and BASE_PATH):"
  echo "    PORT=5173 BASE_PATH=/ pnpm --filter @workspace/deck-os run dev"
  echo ""
  echo "  Or run both at once:"
  echo ""
  echo "    bash setup.sh --start"
  echo ""
fi

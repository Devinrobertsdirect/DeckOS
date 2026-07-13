#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deck OS — Update Script
# Pulls the latest code, reinstalls deps, and applies DB migrations.
#
# Usage:
#   bash update.sh             — git pull + install deps + migrate (bare-metal)
#   bash update.sh --no-pull  — skip git pull (install + migrate only)
#   bash update.sh --docker   — Docker Compose update (pull images + rebuild)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; CYAN="\033[36m"; RESET="\033[0m"

log()  { echo -e "${BOLD}${CYAN}[deck-os]${RESET} $*"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $*"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $*"; }
fail() { echo -e "${RED}  ✗ ERROR:${RESET} $*" >&2; exit 1; }

NO_PULL=false
USE_DOCKER=false
for arg in "$@"; do
  [[ "$arg" == "--no-pull" ]] && NO_PULL=true
  [[ "$arg" == "--docker"  ]] && USE_DOCKER=true
done

echo ""
echo -e "${BOLD}${CYAN}  ██████╗ ███████╗ ██████╗██╗  ██╗     ██████╗ ███████╗${RESET}"
echo -e "${BOLD}${CYAN}  ██╔══██╗██╔════╝██╔════╝██║ ██╔╝    ██╔═══██╗██╔════╝${RESET}"
echo -e "${BOLD}${CYAN}  ██║  ██║█████╗  ██║     █████╔╝     ██║   ██║███████╗${RESET}"
echo -e "${BOLD}${CYAN}  ██║  ██║██╔══╝  ██║     ██╔═██╗     ██║   ██║╚════██║${RESET}"
echo -e "${BOLD}${CYAN}  ██████╔╝███████╗╚██████╗██║  ██╗    ╚██████╔╝███████║${RESET}"
echo -e "${BOLD}${CYAN}  ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝     ╚═════╝ ╚══════╝${RESET}"
echo ""
log "JARVIS Command Center — Update"
echo ""

# ─────────────────────────────────────
# Version helper
# ─────────────────────────────────────
get_version() {
  if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
    git describe --tags --always 2>/dev/null || echo "unknown"
  else
    grep '"version"' package.json 2>/dev/null \
      | head -1 \
      | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' \
      || echo "unknown"
  fi
}

# ─────────────────────────────────────
# Docker Compose fast-path
# ─────────────────────────────────────
if [[ "$USE_DOCKER" == true ]]; then
  log "Docker Compose update"

  if ! command -v docker &>/dev/null; then
    fail "Docker not found. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
  fi
  ok "Docker found: $(docker --version | head -1)"

  if [[ "$NO_PULL" == false ]]; then
    log "Pulling latest code..."
    if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
      git pull && ok "Code updated" || warn "git pull failed — continuing with local code"
    else
      warn "Not a git repository — skipping code pull"
    fi
  else
    warn "--no-pull: skipping git pull"
  fi

  log "Pulling updated Docker images..."
  docker compose pull
  ok "Docker images updated"

  log "Rebuilding and restarting services..."
  docker compose up -d --build
  ok "Services restarted"

  VERSION=$(get_version)
  [[ "$VERSION" == v* ]] || VERSION="v${VERSION}"
  echo ""
  echo -e "${GREEN}${BOLD}  ✓ Updated to ${VERSION}!${RESET}"
  echo ""
  echo "  Frontend   →  http://localhost:3000"
  echo "  API server →  http://localhost:8080"
  echo "  Logs:          docker compose logs -f"
  echo ""
  exit 0
fi

# ─────────────────────────────────────
# 1. Git pull
# ─────────────────────────────────────
if [[ "$NO_PULL" == false ]]; then
  log "Pulling latest code..."
  if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null 2>&1; then
    git pull && ok "Code updated" || warn "git pull failed — continuing with local code"
  else
    warn "Not inside a git repository — skipping code pull"
    warn "  Pass --no-pull to suppress this message when using a local copy"
  fi
else
  warn "--no-pull: skipping git pull"
fi

# ─────────────────────────────────────
# 2. Load .env so DATABASE_URL is set for migrations
# ─────────────────────────────────────
log "Loading environment..."
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  ok "Loaded .env"
else
  warn ".env not found — DATABASE_URL may not be set for migrations"
  warn "  Run  bash setup.sh  first to create it, or copy .env.example → .env"
fi

# ─────────────────────────────────────
# 3. Install / update dependencies
# ─────────────────────────────────────
log "Installing dependencies..."
if ! command -v pnpm &>/dev/null; then
  fail "pnpm not found. Run  bash setup.sh  to install prerequisites, then try again."
fi
pnpm install --frozen-lockfile 2>&1 | tail -5
ok "Dependencies installed"

# ─────────────────────────────────────
# 4. Database migrations
# ─────────────────────────────────────
log "Running database migrations..."
if pnpm --filter @workspace/db run push 2>&1; then
  ok "Database schema up to date"
else
  fail "Migration failed. Check DATABASE_URL in .env and ensure Postgres is running.
       Then fix the issue and re-run: source .env && pnpm --filter @workspace/db run push"
fi

# ─────────────────────────────────────
# Done
# ─────────────────────────────────────
VERSION=$(get_version)
[[ "$VERSION" == v* ]] || VERSION="v${VERSION}"
echo ""
echo -e "${GREEN}${BOLD}  ✓ Updated to ${VERSION}!${RESET}"
echo ""
echo "  Restart your dev servers to pick up the changes:"
echo ""
echo "    bash setup.sh --start"
echo ""
echo "  Or manually in separate terminals:"
echo "    pnpm --filter @workspace/api-server run dev"
echo "    PORT=5173 BASE_PATH=/ pnpm --filter @workspace/deck-os run dev"
echo ""

<#
.SYNOPSIS
  Deck OS — Update Script for Windows (PowerShell)

.DESCRIPTION
  Pulls the latest code, reinstalls dependencies, and applies DB migrations.

.PARAMETER NoPull
  Skip the git pull step (e.g. if you already ran git pull manually).

.PARAMETER Docker
  Update a Docker Compose installation (pull updated images then rebuild).

.EXAMPLE
  .\update.ps1             # Pull code + install deps + migrate
  .\update.ps1 -NoPull    # Install deps + migrate without pulling
  .\update.ps1 -Docker    # Docker Compose update (pull images + rebuild)
#>

param(
  [switch]$NoPull,
  [switch]$Docker
)

$ErrorActionPreference = "Stop"

function Write-Banner {
  $c = "Cyan"
  Write-Host ""
  Write-Host "  ██████╗ ███████╗ ██████╗██╗  ██╗     ██████╗ ███████╗" -ForegroundColor $c
  Write-Host "  ██╔══██╗██╔════╝██╔════╝██║ ██╔╝    ██╔═══██╗██╔════╝" -ForegroundColor $c
  Write-Host "  ██║  ██║█████╗  ██║     █████╔╝     ██║   ██║███████╗" -ForegroundColor $c
  Write-Host "  ██║  ██║██╔══╝  ██║     ██╔═██╗     ██║   ██║╚════██║" -ForegroundColor $c
  Write-Host "  ██████╔╝███████╗╚██████╗██║  ██╗    ╚██████╔╝███████║" -ForegroundColor $c
  Write-Host "  ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝     ╚═════╝ ╚══════╝" -ForegroundColor $c
  Write-Host ""
  Write-Host "  [deck-os] JARVIS Command Center — Update" -ForegroundColor Cyan
  Write-Host ""
}

function Log  { param([string]$msg) Write-Host "  [deck-os] $msg" -ForegroundColor Cyan }
function Ok   { param([string]$msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn { param([string]$msg) Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Fail { param([string]$msg) Write-Host "  ERROR  $msg" -ForegroundColor Red; exit 1 }

function Get-DeckVersion {
  try {
    if (Get-Command "git" -ErrorAction SilentlyContinue) {
      $tag = git describe --tags --always 2>$null
      if ($LASTEXITCODE -eq 0 -and $tag) { return $tag.Trim() }
    }
  } catch {}
  try {
    $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
    return $pkg.version
  } catch {
    return "unknown"
  }
}

Write-Banner

# ─────────────────────────────────────
# Docker Compose fast-path
# ─────────────────────────────────────
if ($Docker) {
  Log "Docker Compose update"

  if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Fail "Docker not found. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
  }
  $dockerVer = docker --version
  Ok "Docker found: $dockerVer"

  if (-not $NoPull) {
    Log "Pulling latest code..."
    if (Get-Command "git" -ErrorAction SilentlyContinue) {
      try {
        git rev-parse --git-dir 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
          git pull
          if ($LASTEXITCODE -eq 0) { Ok "Code updated" } else { Warn "git pull failed — continuing with local code" }
        } else {
          Warn "Not a git repository — skipping code pull"
        }
      } catch {
        Warn "git pull failed — continuing with local code"
      }
    } else {
      Warn "git not found — skipping code pull"
    }
  } else {
    Warn "-NoPull: skipping git pull"
  }

  Log "Pulling updated Docker images..."
  docker compose pull
  if ($LASTEXITCODE -ne 0) { Fail "docker compose pull failed. Check your Docker setup and try again." }
  Ok "Docker images updated"

  Log "Rebuilding and restarting services..."
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { Fail "docker compose up failed. Check docker compose logs for details." }
  Ok "Services restarted"

  $version = Get-DeckVersion
  if (-not $version.StartsWith("v")) { $version = "v$version" }
  Write-Host ""
  Write-Host "  Updated to $version!" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Frontend   ->  http://localhost:3000"
  Write-Host "  API server ->  http://localhost:8080"
  Write-Host "  Logs:          docker compose logs -f"
  Write-Host ""
  exit 0
}

# ─────────────────────────────────────
# 1. Git pull
# ─────────────────────────────────────
if (-not $NoPull) {
  Log "Pulling latest code..."
  if (Get-Command "git" -ErrorAction SilentlyContinue) {
    try {
      git rev-parse --git-dir 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        git pull
        if ($LASTEXITCODE -eq 0) { Ok "Code updated" } else { Warn "git pull failed — continuing with local code" }
      } else {
        Warn "Not inside a git repository — skipping code pull"
        Warn "  Pass -NoPull to suppress this message when using a local copy"
      }
    } catch {
      Warn "git pull failed — continuing with local code"
    }
  } else {
    Warn "git not found — skipping code pull"
  }
} else {
  Warn "-NoPull: skipping git pull"
}

# ─────────────────────────────────────
# 2. Load .env so DATABASE_URL is set for migrations
# ─────────────────────────────────────
Log "Loading environment..."
if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match "^\s*([^#=][^=]*)=(.*)$") {
      [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
  Ok "Loaded .env"
} else {
  Warn ".env not found — DATABASE_URL may not be set for migrations"
  Warn "  Run  .\setup.ps1  first, or copy .env.example to .env and edit it"
}

# ─────────────────────────────────────
# 3. Install / update dependencies
# ─────────────────────────────────────
Log "Installing dependencies..."
if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
  Fail "pnpm not found. Run  .\setup.ps1  to install prerequisites, then try again."
}
pnpm install --frozen-lockfile 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed." }
Ok "Dependencies installed"

# ─────────────────────────────────────
# 4. Database migrations
# ─────────────────────────────────────
Log "Running database migrations..."
pnpm --filter @workspace/db run push 2>&1
if ($LASTEXITCODE -ne 0) {
  Fail "Migration failed. Check DATABASE_URL in .env and ensure Postgres is running.`n  Then re-run: pnpm --filter @workspace/db run push"
}
Ok "Database schema up to date"

# ─────────────────────────────────────
# Done
# ─────────────────────────────────────
$version = Get-DeckVersion
if (-not $version.StartsWith("v")) { $version = "v$version" }
Write-Host ""
Write-Host "  Updated to $version!" -ForegroundColor Green
Write-Host ""
Write-Host "  Restart your dev servers to pick up the changes:"
Write-Host ""
Write-Host "    .\setup.ps1 -Start"
Write-Host ""
Write-Host "  Or manually in separate terminals:"
Write-Host "    pnpm --filter @workspace/api-server run dev"
Write-Host '    $env:PORT = "5173"; $env:BASE_PATH = "/"; pnpm --filter @workspace/deck-os run dev'
Write-Host ""

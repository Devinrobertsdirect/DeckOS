# Deck OS — Local Launcher (PowerShell)
# Run from project root: .\start.ps1

# PowerShell treats any stderr from native executables as errors by default.
# Setting Continue here prevents that from blocking pnpm.
$ErrorActionPreference = "Continue"
$ProgressPreference    = "SilentlyContinue"

Write-Host ""
Write-Host " =====================================" -ForegroundColor Cyan
Write-Host "  DECK OS — Local Server Launcher" -ForegroundColor Cyan
Write-Host " =====================================" -ForegroundColor Cyan
Write-Host ""

# Verify pnpm is on PATH
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host " ERROR: pnpm not found." -ForegroundColor Red
    Write-Host " Install it: npm install -g pnpm" -ForegroundColor Yellow
    exit 1
}

$root = $PSScriptRoot

# Launch API server in a new CMD window (CMD avoids PS stderr wrapping entirely)
Write-Host " Starting API Server (port 8080)..." -ForegroundColor Green
Start-Process cmd -ArgumentList "/c", "title DeckOS API Server && pnpm --filter @workspace/api-server run dev & pause" `
    -WorkingDirectory $root

# Give the server a moment before the frontend starts
Start-Sleep -Seconds 3

# Launch frontend in a new CMD window
Write-Host " Starting Desktop Frontend (port 5173)..." -ForegroundColor Green
Start-Process cmd -ArgumentList "/c", "title DeckOS Frontend && pnpm --filter @workspace/deck-os run dev & pause" `
    -WorkingDirectory $root

Write-Host ""
Write-Host " Both services are starting in their own windows." -ForegroundColor Cyan
Write-Host ""
Write-Host " URLs when ready:" -ForegroundColor White
Write-Host "   Frontend  : http://localhost:5173" -ForegroundColor Green
Write-Host "   API       : http://localhost:8080" -ForegroundColor Green
Write-Host "   API check : http://localhost:8080/api/healthz" -ForegroundColor DarkGray
Write-Host ""
Write-Host " Close those windows or press Ctrl+C in each to stop." -ForegroundColor DarkGray
Write-Host ""

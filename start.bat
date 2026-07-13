@echo off
setlocal
title Deck OS — Local Launcher

echo.
echo  =====================================
echo   DECK OS — Local Server Launcher
echo  =====================================
echo.
echo  This will start two windows:
echo    1. API Server    ^(port 8080^)
echo    2. Frontend      ^(port 5173^)
echo.
echo  Run this from the project root.
echo.

:: Verify pnpm is available
where pnpm >nul 2>&1
if errorlevel 1 (
  echo  ERROR: pnpm not found on PATH.
  echo  Install it: npm install -g pnpm
  echo.
  pause
  exit /b 1
)

:: Start API server in its own CMD window
echo  Starting API Server...
start "DeckOS — API Server (port 8080)" cmd /c "pnpm --filter @workspace/api-server run dev & echo. & echo Server stopped. & pause"

:: Give the API server a moment to bind its port
timeout /t 3 /nobreak >nul

:: Start the desktop frontend in its own CMD window
echo  Starting Desktop Frontend...
start "DeckOS — Frontend (port 5173)" cmd /c "pnpm --filter @workspace/deck-os run dev & echo. & echo Vite stopped. & pause"

echo.
echo  Both services are starting in separate windows.
echo.
echo  URLs when ready:
echo    Frontend  : http://localhost:5173
echo    API       : http://localhost:8080
echo    API docs  : http://localhost:8080/api/healthz
echo.
echo  Close those two windows (or press Ctrl+C in each) to stop the servers.
echo.
pause

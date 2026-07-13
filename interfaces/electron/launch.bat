@echo off
setlocal enabledelayedexpansion

title Deck OS — JARVIS Command Center

echo.
echo  ██████╗ ███████╗ ██████╗██╗  ██╗     ██████╗ ███████╗
echo  ██╔══██╗██╔════╝██╔════╝██║ ██╔╝    ██╔═══██╗██╔════╝
echo  ██║  ██║█████╗  ██║     █████╔╝     ██║   ██║███████╗
echo  ██║  ██║██╔══╝  ██║     ██╔═██╗     ██║   ██║╚════██║
echo  ██████╔╝███████╗╚██████╗██║  ██╗    ╚██████╔╝███████║
echo  ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝     ╚═════╝ ╚══════╝
echo.
echo  Launching JARVIS Command Center...
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  Node.js: %NODE_VER%

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

if not exist "node_modules" (
    echo  Installing dependencies (first run only)...
    call npm install --prefer-offline 2>&1
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo  Starting Deck OS...
npx electron .

endlocal

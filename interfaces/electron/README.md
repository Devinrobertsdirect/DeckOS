# Deck OS — Desktop App

Iron Man JARVIS-style AI Command Center running locally on your Windows machine.

## Quick Start (Development / No-Build)

> Requires: Node.js 18+, the API server built, and the frontend built.

### Option A — One-shot build script (Linux/macOS)

From the repository root:
```bash
bash scripts/build-win.sh
```

This builds the API server, builds the frontend, copies outputs into `deck-win/`, and produces the Windows distributable in `deck-win/dist-win/`.

### Option B — Manual steps

1. **Build the API server** (from repo root):
   ```bash
   cd artifacts/api-server
   pnpm run build
   ```

2. **Build the frontend** (from repo root):
   ```bash
   cd artifacts/deck-os
   pnpm run build
   ```

3. **Copy build outputs** into `deck-win/`:
   ```bash
   # Linux/macOS
   cp -r artifacts/api-server/dist  deck-win/api-dist
   cp -r artifacts/deck-os/dist     deck-win/frontend-dist

   # Windows (cmd)
   xcopy /E /I artifacts\api-server\dist deck-win\api-dist
   xcopy /E /I artifacts\deck-os\dist    deck-win\frontend-dist
   ```

4. **Launch** (Windows):
   ```bat
   deck-win\launch.bat
   ```
   Or from inside the `deck-win\` directory:
   ```bat
   npm install
   npm start
   ```

---

## Build a Distributable Windows .exe

### Prerequisites
- Node.js 18+
- Windows (or Wine on Linux/macOS)

### Steps

```bat
REM 1. Build API & frontend (see above)
REM 2. Copy outputs (see above)
REM 3. Install Electron builder deps + build
cd deck-win
npm install
npm run build
```

Outputs land in `deck-win\dist-win\`:
- `Deck OS Setup 1.0.0.exe` — NSIS installer (creates Start Menu + Desktop shortcut)
- `Deck OS 1.0.0.exe` — Single-file portable executable (no install needed)

---

## Features

### System Tray Integration

Deck OS lives in the Windows system tray and reflects the AI's live status:

| Tray icon | Meaning |
|-----------|---------|
| 🔵 Blue dot | JARVIS — Online (idle) |
| 🔵 Cyan dot | JARVIS — Speaking (streaming a response) |
| ⚫ Grey dot | JARVIS — Offline |

**Tray behaviour:**
- Closing the window **hides** it to the tray instead of quitting.
- **Double-click** the tray icon to bring the window back.
- Right-click → **Open Deck OS** or **Quit** to exit fully.

The tray connects to the local WebSocket server (`/api/ws`) and updates the icon in real time based on events (`ai.chat.token`, `ai.tts.speaking`, `system.boot`, etc.).

---

## Architecture

```
deck-win/
├── main.js          ← Electron main process
│   • Spawns the API server as a child Node process
│   • Shows splash screen while API warms up
│   • Opens BrowserWindow pointed at http://127.0.0.1:8080
│   • Creates system tray with live AI status indicator
│   • Minimises to tray on close; Quit from tray menu to exit
├── preload.js       ← Context bridge (exposes safe Electron APIs to renderer)
├── package.json     ← electron-builder config + scripts
├── launch.bat       ← Zero-install Windows launcher
└── build/
    └── icon.png     ← App icon (custom logo)

scripts/
└── build-win.sh     ← One-shot build script (Linux/macOS hosts)
```

The API server runs on `http://127.0.0.1:8080` and serves both the REST API
(`/api/*`) and the pre-built frontend (`/*`) via Express static middleware when
`ELECTRON_STATIC=1` is set. The frontend dist path is injected via
`ELECTRON_FRONTEND_DIST` so packaged builds resolve assets correctly.

---

## Ollama / Open WebUI

Both backends are auto-detected at startup:
- **Ollama**: `http://localhost:11434` (default)
- **Open WebUI**: `http://localhost:3000` (default)

You can override these in **Settings → Connections** inside the app.

---

## Requirements

| Component | Minimum |
|-----------|---------|
| OS | Windows 10 x64 or later |
| Node.js | 18 LTS or later |
| RAM | 4 GB (8 GB recommended) |
| Ollama | Optional — install from https://ollama.com |
| Open WebUI | Optional — install via Docker or exe |

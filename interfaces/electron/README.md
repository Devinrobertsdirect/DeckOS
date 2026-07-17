# Neura — Desktop App

Neura — your own neural network, with a face — running locally on your machine.
Packaging: `npm run pack:win` / `pack:mac` / `pack:linux` (see `scripts/pack.mjs`);
icons are generated from the brand by `scripts/make-icon.mjs`.

## Quick Start (Development / No-Build)

> Requires: Node.js 18+, the API server built, and the frontend built.

### Option A — One-shot build script (Linux/macOS)

From the repository root:
```bash
bash scripts/build-win.sh
```

This builds the API server, builds the frontend, copies outputs into `interfaces/electron/`, and produces the Windows distributable in `interfaces/electron/dist-win/`.

### Option B — Manual steps

1. **Build the API server** (from repo root):
   ```bash
   cd core/server
   pnpm run build
   ```

2. **Build the frontend** (from repo root):
   ```bash
   cd interfaces/desktop
   pnpm run build
   ```

3. **Copy build outputs** into `interfaces/electron/`:
   ```bash
   # Linux/macOS
   cp -r core/server/dist        interfaces/electron/api-dist
   cp -r interfaces/desktop/dist interfaces/electron/frontend-dist

   # Windows (cmd)
   xcopy /E /I core\server\dist        interfaces\electron\api-dist
   xcopy /E /I interfaces\desktop\dist interfaces\electron\frontend-dist
   ```

4. **Launch** (Windows):
   ```bat
   interfaces\electron\launch.bat
   ```
   Or from inside the `interfaces\electron\` directory:
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
cd interfaces\electron
npm install
npm run build
```

Outputs land in `interfaces\electron\dist-win\`:
- `DeckOS Atlas Setup 1.0.0.exe` — NSIS installer (creates Start Menu + Desktop shortcut)
- `DeckOS Atlas 1.0.0.exe` — Single-file portable executable (no install needed)

---

## Features

### System Tray Integration

DeckOS Atlas lives in the Windows system tray and reflects the AI's live status:

| Tray icon | Meaning |
|-----------|---------|
| 🔵 Blue dot | Atlas — online (idle) |
| 🔵 Cyan dot | Atlas — speaking (streaming a response) |
| ⚫ Grey dot | Atlas — offline |

**Tray behaviour:**
- Closing the window **hides** it to the tray instead of quitting.
- **Double-click** the tray icon to bring the window back.
- Right-click → **Open DeckOS Atlas** or **Quit** to exit fully.

The tray connects to the local WebSocket server (`/api/ws`) and updates the icon in real time based on events (`ai.chat.token`, `ai.tts.speaking`, `system.boot`, etc.).

---

## Architecture

```
interfaces/electron/
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

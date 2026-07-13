# Deck OS — Setup & User Guide

**Your personal JARVIS command center. This guide gets you from zero to fully operational.**

---

## Table of Contents

1. [What is Deck OS?](#1-what-is-deck-os)
2. [Quick Start (Windows)](#2-quick-start-windows)
3. [Quick Start (Linux / macOS)](#3-quick-start-linux--macos)
4. [First Boot — What to Expect](#4-first-boot--what-to-expect)
5. [Connecting an AI Model](#5-connecting-an-ai-model)
6. [Navigating the Interface](#6-navigating-the-interface)
7. [Key Features](#7-key-features)
8. [Optional: OpenClaw & Bioelectric Input](#8-optional-openclaw--bioelectric-input)
9. [Troubleshooting](#9-troubleshooting)
10. [Frequently Asked Questions](#10-frequently-asked-questions)

---

## 1. What is Deck OS?

Deck OS is a self-hosted AI command center inspired by Tony Stark's JARVIS. It runs **entirely on your own computer** — your data never leaves your machine unless you choose to connect external services.

Out of the box you get:
- **AI Chat** — talk to a local LLM (via Ollama) or any OpenAI-compatible model
- **Memory System** — the AI remembers things you tell it across sessions
- **Routines & Briefings** — scheduled summaries and daily briefings
- **Plugin Store** — expand capabilities with ClawHub skills
- **Device Control** — manage smart home devices and network gear
- **Command Console** — run system-level commands and scripts
- **Spatial Map** — track connected devices and locations

---

## 2. Quick Start (Windows)

> **Requirements:** Windows 10 or 11 with an internet connection for first-time setup.

1. Download or clone this repository to your computer.
2. Right-click **`START_WINDOWS.bat`** and select **"Run as Administrator"**.
3. The setup window will open and walk you through each step automatically:
   - Checks for Node.js (installs guidance if missing)
   - Installs pnpm package manager
   - Configures your `.env` file
   - Installs all dependencies
   - Creates a **Deck OS** shortcut on your Desktop
   - Starts both the API server and the web interface
4. When the browser opens to `http://localhost:3000`, you are live.

**Next time:** Just double-click the **Deck OS** shortcut on your Desktop.

### Common Windows Issues

| Problem | Fix |
|---|---|
| "Execution Policy" error | Open PowerShell as Admin, run: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Node.js not found | Download from [nodejs.org](https://nodejs.org) — install the **LTS** version |
| Port 3000 already in use | Close other local web servers, or change the port in `.env` |

---

## 3. Quick Start (Linux / macOS)

> **Requirements:** Node.js 18+, pnpm

```bash
# Clone the repo
git clone https://github.com/Devinrobertsdirect/DeckOSCapstone
cd DeckOSCapstone

# Install dependencies
pnpm install

# Copy and edit the environment config
cp .env.example .env
# Open .env in your editor and fill in DATABASE_URL

# Start everything
pnpm dev
```

Then open **http://localhost:3000** in your browser.

---

## 4. First Boot — What to Expect

When you open Deck OS for the very first time you will go through a short setup sequence:

1. **Start Screen** — A welcome splash. Click to begin.
2. **Cinematic Boot Sequence** — A BIOS-style initialization screens (this only happens once). This sets up your AI's name and personality profile.
3. **Onboarding Wizard** — Choose your color theme, give the AI a name, and optionally add an OpenAI API key.
4. **Main Interface** — You're in. The on-screen guide will walk you through the key areas.

> To re-run the setup wizard at any time, open the left sidebar and click **↺ Reset setup** at the bottom.

---

## 5. Connecting an AI Model

Deck OS supports three AI backends. You only need **one** to start chatting.

### Option A — Ollama (Recommended, fully local, free)

1. Download and install Ollama from [ollama.com](https://ollama.com).
2. Pull a model — open a terminal and run:
   ```
   ollama pull llama3
   ```
3. Make sure Ollama is running (it starts automatically on most systems).
4. Deck OS will detect it automatically — the **AI** status in the top header will show green.

### Option B — OpenAI (Cloud, requires an API key)

1. Get an API key from [platform.openai.com](https://platform.openai.com).
2. Open your `.env` file and add:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart the server. Deck OS will use OpenAI when Ollama is not available.

### Option C — OpenWebUI (Local, advanced)

If you are running [Open WebUI](https://openwebui.com), go to **Settings → Connection** in Deck OS and enter your OpenWebUI URL. Deck OS will route requests through it automatically.

---

## 6. Navigating the Interface

```
┌──────────────────────────────────────────────┐
│  HEADER  — System status, clock, color picker │
├────────┬─────────────────────────────────────┤
│ SIDE   │                                     │
│ BAR    │   MAIN CONTENT AREA                 │
│ (nav)  │                                     │
└────────┴─────────────────────────────────────┘
```

### Sidebar Sections

| Label | What it does |
|---|---|
| **SYS.HUD** | Main dashboard — system overview, AI status, quick actions |
| **AI.ROUTER** | Chat with your AI, view model status, manage providers |
| **AI.PERSONA** | Customize your AI's name, personality, and voice |
| **PLUGINS** | Manage installed plugins |
| **PLUGIN.STORE** | Browse and install skills from the ClawHub catalog |
| **MEMORY.BANK** | View and edit what the AI remembers about you |
| **DEVICES** | Smart home and network device management |
| **CONSOLE** | Run commands and scripts directly |
| **ROUTINES** | Set up automated tasks that run on a schedule |
| **BRIEFINGS** | Daily AI-generated news and status summaries |
| **TIMELINE** | Log of everything the AI has done |
| **SETTINGS** | All configuration options |
| **SPATIAL.MAP** | Visual map of connected devices and locations |

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `E` | Toggle the Event Log panel |
| `Ctrl+Shift+G` | Toggle ACERA bioelectric device |
| `Ctrl+Shift+S` | Toggle Stark bioelectric device |

---

## 7. Key Features

### Memory System
The AI automatically stores important things you tell it. You can view, edit, or delete memories from the **MEMORY.BANK** page. Memories are grouped into layers: Identity, Goals, Preferences, and more.

### Routines
Schedule the AI to run tasks at specific times — daily briefings, reminders, data syncs. Find them under **ROUTINES**.

### Briefings
Get a curated daily update generated by your AI — news, weather, your schedule, and system status. Configure sources under **BRIEFINGS**.

### Plugin Store (ClawHub)
Browse 70+ skills across categories like Homelab, DevOps, AI Tools, Security, Media, and more. Click **INSTALL** on any skill to add it to your system. Skills appear in the **PLUGINS** page when installed.

### Command Console
A direct terminal-style interface for running scripts and system commands. Useful for advanced automation and debugging.

---

## 8. Optional: OpenClaw & Bioelectric Input

OpenClaw allows you to control Deck OS using **muscle signals (EMG), brainwaves (EEG), or heartbeat (EKG)** from compatible biosensing hardware.

### Setup

1. Install WSL2 on Windows (the setup script handles this automatically).
2. Inside WSL, run:
   ```bash
   curl -fsSL https://docs.openclaw.ai/install.sh | bash
   ```
3. Launch the gateway:
   ```bash
   ollama launch openclaw
   ```
4. Deck OS will detect OpenClaw automatically (port 18789).

### Signal Actions

| Signal | Action |
|---|---|
| Flex (EMG) | Confirm / Click |
| Double Flex | Dismiss / Cancel |
| Hold Flex | Fullscreen / Hold |
| Blink (EEG) | Next page |
| Alpha Wave | Previous page |
| Focus | Open Command Console |

---

## 9. Troubleshooting

### "API DOWN" in the header
The backend server isn't running. Re-run `START_WINDOWS.bat` or `pnpm dev`.

### AI not responding
- Check that Ollama is running: open a terminal and run `ollama list`
- Check your `OPENAI_API_KEY` in `.env` if using OpenAI
- Open **Settings → Connection** to verify your endpoint URLs

### Database errors on startup
Make sure your `DATABASE_URL` in `.env` points to a valid PostgreSQL instance. The setup script will prompt you to configure this.

### Browser shows a blank white page
Hard-refresh the browser (`Ctrl+Shift+R` on Windows/Linux, `Cmd+Shift+R` on Mac). If it persists, check that both services started successfully (look at `api-server-err.log` and `frontend-err.log` in the project folder).

### Port conflict (address already in use)
Another program is using port 3000 or 8080. Close it, or update the ports in `.env`:
```
PORT=8081
VITE_PORT=3001
```

---

## 10. Frequently Asked Questions

**Q: Does Deck OS send my data to the cloud?**  
A: No. All AI processing is local by default (via Ollama). If you add an OpenAI key, chat messages are sent to OpenAI's servers — just like using ChatGPT directly.

**Q: Can I use this on a tablet or phone?**  
A: Yes. Open the mobile-optimized version at the `/mobile` path, or access `http://YOUR_COMPUTER_IP:3000` from any device on the same network.

**Q: How do I update Deck OS?**  
A: Pull the latest code (`git pull`) and re-run `START_WINDOWS.bat` or `pnpm install && pnpm dev`.

**Q: Can I add my own AI models?**  
A: Yes — any model supported by Ollama works. Run `ollama pull MODEL_NAME` and it will appear automatically.

**Q: Where are my memories and settings stored?**  
A: In your PostgreSQL database (configured via `DATABASE_URL`) and in your browser's localStorage. Nothing is stored on external servers.

**Q: How do I completely reset Deck OS?**  
A: Click **↺ Reset setup** at the bottom of the left sidebar, or clear your browser's localStorage and restart.

---

*Built with React, Vite, Express 5, PostgreSQL, and Drizzle ORM.*  
*Requires Node.js 18+ and pnpm.*

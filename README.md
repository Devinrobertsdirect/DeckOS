# Deck OS

> **You re-explain yourself to your AI every single session. Deck OS ends that.**

Your AI doesn't know you. It forgets your name, your goals, your home, your history the moment you close the tab. You pay $20/month for a chat box that treats you like a stranger every time.

Deck OS replaces it with an AI that actually runs your system — remembering everything, acting on your environment, and routing work without being told twice. Runs on your hardware. Fully yours to own and extend.

```bash
npx deckos start
```

Running in under a minute. Say *"turn off the lights"* — and they turn off. Flex your wrist — and the scene changes.

---

**The habits it replaces:**

| What you do now | What Deck OS replaces it with |
|-----------------|-------------------------------|
| Re-explain your context to AI every session | Memory that builds — JARVIS knows your goals, habits, and history without being told again |
| Tab between 5 tools to get one thing done | One system that routes, acts, and responds across everything |
| Ask AI questions it can't do anything about | Commands that affect your devices, routines, and workflows in real time |
| Pay for cloud AI that learns nothing about you | Local AI you fully own, control, and extend |

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Updating](#updating)
3. [Development Commands](#development-commands)
4. [Local AI (Ollama)](#local-ai-ollama)
5. [Environment Variables](#environment-variables)
6. [Features](#features)
7. [Mobile Access](#mobile-access)
8. [Architecture](#architecture)
9. [Plugin System](#plugin-system)
   - [How Plugins Work](#how-plugins-work)
   - [Writing a Community Plugin](#writing-a-community-plugin)
   - [Sandbox API Reference](#sandbox-api-reference)
   - [Testing Your Plugin Locally](#testing-your-plugin-locally)
   - [Publishing to the Marketplace](#publishing-to-the-marketplace)
   - [Registry Entry Format](#registry-entry-format)
   - [Built-in Plugins (TypeScript)](#built-in-plugins-typescript)
10. [EventBus Event Types](#eventbus-event-types)
11. [WebSocket API](#websocket-api)
12. [Troubleshooting](#troubleshooting)
13. [Requirements](#requirements)
14. [Complete Feature & Component Reference](#complete-feature--component-reference)
15. [IoT & Hardware Compatibility](#iot--hardware-compatibility)
16. [ACERA Protocol — Vision Tracking Reference](#acera-protocol--vision-tracking-reference)
17. [Stark Protocol — Bioelectric Signal Reference](#stark-protocol--bioelectric-signal-reference)
18. [Use Cases](#use-cases)
19. [License](#license)

---

## Quick Start

### Option A — `npx deckos` (easiest, ~1 minute)

> The zero-clone path. Node.js 20+ is the only requirement.

```bash
npx deckos start
```

That's it. The CLI:

1. Checks prerequisites (Node, pnpm, git)
2. Clones the repo to `~/.local/share/deckos` if you're not already inside it
3. Copies `.env.example` → `.env` on first run
4. Auto-detects Docker and uses `docker compose up` when available, otherwise bare-metal
5. Runs DB migrations and starts the API + frontend
6. Opens `http://localhost:3000` in your browser

**All subsequent CLI commands:**
```bash
npx deckos status       # Check which services are running
npx deckos stop         # Stop everything gracefully
npx deckos update       # Pull latest code + re-migrate
npx deckos doctor       # Diagnose prerequisites
```

**Flags:**
```bash
npx deckos start --docker   # Force Docker Compose mode
npx deckos start --bare     # Force bare-metal mode (skip Docker)
npx deckos start --no-open  # Don't open the browser automatically
```

---

### Option B — Docker Compose (recommended, ~3 minutes)

> Requires [Docker Desktop](https://www.docker.com/products/docker-desktop) (Windows/Mac/Linux)

```bash
# 1. Clone and enter the repo
git clone https://github.com/your-username/deck-os.git
cd deck-os

# 2. Copy the environment template (edit to add optional API keys)
cp .env.example .env

# 3. Start everything
bash setup.sh --docker        # Linux / macOS
.\setup.ps1 -Docker           # Windows PowerShell
```

That's it. Docker builds the API server and frontend, starts PostgreSQL, and runs DB migrations automatically.

| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost:3000     |
| API server | http://localhost:8080     |

**Useful Docker commands:**
```bash
docker compose logs -f          # Follow all logs
docker compose logs -f api      # API server logs only
docker compose down             # Stop everything
docker compose down -v          # Stop + erase database volume
```

---

### Option B — Bare-Metal (for development)

> Requires: Node.js 20+, pnpm, PostgreSQL 14+

```bash
# Linux / macOS
bash setup.sh           # Check prerequisites, install deps, run migrations
bash setup.sh --start   # Same as above, then start API + frontend together

# Windows PowerShell
.\setup.ps1             # Check prerequisites, install deps, run migrations
.\setup.ps1 -Start      # Same as above, then start API + frontend together
```

> **Note:** Setup does not auto-start the servers. Pass `--start` / `-Start` when
> you want a one-shot "set up and run" experience. For day-to-day development,
> starting API and frontend in separate terminals (so you can see each log stream
> independently) is usually more convenient.

The script automatically:
- Checks Node.js 20+ and pnpm (installs pnpm via corepack if missing)
- Detects a running PostgreSQL instance and creates the `deckos` DB/user
- Detects Ollama and prints model pull commands
- Copies `.env.example` → `.env` (prompts to edit before continuing)
- Runs `pnpm install` and applies DB migrations (`drizzle-kit push`)

After setup, services are available at:

| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost:5173     |
| API server | http://localhost:8080     |

**Start dev servers manually:**
```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend (separate terminal)
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/deck-os run dev
```

---

## Updating

### Via `npx deckos` (easiest)

```bash
npx deckos update
```

Handles everything in the right order: stops running services, git pull, reinstalls deps, runs migrations.

### Via update scripts

```bash
# Linux / macOS
bash update.sh            # git pull + install deps + DB migrations
bash update.sh --no-pull  # skip git pull (already done manually)
bash update.sh --docker   # Docker Compose: pull new images + rebuild

# Windows PowerShell
.\update.ps1              # git pull + install deps + DB migrations
.\update.ps1 -NoPull      # skip git pull (already done manually)
.\update.ps1 -Docker      # Docker Compose: pull new images + rebuild
```

The script handles the three steps that are easy to forget in the right order:
1. `git pull` — fetch latest code (skip with `--no-pull` / `-NoPull`)
2. `pnpm install --frozen-lockfile` — sync new/changed packages
3. `pnpm --filter @workspace/db run push` — apply any new DB migrations

Then restart your dev servers to pick up the changes.

---

## Development Commands

All commands are run from the **repo root** unless otherwise noted. Every package is addressed with `pnpm --filter <package-name>`.

### Workspace (root)

```bash
pnpm install                    # Install all dependencies across the monorepo
pnpm build                      # Typecheck + build every artifact in order
pnpm typecheck                  # Type-check libs + all artifacts (no emit)
pnpm typecheck:libs             # Type-check lib packages only (tsc --build)
```

---

### API Server (`@workspace/api-server`)

```bash
# Development
pnpm --filter @workspace/api-server run dev         # esbuild → start (rebuilds on every run)
pnpm --filter @workspace/api-server run build       # esbuild bundle only → dist/
pnpm --filter @workspace/api-server run start       # Start pre-built dist/index.mjs
pnpm --filter @workspace/api-server run typecheck   # tsc type-check (no emit)
```

Server starts on **port 8080** (`PORT` env overrides).

---

### Deck OS — main dashboard (`@workspace/deck-os`)

```bash
# Development
pnpm --filter @workspace/deck-os run dev            # Vite dev server (HMR, port $PORT)
pnpm --filter @workspace/deck-os run build          # Production Vite build → dist/
pnpm --filter @workspace/deck-os run serve          # Preview the production build locally
pnpm --filter @workspace/deck-os run typecheck      # tsc type-check (no emit)
```

---

### Deck Mobile — PWA chat interface (`@workspace/deck-mobile`)

```bash
pnpm --filter @workspace/deck-mobile run dev        # Vite dev server (HMR)
pnpm --filter @workspace/deck-mobile run build      # Production build → dist/
pnpm --filter @workspace/deck-mobile run serve      # Preview the production build
pnpm --filter @workspace/deck-mobile run typecheck  # tsc type-check (no emit)
```

---

### Deck CLI (`@workspace/deck-cli`)

```bash
pnpm --filter @workspace/deck-cli run dev           # Build then launch interactive REPL
pnpm --filter @workspace/deck-cli run build         # esbuild bundle → dist/
pnpm --filter @workspace/deck-cli run start         # Start pre-built CLI (non-interactive)
pnpm --filter @workspace/deck-cli run typecheck     # tsc type-check (no emit)
```

---

### Database — Drizzle migrations (`@workspace/db`)

```bash
pnpm --filter @workspace/db run push                # Push schema changes to the DB (safe)
pnpm --filter @workspace/db run push-force          # Force push — overwrites conflicting columns
```

> Run `push` after pulling new code that includes schema changes. `push-force` is only needed when column types change during early development.

---

### API Codegen (`@workspace/api-spec`)

```bash
pnpm --filter @workspace/api-spec run codegen       # Regenerate API client from OpenAPI spec (Orval)
```

Run this after editing `lib/api-spec/openapi.yaml`. It regenerates `lib/api-client-react/` and `lib/api-zod/` automatically.

---

### OpenClaw — local AI agent gateway

OpenClaw runs inside WSL2 on Windows and exposes an Ollama-compatible gateway on **port 18789**.

```bash
# Windows PowerShell (inside WSL2)
ollama launch openclaw                              # Start the OpenClaw gateway
ollama list                                         # List locally available models

# Install ClawHub skills (inside WSL2 terminal)
clawhub install <author>/<skill-name>               # e.g. clawhub install github/github
clawhub list                                        # List installed skills
clawhub update                                      # Update all installed skills
```

The `setup.ps1` script auto-detects WSL2 and starts the gateway for you. See **Settings → Connection → OpenClaw Gateway** in the app to verify status.

---

### Ollama — local inference models

```bash
ollama serve                                        # Start the Ollama server (if not running as a service)
ollama pull gemma3:9b                               # CORTEX tier — chat, reasoning, planning
ollama pull phi3                                    # REFLEX tier — fast classification, commands
ollama list                                         # Show installed models + sizes
ollama rm <model>                                   # Remove a model to free disk space
ollama run gemma3:9b                                # Interactive chat with a model (testing)
```

Deck OS auto-detects Ollama on startup and every 30 seconds. No restart needed when you pull a new model.

---

### Docker Compose

```bash
docker compose up -d                                # Start all services in the background
docker compose up --build                           # Rebuild images then start
docker compose logs -f                              # Tail logs for all services
docker compose logs -f api                          # API server logs only
docker compose logs -f frontend                     # Frontend logs only
docker compose down                                 # Stop all services
docker compose down -v                              # Stop + wipe the database volume
docker compose ps                                   # Show running containers + ports
```

---

## Local AI (Ollama)

Deck OS uses [Ollama](https://ollama.com) for private, local AI inference. Install Ollama, then pull the two default models:

```bash
ollama pull gemma3:9b   # CORTEX — chat, reasoning, planning
ollama pull phi3        # REFLEX  — fast classification, commands
```

Deck OS runs in rule-engine fallback mode if Ollama is unavailable. You can swap models any time in **Settings → AI Config** inside the app.

---

## Environment Variables

Copy `.env.example` to `.env` before running. Key settings:

| Variable             | Required | Description                                              |
|----------------------|----------|----------------------------------------------------------|
| `DATABASE_URL`       | Yes      | PostgreSQL connection string                             |
| `REASONING_MODEL`    | No       | Ollama model for deep reasoning (default: `gemma3:9b`)   |
| `FAST_MODEL`         | No       | Ollama model for fast tasks (default: `phi3`)            |
| `OLLAMA_HOST`        | No       | Ollama URL (default: `http://localhost:11434`)            |
| `OPENAI_API_KEY`     | No       | Enables Whisper STT, vision, and cloud LLM fallback      |
| `ELEVENLABS_API_KEY` | No       | Enables text-to-speech voice output                      |
| `MQTT_BROKER_URL`    | No       | MQTT broker for IoT device integration                   |
| `MQTT_BROKER_USER`   | No       | MQTT broker username                                     |
| `MQTT_BROKER_PASS`   | No       | MQTT broker password                                     |
| `SESSION_SECRET`     | No       | Secret for session cookies (auto-generated if unset)     |
| `PLUGIN_REGISTRY_URL`| No       | URL to a custom plugin registry JSON (overrides local `registry.json`) |

See `.env.example` for the full list with descriptions.

---

## Features

- **AI Command Console** — Chat with JARVIS via text or voice; streaming responses
- **3-Tier Model Routing** — CORTEX (deep reasoning) · REFLEX (fast) · AUTOPILOT (offline rule engine)
- **Self-Upgrade** — JARVIS adjusts its personality dials in response to your instructions
- **Personality Dials** — Fine-tune gravity, snarkiness, and warmth sliders
- **Device Dashboard** — MQTT/WebSocket IoT sensor monitoring with live charts
- **Memory Bank** — Short-term and long-term memory with keyword search
- **Goal Manager** — Create and track goals with AI-generated step-by-step plans
- **Daily Briefing** — AI-generated summary of the past 24 hours, auto-scheduled at 06:00
- **Autonomous Layer** — Routine scheduling with safety levels (strict/moderate/permissive)
- **Spatial Map** — Live device tracking with geofencing
- **Voice TTS/STT** — ElevenLabs TTS and OpenAI Whisper STT (optional API keys)
- **Mobile Companion App** — PWA paired to your desktop via a unique device code; JARVIS chat, persona, and channel status on your phone; auto-reconnects on next visit
- **ACERA Connect** — MediaPipe hand-tracking gesture control (enable in Settings → Vision)
- **Plugin System** — Dynamically-loaded community plugins run in isolated worker sandboxes

---

## Mobile Access

Deck OS ships with a PWA mobile companion (`deck-mobile`) that gives you JARVIS chat, persona management, and channel status from your phone — all routed through the same desktop instance.

### How Pairing Works

Mobile devices authenticate to a specific desktop instance via a **unique device code** (format: `XXX-0000`). The code is stored in the database and is stable across restarts. Resetting it invalidates all previously paired phones.

```
Desktop                Mobile Browser
───────                ──────────────
GET /api/pairing/code  ←─ Settings → Mobile Access shows code
POST /api/pairing/validate  ←─ Phone enters code at first launch
  {"valid": true}       ──→ Phone stores code + session ID in localStorage
                             Auto-reconnects on every subsequent visit
```

### Step-by-Step: First Pairing

1. **On your desktop** — open DeckOS, go to **Settings → Mobile Access**
2. Note the pairing code (e.g. `UYP-0006`) and the mobile URL shown beneath it
3. **On your phone** — navigate to the mobile URL (same local network required)
4. Enter the pairing code on the pairing screen and tap **Link to Desktop →**
5. Your phone is now permanently linked — it auto-connects every time you open the URL

> The pairing screen also appears during the first-run setup wizard (after the visual mode step), so you can pair your phone before you even open the main dashboard.

### Managing Pairings

| Action | How |
|--------|-----|
| **View your code** | Desktop → Settings → Mobile Access |
| **Copy code / mobile URL** | Copy buttons on the Mobile Access tab |
| **Re-pair your phone** | Mobile → Settings → Identity → RE-LINK, then enter new code |
| **Revoke all mobile access** | Desktop → Settings → Mobile Access → Reset Code (generates a new code; old phones must re-pair) |

### Persistence & Reconnection

- The pairing code is saved in your phone's `localStorage` — closing and reopening the browser tab reconnects automatically without re-entering the code.
- On every launch, the mobile app silently validates the stored code against the desktop. If the code has been reset, the app drops back to the pairing screen.
- Network errors during validation are treated as "still valid" — a brief connectivity blip does not force re-pairing.

### API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pairing/code` | GET | Returns `{ code, mobileUrl }` — lazy-generates if not set |
| `/api/pairing/validate` | POST `{ code }` | Returns `{ valid: boolean }` |
| `/api/pairing/reset` | POST | Generates a new code, invalidates old pairings |

---

## Architecture

```
deck-os/
├── artifacts/
│   ├── api-server/      Express 5 + Drizzle + PostgreSQL + WebSocket
│   │   ├── src/
│   │   │   ├── plugins/         Built-in TypeScript plugins (system_monitor, ai_chat)
│   │   │   ├── lib/
│   │   │   │   ├── plugin-registry.ts  Plugin loader + sandbox manager
│   │   │   │   └── community-plugin-worker.ts  Worker sandbox host
│   │   │   └── routes/store.ts  Plugin Store REST API
│   │   ├── community-plugins/   Downloaded community plugin .mjs files
│   │   └── registry.json        Local plugin registry (used if PLUGIN_REGISTRY_URL is unset)
│   ├── deck-os/         React + Vite + TailwindCSS (main dashboard)
│   ├── deck-mobile/     React PWA mobile chat interface
│   └── deck-cli/        Node.js interactive CLI (REPL + daemon mode)
├── lib/
│   ├── db/              Drizzle schema + migrations
│   ├── event-bus/       Async non-blocking EventBus + Plugin base class
│   └── api-zod/         Shared Zod schemas (API contracts)
├── docker-compose.yml   Full local stack (Postgres + API + frontend)
├── setup.sh             Linux/macOS first-time setup script
├── setup.ps1            Windows first-time setup script
├── update.sh            Linux/macOS one-command update script
└── update.ps1           Windows one-command update script
```

---

## Plugin System

Deck OS has two plugin tiers:

| Tier | Language | Isolation | When to use |
|------|----------|-----------|-------------|
| **Built-in** | TypeScript, compiled with esbuild | Same process | Core system features; full DB/inference access |
| **Community** | Plain JavaScript ESM (`.mjs`) | Worker thread sandbox | Third-party extensions distributed via the store |

This guide covers community plugins — the kind you write and publish to the marketplace.

---

### How Plugins Work

When Deck OS starts, it:

1. Scans `dist/plugins/` and loads every `.mjs` file as a **built-in** plugin directly in the main process.
2. Queries the database for all enabled community plugins and re-downloads any whose local `.mjs` file is missing.
3. Spawns each community plugin in its own **Node.js Worker thread** via `community-plugin-worker.mjs`. The worker can only communicate with the main process through a message-passing protocol — it cannot `require` arbitrary modules or touch the filesystem directly.

The Plugin Store UI (in **Settings → Store**) browses the registry, installs plugins by downloading their `.mjs` from an approved CDN, and hot-loads them without restarting the server.

---

### Writing a Community Plugin

A community plugin is a single self-contained ESM JavaScript file that exports a default class (or plain object) with five required fields and four required methods.

#### Minimal template

```javascript
// my_plugin/index.mjs

export default class MyPlugin {
  // ── Required identity fields ───────────────────────────────────────────────
  id          = "my_plugin";        // Snake-case, a-z0-9_-, max 64 chars
  name        = "My Plugin";        // Human-readable display name
  version     = "1.0.0";           // SemVer string
  description = "Does something useful.";
  category    = "productivity";     // monitoring | productivity | ai | iot | utilities

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Called once when the plugin is loaded.
   * Set up timers, subscribe to events, and register HTTP routes here.
   * @param {PluginContext} ctx
   */
  async init(ctx) {
    this._ctx = ctx;
    ctx.logger.info("MyPlugin: started");
  }

  /**
   * Called for every EventBus event the plugin has subscribed to.
   * Alternatively, use ctx.subscribe() inside init() for per-type handlers.
   * @param {BusEvent} event
   */
  async on_event(event) {
    // handle event
  }

  /**
   * Called when the user or another plugin triggers this plugin via the REST API.
   * POST /api/plugins/my_plugin/execute  { command: "ping", args: {} }
   * Must return a JSON-serialisable value.
   * @param {{ command?: string, args?: Record<string, unknown> }} payload
   */
  async execute(payload) {
    if (payload?.command === "ping") return { pong: true };
    return { error: "Unknown command" };
  }

  /**
   * Called when the plugin is disabled or the server shuts down.
   * Clear all timers and release resources here.
   */
  async shutdown() {
    ctx.logger.info("MyPlugin: stopped");
  }
}
```

#### Important rules

- The `id` field **must match** the `id` in the registry entry exactly. The sandbox validates this and rejects mismatches to prevent ID spoofing.
- `id` must match `/^[a-z][a-z0-9_-]{0,63}$/` — lowercase letters, digits, underscores, hyphens only; max 64 characters; must start with a letter.
- Your plugin file must be valid ES module syntax (i.e. `export default class ...`). CommonJS (`module.exports`) is not supported.
- Do not use top-level `await` outside of `init()`. The worker will call `init()` after instantiation.
- You cannot `import` or `require` external npm packages inside a community plugin — the sandbox does not have access to `node_modules`. Use the built-in `fetch` API for network calls, or use the `ctx.infer` RPC for AI inference.

---

### Sandbox API Reference

Inside `init()`, `on_event()`, and `execute()` you receive a `ctx` object with the following methods:

#### `ctx.emit(event)`

Emit an event to the global EventBus. All other plugins and internal services will receive it.

```javascript
ctx.emit({
  source: `plugin.${this.id}`,   // Convention: "plugin.<your_id>"
  target: null,                   // null = broadcast; string = specific target
  type: "my_plugin.something_happened",
  payload: { value: 42 },
});
```

#### `ctx.subscribe(eventType, handler)`

Subscribe to a specific event type. Use `"*"` to receive every event on the bus.
Returns a subscription ID string (you can ignore it — the sandbox cleans up on shutdown).

```javascript
ctx.subscribe("system.shutdown", async (event) => {
  await this.shutdown();
});

ctx.subscribe("my_plugin.configure", (event) => {
  const { interval } = event.payload ?? {};
  if (typeof interval === "number") this._interval = interval;
});
```

#### `ctx.logger`

Structured logger. Output appears in the API server's pino log stream tagged with your plugin ID.

```javascript
ctx.logger.info("Plugin started");
ctx.logger.warn("Retrying fetch...", { url, attempt });
ctx.logger.error("Failed to connect", { err: error.message });
```

#### `ctx.infer(opts)` → `Promise<{ text: string }>`

Run a prompt through Deck OS's 3-tier AI router (Ollama → cloud fallback → rule engine). This counts against your user's Ollama context — use sparingly.

```javascript
const result = await ctx.infer({
  prompt: "Summarise this in one sentence: " + rawText,
  model: "fast",          // "fast" | "reasoning" — optional, defaults to "fast"
  systemPrompt: "...",    // optional
});
ctx.logger.info("AI says: " + result.text);
```

#### `ctx.memory`

Read and write entries to JARVIS's long-term memory store (PostgreSQL-backed).

```javascript
// Store a memory
await ctx.memory.store({
  type: "long_term",               // "short_term" | "long_term"
  content: "User prefers dark mode at night",
  keywords: ["preference", "display", "dark"],
  source: this.id,
});

// Keyword search
const results = await ctx.memory.search("dark mode", 5);
// results: Array<{ id, content, keywords, createdAt, ... }>

// Fetch recent memories
const recent = await ctx.memory.getRecent(10);

// Fetch a specific memory by ID
const entry = await ctx.memory.getById("uuid-here");

// Purge expired short-term memories
await ctx.memory.expire();
```

#### `ctx.http.register(method, pattern, handler)`

Register an HTTP sub-route under `/api/plugins/<your_id>/<pattern>`. The Deck OS API server proxies matching requests to your worker via message passing.

```javascript
ctx.http.register("GET", "/status", async (req) => {
  return {
    status: 200,
    body: { running: true, lastPoll: this._lastPollAt },
  };
});

ctx.http.register("POST", "/configure", async (req) => {
  const { lat, lon } = req.body ?? {};
  this._lat = lat ?? this._lat;
  this._lon = lon ?? this._lon;
  return { status: 200, body: { ok: true } };
});
```

`req` has the shape `{ body, query, params, headers }`. Routes time out after 30 seconds.
After registering `GET /status`, the route is reachable at:
```
GET http://localhost:8080/api/plugins/my_plugin/status
```

---

### Testing Your Plugin Locally

You have two options for local testing before publishing.

#### Option 1 — Sideload from disk (fastest)

1. Place your compiled `.mjs` file in `artifacts/api-server/community-plugins/`:
   ```bash
   cp my_plugin/index.mjs artifacts/api-server/community-plugins/my_plugin.mjs
   ```
2. Insert a row into the database to register it as "installed":
   ```sql
   INSERT INTO community_plugins (plugin_id, name, author, description, version, category, permissions, enabled)
   VALUES ('my_plugin', 'My Plugin', 'your-username', 'Does something useful.', '1.0.0', 'productivity', '[]', true);
   ```
3. Restart the API server — it will load the local file automatically at startup:
   ```bash
   pnpm --filter @workspace/api-server run dev
   ```
4. Verify it loaded:
   ```bash
   curl http://localhost:8080/api/plugins/store/installed
   # Should include your plugin with "enabled": true
   ```

#### Option 2 — Install via store API with a local registry

1. Add your plugin entry to `artifacts/api-server/registry.json` (see the [Registry Entry Format](#registry-entry-format) section below). Set `entrypointUrl` to a raw GitHub URL or a local file-serving URL.
2. Hit the install endpoint:
   ```bash
   curl -X POST http://localhost:8080/api/plugins/store/install/my_plugin
   ```
3. Check runtime status:
   ```bash
   curl http://localhost:8080/api/plugins
   # Look for your plugin in the list with status "active"
   ```

#### Invoke your plugin

```bash
# Trigger execute() with a command
curl -X POST http://localhost:8080/api/plugins/my_plugin/execute \
  -H "Content-Type: application/json" \
  -d '{"command":"ping"}'

# Hit a registered HTTP sub-route
curl http://localhost:8080/api/plugins/my_plugin/status
```

#### Read server logs

All `ctx.logger.*` calls appear in the API server log stream tagged with your plugin ID:
```
[INFO] [community:my_plugin] Plugin started
```

Follow live logs:
```bash
# Bare-metal
pnpm --filter @workspace/api-server run dev

# Docker
docker compose logs -f api
```

---

### Publishing to the Marketplace

The Deck OS plugin marketplace is a `registry.json` file hosted on GitHub. Publishing means opening a pull request to add your entry to the community registry repository.

#### Step 1 — Prepare your plugin file

Your plugin must be a single self-contained ESM file. If you write it in TypeScript or use multiple source files, bundle it first:

```bash
# Using esbuild (recommended — same bundler as Deck OS itself)
npx esbuild src/index.ts \
  --bundle \
  --format=esm \
  --platform=node \
  --outfile=dist/index.mjs \
  --external:node:* \
  --minify
```

> **Important:** Only `node:*` built-ins are available inside the sandbox. Do not bundle node_modules that require native binaries (`.node` files), spawn child processes, or access the filesystem outside of the Node.js built-in APIs. Such plugins will fail to load.

Test the bundled output locally (Option 1 or 2 above) before publishing.

#### Step 2 — Host your plugin file on an approved CDN

The Deck OS server only downloads plugin files from a hard-coded allowlist of trusted origins:

| Approved origin | Example URL format |
|---|---|
| `https://raw.githubusercontent.com` | `https://raw.githubusercontent.com/<user>/<repo>/main/<plugin>/index.mjs` |
| `https://cdn.jsdelivr.net` | `https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/<plugin>/index.mjs` |
| `https://unpkg.com` | `https://unpkg.com/<package>@<version>/dist/index.mjs` |

**Recommended approach — GitHub raw URL:**

1. Create a public GitHub repo (e.g. `github.com/yourname/deck-os-plugins`).
2. Commit your bundled `index.mjs` to it (e.g. `my_plugin/index.mjs`).
3. Your `entrypointUrl` will be:
   ```
   https://raw.githubusercontent.com/yourname/deck-os-plugins/main/my_plugin/index.mjs
   ```

**Tip:** Pin to a tag rather than `main` for stability:
```
https://raw.githubusercontent.com/yourname/deck-os-plugins/v1.0.0/my_plugin/index.mjs
```

#### Step 3 — Create your registry entry

Write a JSON object that describes your plugin (see [Registry Entry Format](#registry-entry-format) below).

#### Step 4 — Open a pull request to the community registry

1. Fork the official registry repository:
   ```
   https://github.com/deck-os/community-plugins
   ```
2. Edit `registry.json` and add your plugin object to the `plugins` array.
3. Commit and open a pull request. Your PR title should be:
   ```
   feat: add <your_plugin_id> plugin
   ```
4. The maintainers will review your plugin for:
   - Correct `id` format and uniqueness
   - Valid `entrypointUrl` from an approved CDN
   - Plugin actually loads without errors (automated CI check)
   - No malicious behaviour, network calls to unexpected hosts, or filesystem abuse
5. Once merged, your plugin appears in every user's Plugin Store within 5 minutes (the server caches the registry for 5 minutes).

#### Step 5 — Updating your plugin

To release a new version:

1. Upload the new bundled `.mjs` to your CDN (same URL or a new tagged URL).
2. Open another PR to the registry updating your entry's `version` field and `entrypointUrl` if the URL changed.
3. Users who already have the plugin installed can update it by clicking **Update** in the Plugin Store, which calls:
   ```bash
   curl -X POST http://localhost:8080/api/plugins/store/install/my_plugin \
     -H "Content-Type: application/json" \
     -d '{"force": true}'
   ```

---

### Registry Entry Format

Each entry in `registry.json` → `plugins[]` must conform to this schema:

```jsonc
{
  // Required fields
  "id": "my_plugin",              // Must match /^[a-z][a-z0-9_-]{0,63}$/ and be globally unique
  "name": "My Plugin",            // Display name shown in the Plugin Store UI
  "author": "community/yourname", // "community/<handle>" for third-party; "deck-os/official" is reserved
  "description": "One paragraph describing what the plugin does.",
  "version": "1.0.0",            // SemVer string — bump this on every update
  "category": "productivity",     // monitoring | productivity | ai | iot | utilities
  "permissions": ["network"],     // Declared permissions (informational — shown to users before install)
  "tags": ["timer", "focus"],     // Array of lowercase search tags
  "iconUrl": null,                // null, or https:// URL to a square icon image
  "entrypointUrl": "https://raw.githubusercontent.com/yourname/deck-os-plugins/main/my_plugin/index.mjs",
  "installCount": 0,              // Start at 0; the registry maintainers update this periodically
  "readme": "Full Markdown readme shown on the plugin detail page."
}
```

**Permissions** are informational strings shown to users before they install. Use them to declare what your plugin does. Current convention:

| Permission string | Meaning |
|---|---|
| `network` | Makes outbound HTTP/HTTPS requests |
| `ai_inference` | Calls `ctx.infer()` to use local AI |
| `memory_read` | Reads from JARVIS memory store |
| `memory_write` | Writes to JARVIS memory store |
| `notifications` | Emits `notification.created` events |
| `tts` | Emits `tts.speak` events (requires ElevenLabs key) |
| `device_read` | Reads device state from the device registry |
| `device_control` | Sends commands to devices |
| `system_stats` | Reads system CPU/memory/disk metrics |

---

### Built-in Plugins (TypeScript)

Built-in plugins live in `artifacts/api-server/src/plugins/` and are compiled into `dist/plugins/` by the esbuild build step. They run in the main process (no sandbox) and have full access to the database, file system, and all internal services.

To add a built-in plugin:

1. Create `artifacts/api-server/src/plugins/my_plugin.ts`.
2. Export a default class that extends `Plugin` from `@workspace/event-bus`:
   ```typescript
   import { Plugin } from "@workspace/event-bus";
   import type { PluginContext, BusEvent } from "@workspace/event-bus";

   export default class MyPlugin extends Plugin {
     readonly id          = "my_plugin";
     readonly name        = "My Plugin";
     readonly version     = "1.0.0";
     readonly description = "Does something useful.";
     readonly category    = "monitoring";

     async init(context: PluginContext): Promise<void> {
       context.logger.info("MyPlugin: started");
     }

     async on_event(_event: BusEvent): Promise<void> {}

     async execute(payload: unknown): Promise<unknown> {
       return { ok: true };
     }

     async shutdown(): Promise<void> {
       // cleanup
     }
   }
   ```
3. The plugin is auto-discovered from `dist/plugins/` on startup — no registration step needed.
4. Add a corresponding entry to `registry.json` with `"author": "deck-os/official"` and `"entrypointUrl": null` (built-ins are not downloaded from a URL).

---

## EventBus Event Types

All internal communication in Deck OS flows through the async EventBus. Plugins can subscribe to and emit any of these types.

| Type | Direction | Payload |
|---|---|---|
| `chat.message` | API → bus | `{ role, content, sessionId }` |
| `chat.response` | bus → clients | `{ content, model, sessionId }` |
| `system.monitor.metrics` | system_monitor → bus | `{ cpu, memory, disk, network, uptime }` |
| `system.monitor.request` | any → system_monitor | `{ replyTo? }` |
| `system.resource.alert` | system_monitor → bus | `{ resource, value, threshold, message }` |
| `system.resource.clear` | system_monitor → bus | `{ resource, value, threshold }` |
| `weather.update` | weather_monitor → bus | `{ temperature, windSpeed, humidity, weatherCode, ... }` |
| `notification.created` | any → bus | `{ title, message, severity, pluginId }` |
| `plugin.loaded` | registry → bus | `{ pluginId, name, version, sandboxed? }` |
| `plugin.unloaded` | registry → bus | `{ pluginId }` |
| `plugin.error` | registry → bus | `{ pluginId, error }` |
| `plugin.installed` | store → bus | `{ pluginId, name, version }` |
| `plugin.uninstalled` | store → bus | `{ pluginId }` |
| `plugin.status_changed` | store/registry → bus | `{ pluginId, enabled }` |
| `device.reading` | device → bus | `{ deviceId, type, value, unit, timestamp }` |
| `device.command` | any → bus | `{ deviceId, command, args }` |
| `device.connected` | transport → bus | `{ deviceId }` |
| `device.disconnected` | transport → bus | `{ deviceId }` |
| `tts.speak` | any → bus | `{ text, voice?, priority? }` |
| `acera.gesture.detected` | acera → bus | `{ gesture, confidence, hand }` |
| `acera.scene.update` | acera → bus | `{ hands, gestures, timestamp }` |
| `acera.tracking.started` | acera → bus | `{}` |
| `acera.tracking.stopped` | acera → bus | `{}` |
| `system.shutdown` | server → bus | `{}` |
| `routine.triggered` | routine-runner → bus | `{ routineId, name }` |
| `goal.created` | any → bus | `{ goalId, title }` |
| `goal.completed` | any → bus | `{ goalId, title }` |
| `briefing.ready` | briefing → bus | `{ content, generatedAt }` |
| `memory.stored` | memory-service → bus | `{ id, type, keywords }` |
| `cognitive.loop.tick` | cognitive-loop → bus | `{ tickAt }` |

---

## WebSocket API

Connect to `ws://localhost:8080/api/ws` to receive real-time EventBus events in the frontend or any external client.

**Subscribe to event types:**
```json
{ "type": "subscribe", "eventTypes": ["system.monitor.metrics", "device.reading"] }
```

**Unsubscribe:**
```json
{ "type": "unsubscribe", "eventTypes": ["system.monitor.metrics"] }
```

**Emit an event (authenticated clients only):**
```json
{ "type": "emit", "event": { "source": "client", "target": null, "type": "system.monitor.request", "payload": {} } }
```

The server validates all emitted events against the `EventTypeSchema`. Unknown types are rejected with a `validation.error` message.

---

## Troubleshooting

### "Connection refused: Not authorized" in server logs

This is the MQTT broker auth error. It means `MQTT_BROKER_URL` is set in your `.env` but `MQTT_BROKER_USER` / `MQTT_BROKER_PASS` are missing or wrong. Either:
- Set the correct credentials for your HiveMQ Cloud (or other) broker.
- Remove `MQTT_BROKER_URL` from `.env` to disable MQTT entirely.

This error is benign — all other features continue working without MQTT.

### Ollama model not found

```
error loading model: open .../gemma3:9b: no such file or directory
```

Pull the model:
```bash
ollama pull gemma3:9b
ollama pull phi3
```

Deck OS falls back to the rule engine automatically if no model is available.

### Frontend shows blank screen / can't connect to API

1. Confirm the API server is running and listening: `curl http://localhost:8080/api/healthz`
2. Check that `VITE_API_URL` in your `.env` matches the API server address.
3. In Docker: make sure both containers are in the same Compose network (`docker compose ps`).

### Community plugin fails to load ("Worker exited")

- Check the API server log for the error: `[community:<plugin_id>] ...`
- Common causes:
  - Plugin uses `import` / `require` for a package not available in the sandbox (only built-in Node.js modules are available).
  - Plugin `id` field doesn't match the registry `id`.
  - Plugin is not valid ESM (uses CommonJS `module.exports`).
  - `init()` throws an unhandled exception.
- Test with the sideload method first to see errors locally before publishing.

### Database migration fails

```bash
pnpm --filter @workspace/db run push
```

If it still fails, check `DATABASE_URL` in `.env` and ensure PostgreSQL is running:
```bash
psql $DATABASE_URL -c "SELECT 1"
```

---

## Requirements

| Tool        | Minimum | Notes                                    |
|-------------|---------|------------------------------------------|
| Node.js     | 20      | LTS recommended — https://nodejs.org     |
| pnpm        | 8       | Auto-installed by setup script           |
| PostgreSQL  | 14      | Or use Docker Compose                    |
| Docker      | 24      | Only for the `--docker` path             |
| Ollama      | any     | Optional — https://ollama.com            |

---

## Complete Feature & Component Reference

A full map of every module, page, and sub-system in Deck OS — what it does, where it lives, and how it integrates with the rest of the stack.

---

### Frontend — `artifacts/deck-os/src/`

#### Pages

| Page | Route | File | Description |
|------|-------|------|-------------|
| **Dashboard** | `/` | `pages/Dashboard.tsx` | Particle canvas, live MQTT device metrics, AI face idle animation, weather widget, time/date |
| **AI Router** | `/ai` | `pages/AIRouter.tsx` | Full chat interface with streaming responses, voice STT input, TTS playback, message history |
| **Command Console** | `/commands` | `pages/CommandsPage.tsx` | Low-latency text REPL, JARVIS quick-action tiles, autonomous task output stream |
| **Device Monitor** | `/devices` | `pages/Devices.tsx` | Live sensor charts, device registry, per-device status cards, MQTT topic browser |
| **Memory Bank** | `/memory` | `pages/MemoryPage.tsx` | Short-term and long-term memory viewer, keyword search, manual entry, memory decay controls |
| **Goal Manager** | `/goals` | `pages/GoalsPage.tsx` | Create/edit goals, AI step-plan generation, progress tracking, goal archiving |
| **Routines** | `/routines` | `pages/RoutinesPage.tsx` | Visual routine builder, CRON scheduler, step sequencer, autonomy safety level picker |
| **Spatial Map** | `/map` | `pages/MapPage.tsx` | Leaflet-based device map, geofence editor, live device position updates |
| **News Feed** | `/news` | `pages/NewsPage.tsx` | AI-curated briefing cards, source configurator, read/unread tracking |
| **Plugin Store** | `/store` | `pages/StorePage.tsx` | Community plugin browser, one-click install, enable/disable, version info |
| **Settings** | `/settings` | `pages/Settings.tsx` | Eight tabs: Connection · API Keys · Models · System Health · ACERA Vision · Stark Connect · Mobile Access · About |
| **Start Screen** | `/` (pre-auth) | `components/Onboarding.tsx` | Name/AI-name setup, color theme picker, launch gate |

#### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| **Layout** | `components/Layout.tsx` | Root shell: sidebar nav, Ollama banner, gesture handlers, ACERA + Stark overlays, particle bursts |
| **AIFace** | `components/AIFace.tsx` | Animated SVG AI avatar; expression changes on inference state |
| **AceraOverlay** | `components/AceraOverlay.tsx` | Floating cyan HUD — bottom-right; live hand skeleton, gesture badge, waveform |
| **StarkOverlay** | `components/StarkOverlay.tsx` | Floating red/amber HUD — bottom-left; signal waveform, contraction state, BPM |
| **ConnectParticles** | `components/ConnectParticles.tsx` | Full-screen canvas burst animation triggered on ACERA/Stark device connect |
| **EventLogPanel** | `components/EventLogPanel.tsx` | Scrolling EventBus event stream with type filter and JSON payload inspector |
| **NotificationDrawer** | `components/NotificationDrawer.tsx` | Slide-in notification tray; WS-pushed alerts with read/unread state |
| **DeviceControl** | `components/DeviceControl.tsx` | Per-device MQTT command panel (on/off, dim, set temperature) |
| **VisualMode** | `contexts/VisualMode.tsx` | Three render modes: Particle · Minimal · Performance; persisted per-session |

#### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useAceraConnect` | `hooks/useAceraConnect.ts` | MediaPipe hand-tracking lifecycle; gesture classification; WS broadcast |
| `useStarkConnect` | `hooks/useStarkConnect.ts` | Web Serial API; BioAmp ADC parsing; StarkProcessor pipeline; WS broadcast |
| `useCamera` | `hooks/useCamera.ts` | Camera permission + vision description via OpenAI vision API |
| `useWebSocket` | `contexts/WebSocketContext.tsx` | WS client singleton; event subscription/emission; reconnect backoff |
| `useAiName` | `hooks/useAiName.ts` | Reads persona name from DB/WS; reactive updates |
| `useUserName` | `hooks/useUserName.ts` | User identity from localStorage + onboarding |
| `useHealthCheck` | `(api-client-react)` | Periodic `/api/healthz` polling with cached query key |

#### Signal Processing Libraries

| Library | File | Purpose |
|---------|------|---------|
| `starkSignals` | `lib/starkSignals.ts` | RingBuffer, StarkProcessor (EMG/EEG/EKG), adaptive baseline EWMA, RMS window, contraction state machine, auto-mode detection, action mapping |
| `aceraGestures` | `lib/aceraGestures.ts` | Gesture classifier (8 gestures), latch debouncing, DashboardAction mapping |
| `audioAnalyser` | `lib/audioAnalyser.ts` | Microphone FFT, voice-activity detection, wake-word passthrough |

---

### Backend — `artifacts/api-server/src/`

#### API Routes

| Route | File | Methods | Description |
|-------|------|---------|-------------|
| `/api/healthz` | `routes/health.ts` | GET | System + DB + Ollama status |
| `/api/chat` | `routes/chat.ts` | POST | LLM inference with ACERA + Stark context injection |
| `/api/chat/stream` | `routes/chat.ts` | POST (SSE) | Streaming chat response (token-by-token) |
| `/api/memory` | `routes/memory.ts` | GET POST DELETE | Short/long-term memory CRUD |
| `/api/goals` | `routes/goals.ts` | GET POST PATCH DELETE | Goal + AI step-plan management |
| `/api/routines` | `routes/routines.ts` | GET POST PATCH DELETE | Routine CRON scheduler |
| `/api/devices` | `routes/devices.ts` | GET POST PATCH | Device registry; MQTT command dispatch |
| `/api/devices/:id/command` | `routes/devices.ts` | POST | Fire a device command (on/off/dim/set) |
| `/api/autonomy/config` | `routes/autonomy.ts` | GET PATCH | Safety level + autonomy on/off |
| `/api/autonomy/log` | `routes/autonomy.ts` | GET | Autonomous action history |
| `/api/plugins` | `routes/plugins.ts` | GET POST DELETE | Plugin registry management |
| `/api/plugins/:id/execute` | `routes/plugins.ts` | POST | Run a plugin command |
| `/api/store` | `routes/store.ts` | GET POST | Plugin marketplace browser + install |
| `/api/news` | `routes/news.ts` | GET | AI news briefing fetch |
| `/api/map` | `routes/map.ts` | GET POST | Spatial device positions + geofences |
| `/api/notifications` | `routes/notifications.ts` | GET POST PATCH | Notification CRUD |
| `/api/persona` | `routes/persona.ts` | GET PATCH | AI name, gender, personality dials |
| `/api/config` | `routes/config.ts` | GET PATCH | Runtime env var overrides |
| `/api/self-update` | `routes/self-update.ts` | POST | `git pull` + `pnpm install` + migration |
| `/api/pairing/code` | `routes/pairing.ts` | GET | Lazy-generate and return the instance pairing code + mobile URL |
| `/api/pairing/validate` | `routes/pairing.ts` | POST | Validate a code submitted by a mobile device |
| `/api/pairing/reset` | `routes/pairing.ts` | POST | Regenerate the pairing code (revokes existing mobile sessions) |

#### Core Server Libraries

| Module | File | Purpose |
|--------|------|---------|
| **Bootstrap** | `lib/bootstrap.ts` | Wires all subsystems at startup; ACERA + Stark scene context store |
| **Inference Engine** | `lib/inference.ts` | 3-tier routing (Ollama → OpenAI → rule engine); caching; streaming |
| **EventBus** | `lib/bus.ts` | In-process async pub/sub; typed event dispatch |
| **WS Server** | `lib/ws-server.ts` | WebSocket server; broadcast; per-client subscriptions |
| **Plugin Registry** | `lib/plugin-registry.ts` | Load/reload community `.mjs` plugins in Worker sandboxes |
| **Memory Service** | `lib/memory-service.ts` | Short/long-term memory; embedding search |
| **Cognitive Loop** | `lib/cognitive-loop.ts` | Background autonomous task engine; safety evaluation |
| **Routine Runner** | `lib/routine-runner.ts` | CRON-based routine scheduler; step execution |
| **Device Manager** | `lib/device-manager.ts` | Device registry; state aggregation; command dispatch |
| **MQTT Transport** | `lib/mqtt-transport.ts` | Subscribe/publish IoT telemetry; topic auto-mapping |
| **WS Device Transport** | `lib/ws-device-transport.ts` | WebSocket-based device bridge (ESP32, custom firmware) |
| **Presence Manager** | `lib/presence-manager.ts` | Per-channel user presence tracking |
| **Narrative Manager** | `lib/narrative-manager.ts` | Daily briefing generation; contextual event summarisation |
| **Initiative Engine** | `lib/initiative-engine.ts` | Proactive AI suggestions triggered by inactivity / events |
| **System Prompt** | `lib/system-prompt.ts` | Builds personalised system prompt from persona + memory + scene context |
| **Simulated Devices** | `lib/simulated-devices.js` | Built-in demo IoT sensor data for offline testing |
| **Easter Eggs** | `lib/easter-eggs.ts` | Hard-coded JARVIS/Iron Man easter-egg responses |
| **Logger** | `lib/logger.ts` | Pino structured logging with request/response timing |

#### Built-in TypeScript Plugins (`src/plugins/`)

| Plugin | File | What it does |
|--------|------|--------------|
| `system_monitor` | `system_monitor.ts` | CPU, RAM, disk, network metrics every 5 s |
| `weather_monitor` | `weather_monitor.ts` | Open-Meteo weather API poll every 30 min |
| `ai_chat`         | `ai_chat.ts`         | Autonomous chat initiation and follow-up |
| `daily_briefing`  | `daily_briefing.ts`  | 06:00 scheduled AI briefing generation |
| `memory_enricher` | `memory_enricher.ts` | Background memory consolidation and decay |

---

### Shared Libraries — `lib/`

| Package | Directory | Description |
|---------|-----------|-------------|
| `@workspace/db` | `lib/db/` | Drizzle ORM schema, migrations, connection pool |
| `@workspace/event-bus` | `lib/event-bus/` | EventBus class, `BusEvent` types, Zod schemas for all 40+ event types |
| `@workspace/api-zod` | `lib/api-zod/` | Shared Zod request/response schemas used by both frontend and backend |
| `@workspace/api-client-react` | `lib/api-client-react/` | TanStack Query hooks generated from the API spec |

#### Database Tables (PostgreSQL + Drizzle)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `chat_messages` | session_id, role, content, channel | Full conversation history |
| `memory_entries` | type, content, embedding, decay_score | Short/long-term AI memory |
| `goals` | title, steps (JSON), status, priority | User goals + AI plans |
| `routines` | name, cron, steps (JSON), autonomy_level | Scheduled automation |
| `device_profiles` | device_id, type, capabilities | IoT device metadata |
| `device_locations` | device_id, lat, lon, geofences | Spatial device tracking |
| `autonomy_config` | enabled, safety_level | Global autonomy settings |
| `autonomy_log` | action, result, safety_check | Autonomous action audit trail |
| `ai_persona` | ai_name, gender, gravity, snarkiness | Personality configuration |
| `voice_identity` | tone, formality, verbosity | TTS voice style profile |
| `notifications` | type, message, read | System notification queue |
| `app_config` | key, value | Key-value store for instance settings (e.g. `INSTANCE_PAIRING_CODE`) |

---

## IoT & Hardware Compatibility

Deck OS ships with pre-programmed support for the following device categories, protocols, and hardware. All communication goes through the MQTT broker or WebSocket device transport — no vendor SDKs required.

---

### Communication Protocols

| Protocol | Library / Standard | Use Case |
|----------|--------------------|----------|
| **MQTT 3.1.1 / 5.0** | HiveMQ, Mosquitto, AWS IoT, Azure IoT | Primary IoT telemetry + command bus |
| **WebSocket** | Native WS (ws package) | Browser-to-server realtime; device bridge |
| **HTTP/SSE** | Express 5 | REST API, streaming AI responses |
| **Web Serial API** | W3C spec (Chromium) | Upside Down Labs BioAmp direct USB |
| **MediaPipe WASM** | Google MediaPipe Tasks | ACERA hand/face landmark tracking |

---

### Supported IoT Ecosystems

#### Smart Home Platforms

| Platform | Integration | Notes |
|----------|-------------|-------|
| **Home Assistant** | MQTT discovery topics (`homeassistant/#`) | Auto-maps HA MQTT entities to device registry |
| **Node-RED** | MQTT pub/sub | Use the `deck-os-out` node to push events into Deck OS |
| **OpenHAB** | MQTT binding | Publish sensor readings to configured topics |
| **ESPHome** | MQTT native | ESP32/ESP8266 sensors auto-detected by device_id |
| **Tasmota** | `tele/+/SENSOR` and `stat/+/POWER` topics | Shelly-compatible topic schema |
| **Zigbee2MQTT** | `zigbee2mqtt/+/+` | Bridges all Zigbee devices to MQTT |

#### Devices Pre-Programmed

**Lighting**
- Shelly 1 / Shelly Plus 1 / Shelly Dimmer 2 (on/off, dim via MQTT)
- Philips Hue (via MQTT bridge or Hue MQTT adapter)
- LIFX bulbs (via MQTT bridge)
- Tasmota-flashed smart bulbs (generic on/off/dim)
- WLED LED strips (brightness, effect, color via MQTT)

**Power & Switches**
- Shelly Plug S / Shelly EM (on/off, power monitoring)
- Sonoff Basic / Sonoff Mini R2 (Tasmota firmware, on/off)
- TP-Link Kasa (via MQTT bridge)
- Generic smart plugs with Tasmota (on/off, energy monitoring)

**Sensors**
- DHT22 / DHT11 — temperature + humidity (Arduino/ESP MQTT publisher)
- BME280 / BME680 — temperature, humidity, pressure, air quality
- DS18B20 — waterproof temperature probe
- PIR HC-SR501 — passive infrared motion sensor
- MQ-2 / MQ-135 — gas / air quality sensors
- HC-SR04 — ultrasonic distance sensor
- Soil moisture sensors (resistive and capacitive)
- Rain gauge sensors
- Light-dependent resistor (LDR) brightness sensors
- AM312 / AS312 mini PIR sensors

**Environmental / Weather**
- RTL-SDR + rtl_433 weather station receivers (piped to MQTT)
- Ecowitt / Fine Offset WiFi weather stations (MQTT bridge)
- Open-Meteo API (built-in HTTP plugin — no hardware required)
- WeatherLink MQTT adapters

**Energy Monitoring**
- Shelly EM / Shelly 3EM (3-phase power monitoring)
- Emporia Vue (via MQTT bridge)
- SolarEdge / Fronius inverters (via MQTT bridge)
- Victron Energy MPPT controllers (VE.Direct → MQTT)

**HVAC & Climate**
- Generic MQTT thermostats (set_temperature, mode: cool/heat/fan)
- Mitsubishi/Daikin/LG HVAC via IR blasters (Tasmota IRSend)
- Nest/Ecobee (via Home Assistant MQTT bridge)

**Security**
- Door/window reed switch sensors
- Alarmo (Home Assistant alarm panel via MQTT)
- Generic camera streams (snapshot URL configurable per device)
- RFID reader feedback (UID published to MQTT → identity event)

**Robotics & Automation**
- Roomba (via dorita980 MQTT bridge)
- Litter-Robot (via MQTT API bridge)
- Custom Arduino relay boards

**Networking**
- Unifi Controller metrics (via MQTT bridge)
- Pi-hole stats (via MQTT bridge)
- Router bandwidth (via MQTT publisher script)

---

### DIY / Maker Hardware

| Hardware | Protocol | Example Use |
|----------|----------|-------------|
| Arduino Uno / Nano | USB Serial + MQTT | Sensor reading, BioAmp host |
| ESP32 / ESP8266 | WiFi MQTT (native) | Wireless sensor nodes, relay control |
| Raspberry Pi | MQTT publisher (Python/Node) | Camera feed, GPIO sensors, local broker |
| Raspberry Pi Pico W | MQTT (MicroPython) | Lightweight sensor endpoints |
| M5Stack Core | MQTT (native) | Display + sensor all-in-one node |
| Seeed XIAO ESP32C3 | MQTT | Ultra-compact sensor nodes |
| STM32 / STM8 | Serial-to-MQTT bridge | Industrial sensor adapters |
| Teensy 4.x | USB HID + Serial | High-speed signal acquisition |

---

## ACERA Protocol — Vision Tracking Reference

**ACERA** (Augmented Cognition and Environmental Response Architecture) uses Google MediaPipe Tasks Vision WASM to track hands and face in real-time via the device camera. All processing runs locally in the browser — no frames are transmitted.

### Architecture

```
Camera → MediaPipe WASM → Landmark extraction → Gesture classifier
      → GestureResult → aceraGestures.ts → DashboardAction
      → WebSocket emit → AI context (acera.scene.update)
      → AceraOverlay render
```

### Recognised Gestures

| Gesture | Description | Default Action |
|---------|-------------|----------------|
| `SWIPE_LEFT` | Open-palm horizontal sweep left | `nav:prev` — previous page |
| `SWIPE_RIGHT` | Open-palm horizontal sweep right | `nav:next` — next page |
| `PEACE` | Index + middle finger V-sign | `nav:console` — Command Console |
| `THUMBS_UP` | Closed fist, thumb extended up | `nav:ai` — AI Router |
| `OPEN_PALM` | All five fingers extended | `ui:fullscreen` — fullscreen toggle |
| `CLOSED_FIST` | All fingers closed | `ui:dismiss` — cancel / dismiss |
| `THREE_FINGERS` | Index + middle + ring extended | `ui:confirm` — confirm action |
| `PINCH` | Thumb + index finger pinch | `ui:confirm` — select / activate |

### Keyboard Shortcut
- `Ctrl+Shift+G` — toggle ACERA overlay on/off

### AI Scene Context
Every 500 ms while active, ACERA pushes a summary to the server:
```
[ACERA] 1 hand detected. Dominant gesture: OPEN_PALM (confidence 0.97). Activity: active.
Right hand palm at (0.52, 0.63). Fingers: [true, true, true, true, true].
```
This text is appended to the AI system prompt during chat sessions.

---

## Stark Protocol — Bioelectric Signal Reference

**Stark** (Synaptic Transmission and Augmented Reality Kinetics) uses the **Web Serial API** to read raw ADC samples from Upside Down Labs BioAmp hardware over USB, then classifies the bioelectric signal into machine-readable events that drive dashboard actions — working in tandem with ACERA.

### Compatible Hardware

| Device | Modes | ADC | Notes |
|--------|-------|-----|-------|
| **BioAmp EXG Pill** | EMG · EEG · EKG | 10-bit (0–1023) | Universal — snap-on electrode pads; the primary recommended board |
| **Muscle BioAmp Shield** | EMG | 10-bit | Arduino Uno shield form factor; 3 electrode connectors |
| **BioAmp Band** | EMG | 10-bit | Textile electrode band; forearm / bicep placement |
| **BioAmp Candy** | EMG · EEG | 10-bit | Compact USB-C form factor; direct computer connection |
| **Muscle BioAmp Patchy** | EMG | 10-bit | Wireless patch (BLE bridge required for Stark) |
| **Any Arduino + AD8232** | EKG | 10-bit | DIY EKG shield; standard 3-lead clinical placement |
| **Teensy 4.x + custom amp** | EMG/EEG | 12-bit (0–4095) | High-speed acquisition; supported by auto-range detection |

### Serial Line Format

All supported firmware prints one reading per line at up to 1000 Hz:

```
512\n                  # single ADC value (most BioAmp examples)
1234,512\n             # counter,value (BioAmp Candy and some examples)
1234,512,510,511\n     # counter + multi-channel; Stark takes the last value
```

### Signal Processing Pipeline

```
Raw ADC sample (0–1023)
  → Adaptive DC baseline (EWMA α=0.001, ~1000-sample time constant)
  → Center: raw − baseline
  → Normalize: |centered| / 512
  → RMS window: √(mean(x²)) over last 128 samples (~256 ms at 500 Hz)
  → Calibrated amplitude: RMS / adaptive_max  →  clamped 0–1
  → Mode-specific classifier (EMG / EEG / EKG)
  → StarkAction mapping → DashboardAction
```

### EMG Signal States

| State | Trigger | Duration | Default Action | Visual |
|-------|---------|----------|----------------|--------|
| `IDLE` | Amplitude < 0.25 (threshold) | — | none | Dim red |
| `FLEX` | Amplitude ≥ 0.25, rising edge | Transient | `ui:confirm` | Bright red pulse |
| `DOUBLE_FLEX` | Two FLEXes within 480 ms | Transient | `ui:dismiss` | Orange flash |
| `SUSTAINED` | FLEX held ≥ 800 ms | While held | `ui:fullscreen` | Amber glow |
| `RELAX` | Falling edge from FLEX | One frame | none | Green flash |

### EEG Signal States

| State | Trigger | Default Action |
|-------|---------|----------------|
| `IDLE` | Low amplitude, no distinct pattern | none |
| `BLINK` | Amplitude spike > 0.72 (large artifact) | `nav:next` |
| `FOCUS` | Amplitude 0.18–0.55 sustained (beta activity) | `nav:console` |
| `RELAX_ALPHA` | Amplitude 0.05–0.18 (alpha wave dominance) | `nav:prev` |

### EKG Signal States

| State | Trigger | Notes |
|-------|---------|-------|
| `IDLE` | Between beats | Tracks inter-peak intervals |
| `BEAT` | Amplitude > 0.42 (R-peak), refractory 280 ms | BPM = 60 000 / avg interval |

### Auto-Mode Detection

After 600 samples (~1.2 s at 500 Hz), `StarkProcessor` analyses the signal:
1. Counts large peaks separated by 100+ samples — 2–6 regular peaks → **EKG**
2. Computes signal variance → high variance (`> 0.008`) → **EMG**; low variance → **EEG**

### Keyboard Shortcut
- `Ctrl+Shift+S` — toggle Stark overlay on/off

### AI Scene Context
Every 600 ms while active, Stark pushes a summary to the server:
```
[STARK] BioAmp device connected (VID:1A86 PID:7523). Mode: EMG.
Signal amplitude: 67% of calibrated max. Sample rate: 498 Hz. Muscle state: FLEX.
```
This block is appended to the AI system prompt, allowing the AI to reference the user's biometric state in conversation.

### Electrode Placement Guide

**EMG (Muscle)**
- Positive: muscle belly (e.g., forearm flexor, bicep, tibialis anterior)
- Negative: 2 cm distal from positive on same muscle
- Reference (ground): bony prominence (elbow, wrist, knee)

**EEG (Brain)**
- Positive: Fp1 or Fp2 (forehead, ~2 cm above eyebrow)
- Negative: A1 or A2 (behind ear, mastoid bone)
- Reference: opposite mastoid or vertex (Cz)

**EKG (Heart)**
- Right Arm (RA): right inner wrist or right collarbone
- Left Arm (LA): left inner wrist or left collarbone
- Right Leg (RL/ground): right inner ankle or abdomen

---

## Use Cases

Deck OS + ACERA + Stark are designed for a wide range of real-world applications. Below are documented use cases grouped by domain.

---

### Smart Home & Ambient Intelligence

1. **Gesture-controlled lighting** — Wave left/right with ACERA to cycle room lighting scenes; muscle flex (Stark EMG) triggers on/off
2. **Hands-free appliance control** — Forearm flex turns on coffee maker or kettle while cooking; no need to touch the phone
3. **Wake-word room control** — "JARVIS, dim the bedroom to 30%" via AI Console while EMG monitors background biometrics
4. **Occupancy-aware automation** — ACERA detects when no hands are visible for 5 minutes → trigger "leaving home" routine
5. **Morning briefing station** — Briefing plays TTS at 06:00; thumbs-up gesture (ACERA) snoozes; double flex (Stark) dismisses
6. **Geofenced device automation** — Phone GPS piped to MQTT → Deck OS fires "arriving home" routine when inside defined radius
7. **Energy monitoring dashboard** — Shelly EM readings visualised in real-time; AI alerts on unexpected spikes
8. **HVAC gesture control** — Peace sign (ACERA) opens climate panel; sustained flex (Stark) increments target temperature
9. **Smart lock integration** — RFID UID published to MQTT → Deck OS logs entry, greets by name via TTS
10. **Sleep-mode automation** — EEG alpha state detected (Stark) → system triggers "night mode" routine: lights off, thermostat down, phone silent

---

### Health & Wellness Monitoring

11. **Heart rate tracking during exercise** — EKG mode on BioAmp; BPM streamed to Deck OS dashboard and logged every minute
12. **Stress detection** — Sustained elevated EMG amplitude or elevated BPM (> 100) → AI sends a calming suggestion
13. **Posture alert** — EMG electrodes on upper trapezius; SUSTAINED state triggers Deck OS notification "Check your posture"
14. **Rehabilitation tracking** — Physical therapist-designed routines; EMG FLEX counts logged per session; progress graphed over time
15. **Fatigue detection** — Declining EMG max amplitude across a session → AI suggests break via TTS
16. **Meditation assistant** — EEG alpha waves (RELAX_ALPHA) displayed in real time; Deck OS logs session quality score
17. **Focus timer integration** — EEG FOCUS state increments a Pomodoro timer; IDLE state pauses it automatically
18. **Sleep stage approximation** — EEG electrode on forehead; delta-wave dominance (low amplitude, slow) logged overnight
19. **Pre-workout readiness** — Grip-strength EMG test at session start; AI compares to baseline and adjusts workout recommendation
20. **Biometric journaling** — At end of day, Deck OS AI generates a biometric summary: avg BPM, focus time, flex count, peak amplitude

---

### Accessibility

21. **Single-switch scanning interface** — One EMG electrode on cheek muscle; FLEX selects highlighted item in Deck OS UI
22. **Eye-blink navigation** — EEG blink detection cycles through menu items; a second blink confirms selection
23. **Hands-free web browsing** — ACERA gestures scroll and click within an embedded browser pane in the dashboard
24. **Voice + gesture combined input** — STT captures commands while ACERA/Stark provide navigation; reduces cognitive load for motor-impaired users
25. **Facial muscle typing** — Facial EMG mapped to a scan-keyboard for users with severe motor limitations
26. **Smart wheelchair integration** — Arduino EMG shield publishes FLEX/DOUBLE_FLEX to MQTT → wheelchair drive commands
27. **ALS/MND communication aid** — Lateral eye movement mapped to EEG artifact; letters selected by blink sequence
28. **Remote control for bedridden users** — Stark EMG wristband fires MQTT commands to control TV, lights, and nurse call from bed

---

### Productivity & Focus

29. **Distraction detection** — ACERA sees user looking away from screen (hand tracking goes idle, face tracking detects head turn) → plays subtle audio cue
30. **Flow state preservation** — EEG alpha + beta balance classified as FOCUS; Deck OS silences all notifications automatically
31. **Meeting focus mode** — Thumbs-up gesture (ACERA) starts a silent timer; closed fist ends it; AI logs duration
32. **Hands-free note dictation** — Peace sign opens AI console, voice input activates automatically; muscle flex sends message
33. **Gesture-controlled presentation** — ACERA swipe controls slide deck embedded in dashboard; sustained flex (Stark) toggles laser-pointer mode
34. **Context-aware reminders** — AI monitors memory bank; when FOCUS state is detected via EEG, surfaces deferred reminders
35. **Biometric Pomodoro** — Work timer automatically pauses when EEG drops from FOCUS to IDLE; resumes when focus returns
36. **Wrist EMG macro pad** — Each of 4 forearm flexors mapped to different macro commands (FLEX / DOUBLE / SUSTAINED per channel)

---

### Gaming & Entertainment

37. **Gesture game controller** — ACERA gestures map to keyboard shortcuts in any PC game via synthetic events
38. **Muscle-strength power meter** — EMG amplitude drives an in-game power bar (shot power, jump height)
39. **Heartbeat integration** — EKG BPM fed into game as a "fear/stress" mechanic; higher BPM = harder enemies
40. **Calm-to-play gating** — Game start requires EEG alpha state for 5 seconds — forces a pre-game breathing exercise
41. **Biometric tournament stats** — Stark logs peak BPM, average focus, and max EMG during a gaming session; Deck OS AI summarises performance
42. **VR hand tracking** — ACERA MediaPipe landmarks piped to virtual environment via WebSocket for controller-free VR interaction
43. **Music playback control** — ACERA swipe gestures skip tracks; EMG intensity modulates playback volume in real time
44. **Interactive art installation** — Stark EMG drives generative art parameters (particle speed, colour hue) via WebSocket to a p5.js canvas

---

### Workshop & Maker Projects

45. **CNC machine emergency stop** — Double flex (Stark) published to MQTT → Deck OS fires relay OFF command in < 350 ms
46. **3D printer monitoring** — Printer telemetry via MQTT; AI alerts when print fails (temperature drop or motion halt)
47. **Soldering station control** — EMG flex turns on solder station; SUSTAINED state sets temperature via MQTT
48. **Electronics bench assistant** — AI Console answers component questions; ACERA gesture captures schematic photo via camera
49. **Oscilloscope overlay** — Arduino serial data piped into Stark overlay for waveform visualisation without a dedicated scope
50. **Pick-and-place robot arm** — ACERA hand landmarks drive robot arm joint angles via WebSocket-to-ROS bridge

---

### Security & Monitoring

51. **Biometric door lock** — Specific double-flex sequence (Stark) + camera face detection (ACERA) = two-factor physical access
52. **Server room temperature alert** — BME280 sensor → MQTT → AI fires TTS alert + Slack notification if temp > 30 °C
53. **Intrusion detection** — PIR sensor triggers MQTT → Deck OS logs event, sends notification, captures camera snapshot
54. **Panic button** — Forearm sustained flex (Stark) for 3 seconds → publishes to MQTT → triggers alarm siren relay

---

### Scientific & Research

55. **EMG gait analysis** — Tibialis anterior electrode during walking; FLEX events logged with timestamps for stride analysis
56. **Attention research** — EEG alpha/beta ratio tracked over a 30-minute cognitive task; exported as CSV via Deck OS API
57. **Neurofeedback training** — RELAX_ALPHA state triggers audio reward tone via TTS; trains alpha wave control over sessions
58. **Cardiovascular fitness testing** — EKG BPM during step test; AI plots BPM recovery curve and compares to baseline
59. **Tremor quantification** — High-frequency EMG amplitude variance logged during rest; AI computes tremor index per session

---

### Industrial & Commercial

60. **Operator fatigue monitoring** — Sustained high EMG + BPM spike → alert supervisor; log to compliance database
61. **Ergonomic workstation** — Deck OS adjusts desk height, monitor brightness, and HVAC via MQTT based on posture EMG
62. **Inventory IoT** — Weight sensors on shelves → MQTT → Deck OS AI generates restock requests automatically
63. **Fleet telematics dashboard** — Vehicle GPS + OBD MQTT bridge → live map + AI anomaly detection
64. **Cold-chain monitoring** — DS18B20 temperature probes in refrigerated trucks → MQTT → AI alerts on excursion

---

## License

MIT

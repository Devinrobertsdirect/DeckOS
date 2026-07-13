# `atlas` — DeckOS Atlas CLI

> **A Jarvis brain for humans, machines, and robots.**
> The `atlas` CLI installs, starts, stops, inspects, and updates your local DeckOS Atlas instance — and connects robot bodies to it.

```
npx deckos-atlas start
```

(The package also ships a legacy `deckos` bin alias — `atlas` and `deckos` run the same CLI.)

---

## Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20 | Runtime for the CLI itself |
| pnpm | any | Monorepo package manager |
| git | any | Clone / update the repo |
| Docker *(optional)* | any | Recommended easiest path |
| PostgreSQL *(optional)* | ≥ 14 | Required for bare-metal mode |
| Ollama *(optional)* | any | Local AI (CORTEX/REFLEX tiers) |

---

## Commands

```bash
atlas install            # Install & set up Atlas (alias of start — setup runs on first launch)
atlas start              # Start all services (auto-detects Docker vs bare-metal)
atlas start --docker     # Force Docker Compose mode
atlas start --bare       # Force bare-metal mode
atlas start --no-open    # Don't open the browser automatically
atlas stop               # Stop all running services
atlas status             # Show service health + process status
atlas doctor             # Check prerequisites and system compatibility
atlas update             # Pull latest code, reinstall deps, run migrations

atlas devices            # List connected devices (id, name, type, status)
atlas plugins            # List installed plugins
atlas plugins store      # Browse the community plugin store registry
atlas plugins install <id>   # Install a plugin from the store (--force to re-install)
atlas brain              # Show the AI Router tier stack + request counters
atlas robot-connect [host]   # Ping a robot body (default: atlas.local) and print next steps
```

### `atlas brain` — the tier stack

| Tier | Engine | Role |
|------|--------|------|
| **APEX** | Claude (cloud) | Deep reasoning when an API key is configured — cloud optional |
| **CORTEX** | Ollama (local) | Chat, planning, summarization, predictions |
| **REFLEX** | Ollama (local) | Classification, routing, quick commands |
| **AUTOPILOT** | Rule engine | Deterministic actions and fallback — always on |

### `atlas robot-connect`

Pings `http://<host>:8000/health` (default host `atlas.local`), prints the WebSocket
telemetry hint (`ws://<host>:8000/ws`), and walks you through pointing the robot
bridge at your Atlas server. Verify with `atlas devices` afterwards.

---

## What `start` does (step by step)

1. **Prerequisites** — checks Node ≥ 20, pnpm, git
2. **Locate repo** — looks in the current directory (and parents); if not found, clones from GitHub to `~/.local/share/deckos-atlas` (Linux) / `~/Library/Application Support/DeckOS-Atlas` (macOS) / `%LOCALAPPDATA%\DeckOS-Atlas` (Windows)
3. **Environment** — copies `.env.example` → `.env` on first run and prompts for review
4. **Install deps** — runs `pnpm install`
5. **Migrate** — applies database schema with `drizzle-kit push`
6. **Launch** — starts API server + frontend as background processes, saves PIDs so `stop` works
7. **Open browser** — opens `http://localhost:3000` automatically

**Docker path** (steps 4–6 replaced by `docker compose up -d --build`):
Postgres, migrations, API, and frontend all run in containers. Zero host dependencies beyond Docker.

`atlas install` runs the same flow — first launch *is* the install.

---

## Publishing to npm

```bash
# From the monorepo root
cd installer/atlas-cli

# The GitHub URL is set in src/lib/detect.mjs → GITHUB_REPO
npm publish --access public
```

After publishing, anyone can run:

```bash
npx deckos-atlas start
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DECKOS_REPO` | value in `detect.mjs` | Override the GitHub clone URL |
| `ATLAS_API_URL` | `http://localhost:8080` | API base used by devices/plugins/brain commands |
| `DATABASE_URL` | from `.env` | PostgreSQL connection string |
| `PORT` | `8080` | API server port |

---

## State file

Process PIDs and start times are stored at `~/.deckos/state.json` on every platform.
`atlas stop` reads this file to send `SIGTERM` to the right processes.

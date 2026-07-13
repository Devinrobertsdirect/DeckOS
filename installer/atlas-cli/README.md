# `deckos` — CLI Bootstrap

> **One command to rule them all.**  
> The `deckos` CLI installs, starts, stops, and updates your local Deck OS instance.

```
npx deckos start
```

---

## Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20 | Runtime for the CLI itself |
| pnpm | any | Monorepo package manager |
| git | any | Clone / update the repo |
| Docker *(optional)* | any | Recommended easiest path |
| PostgreSQL *(optional)* | ≥ 14 | Required for bare-metal mode |

---

## Usage

### First run (any machine)

```bash
# Recommended — Docker handles Postgres automatically
npx deckos start --docker

# Bare-metal — you manage Postgres yourself
npx deckos start --bare
```

If the Deck OS repo isn't found on disk, `deckos start` clones it automatically.

### Commands

```bash
npx deckos start        # Start all services (auto-detects Docker vs bare-metal)
npx deckos start --docker  # Force Docker Compose mode
npx deckos start --bare    # Force bare-metal mode
npx deckos start --no-open # Don't open the browser automatically

npx deckos stop         # Stop all running services
npx deckos status       # Show service health + process status
npx deckos doctor       # Check prerequisites
npx deckos update       # Pull latest code, reinstall deps, run migrations
```

---

## What `start` does (step by step)

1. **Prerequisites** — checks Node ≥ 20, pnpm, git
2. **Locate repo** — looks in the current directory (and parents); if not found, clones from GitHub to `~/.local/share/deckos` (Linux) / `~/Library/Application Support/DeckOS` (macOS) / `%APPDATA%\DeckOS` (Windows)
3. **Environment** — copies `.env.example` → `.env` on first run and prompts for review
4. **Install deps** — runs `pnpm install`
5. **Migrate** — applies database schema with `drizzle-kit push`
6. **Launch** — starts API server + frontend as background processes, saves PIDs so `stop` works
7. **Open browser** — opens `http://localhost:3000` automatically

**Docker path** (steps 4–6 replaced by `docker compose up -d --build`):  
Postgres, migrations, API, and frontend all run in containers. Zero host dependencies beyond Docker.

---

## Publishing to npm

```bash
# From the monorepo root
cd packages/deckos

# Ensure the GitHub URL is set in src/lib/detect.mjs → GITHUB_REPO
# Then publish:
npm publish --access public
```

After publishing, anyone can run:

```bash
npx deckos start
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DECKOS_REPO` | value in `detect.mjs` | Override the GitHub clone URL |
| `DATABASE_URL` | from `.env` | PostgreSQL connection string |
| `PORT` | `8080` | API server port |

---

## State file

Process PIDs and start times are stored at:

- Linux: `~/.local/share/deckos/state.json`  *(CLI state only)*
- macOS: `~/Library/Application Support/DeckOS/state.json`
- Windows: `%APPDATA%\DeckOS\state.json`

`npx deckos stop` reads this file to send `SIGTERM` to the right processes.

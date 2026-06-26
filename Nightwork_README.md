# DeckOS Nightwork Log

Automated nightly code review and cleanup log.
Each entry records what was done, what was found, and what was left for the next pass.

---

## 2026-06-26

**Scope reviewed:** Full repo audit — api-server, devdeck-blog, lib packages, workspace config.

### Bugs Fixed

#### `artifacts/devdeck-blog/src/pages/home.tsx`

1. **Live clock frozen** — The status bar clock called `new Date().toLocaleTimeString()` directly in JSX. This value is computed once at render and never updates. Fixed by extracting a `useClockTime()` hook that uses `useState` + `setInterval` to tick every second and cleans up on unmount.

2. **Tailwind dynamic hover classes broken** — The Roadmap section generated classes like `hover:${phase.bg}` (e.g. `hover:bg-primary/5`) via template literals. Tailwind requires class names to be statically present in source; these never made it into the build output, so hover backgrounds silently did nothing. Fixed by introducing a `HoverRow` component that applies an inline `style` on `onMouseEnter` / `onMouseLeave`.

3. **Hero image used root-relative path** — `src="/cyberdeck-hero.png"` hardcodes the root path. When deployed to a subpath (e.g. Netlify with `basePath`), the image 404s while the two iframes worked fine because they used `import.meta.env.BASE_URL`. Fixed to use `HERO_IMAGE_URL` const matching the iframe pattern.

4. **Typo** — `{/* Persistant Status Bar */}` → `{/* Persistent Status Bar */}`

5. **Unused import** — `ArrowRight` was imported from lucide-react but never used. Removed.

#### `artifacts/api-server/src/index.ts`

6. **Express 5 listen error handling wrong** — In Express 5, the `app.listen(port, callback)` callback fires only on success and never receives an `err` argument (unlike raw `http.Server`). The previous `if (err)` check would never catch a port-binding failure (e.g. EADDRINUSE), leaving it as an unhandled error. Fixed by using `server.on("error", ...)` which is the correct Node.js pattern for listen failures.

7. **PORT required, no default** — `PORT` was mandatory and threw immediately if unset. Changed to default to `8080` so bare-metal dev starts without requiring `export PORT=8080` first. The validation still rejects non-numeric values.

### Issues Noted (Not Yet Fixed)

- **`api-server/src/app.ts`**: `app.use(cors())` allows all origins — fine for local dev but needs an allowed-origins list before any public deployment.
- **`lib/db/src/schema/index.ts`**: Schema is empty (`export {}`). No tables defined yet. The db package depends on `DATABASE_URL` being set at import time — any `pnpm install` or typecheck that loads the db module on a machine without postgres will throw. Consider lazy-initializing the connection.
- **`pnpm-workspace.yaml` esbuild overrides**: All Windows and macOS esbuild platform binaries are excluded (Replit-Linux-only optimisation). If developing on Windows or Mac the package install will fail silently or with a cryptic error. Document this or add a note in the README setup section.
- **`devdeck-blog/src/pages/home.tsx`**: Inline color strings `style={{color:'#ff44aa'}}` and `style={{color:'#9966ff'}}` for the SIDE and TERM pane labels in the wireframe key break the design system. These should be CSS variables or Tailwind custom colors.
- **`mockup-sandbox`**: Has a complete Shadcn UI component library duplicated from devdeck-blog. Both packages share ~40 identical UI component files. Worth extracting to a shared `lib/ui` package to eliminate drift.

### Architecture Observations

- The monorepo is well-structured for its stage. pnpm workspace + Orval codegen + Drizzle is a solid foundation.
- The `lib/api-spec/openapi.yaml` only defines the `/healthz` endpoint. All the DeckOS feature endpoints (IoT devices, modules, AI sessions, audit log) described in the blog posts need to be added here and backed by actual route handlers.
- The blog (`devdeck-blog`) is the only production-facing artifact right now. The API server is a skeleton. The `deck-os`, `deck-mobile`, and `deck-cli` packages referenced in the README do not exist in this repo yet.

### Files Changed This Session

```
artifacts/api-server/src/index.ts
artifacts/devdeck-blog/src/pages/home.tsx
Nightwork_README.md  (this file, created)
```

**Commit:** `5ecc390` — Fix live clock, roadmap hover, image path, and Express 5 listen error

---

## 2026-06-26 (Session 2 — User request)

**Scope:** New simplified user dashboard + `npx deckos` CLI package.

### What was built

#### Simplified user dashboard (`artifacts/devdeck-blog/src/pages/dashboard.tsx`) — NEW

The previous `home.tsx` blog/portfolio was renamed the "Developer View". The new default `/` route is a clean, purpose-built launcher:

- Same cyberdeck dark theme and status bar as the blog
- `DeckOS_` heading + tagline — nothing else above the fold
- 6 module cards in a 3×2 grid: JARVIS (AI), Monitor, Terminal, Network Scanner, IoT Hub, File Explorer
- Each card has an icon, name, one-liner description, per-module accent colour on hover, and an ONLINE status badge
- Quick-install block at the bottom with the `npx deckos start` command and common follow-up commands
- "Developer View →" link in the footer takes the user to `/dev`

**Design decisions:**
- Hover colours are applied as CSS `--accent` variable inline styles (not Tailwind template literals) — avoids the dynamic-class bug fixed in session 1
- `useClockTime()` hook is repeated (minor) rather than extracting a shared module; will extract to `lib/ui` when that package is created
- Module cards are presentational only (no actual routing to module pages yet — those don't exist)

#### Routing (`artifacts/devdeck-blog/src/App.tsx`)

- `/` → `Dashboard` (new default)
- `/dev` → `Home` (full blog/portfolio)
- 404 unchanged

#### Blog navigation (`artifacts/devdeck-blog/src/pages/home.tsx`)

- `[DECKOS]` brand in status bar is now a `<Link href="/">` back to dashboard
- "DEV VIEW" label added so users know they're in the developer section

#### `npx deckos` CLI (`artifacts/deck-cli/`)

New npm package (`name: "deckos"`) ready to publish. Zero external dependencies — uses only Node.js 20+ built-ins so `npx deckos` runs without a slow install phase.

| Command | What it does |
|---------|-------------|
| `npx deckos start` | Checks prereqs → clones repo to `~/.deckos/repo` (first run only) → copies `.env.example` → installs deps → runs migrations → builds API + frontend → spawns both as detached background processes → opens browser |
| `npx deckos stop` | SIGTERMs stored PIDs from `~/.deckos/state.json` |
| `npx deckos status` | Reports liveness of stored PIDs |
| `npx deckos update` | `git pull` + `pnpm install` + `db push` |
| `npx deckos doctor` | Checks Node 20+, git, pnpm, Docker (optional) |

Flags: `--no-open` (skip auto-browser on start), `--no-pull` (skip git pull on update).

State file: `~/.deckos/state.json` — stores PID, port, repoDir, startedAt per service. Already existed on this machine from previous session activity.

**To publish to npm:**
```bash
cd artifacts/deck-cli
pnpm run build        # bundles to dist/index.mjs
npm publish           # requires npm login; name "deckos" must be available
```

### Issues carried forward from session 1 (unchanged)

- `api-server/src/app.ts`: open CORS — needs allowed-origins before public deployment
- `lib/db/src/schema/index.ts`: empty schema, eager DATABASE_URL check at import
- `pnpm-workspace.yaml`: Windows/Mac native binaries excluded — dev on Windows fails at `pnpm install` for esbuild/rollup/lightningcss. Document in README.
- `home.tsx`: hardcoded hex colors `#ff44aa` and `#9966ff` for SIDE/TERM pane labels
- `mockup-sandbox`: ~40 Shadcn UI files duplicated from devdeck-blog

### New issues to address next

- Module cards in the dashboard have no click targets yet — they're presentational. Need to decide: link to sub-routes within this app, or link to a running DeckOS instance at localhost:PORT.
- `deck-cli` build won't succeed on Windows from this workspace (esbuild binary excluded in overrides). Build must be done on Linux or via GitHub Actions. Worth adding a CI workflow that builds and tests the CLI.
- The `npx deckos start` flow builds artifacts before starting them; if `DATABASE_URL` isn't set, the migration step warns but continues. The API server itself will crash on startup because `lib/db/src/index.ts` throws at module load if `DATABASE_URL` is missing. Need to guard this better before the CLI goes public.
- README section "Option A — npx deckos (easiest)" describes this CLI but the package isn't published yet. Add a note that it's coming in v0.1.

### Files changed this session

```
artifacts/devdeck-blog/src/App.tsx          (routing swap)
artifacts/devdeck-blog/src/pages/home.tsx   (back-link in status bar)
artifacts/devdeck-blog/src/pages/dashboard.tsx  (NEW)
artifacts/deck-cli/package.json             (NEW)
artifacts/deck-cli/tsconfig.json            (NEW)
artifacts/deck-cli/build.mjs               (NEW)
artifacts/deck-cli/src/index.ts             (NEW)
artifacts/deck-cli/.replit-artifact/artifact.toml (NEW)
.claude/launch.json                         (NEW — dev server config)
Nightwork_README.md                         (updated)
```

**Commits:** `677ac43` — Add simplified user dashboard and npx deckos CLI

---

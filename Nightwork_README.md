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

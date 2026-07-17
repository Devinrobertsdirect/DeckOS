# ─────────────────────────────────────────────────────────────────────────────
# Neura — self-host / server image.
#
# This is the ADVANCED / self-host channel, NOT the consumer download (that's the
# Electron desktop app in interfaces/electron). It runs the Neura brain + web UI
# on port 8080; open http://localhost:8080. Runs fully DB-less by default
# (config persists to the /data volume); no Postgres required.
#
#   docker build -t neura .
#   docker run -p 8080:8080 -v neura-data:/data neura
# ─────────────────────────────────────────────────────────────────────────────

# ── build stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build
WORKDIR /app
RUN corepack enable
COPY . .
# Install the workspace, build the frontend (Vite) and the server bundle (esbuild).
RUN pnpm install --config.confirmModulesPurge=false \
 && pnpm --filter @workspace/deck-os build \
 && (cd core/server && node ./build.mjs)

# ── runtime stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    ATLAS_DATA_DIR=/data \
    DATABASE_URL=postgresql://127.0.0.1/neura
# The whole tree (incl. the pnpm node_modules the externalized deps resolve from,
# and the built frontend the server serves at interfaces/desktop/dist/public).
COPY --from=build /app /app
VOLUME /data
EXPOSE 8080
WORKDIR /app/core/server
HEALTHCHECK --interval=30s --timeout=4s --start-period=25s \
  CMD node -e "require('http').get('http://127.0.0.1:8080/api/healthz',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "--max-old-space-size=1024", "dist/index.mjs"]

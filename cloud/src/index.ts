/*
 * index.ts — Nobi Cloud entrypoint. Boots the HTTP server and attaches the
 * WebSocket relay to the same port (so one Replit/Node process serves both).
 */
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { vaultKeyConfigured } from "./crypto.js";
import { SESSION_TTL_MS } from "./auth.js";

const PORT = Number(process.env.PORT || 8790);

const { app, store, hub } = createApp();
const server = createServer(app);
hub.attach(server);

// Periodically purge expired sessions so stale tokens don't linger or accumulate
// (WS + REST both reject them live, but this keeps the store bounded).
const sweep = setInterval(
  () => {
    void store.purgeExpiredSessions(SESSION_TTL_MS);
  },
  60 * 60 * 1000, // hourly
);
sweep.unref?.();

server.listen(PORT, () => {
  console.log(`[neura-cloud] listening on :${PORT}`);
  if (!vaultKeyConfigured()) {
    console.warn(
      "[neura-cloud] WARNING: NEURA_VAULT_KEY is not set — key vault writes will fail. " +
        "Set a strong random value before going live.",
    );
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn("[neura-cloud] note: GOOGLE_CLIENT_ID unset — Google login disabled.");
  }
});

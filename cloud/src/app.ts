/*
 * app.ts — Nobi Cloud Express app + route wiring.
 *
 * Public surface (all under /v1):
 *   /health, /config                          — status + capabilities
 *   /auth/*                                    — signup, login, google, me, logout
 *   /keys/*        (Bearer)                    — encrypted API-key vault
 *   /chat          (Bearer)                    — cloud brain
 *   /bots/*        (Bearer)                    — device registry + relay commands
 *
 * The WebSocket relay (/v1/ws) is attached to the HTTP server in index.ts.
 */
import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { FileStore, type Store } from "./store.js";
import { authRouter } from "./auth.js";
import { vaultRouter } from "./vault.js";
import { profileRouter } from "./profile.js";
import { reserveRouter, adminRouter } from "./reserve.js";
import { syncRouter, adminEntitleRouter } from "./sync.js";
import { brainRouter } from "./brain.js";
import { botsRouter, RelayHub } from "./relay.js";
import { vaultKeyConfigured } from "./crypto.js";
import { rateLimit, byIp } from "./ratelimit.js";

export function createApp(store: Store = new FileStore()): {
  app: Express;
  store: Store;
  hub: RelayHub;
} {
  const app = express();
  const hub = new RelayHub(store);

  // Behind Replit's / a cloud proxy, so req.ip reflects the client, not the proxy.
  app.set("trust proxy", 1);
  app.use(cors());
  // Keep the raw body: the Stripe webhook signature is computed over the exact bytes.
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));

  // IP throttle on the unauthenticated auth surface: blunts credential stuffing,
  // signup/enumeration floods, and the scrypt-DoS vector.
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.NEURA_CLOUD_AUTH_PER_MIN || 20),
    key: byIp,
    name: "auth",
  });

  app.get("/v1/health", (_req, res) => {
    res.json({
      ok: true,
      service: "neura-cloud",
      version: "0.1.0",
      vaultKey: vaultKeyConfigured(),
      google: !!process.env.GOOGLE_CLIENT_ID,
    });
  });

  // Advertised so the mobile app can adapt its UI to what's actually configured.
  app.get("/v1/config", (_req, res) => {
    res.json({
      service: "neura-cloud",
      features: {
        emailPassword: true,
        google: !!process.env.GOOGLE_CLIENT_ID,
        cloudBrain: true,
        botRelay: true,
      },
      model: process.env.NEURA_CLOUD_MODEL || "claude-3-5-sonnet-latest",
    });
  });

  app.use("/v1/auth", authLimiter, authRouter(store));
  app.use("/v1/keys", vaultRouter(store));
  app.use("/v1/profile", profileRouter(store));
  app.use("/v1/reserve", reserveRouter(store));
  app.use("/v1/admin", adminRouter(store));
  app.use("/v1/admin", adminEntitleRouter(store));
  app.use("/v1", syncRouter(store));
  app.use("/v1/chat", brainRouter(store));
  app.use("/v1/bots", botsRouter(store, hub));

  // Optional: serve the mobile web app so ONE Replit deploy provides the API +
  // the mobile UI. Drop the mobile build into ./mobile-dist (or set
  // NEURA_MOBILE_DIST); the Expo app then points at https://<host>/mobile/.
  const mobileDist = process.env.NEURA_MOBILE_DIST || path.resolve(process.cwd(), "mobile-dist");
  if (fs.existsSync(path.join(mobileDist, "index.html"))) {
    const idx = path.join(mobileDist, "index.html");
    app.use("/mobile", express.static(mobileDist));
    app.use("/mobile", (req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(idx);
    });
  }

  // Friendly root so hitting the deploy URL shows status, not a 404.
  app.get("/", (_req, res) => {
    const mobile = fs.existsSync(path.join(mobileDist, "index.html"));
    res
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Nobi Cloud</title>` +
          `<style>body{background:#070d1f;color:#eaf1ff;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center}` +
          `svg{filter:drop-shadow(0 0 12px rgba(201,220,240,.4))}a{color:#f5b83d}</style>` +
          `<div><svg width="72" height="72" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#1e2a38"/>` +
          `<rect x="13" y="15" width="7" height="18" rx="3.5" fill="#c9dcf0"/><rect x="28" y="15" width="7" height="18" rx="3.5" fill="#c9dcf0"/></svg>` +
          `<h1 style="letter-spacing:.02em">Nobi Cloud</h1>` +
          `<p style="color:#9db3d9">Online. Accounts · vault · brain · relay.</p>` +
          `<p style="color:#6f82a6;font-size:.85rem">API under <code>/v1</code>${mobile ? ` · mobile app at <a href="/mobile/">/mobile/</a>` : ""}</p></div>`,
      );
  });

  return { app, store, hub };
}

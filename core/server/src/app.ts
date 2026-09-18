import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { ServerResponse } from "http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

// Cache policy for the built SPAs: Vite fingerprints everything under /assets/
// (a new build changes the filename), so those files are safe to cache forever —
// the Pi's Chromium kiosk skips re-downloading/parsing them on every boot.
// index.html is explicitly no-cache so a fresh deploy is picked up on next load.
const staticCacheOptions = {
  setHeaders(res: ServerResponse, filePath: string) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
};

// /remote is the short URL people actually type and hand to each other, so
// alias it to the remote page rather than letting it fall through to the
// dashboard SPA (which answers 200 with the wrong page — worse than a 404).
app.get("/remote", (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(302, `/api/remote${qs}`);
});

// /setup is the Wi-Fi onboarding page, and it is read off a robot's face and
// typed into a phone by someone who has owned him for four minutes. It has to
// be the shortest thing that could possibly work.
app.get("/setup", (_req, res) => res.redirect(302, "/api/setup"));

// /play is what gets read off his face when a game starts. It is the same page
// as the remote, which shows only the games when the code is a play code —
// one implementation of a live game, not two that can drift apart.
app.get("/play", (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(302, `/api/remote${qs}`);
});

// The probes iOS and Android fire when they join a network decide whether the
// phone shows "sign in to this network". While the setup hotspot is up we are
// that network, and answering these with a redirect is what makes the setup
// page appear BY ITSELF — no URL to read out, no typing. When the hotspot is
// not up these paths are never reached on a normal network, so this costs
// nothing the rest of the time.
app.get(
  ["/hotspot-detect.html", "/generate_204", "/gen_204", "/connecttest.txt", "/ncsi.txt", "/library/test/success.html"],
  (_req, res) => res.redirect(302, "/api/setup"),
);

// Serve the installable mobile companion (PWA) at /mobile/. This is the URL the
// pairing flow hands to a phone; the phone can "Add to Home Screen" and connect
// back to this brain. Mounted BEFORE the desktop SPA so /mobile/* never falls
// through to the dashboard's index.html. ELECTRON_MOBILE_DIST overrides location.
const mobileDist =
  process.env.ELECTRON_MOBILE_DIST ??
  [
    path.resolve(__dirname, "../../../interfaces/mobile/dist/public"), // monorepo build
    path.resolve(__dirname, "../mobile-dist"),                        // electron package layout
  ].find((p) => fs.existsSync(path.join(p, "index.html")));

if (mobileDist && fs.existsSync(path.join(mobileDist, "index.html"))) {
  logger.info({ mobileDist }, "Serving mobile PWA at /mobile/");
  const mobileIndex = path.join(mobileDist, "index.html");
  app.use("/mobile", express.static(mobileDist, staticCacheOptions));
  // SPA fallback for mobile deep-links (GET, non-asset) → mobile index.html.
  app.use("/mobile", (req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(mobileIndex);
  });
}

// Serve the built dashboard whenever it exists, so `http://localhost:8080`
// works with a single process. ELECTRON_FRONTEND_DIST overrides the location.
const frontendDist =
  process.env.ELECTRON_FRONTEND_DIST ??
  [
    path.resolve(__dirname, "../../../interfaces/desktop/dist/public"), // monorepo build
    path.resolve(__dirname, "../frontend-dist"),                      // electron package layout
  ].find((p) => fs.existsSync(path.join(p, "index.html")));

if (frontendDist && fs.existsSync(path.join(frontendDist, "index.html"))) {
  logger.info({ frontendDist }, "Serving dashboard static build");
  const indexHtml = path.join(frontendDist, "index.html");
  app.use(express.static(frontendDist, staticCacheOptions));
  // SPA fallback for non-API GETs (Express 5: no bare "*" route strings).
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(indexHtml);
  });
}

export default app;

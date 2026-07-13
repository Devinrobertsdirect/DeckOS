import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
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
  app.use(express.static(frontendDist));
  // SPA fallback for non-API GETs (Express 5: no bare "*" route strings).
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(indexHtml);
  });
}

export default app;

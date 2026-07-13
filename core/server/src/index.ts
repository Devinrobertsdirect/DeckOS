import http from "http";
import app from "./app.js";
import { logger, isDaemon } from "./lib/logger.js";
import { bootstrap, teardown } from "./lib/bootstrap.js";
import { attachWebSocketServer } from "./lib/ws-server.js";

const rawPort = process.env["PORT"];

// Default to the Atlas contract port when unset (see docs/ARCHITECTURE.md).
const port = Number(rawPort ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (isDaemon) {
  logger.info({ daemon: true }, "Starting in daemon mode — JSON-only stdout logging enabled");
}

process.on("unhandledRejection", (reason) => {
  logger.error(
    { err: reason instanceof Error ? reason.message : String(reason) },
    "Unhandled rejection — continuing (local-first: the brain never goes silent)",
  );
});

async function main() {
  try {
    await bootstrap();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Bootstrap degraded — continuing without full persistence (is the database running?)",
    );
  }

  const server = http.createServer(app);
  attachWebSocketServer(server);

  server.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port, daemon: isDaemon }, "Server listening (HTTP + WebSocket)");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    await teardown();
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});

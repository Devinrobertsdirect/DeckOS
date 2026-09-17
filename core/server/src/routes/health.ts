import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, dbEnabled } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// "/health" is the name everyone reaches for first; keep "/healthz" as-is.
router.get(["/healthz", "/health"], async (_req, res) => {
  const timestamp = new Date().toISOString();

  let dbOk = false;
  // Local-first desktop has no database — report false rather than blocking the
  // health check on a connection attempt that can only time out.
  if (dbEnabled) {
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }

  const data = HealthCheckResponse.parse({ status: "ok", db: dbOk, timestamp });
  res.json(data);
});

export default router;

import { Router } from "express";
import { db, briefingsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { generateBriefing } from "../lib/briefing-generator.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/briefings", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(briefingsTable)
      .orderBy(desc(briefingsTable.generatedAt));
    res.json({ briefings: rows, count: rows.length });
  } catch (err) {
    logger.warn({ err }, "GET /briefings failed");
    res.status(500).json({ error: "Failed to fetch briefings" });
  }
});

router.get("/briefings/latest", async (_req, res) => {
  try {
    const [row] = await db
      .select()
      .from(briefingsTable)
      .orderBy(desc(briefingsTable.generatedAt))
      .limit(1);
    if (!row) {
      res.json({ briefing: null });
      return;
    }
    res.json({ briefing: row });
  } catch (err) {
    logger.warn({ err }, "GET /briefings/latest failed");
    res.status(500).json({ error: "Failed to fetch latest briefing" });
  }
});

router.post("/briefings/generate", async (_req, res) => {
  try {
    const briefing = await generateBriefing();
    res.json({ briefing });
  } catch (err) {
    logger.warn({ err }, "POST /briefings/generate failed");
    res.status(500).json({ error: "Failed to generate briefing" });
  }
});

export default router;

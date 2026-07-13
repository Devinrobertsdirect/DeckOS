import { Router } from "express";
import { db, presenceStateTable, nudgesTable, narrativeThreadsTable, initiativeConfigTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { presenceManager } from "../lib/presence-manager.js";
import { narrativeManager } from "../lib/narrative-manager.js";
import { initiativeEngine } from "../lib/initiative-engine.js";

const router = Router();

// GET /api/presence — current presence state + summary
router.get("/", async (_req, res) => {
  const state = await presenceManager.get();
  const activeNudges = await db.select().from(nudgesTable)
    .where(eq(nudgesTable.dismissed, false))
    .orderBy(desc(nudgesTable.createdAt))
    .limit(10);
  const activeThreads = await narrativeManager.getActiveThreads();

  res.json({ presence: state, nudges: activeNudges, threads: activeThreads });
});

// PUT /api/presence/record — called by any channel to mark interaction
router.put("/record", async (req, res) => {
  const { channel } = req.body as { channel?: string };
  await presenceManager.record((channel as any) ?? "web");
  const state = await presenceManager.get();
  res.json({ ok: true, presence: state });
});

// GET /api/presence/nudges — pending nudges
router.get("/nudges", async (_req, res) => {
  const nudges = await db.select().from(nudgesTable)
    .where(eq(nudgesTable.dismissed, false))
    .orderBy(desc(nudgesTable.urgencyScore), desc(nudgesTable.createdAt))
    .limit(20);
  res.json(nudges);
});

// PUT /api/presence/nudges/:id/dismiss
router.put("/nudges/:id/dismiss", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db.update(nudgesTable)
    .set({ dismissed: true, surfacedAt: new Date() })
    .where(eq(nudgesTable.id, id));
  return res.json({ ok: true });
});

// GET /api/presence/threads — narrative threads
router.get("/threads", async (_req, res) => {
  const active = await narrativeManager.getActiveThreads();
  const dormant = await narrativeManager.getDormantThreads();
  res.json({ active, dormant });
});

// PUT /api/presence/threads/:id/touch
router.put("/threads/:id/touch", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await narrativeManager.touchThread(id);
  return res.json({ ok: true });
});

// PUT /api/presence/threads/:id/resolve
router.put("/threads/:id/resolve", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await narrativeManager.resolveThread(id);
  return res.json({ ok: true });
});

// GET /api/presence/config — initiative config
router.get("/config", async (_req, res) => {
  const rows = await db.select().from(initiativeConfigTable).limit(1);
  if (rows.length) return res.json(rows[0]);
  const [created] = await db.insert(initiativeConfigTable).values({}).returning();
  return res.json(created);
});

// PUT /api/presence/config — update initiative config
router.put("/config", async (req, res) => {
  const { enabled, initiativeLevel, checkInAfterMinutes, goalDecayThreshold, maxActiveNudges } = req.body as {
    enabled?: boolean; initiativeLevel?: number; checkInAfterMinutes?: number;
    goalDecayThreshold?: number; maxActiveNudges?: number;
  };

  const update: Record<string, unknown> = {};
  if (enabled !== undefined) update.enabled = enabled;
  if (initiativeLevel !== undefined) update.initiativeLevel = Math.max(0, Math.min(1, initiativeLevel));
  if (checkInAfterMinutes !== undefined) update.checkInAfterMinutes = checkInAfterMinutes;
  if (goalDecayThreshold !== undefined) update.goalDecayThreshold = goalDecayThreshold;
  if (maxActiveNudges !== undefined) update.maxActiveNudges = maxActiveNudges;

  const rows = await db.select().from(initiativeConfigTable).limit(1);
  if (rows.length) {
    await db.update(initiativeConfigTable).set(update).where(eq(initiativeConfigTable.id, rows[0].id));
  } else {
    await db.insert(initiativeConfigTable).values(update);
  }

  // Trigger a tick to reflect new config immediately
  void initiativeEngine.tick();

  const [updated] = await db.select().from(initiativeConfigTable).limit(1);
  res.json(updated);
});

// POST /api/presence/threads/sync — sync narrative threads from goals
router.post("/threads/sync", async (_req, res) => {
  await narrativeManager.syncFromGoals();
  const threads = await narrativeManager.getActiveThreads();
  res.json({ synced: threads.length, threads });
});

export default router;

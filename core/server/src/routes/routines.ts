import { Router } from "express";
import { z } from "zod";
import { db, routinesTable, routineExecutionsTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { routineRunner, nextCronDate } from "../lib/routine-runner.js";

const router = Router();

const VALID_TRIGGER_TYPES  = ["cron", "event"] as const;
const VALID_ACTION_TYPES   = [
  "generate_briefing",
  "send_notification",
  "refresh_memory",
  "query_goals_summary",
  "run_health_check",
  "emit_bus_event",
] as const;

const CreateBody = z.object({
  name:             z.string().min(1).max(120),
  enabled:          z.boolean().optional().default(true),
  triggerType:      z.enum(VALID_TRIGGER_TYPES),
  triggerValue:     z.string().min(1),
  actionType:       z.enum(VALID_ACTION_TYPES),
  actionParams:     z.record(z.unknown()).optional().default({}),
  notifyOnComplete: z.boolean().optional().default(false),
});

const UpdateBody = z.object({
  name:             z.string().min(1).max(120).optional(),
  enabled:          z.boolean().optional(),
  triggerType:      z.enum(VALID_TRIGGER_TYPES).optional(),
  triggerValue:     z.string().min(1).optional(),
  actionType:       z.enum(VALID_ACTION_TYPES).optional(),
  actionParams:     z.record(z.unknown()).optional(),
  notifyOnComplete: z.boolean().optional(),
});

function formatRoutine(r: typeof routinesTable.$inferSelect) {
  const nextRun = r.triggerType === "cron"
    ? (() => { try { return nextCronDate(r.triggerValue)?.toISOString() ?? null; } catch { return null; } })()
    : null;
  return {
    id:               r.id,
    name:             r.name,
    enabled:          r.enabled,
    triggerType:      r.triggerType,
    triggerValue:     r.triggerValue,
    actionType:       r.actionType,
    actionParams:     r.actionParams,
    notifyOnComplete: r.notifyOnComplete,
    lastRunAt:        r.lastRunAt?.toISOString() ?? null,
    nextRunAt:        r.nextRunAt?.toISOString() ?? nextRun,
    createdAt:        r.createdAt.toISOString(),
    updatedAt:        r.updatedAt.toISOString(),
  };
}

function formatExecution(e: typeof routineExecutionsTable.$inferSelect) {
  return {
    id:          e.id,
    routineId:   e.routineId,
    triggeredAt: e.triggeredAt.toISOString(),
    outcome:     e.outcome,
    result:      e.result ?? null,
  };
}

// ── List all routines ────────────────────────────────────────────────────────
router.get("/routines", async (_req, res) => {
  const rows = await db.select().from(routinesTable).orderBy(desc(routinesTable.createdAt));
  res.json({ routines: rows.map(formatRoutine), total: rows.length });
});

// ── All executions (unified history) ────────────────────────────────────────
router.get("/routines/executions/all", async (req, res) => {
  const { routineId, outcome, from, to } = req.query;

  const conditions: ReturnType<typeof eq>[] = [];

  if (routineId) {
    const rid = parseInt(routineId as string);
    if (!isNaN(rid)) conditions.push(eq(routineExecutionsTable.routineId, rid));
  }
  if (outcome === "success" || outcome === "error") {
    conditions.push(eq(routineExecutionsTable.outcome, outcome as string));
  }
  if (from) {
    const fromDate = new Date(from as string);
    if (!isNaN(fromDate.getTime())) conditions.push(gte(routineExecutionsTable.triggeredAt, fromDate));
  }
  if (to) {
    const toDate = new Date(to as string);
    if (!isNaN(toDate.getTime())) {
      // Set to end-of-day so the full selected date is included
      toDate.setUTCHours(23, 59, 59, 999);
      conditions.push(lte(routineExecutionsTable.triggeredAt, toDate));
    }
  }

  const rows = await db
    .select({
      id:          routineExecutionsTable.id,
      routineId:   routineExecutionsTable.routineId,
      routineName: routinesTable.name,
      actionType:  routinesTable.actionType,
      triggeredAt: routineExecutionsTable.triggeredAt,
      outcome:     routineExecutionsTable.outcome,
      result:      routineExecutionsTable.result,
    })
    .from(routineExecutionsTable)
    .leftJoin(routinesTable, eq(routineExecutionsTable.routineId, routinesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(routineExecutionsTable.triggeredAt))
    .limit(200);

  res.json({
    executions: rows.map(r => ({
      id:          r.id,
      routineId:   r.routineId,
      routineName: r.routineName ?? "(deleted routine)",
      actionType:  r.actionType ?? null,
      triggeredAt: r.triggeredAt.toISOString(),
      outcome:     r.outcome,
      result:      r.result ?? null,
    })),
    total: rows.length,
  });
});

// ── Get single routine ───────────────────────────────────────────────────────
router.get("/routines/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(routinesTable).where(eq(routinesTable.id, id));
  if (rows.length === 0) { res.status(404).json({ error: "Routine not found" }); return; }
  res.json(formatRoutine(rows[0]));
});

// ── Create routine ───────────────────────────────────────────────────────────
router.post("/routines", async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { name, enabled, triggerType, triggerValue, actionType, actionParams, notifyOnComplete } = parsed.data;

  const nextRun = triggerType === "cron"
    ? (() => { try { return nextCronDate(triggerValue) ?? undefined; } catch { return undefined; } })()
    : undefined;

  const [row] = await db.insert(routinesTable).values({
    name, enabled, triggerType, triggerValue, actionType,
    actionParams: actionParams ?? {},
    notifyOnComplete: notifyOnComplete ?? false,
    nextRunAt: nextRun,
  }).returning();

  if (triggerType === "event") {
    void routineRunner.resubscribeEventRoutines();
  }

  res.status(201).json(formatRoutine(row));
});

// ── Update routine ───────────────────────────────────────────────────────────
router.put("/routines/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const rows = await db.select().from(routinesTable).where(eq(routinesTable.id, id));
  if (rows.length === 0) { res.status(404).json({ error: "Routine not found" }); return; }

  const updates: Partial<typeof routinesTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.name             !== undefined) updates.name             = d.name;
  if (d.enabled          !== undefined) updates.enabled          = d.enabled;
  if (d.triggerType      !== undefined) updates.triggerType      = d.triggerType;
  if (d.triggerValue     !== undefined) updates.triggerValue     = d.triggerValue;
  if (d.actionType       !== undefined) updates.actionType       = d.actionType;
  if (d.actionParams     !== undefined) updates.actionParams     = d.actionParams;
  if (d.notifyOnComplete !== undefined) updates.notifyOnComplete = d.notifyOnComplete;

  const newTriggerType  = d.triggerType  ?? rows[0].triggerType;
  const newTriggerValue = d.triggerValue ?? rows[0].triggerValue;

  if (newTriggerType === "cron") {
    try {
      updates.nextRunAt = nextCronDate(newTriggerValue) ?? undefined;
    } catch { /* ignore */ }
  }

  const [updated] = await db.update(routinesTable).set(updates).where(eq(routinesTable.id, id)).returning();

  void routineRunner.resubscribeEventRoutines();

  res.json(formatRoutine(updated));
});

// ── Delete routine ───────────────────────────────────────────────────────────
router.delete("/routines/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(routineExecutionsTable).where(eq(routineExecutionsTable.routineId, id));
  await db.delete(routinesTable).where(eq(routinesTable.id, id));
  void routineRunner.resubscribeEventRoutines();
  res.status(204).send();
});

// ── Manual trigger ───────────────────────────────────────────────────────────
router.post("/routines/:id/trigger", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(routinesTable).where(eq(routinesTable.id, id));
  if (rows.length === 0) { res.status(404).json({ error: "Routine not found" }); return; }
  void routineRunner.executeRoutine(rows[0]);
  res.json({ ok: true, message: `Routine "${rows[0].name}" triggered manually` });
});

// ── Execution log ────────────────────────────────────────────────────────────
router.get("/routines/:id/executions", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(routineExecutionsTable)
    .where(eq(routineExecutionsTable.routineId, id))
    .orderBy(desc(routineExecutionsTable.triggeredAt))
    .limit(50);
  res.json({ executions: rows.map(formatExecution), total: rows.length });
});

export default router;

import { Router } from "express";
import { z } from "zod";
import { db, goalsTable, goalPlansTable } from "@workspace/db";
import { eq, desc, isNull, or } from "drizzle-orm";
import { bus } from "../lib/bus.js";

const router = Router();

const CreateGoalBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional().default(50),
  parentGoalId: z.number().int().optional(),
  tags: z.array(z.string()).optional().default([]),
  dueAt: z.string().datetime().optional(),
  decayRatePerHour: z.number().min(0).max(100).optional().default(0.5),
});

const UpdateGoalBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  status: z.enum(["active", "completed", "paused", "decayed"]).optional(),
  completionPct: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
  dueAt: z.string().datetime().optional().nullable(),
});

const CreatePlanBody = z.object({
  steps: z.array(z.object({
    step: z.number().int(),
    action: z.string(),
    dependencies: z.array(z.number().int()).default([]),
    status: z.enum(["pending", "in_progress", "done", "skipped"]).default("pending"),
    notes: z.string().optional(),
  })),
  confidence: z.number().min(0).max(1).optional().default(0.7),
  riskAssessment: z.string().optional(),
});

function applyDecay(goal: typeof goalsTable.$inferSelect): number {
  if (goal.status !== "active") return goal.completionPct;
  const hoursElapsed = (Date.now() - goal.updatedAt.getTime()) / 3600000;
  const decayed = goal.completionPct - hoursElapsed * goal.decayRatePerHour;
  return Math.max(0, Math.round(decayed));
}

function formatGoal(g: typeof goalsTable.$inferSelect) {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    status: g.status,
    priority: g.priority,
    parentGoalId: g.parentGoalId,
    completionPct: applyDecay(g),
    decayRatePerHour: g.decayRatePerHour,
    tags: g.tags,
    dueAt: g.dueAt?.toISOString() ?? null,
    completedAt: g.completedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

function formatPlan(p: typeof goalPlansTable.$inferSelect) {
  return {
    id: p.id,
    goalId: p.goalId,
    steps: p.steps,
    status: p.status,
    confidence: p.confidence,
    riskAssessment: p.riskAssessment,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/goals", async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  let rows = await db.select().from(goalsTable).orderBy(desc(goalsTable.priority), desc(goalsTable.createdAt));
  if (statusFilter) {
    rows = rows.filter((g) => g.status === statusFilter);
  }
  res.json({ goals: rows.map(formatGoal), total: rows.length });
});

router.get("/goals/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(goalsTable).where(eq(goalsTable.id, id));
  if (rows.length === 0) { res.status(404).json({ error: "Goal not found" }); return; }
  const subgoals = await db.select().from(goalsTable).where(eq(goalsTable.parentGoalId, id));
  const plans = await db.select().from(goalPlansTable).where(eq(goalPlansTable.goalId, id)).orderBy(desc(goalPlansTable.createdAt));
  res.json({ goal: formatGoal(rows[0]), subgoals: subgoals.map(formatGoal), plans: plans.map(formatPlan) });
});

router.post("/goals", async (req, res) => {
  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { title, description, priority, parentGoalId, tags, dueAt, decayRatePerHour } = parsed.data;

  const [goal] = await db.insert(goalsTable).values({
    title,
    description,
    priority,
    parentGoalId,
    tags,
    dueAt: dueAt ? new Date(dueAt) : undefined,
    decayRatePerHour,
  }).returning();

  bus.emit({ source: "goal-manager", target: null, type: "memory.stored", payload: { event: "goal.create", goalId: goal.id, title } });

  res.status(201).json(formatGoal(goal));
});

router.patch("/goals/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateGoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const rows = await db.select().from(goalsTable).where(eq(goalsTable.id, id));
  if (rows.length === 0) { res.status(404).json({ error: "Goal not found" }); return; }

  const updates: Partial<typeof goalsTable.$inferInsert> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "completed") updates.completedAt = new Date();
  }
  if (parsed.data.completionPct !== undefined) updates.completionPct = parsed.data.completionPct;
  if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags;
  if ("dueAt" in parsed.data) updates.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;

  const [updated] = await db.update(goalsTable).set(updates).where(eq(goalsTable.id, id)).returning();

  const eventType = parsed.data.status === "completed" ? "goal.complete" : "goal.update";
  bus.emit({ source: "goal-manager", target: null, type: "memory.stored", payload: { event: eventType, goalId: id, changes: Object.keys(updates) } });

  res.json(formatGoal(updated));
});

router.delete("/goals/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(goalPlansTable).where(eq(goalPlansTable.goalId, id));
  await db.delete(goalsTable).where(eq(goalsTable.id, id));
  bus.emit({ source: "goal-manager", target: null, type: "memory.deleted", payload: { event: "goal.delete", goalId: id } });
  res.status(204).send();
});

router.post("/goals/:id/plan", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db.select().from(goalsTable).where(eq(goalsTable.id, id));
  if (rows.length === 0) { res.status(404).json({ error: "Goal not found" }); return; }

  const goal = rows[0];
  const parsed = CreatePlanBody.safeParse(req.body);

  let steps: unknown[];
  let confidence: number;
  let riskAssessment: string;

  if (parsed.success && parsed.data.steps.length > 0) {
    steps = parsed.data.steps;
    confidence = parsed.data.confidence ?? 0.7;
    riskAssessment = parsed.data.riskAssessment ?? "Low risk — user-defined plan";
  } else {
    steps = generatePlanSteps(goal.title, goal.description);
    confidence = estimateConfidence(goal);
    riskAssessment = generateRiskAssessment(goal);
  }

  const [plan] = await db.insert(goalPlansTable).values({
    goalId: id,
    steps,
    confidence,
    riskAssessment,
    status: "active",
  }).returning();

  bus.emit({ source: "planning-engine", target: null, type: "memory.stored", payload: { event: "plan.generated", goalId: id, planId: plan.id, steps: (steps as unknown[]).length, confidence } });

  res.status(201).json(formatPlan(plan));
});

router.patch("/goals/:goalId/plan/:planId/step/:stepNum", async (req, res) => {
  const goalId = parseInt(req.params.goalId);
  const planId = parseInt(req.params.planId);
  const stepNum = parseInt(req.params.stepNum);

  const StepUpdateBody = z.object({ status: z.enum(["pending", "in_progress", "done", "skipped"]), notes: z.string().optional() });
  const parsed = StepUpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const plans = await db.select().from(goalPlansTable).where(eq(goalPlansTable.id, planId));
  if (plans.length === 0) { res.status(404).json({ error: "Plan not found" }); return; }

  const plan = plans[0];
  const steps = (plan.steps as Array<Record<string, unknown>>).map((s) =>
    s.step === stepNum ? { ...s, status: parsed.data.status, notes: parsed.data.notes ?? s.notes } : s
  );

  const doneCount = steps.filter((s) => s.status === "done").length;
  const completionPct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;
  const allDone = completionPct === 100;

  const [updated] = await db.update(goalPlansTable).set({ steps, status: allDone ? "completed" : "active" }).where(eq(goalPlansTable.id, planId)).returning();

  if (allDone) {
    await db.update(goalsTable).set({ completionPct: 100, status: "completed", completedAt: new Date() }).where(eq(goalsTable.id, goalId));
  } else {
    await db.update(goalsTable).set({ completionPct }).where(eq(goalsTable.id, goalId));
  }

  bus.emit({ source: "planning-engine", target: null, type: "memory.stored", payload: { event: "plan.step_updated", goalId, planId, stepNum, status: parsed.data.status, completionPct } });

  res.json(formatPlan(updated));
});

function generatePlanSteps(title: string, description?: string | null): Array<Record<string, unknown>> {
  const base = [
    { step: 1, action: `Define scope and success criteria for "${title}"`, dependencies: [], status: "pending" },
    { step: 2, action: "Break into concrete sub-tasks with estimated effort", dependencies: [1], status: "pending" },
    { step: 3, action: "Execute first milestone — validate direction", dependencies: [2], status: "pending" },
    { step: 4, action: "Review progress and adjust plan if needed", dependencies: [3], status: "pending" },
    { step: 5, action: "Complete remaining tasks and verify all success criteria", dependencies: [4], status: "pending" },
  ];
  if (description) {
    base.push({ step: 6, action: `Document outcome: ${description.substring(0, 80)}`, dependencies: [5], status: "pending" });
  }
  return base;
}

function estimateConfidence(goal: typeof goalsTable.$inferSelect): number {
  let score = 0.5;
  if (goal.description) score += 0.1;
  if (goal.dueAt) score += 0.1;
  if (goal.tags.length > 0) score += 0.05;
  if (goal.priority >= 70) score += 0.1;
  if (goal.parentGoalId) score += 0.05;
  return Math.min(0.95, score);
}

function generateRiskAssessment(goal: typeof goalsTable.$inferSelect): string {
  const risks: string[] = [];
  if (!goal.description) risks.push("no description provided");
  if (!goal.dueAt) risks.push("no deadline set");
  if (goal.priority < 30) risks.push("low priority may cause deprioritization");
  if (risks.length === 0) return "Low risk — goal is well-defined with deadline and context.";
  return `Moderate risk — ${risks.join("; ")}.`;
}

export default router;

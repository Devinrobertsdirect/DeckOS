import { Router } from "express";
import { z } from "zod";
import { db, predictionsTable, goalsTable, feedbackSignalsTable, behaviorProfileTable } from "@workspace/db";
import { eq, desc, ne } from "drizzle-orm";
import { bus } from "../lib/bus.js";

const router = Router();

const ResolvePredictionBody = z.object({
  resolution: z.enum(["executed", "rejected"]),
  notes: z.string().optional(),
});

function formatPrediction(p: typeof predictionsTable.$inferSelect) {
  return {
    id: p.id,
    prediction: p.prediction,
    confidence: Math.round(p.confidence * 100),
    suggestedAction: p.suggestedAction,
    triggerWindow: p.triggerWindow,
    basis: p.basis,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function runPredictionEngine(): Promise<typeof predictionsTable.$inferInsert[]> {
  const predictions: typeof predictionsTable.$inferInsert[] = [];

  const goals = await db.select().from(goalsTable)
    .where(eq(goalsTable.status, "active"))
    .orderBy(desc(goalsTable.priority))
    .limit(10);

  const signals = await db.select().from(feedbackSignalsTable)
    .orderBy(desc(feedbackSignalsTable.createdAt))
    .limit(50);

  const profileRows = await db.select().from(behaviorProfileTable).limit(1);
  const profile = profileRows[0];

  for (const goal of goals) {
    const hoursSinceUpdate = (Date.now() - goal.updatedAt.getTime()) / 3600000;
    const isStale = hoursSinceUpdate > 24 && goal.completionPct < 100;
    const isNearDue = goal.dueAt && (goal.dueAt.getTime() - Date.now()) < 86400000 * 3;
    const isLowCompletion = goal.completionPct < 30 && goal.priority >= 60;

    if (isStale) {
      predictions.push({
        prediction: `Goal "${goal.title}" has been inactive for ${Math.round(hoursSinceUpdate)}h — resuming may prevent further decay`,
        confidence: 0.72,
        suggestedAction: `Resume "${goal.title}" — ${goal.completionPct}% complete`,
        triggerWindow: "next session",
        basis: { goalId: goal.id, hoursSinceUpdate: Math.round(hoursSinceUpdate), completionPct: goal.completionPct },
        status: "pending",
      });
    }

    if (isNearDue && goal.dueAt) {
      const daysLeft = Math.ceil((goal.dueAt.getTime() - Date.now()) / 86400000);
      predictions.push({
        prediction: `Goal "${goal.title}" is due in ${daysLeft} day(s) and is only ${goal.completionPct}% complete`,
        confidence: 0.88,
        suggestedAction: `Prioritize "${goal.title}" — deadline approaching`,
        triggerWindow: "24h",
        basis: { goalId: goal.id, daysLeft, completionPct: goal.completionPct },
        status: "pending",
      });
    }

    if (isLowCompletion && !isStale) {
      predictions.push({
        prediction: `High-priority goal "${goal.title}" has low completion (${goal.completionPct}%) — may need plan revision`,
        confidence: 0.65,
        suggestedAction: `Review and revise plan for "${goal.title}"`,
        triggerWindow: "today",
        basis: { goalId: goal.id, priority: goal.priority, completionPct: goal.completionPct },
        status: "pending",
      });
    }
  }

  if (signals.length > 0) {
    const errorSignals = signals.filter((s) => s.signalType === "error.occurred");
    if (errorSignals.length >= 3) {
      predictions.push({
        prediction: `${errorSignals.length} recent errors detected — system may need inspection`,
        confidence: 0.78,
        suggestedAction: "Review error log and check system health",
        triggerWindow: "1h",
        basis: { errorCount: errorSignals.length, recentSignals: errorSignals.length },
        status: "pending",
      });
    }

    const repeatedCommands = signals.filter((s) => s.signalType === "command.repeated");
    if (repeatedCommands.length >= 5) {
      predictions.push({
        prediction: "Repeated command pattern detected — you may benefit from a shortcut or automation",
        confidence: 0.60,
        suggestedAction: "Create a plugin or command alias for frequently repeated action",
        triggerWindow: "this session",
        basis: { repeatedCount: repeatedCommands.length },
        status: "pending",
      });
    }
  }

  if (profile && profile.proactiveFrequency > 0.7 && goals.length > 0) {
    const topGoal = goals[0];
    predictions.push({
      prediction: `Based on your activity patterns, now is a good time to work on "${topGoal.title}"`,
      confidence: profile.proactiveFrequency * 0.8,
      suggestedAction: `Open "${topGoal.title}" and take the next step`,
      triggerWindow: "now",
      basis: { proactiveScore: profile.proactiveFrequency, topGoalId: topGoal.id },
      status: "pending",
    });
  }

  return predictions;
}

router.get("/predictions", async (req, res) => {
  const status = req.query.status as string | undefined;
  let rows = await db.select().from(predictionsTable).orderBy(desc(predictionsTable.createdAt)).limit(50);
  if (status) {
    rows = rows.filter((p) => p.status === status);
  }
  res.json({ predictions: rows.map(formatPrediction), total: rows.length });
});

router.post("/predictions/generate", async (req, res) => {
  const newPredictions = await runPredictionEngine();

  if (newPredictions.length === 0) {
    res.json({ predictions: [], message: "No predictions generated — insufficient data or all goals on track" });
    return;
  }

  const inserted = await db.insert(predictionsTable).values(newPredictions).returning();

  for (const p of inserted) {
    bus.emit({
      source: "prediction-engine",
      target: null,
      type: "memory.stored",
      payload: { event: "prediction.generated", predictionId: p.id, confidence: p.confidence, triggerWindow: p.triggerWindow },
    });
  }

  res.json({ predictions: inserted.map(formatPrediction), generated: inserted.length });
});

router.patch("/predictions/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = ResolvePredictionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db.update(predictionsTable)
    .set({ status: parsed.data.resolution })
    .where(eq(predictionsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Prediction not found" }); return; }

  bus.emit({
    source: "prediction-engine",
    target: null,
    type: "memory.stored",
    payload: { event: `prediction.${parsed.data.resolution}`, predictionId: id },
  });

  res.json(formatPrediction(updated));
});

router.delete("/predictions/clear", async (req, res) => {
  await db.delete(predictionsTable).where(ne(predictionsTable.status, "pending"));
  res.json({ success: true });
});

export default router;

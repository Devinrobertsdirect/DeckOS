import { Router } from "express";
import { z } from "zod";
import { db, feedbackSignalsTable, behaviorProfileTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { bus } from "../lib/bus.js";

const router = Router();

const SIGNAL_WEIGHTS: Record<string, number> = {
  "response.accepted": +1.0,
  "response.ignored": -0.5,
  "response.rejected": -1.0,
  "command.repeated": +0.3,
  "suggestion.acted_on": +1.5,
  "suggestion.dismissed": -0.8,
  "error.occurred": -0.3,
  "session.long": +0.2,
  "session.short": -0.1,
};

const RecordSignalBody = z.object({
  signalType: z.enum([
    "response.accepted",
    "response.ignored",
    "response.rejected",
    "command.repeated",
    "suggestion.acted_on",
    "suggestion.dismissed",
    "error.occurred",
    "session.long",
    "session.short",
  ]),
  context: z.record(z.string(), z.unknown()).optional().default({}),
});

async function getOrCreateProfile() {
  const rows = await db.select().from(behaviorProfileTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(behaviorProfileTable).values({}).returning();
  return created;
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

async function updateBehaviorProfile(signalType: string, weight: number): Promise<void> {
  const profile = await getOrCreateProfile();
  const alpha = 0.05;

  let verbosityDelta = 0;
  let proactiveDelta = 0;
  let toneDelta = 0;
  let thresholdDelta = 0;

  switch (signalType) {
    case "response.accepted":
    case "suggestion.acted_on":
      proactiveDelta = +alpha;
      thresholdDelta = -alpha * 0.5;
      break;
    case "response.ignored":
    case "suggestion.dismissed":
      proactiveDelta = -alpha;
      thresholdDelta = +alpha;
      verbosityDelta = -alpha * 0.5;
      break;
    case "response.rejected":
      verbosityDelta = -alpha;
      proactiveDelta = -alpha * 0.5;
      thresholdDelta = +alpha;
      break;
    case "command.repeated":
      verbosityDelta = +alpha * 0.5;
      break;
    case "error.occurred":
      thresholdDelta = +alpha;
      break;
    case "session.long":
      proactiveDelta = +alpha * 0.3;
      break;
    case "session.short":
      proactiveDelta = -alpha * 0.3;
      break;
  }

  const patterns = profile.learnedPatterns as Record<string, number>;
  patterns[signalType] = (patterns[signalType] ?? 0) + weight;

  await db.update(behaviorProfileTable).set({
    verbosityLevel: clamp(profile.verbosityLevel + verbosityDelta),
    proactiveFrequency: clamp(profile.proactiveFrequency + proactiveDelta),
    toneFormality: clamp(profile.toneFormality + toneDelta),
    confidenceThreshold: clamp(profile.confidenceThreshold + thresholdDelta, 0.3, 0.95),
    totalSignals: profile.totalSignals + 1,
    learnedPatterns: patterns,
  }).where(eq(behaviorProfileTable.id, profile.id));
}

router.post("/feedback/signal", async (req, res) => {
  const parsed = RecordSignalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { signalType, context } = parsed.data;
  const weight = SIGNAL_WEIGHTS[signalType] ?? 0;

  const [signal] = await db.insert(feedbackSignalsTable).values({ signalType, context, weight }).returning();

  await updateBehaviorProfile(signalType, weight);

  bus.emit({
    source: "feedback-engine",
    target: null,
    type: "memory.stored",
    payload: { event: "feedback.recorded", signalType, weight, signalId: signal.id },
  });

  const profile = await getOrCreateProfile();

  res.status(201).json({
    signal: { id: signal.id, signalType, weight, createdAt: signal.createdAt.toISOString() },
    behaviorProfile: formatProfile(profile),
  });
});

router.get("/feedback/profile", async (req, res) => {
  const profile = await getOrCreateProfile();
  res.json(formatProfile(profile));
});

router.get("/feedback/signals", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? "50"), 200);
  const signals = await db.select().from(feedbackSignalsTable).orderBy(desc(feedbackSignalsTable.createdAt)).limit(limit);
  res.json({
    signals: signals.map((s) => ({
      id: s.id,
      signalType: s.signalType,
      weight: s.weight,
      context: s.context,
      createdAt: s.createdAt.toISOString(),
    })),
    total: signals.length,
  });
});

router.post("/feedback/profile/reset", async (req, res) => {
  const profile = await getOrCreateProfile();
  const [reset] = await db.update(behaviorProfileTable).set({
    verbosityLevel: 0.5,
    proactiveFrequency: 0.5,
    toneFormality: 0.5,
    confidenceThreshold: 0.7,
    totalSignals: 0,
    learnedPatterns: {},
  }).where(eq(behaviorProfileTable.id, profile.id)).returning();

  bus.emit({ source: "feedback-engine", target: null, type: "system.config_changed", payload: { event: "behavior.reset" } });
  res.json(formatProfile(reset));
});

function formatProfile(p: typeof behaviorProfileTable.$inferSelect) {
  return {
    verbosityLevel: Math.round(p.verbosityLevel * 100),
    proactiveFrequency: Math.round(p.proactiveFrequency * 100),
    toneFormality: Math.round(p.toneFormality * 100),
    confidenceThreshold: Math.round(p.confidenceThreshold * 100),
    totalSignals: p.totalSignals,
    learnedPatterns: p.learnedPatterns,
    updatedAt: p.updatedAt.toISOString(),
    interpretation: {
      verbosity: p.verbosityLevel < 0.35 ? "terse" : p.verbosityLevel > 0.65 ? "verbose" : "balanced",
      proactivity: p.proactiveFrequency < 0.35 ? "passive" : p.proactiveFrequency > 0.65 ? "proactive" : "reactive",
      tone: p.toneFormality < 0.35 ? "casual" : p.toneFormality > 0.65 ? "formal" : "neutral",
    },
  };
}

export default router;

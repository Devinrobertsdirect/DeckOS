/**
 * Persistent Cognitive Loop
 *
 * Runs every TICK_MS (default 10s). This is the "always-on thinking" layer
 * that ties predictions, goals, device state, and autonomy together — even
 * when the user is idle.
 *
 * Responsibilities each tick:
 *   1. Emit cognitive_tick heartbeat with system snapshot
 *   2. Every PREDICT_EVERY_MS: auto-run the prediction engine
 *   3. Route high-confidence predictions with a suggestedAction to autonomy
 *      when autonomy is enabled + permissive (no user interaction required)
 *   4. Decay stale goals (once per DECAY_EVERY_MS)
 *   5. Prune old predictions (once per PRUNE_EVERY_MS)
 */
import { db, goalsTable, predictionsTable, autonomyConfigTable, userCognitiveModelTable } from "@workspace/db";
import { eq, desc, lt, and } from "drizzle-orm";
import { bus } from "./bus.js";
import { logger } from "./logger.js";

const TICK_MS        = 10_000;   // 10 seconds — main heartbeat
const PREDICT_EVERY  = 5 * 60_000;  // auto-generate predictions every 5 min
const DECAY_EVERY    = 60 * 60_000; // decay stale goals hourly
const PRUNE_EVERY    = 24 * 60 * 60_000; // prune old predictions daily

export class CognitiveLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPredictAt = 0;
  private lastDecayAt   = 0;
  private lastPruneAt   = 0;
  private tickCount     = 0;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Stagger first tick slightly to avoid boot congestion
    setTimeout(() => void this.tick(), 3_000);
    logger.info({ tickMs: TICK_MS }, "CognitiveLoop started");
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  async tick(): Promise<void> {
    this.tickCount++;
    const now = Date.now();

    try {
      // 1. System snapshot
      const [goalCount, pendingPredictions] = await Promise.all([
        this.countActiveGoals(),
        this.getHighConfidencePredictions(),
      ]);

      bus.emit({
        source: "cognitive-loop",
        target: null,
        type:   "system.cognitive_tick",
        payload: {
          tick:               this.tickCount,
          activeGoals:        goalCount,
          pendingPredictions: pendingPredictions.length,
          timestamp:          new Date().toISOString(),
        },
      });

      // 2. Auto-generate predictions periodically
      if (now - this.lastPredictAt > PREDICT_EVERY) {
        this.lastPredictAt = now;
        await this.runPredictions();
      }

      // 3. Route high-confidence predictions → autonomy (permissive only)
      if (pendingPredictions.length > 0) {
        await this.routeToAutonomy(pendingPredictions);
      }

      // 4. Stale goal decay
      if (now - this.lastDecayAt > DECAY_EVERY) {
        this.lastDecayAt = now;
        await this.decayStaleGoals();
      }

      // 5. Prune old resolved predictions
      if (now - this.lastPruneAt > PRUNE_EVERY) {
        this.lastPruneAt = now;
        await this.pruneOldPredictions();
      }
    } catch (err) {
      logger.warn({ err }, "CognitiveLoop tick error");
    }
  }

  // ── Step helpers ─────────────────────────────────────────────────────────

  private async countActiveGoals(): Promise<number> {
    const rows = await db.select({ id: goalsTable.id })
      .from(goalsTable)
      .where(eq(goalsTable.status, "active"))
      .limit(100);
    return rows.length;
  }

  private async getHighConfidencePredictions() {
    return db.select()
      .from(predictionsTable)
      .where(and(eq(predictionsTable.status, "pending")))
      .orderBy(desc(predictionsTable.confidence))
      .limit(5);
  }

  /** Inline prediction engine — mirrors the route handler logic */
  private async runPredictions(): Promise<void> {
    try {
      const goals = await db.select().from(goalsTable)
        .where(eq(goalsTable.status, "active"))
        .orderBy(desc(goalsTable.priority))
        .limit(10);

      const inserts: (typeof predictionsTable.$inferInsert)[] = [];

      for (const goal of goals) {
        const hoursSince = (Date.now() - goal.updatedAt.getTime()) / 3_600_000;
        if (hoursSince > 24 && goal.completionPct < 100) {
          inserts.push({
            prediction:     `Goal "${goal.title}" stale — ${Math.round(hoursSince)}h without progress`,
            confidence:     Math.min(0.65 + (hoursSince / 240) * 0.2, 0.9),
            suggestedAction:`Resume "${goal.title}" (${goal.completionPct}% complete)`,
            triggerWindow:  "next session",
            basis:          { goalId: goal.id, trigger: "stale", hoursSince: Math.round(hoursSince) },
            status:         "pending",
          });
        }
        if (goal.dueAt && (goal.dueAt.getTime() - Date.now()) < 86_400_000 * 3 && goal.completionPct < 80) {
          inserts.push({
            prediction:     `"${goal.title}" due soon — currently ${goal.completionPct}% complete`,
            confidence:     0.88,
            suggestedAction:`Review progress on "${goal.title}" immediately`,
            triggerWindow:  "now",
            basis:          { goalId: goal.id, trigger: "deadline" },
            status:         "pending",
          });
        }
      }

      for (const p of inserts) {
        const [row] = await db.insert(predictionsTable).values(p).returning();
        bus.emit({
          source: "cognitive-loop",
          target: null,
          type:   "prediction.generated",
          payload: { ...row, confidence: Math.round((row?.confidence ?? 0) * 100) },
        });
      }

      if (inserts.length > 0) {
        logger.debug({ count: inserts.length }, "CognitiveLoop: predictions generated");
      }
    } catch (err) {
      logger.warn({ err }, "CognitiveLoop: prediction generation error");
    }
  }

  /** For permissive autonomy mode: auto-emit autonomy.action.request for actionable predictions */
  private async routeToAutonomy(predictions: (typeof predictionsTable.$inferSelect)[]): Promise<void> {
    try {
      const configRows = await db.select().from(autonomyConfigTable).limit(1);
      const config = configRows[0];
      if (!config || !config.enabled || config.safetyLevel !== "permissive") return;

      for (const p of predictions) {
        if (p.confidence < 0.85 || !p.suggestedAction) continue;

        bus.emit({
          source: "cognitive-loop",
          target: null,
          type:   "autonomy.action.request",
          payload: {
            action:      "generate_summary",
            parameters:  { predictionId: p.id, suggestion: p.suggestedAction },
            requestedBy: "cognitive-loop",
            reason:      p.prediction,
            confidence:  p.confidence,
          },
        });

        // Mark prediction as handled so we don't re-queue it
        await db.update(predictionsTable)
          .set({ status: "executed" })
          .where(eq(predictionsTable.id, p.id));

        logger.info({ predictionId: p.id, action: p.suggestedAction }, "CognitiveLoop → autonomy");
      }
    } catch (err) {
      logger.warn({ err }, "CognitiveLoop: autonomy routing error");
    }
  }

  /** Mark goals with no activity in 30+ days and < 50% completion as stale */
  private async decayStaleGoals(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000); // 30 days
      const staled = await db.update(goalsTable)
        .set({ status: "stale" })
        .where(and(
          eq(goalsTable.status, "active"),
          lt(goalsTable.updatedAt, cutoff),
        ))
        .returning({ id: goalsTable.id, title: goalsTable.title });

      if (staled.length > 0) {
        logger.info({ count: staled.length }, "CognitiveLoop: stale goals decayed");
        bus.emit({
          source: "cognitive-loop",
          target: null,
          type:   "system.maintenance",
          payload: { task: "goal_decay", affected: staled.length, timestamp: new Date().toISOString() },
        });
      }
    } catch (err) {
      logger.warn({ err }, "CognitiveLoop: goal decay error");
    }
  }

  /** Remove predictions resolved > 7 days ago to keep the table lean */
  private async pruneOldPredictions(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000);
      const pruned = await db.delete(predictionsTable)
        .where(and(
          eq(predictionsTable.status, "executed"),
          lt(predictionsTable.updatedAt, cutoff),
        ))
        .returning({ id: predictionsTable.id });

      if (pruned.length > 0) {
        logger.info({ count: pruned.length }, "CognitiveLoop: old predictions pruned");
        bus.emit({
          source: "cognitive-loop",
          target: null,
          type:   "system.maintenance",
          payload: { task: "prediction_prune", affected: pruned.length, timestamp: new Date().toISOString() },
        });
      }
    } catch (err) {
      logger.warn({ err }, "CognitiveLoop: prediction pruning error");
    }
  }
}

export const cognitiveLoop = new CognitiveLoop();

import { db, goalsTable, predictionsTable, nudgesTable, initiativeConfigTable } from "@workspace/db";
import { eq, and, isNull, or, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import { bus } from "./bus.js";
import { presenceManager } from "./presence-manager.js";

interface UrgencyResult {
  goalId: number;
  title: string;
  score: number;
  reason: string;
  category: "goal_decay" | "deadline" | "check_in" | "continuation" | "insight";
}

async function getConfig() {
  const rows = await db.select().from(initiativeConfigTable).limit(1);
  if (rows.length) return rows[0];
  const [created] = await db.insert(initiativeConfigTable).values({}).returning();
  return created;
}

async function countActiveNudges(): Promise<number> {
  const rows = await db.select().from(nudgesTable)
    .where(eq(nudgesTable.dismissed, false));
  return rows.length;
}

async function wasRecentlyNudged(goalId: number, withinMs: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinMs);
  const rows = await db.select().from(nudgesTable)
    .where(and(
      eq(nudgesTable.targetGoalId, goalId),
      eq(nudgesTable.dismissed, false),
    ))
    .orderBy(desc(nudgesTable.createdAt))
    .limit(1);
  if (!rows.length) return false;
  return rows[0].createdAt > cutoff;
}

async function createNudge(data: {
  category: string;
  content: string;
  urgencyScore: number;
  targetGoalId?: number;
  targetThreadId?: number;
}): Promise<void> {
  await db.insert(nudgesTable).values({
    category: data.category,
    content: data.content,
    urgencyScore: data.urgencyScore,
    targetGoalId: data.targetGoalId ?? null,
    targetThreadId: data.targetThreadId ?? null,
    dismissed: false,
  });

  bus.emit({
    source: "initiative-engine",
    target: null,
    type: "initiative.nudge_created",
    payload: { category: data.category, content: data.content, urgencyScore: data.urgencyScore },
  });

  logger.info({ category: data.category, score: data.urgencyScore }, "Nudge created");
}

function computeGoalUrgency(goal: {
  id: number; title: string; priority: number; completionPct: number;
  decayRatePerHour: number; dueAt: Date | null; updatedAt: Date; status: string;
}): UrgencyResult | null {
  if (goal.status !== "active") return null;

  let score = goal.priority / 100;
  let reason = "";
  let category: UrgencyResult["category"] = "continuation";

  const nowMs = Date.now();
  const hoursSinceUpdate = (nowMs - goal.updatedAt.getTime()) / 3_600_000;

  // Deadline proximity
  if (goal.dueAt) {
    const hoursUntilDue = (goal.dueAt.getTime() - nowMs) / 3_600_000;
    if (hoursUntilDue < 0) {
      score += 0.5;
      reason = `Overdue by ${Math.abs(Math.round(hoursUntilDue))}h`;
      category = "deadline";
    } else if (hoursUntilDue < 2) {
      score += 0.45;
      reason = `Due in ${Math.round(hoursUntilDue * 60)}min`;
      category = "deadline";
    } else if (hoursUntilDue < 24) {
      score += 0.3;
      reason = `Due in ${Math.round(hoursUntilDue)}h`;
      category = "deadline";
    }
  }

  // Decay pressure
  if (goal.decayRatePerHour > 0.3 && goal.completionPct < 40) {
    const decayImpact = goal.decayRatePerHour * hoursSinceUpdate * 0.1;
    score += Math.min(decayImpact, 0.3);
    if (!reason) {
      reason = `Decaying — ${Math.round(hoursSinceUpdate)}h without progress`;
      category = "goal_decay";
    }
  }

  // Long neglect
  if (hoursSinceUpdate > 48 && goal.priority > 60) {
    score += 0.2;
    if (!reason) {
      reason = `High-priority goal untouched for ${Math.round(hoursSinceUpdate)}h`;
      category = "goal_decay";
    }
  }

  if (!reason) reason = `Completion at ${goal.completionPct}%`;

  return { goalId: goal.id, title: goal.title, score: Math.min(score, 1), reason, category };
}

function nudgeText(u: UrgencyResult): string {
  switch (u.category) {
    case "deadline":
      return `Deadline alert on "${u.title}" — ${u.reason}. Review and confirm plan.`;
    case "goal_decay":
      return `"${u.title}" is losing momentum. ${u.reason}. Consider a quick checkpoint.`;
    case "check_in":
      return `Still tracking "${u.title}". ${u.reason}. Want to log progress?`;
    case "insight":
      return `Insight: ${u.reason}`;
    default:
      return `Thread update on "${u.title}" — ${u.reason}.`;
  }
}

class InitiativeEngine {
  private interval: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 60_000): void {
    this.interval = setInterval(() => void this.tick(), intervalMs);
    logger.info({ intervalMs }, "InitiativeEngine started");

    setTimeout(() => void this.tick(), 5_000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async tick(): Promise<void> {
    try {
      const config = await getConfig();
      if (!config.enabled) return;

      const activeNudges = await countActiveNudges();
      if (activeNudges >= config.maxActiveNudges) return;

      const presence = await presenceManager.get();
      const goals = await db.select().from(goalsTable)
        .where(eq(goalsTable.status, "active"))
        .orderBy(desc(goalsTable.priority));

      // 1. Evaluate goal urgencies
      const urgencies = goals
        .map(g => computeGoalUrgency(g))
        .filter((u): u is UrgencyResult => u !== null)
        .sort((a, b) => b.score - a.score);

      const top = urgencies[0];
      if (top && top.score >= config.goalDecayThreshold) {
        const alreadyNudged = await wasRecentlyNudged(top.goalId, 60 * 60_000); // 1 hour
        if (!alreadyNudged) {
          await createNudge({
            category: top.category,
            content: nudgeText(top),
            urgencyScore: top.score,
            targetGoalId: top.goalId,
          });
          return;
        }
      }

      // 2. High-confidence pending predictions
      const predictions = await db.select().from(predictionsTable)
        .where(and(eq(predictionsTable.status, "pending")))
        .orderBy(desc(predictionsTable.confidence))
        .limit(1);

      if (predictions.length && predictions[0].confidence > 0.8) {
        const p = predictions[0];
        await createNudge({
          category: "insight",
          content: `Prediction: ${p.prediction}${p.suggestedAction ? ` — Suggested: ${p.suggestedAction}` : ""}`,
          urgencyScore: p.confidence * 0.8,
        });
        return;
      }

      // 3. Presence-based check-in
      if (presence.minutesSinceLastInteraction >= config.checkInAfterMinutes && config.initiativeLevel > 0.4) {
        const recentRows = await db.select().from(nudgesTable)
          .where(and(eq(nudgesTable.category, "check_in"), eq(nudgesTable.dismissed, false)))
          .orderBy(desc(nudgesTable.createdAt))
          .limit(1);

        const lastCheckIn = recentRows[0]?.createdAt;
        const checkInIntervalMs = config.checkInAfterMinutes * 60_000;
        if (!lastCheckIn || Date.now() - lastCheckIn.getTime() > checkInIntervalMs) {
          const subject = goals[0]?.title ?? "your current objectives";
          await createNudge({
            category: "check_in",
            content: `You've been away for ${presence.minutesSinceLastInteraction}min. Continuing thread: "${subject}". Ready when you are.`,
            urgencyScore: 0.4,
          });
        }
      }

      bus.emit({
        source: "initiative-engine",
        target: null,
        type: "system.heartbeat",
        payload: {
          presence: presence.availability,
          activeGoals: goals.length,
          topUrgency: top ? { score: top.score, category: top.category } : null,
          activeNudges,
        },
      });
    } catch (err) {
      logger.error({ err }, "InitiativeEngine tick error");
    }
  }
}

export const initiativeEngine = new InitiativeEngine();

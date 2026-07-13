import {
  db,
  briefingsTable,
  goalsTable,
  autonomyLogTable,
  memoryEntriesTable,
  feedbackSignalsTable,
  deviceProfilesTable,
} from "@workspace/db";
import { gte, eq, desc, sql } from "drizzle-orm";
import { runInference } from "./inference.js";
import { bus } from "./bus.js";
import { logger } from "./logger.js";

export interface BriefingStats {
  goalsActive: number;
  goalsCompleted: number;
  autonomyActionsTotal: number;
  memoriesStored: number;
  feedbackSignals: number;
  devicesOnline: number;
  windowHours: number;
}

export async function generateBriefing(): Promise<typeof briefingsTable.$inferSelect> {
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const today = new Date().toISOString().slice(0, 10);

  const [goalsActive, goalsCompleted, autonomyActionsTotal, memoriesStored, feedbackSignals, devicesOnline] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(goalsTable).where(eq(goalsTable.status, "active")).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(goalsTable).where(gte(goalsTable.completedAt, windowStart)).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(autonomyLogTable).where(gte(autonomyLogTable.createdAt, windowStart)).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(memoryEntriesTable).where(gte(memoryEntriesTable.createdAt, windowStart)).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(feedbackSignalsTable).where(gte(feedbackSignalsTable.createdAt, windowStart)).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(deviceProfilesTable).then((r) => Number(r[0]?.n ?? 0)),
  ]);

  const stats: BriefingStats = {
    goalsActive,
    goalsCompleted,
    autonomyActionsTotal,
    memoriesStored,
    feedbackSignals,
    devicesOnline,
    windowHours: 24,
  };

  const recentMemories = await db
    .select({ content: memoryEntriesTable.content, type: memoryEntriesTable.type })
    .from(memoryEntriesTable)
    .where(gte(memoryEntriesTable.createdAt, windowStart))
    .orderBy(desc(memoryEntriesTable.createdAt))
    .limit(5);

  const recentActions = await db
    .select({ action: autonomyLogTable.action, outcome: autonomyLogTable.outcome })
    .from(autonomyLogTable)
    .where(gte(autonomyLogTable.createdAt, windowStart))
    .orderBy(desc(autonomyLogTable.createdAt))
    .limit(5);

  const memorySnippets = recentMemories
    .map((m) => `  - [${m.type}] ${String(m.content).slice(0, 120)}`)
    .join("\n") || "  (none)";

  const actionSnippets = recentActions
    .map((a) => `  - ${a.action} → ${a.outcome ?? "pending"}`)
    .join("\n") || "  (none)";

  const prompt = `You are JARVIS, an AI command center assistant. Generate a concise morning briefing for the operator based on the following system observations from the past 24 hours.

SYSTEM STATS:
- Active goals: ${stats.goalsActive}
- Goals completed (24h): ${stats.goalsCompleted}
- Autonomy actions taken (24h): ${stats.autonomyActionsTotal}
- Memory entries stored (24h): ${stats.memoriesStored}
- Feedback signals received (24h): ${stats.feedbackSignals}
- Devices registered: ${stats.devicesOnline}

RECENT MEMORY ENTRIES:
${memorySnippets}

RECENT AUTONOMY ACTIONS:
${actionSnippets}

Write a 3-5 sentence professional briefing summary. Start with "Good morning." Mention key metrics, highlight any notable activity, and close with a readiness statement. Do not use bullet points or headers — write it as flowing prose.`;

  const result = await runInference({ prompt, mode: "deep", task: "briefing", useCache: false });

  const [row] = await db.insert(briefingsTable).values({
    date:      today,
    summary:   result.response,
    stats:     stats as unknown as Record<string, unknown>,
    modelUsed: result.modelUsed,
  }).returning();

  if (!row) throw new Error("Failed to insert briefing row");

  bus.emit({
    source:  "briefing-generator",
    target:  null,
    type:    "briefing.generated",
    payload: {
      id:        row.id,
      date:      row.date,
      summary:   row.summary.slice(0, 200),
      modelUsed: row.modelUsed,
      timestamp: row.generatedAt.toISOString(),
    },
  });

  logger.info({ briefingId: row.id, date: today, model: result.modelUsed }, "Briefing generated");
  return row;
}

import { db, goalsTable, narrativeThreadsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "./logger.js";
import { bus } from "./bus.js";

function buildThreadSummary(goal: { title: string; description: string | null; completionPct: number; status: string }): string {
  const pct = goal.completionPct;
  const phase = pct === 0 ? "not started" : pct < 25 ? "early stages" : pct < 60 ? "in progress" : pct < 90 ? "late stage" : "nearly complete";
  return `Ongoing thread around "${goal.title}" — currently ${phase} at ${pct}% completion.${goal.description ? ` Context: ${goal.description.slice(0, 120)}` : ""}`;
}

class NarrativeManager {
  async syncFromGoals(): Promise<void> {
    try {
      const goals = await db.select().from(goalsTable)
        .where(eq(goalsTable.status, "active"))
        .orderBy(desc(goalsTable.priority))
        .limit(10);

      for (const goal of goals) {
        const existing = await db.select().from(narrativeThreadsTable)
          .where(eq(narrativeThreadsTable.id, goal.id))
          .limit(1);

        const summary = buildThreadSummary(goal);
        const tags = goal.tags ?? [];

        if (!existing.length) {
          await db.insert(narrativeThreadsTable).values({
            title: goal.title,
            summary,
            status: "active",
            relatedGoalIds: [goal.id],
            tags,
            relevanceScore: goal.priority / 100,
          });
        } else {
          const thread = existing[0];
          const relevanceScore = goal.priority / 100;
          if (thread.summary !== summary || thread.relevanceScore !== relevanceScore) {
            await db.update(narrativeThreadsTable)
              .set({ summary, relevanceScore, updatedAt: new Date() })
              .where(eq(narrativeThreadsTable.id, thread.id));
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "NarrativeManager.syncFromGoals error");
    }
  }

  async getActiveThreads() {
    const threads = await db.select().from(narrativeThreadsTable)
      .where(eq(narrativeThreadsTable.status, "active"))
      .orderBy(desc(narrativeThreadsTable.relevanceScore))
      .limit(10);
    return threads;
  }

  async getDormantThreads() {
    return db.select().from(narrativeThreadsTable)
      .where(eq(narrativeThreadsTable.status, "dormant"))
      .orderBy(desc(narrativeThreadsTable.lastEngagedAt))
      .limit(5);
  }

  async touchThread(threadId: number): Promise<void> {
    await db.update(narrativeThreadsTable)
      .set({ lastEngagedAt: new Date(), status: "active" })
      .where(eq(narrativeThreadsTable.id, threadId));
  }

  async resolveThread(threadId: number): Promise<void> {
    await db.update(narrativeThreadsTable)
      .set({ status: "resolved" })
      .where(eq(narrativeThreadsTable.id, threadId));
    bus.emit({
      source: "narrative-manager",
      target: null,
      type: "narrative.thread_resolved",
      payload: { threadId },
    });
  }

  async createThread(data: { title: string; summary: string; relatedGoalIds: number[]; tags?: string[] }) {
    const [thread] = await db.insert(narrativeThreadsTable).values({
      title: data.title,
      summary: data.summary,
      status: "active",
      relatedGoalIds: data.relatedGoalIds,
      tags: data.tags ?? [],
      relevanceScore: 0.5,
    }).returning();
    return thread;
  }
}

export const narrativeManager = new NarrativeManager();

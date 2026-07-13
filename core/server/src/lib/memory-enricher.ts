/**
 * Memory Enricher — UCM Auto-Enrichment
 *
 * Runs every ENRICH_EVERY_MS (default 5 min). Analyzes recent memory entries
 * + feedback signals and infers UCM updates marked as `system_inferred`.
 *
 * Writes back to:
 *   - userCognitiveModelTable.preferences    (topic / keyword interests)
 *   - userCognitiveModelTable.behaviorPatterns (command patterns, error rates)
 */
import { db, memoryEntriesTable, feedbackSignalsTable, userCognitiveModelTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { bus } from "./bus.js";
import { logger } from "./logger.js";

const ENRICH_EVERY = 5 * 60_000; // 5 minutes

interface PreferencesLayer {
  topics?: Record<string, number>;
  keywords?: string[];
  inferredAt?: string;
}

interface BehaviorLayer {
  commandFrequency?: Record<string, number>;
  errorPatterns?: string[];
  feedbackSentiment?: { positive: number; negative: number; total: number };
  inferredAt?: string;
}

class MemoryEnricher {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = ENRICH_EVERY): void {
    if (this.timer) return;
    // Delayed first run — let the system stabilize after boot
    setTimeout(() => void this.enrich(), 30_000);
    this.timer = setInterval(() => void this.enrich(), intervalMs);
    logger.info({ intervalMs }, "MemoryEnricher started");
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async enrich(): Promise<void> {
    try {
      const [prefUpdate, behavUpdate] = await Promise.all([
        this.inferPreferences(),
        this.inferBehaviorPatterns(),
      ]);

      const model = await this.getOrCreateModel();

      const currentPrefs = (model.preferences ?? {}) as Record<string, unknown>;
      const currentBehav = (model.behaviorPatterns ?? {}) as Record<string, unknown>;

      const newPrefs: PreferencesLayer = {
        ...(currentPrefs as PreferencesLayer),
        ...prefUpdate,
        inferredAt: new Date().toISOString(),
      };

      const newBehav: BehaviorLayer = {
        ...(currentBehav as BehaviorLayer),
        ...behavUpdate,
        inferredAt: new Date().toISOString(),
      };

      await db.update(userCognitiveModelTable)
        .set({
          preferences:     newPrefs,
          behaviorPatterns: newBehav,
        })
        .where(eq(userCognitiveModelTable.id, model.id));

      bus.emit({
        source: "memory-enricher",
        target: null,
        type:   "memory.ucm_enriched",
        payload: {
          topicsFound: Object.keys(prefUpdate.topics ?? {}).length,
          commandsTracked: Object.keys(behavUpdate.commandFrequency ?? {}).length,
          timestamp: new Date().toISOString(),
        },
      });

      logger.debug({ topics: Object.keys(prefUpdate.topics ?? {}).length }, "MemoryEnricher: UCM updated");
    } catch (err) {
      logger.warn({ err }, "MemoryEnricher: enrichment error");
    }
  }

  // ── Inference helpers ─────────────────────────────────────────────────────

  private async inferPreferences(): Promise<PreferencesLayer> {
    const entries = await db.select({ keywords: memoryEntriesTable.keywords, content: memoryEntriesTable.content })
      .from(memoryEntriesTable)
      .orderBy(desc(memoryEntriesTable.createdAt))
      .limit(200);

    const topicCounts: Record<string, number> = {};
    const allKeywords: Set<string> = new Set();

    for (const e of entries) {
      const kws = (e.keywords ?? []) as string[];
      for (const kw of kws) {
        const k = kw.toLowerCase().trim();
        if (k.length < 2) continue;
        topicCounts[k] = (topicCounts[k] ?? 0) + 1;
        allKeywords.add(k);
      }
    }

    // Keep only the top 20 topics by frequency
    const sorted = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    return {
      topics:   Object.fromEntries(sorted),
      keywords: sorted.map(([k]) => k),
    };
  }

  private async inferBehaviorPatterns(): Promise<BehaviorLayer> {
    const signals = await db.select()
      .from(feedbackSignalsTable)
      .orderBy(desc(feedbackSignalsTable.createdAt))
      .limit(100);

    const commandFreq: Record<string, number> = {};
    const errorPatterns: string[] = [];
    let positive = 0, negative = 0;

    for (const s of signals) {
      const sig = s as Record<string, unknown>;
      const signal = (sig["signal"] as string | undefined)?.toLowerCase() ?? "";
      const type   = (sig["type"]   as string | undefined)?.toLowerCase() ?? "";

      // Count command types
      if (type) {
        commandFreq[type] = (commandFreq[type] ?? 0) + 1;
      }

      // Sentiment
      if (signal === "positive" || signal === "thumbs_up") positive++;
      if (signal === "negative" || signal === "thumbs_down" || signal === "error") negative++;
      if (signal === "error" && type) {
        if (!errorPatterns.includes(type)) errorPatterns.push(type);
      }
    }

    return {
      commandFrequency: commandFreq,
      errorPatterns:    errorPatterns.slice(0, 10),
      feedbackSentiment: { positive, negative, total: signals.length },
    };
  }

  private async getOrCreateModel() {
    const rows = await db.select().from(userCognitiveModelTable).limit(1);
    if (rows.length) return rows[0]!;
    const [created] = await db.insert(userCognitiveModelTable).values({}).returning();
    return created!;
  }
}

export const memoryEnricher = new MemoryEnricher();

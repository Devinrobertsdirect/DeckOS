import { db, presenceStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { bus } from "./bus.js";

export type Availability = "active" | "idle" | "passive";
export type Channel = "web" | "mobile" | "whatsapp" | "voice" | "console";

const ACTIVE_THRESHOLD_MS  = 5  * 60 * 1000; // 5 min
const IDLE_THRESHOLD_MS    = 20 * 60 * 1000; // 20 min

class PresenceManager {
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  start(intervalMs = 30_000): void {
    this.tickInterval = setInterval(() => void this.tick(), intervalMs);
    logger.info("PresenceManager started");
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  async record(channel: Channel): Promise<void> {
    const rows = await db.select().from(presenceStateTable).limit(1);
    const now = new Date();
    if (rows.length === 0) {
      await db.insert(presenceStateTable).values({
        availability: "active",
        activeChannel: channel,
        preferredModality: channel === "voice" ? "voice" : "text",
        lastInteractionAt: now,
        sessionCount: 1,
      });
    } else {
      const prev = rows[0];
      await db.update(presenceStateTable)
        .set({
          availability: "active",
          activeChannel: channel,
          preferredModality: channel === "voice" ? "voice" : prev.preferredModality,
          lastInteractionAt: now,
          sessionCount: prev.sessionCount + 1,
        })
        .where(eq(presenceStateTable.id, prev.id));
    }
  }

  async get(): Promise<{ availability: Availability; activeChannel: string; lastInteractionAt: Date; minutesSinceLastInteraction: number }> {
    const rows = await db.select().from(presenceStateTable).limit(1);
    if (rows.length === 0) {
      return { availability: "passive", activeChannel: "web", lastInteractionAt: new Date(0), minutesSinceLastInteraction: 9999 };
    }
    const row = rows[0];
    const elapsed = Date.now() - row.lastInteractionAt.getTime();
    const minutesSince = Math.floor(elapsed / 60_000);
    const availability: Availability = elapsed < ACTIVE_THRESHOLD_MS ? "active"
      : elapsed < IDLE_THRESHOLD_MS ? "idle"
      : "passive";
    return { availability, activeChannel: row.activeChannel, lastInteractionAt: row.lastInteractionAt, minutesSinceLastInteraction: minutesSince };
  }

  private async tick(): Promise<void> {
    const rows = await db.select().from(presenceStateTable).limit(1);
    if (rows.length === 0) return;

    const row = rows[0];
    const elapsed = Date.now() - row.lastInteractionAt.getTime();
    const newAvailability: Availability = elapsed < ACTIVE_THRESHOLD_MS ? "active"
      : elapsed < IDLE_THRESHOLD_MS ? "idle"
      : "passive";

    if (newAvailability !== row.availability) {
      await db.update(presenceStateTable)
        .set({ availability: newAvailability })
        .where(eq(presenceStateTable.id, row.id));

      bus.emit({
        source: "presence-manager",
        target: null,
        type: "system.config_changed",
        payload: { config: "presence", availability: newAvailability, previousAvailability: row.availability },
      });

      logger.info({ from: row.availability, to: newAvailability }, "Presence state changed");
    }
  }
}

export const presenceManager = new PresenceManager();

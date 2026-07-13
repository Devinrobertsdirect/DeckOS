/**
 * Notification Service
 * Subscribes to relevant bus events and persists them as notifications in the DB.
 * Emits notification.created on the bus so the WS layer forwards them to frontends.
 */
import { db, notificationsTable } from "@workspace/db";
import { eq, desc, or, and, lt } from "drizzle-orm";
import { bus } from "./bus.js";
import { logger } from "./logger.js";
import type { BusEvent } from "@workspace/event-bus";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETENTION_DAYS    = 7;

type Severity = "info" | "warning" | "critical";

interface NotificationSpec {
  type: string;
  severity: Severity;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

class NotificationService {
  private subIds:     string[] = [];
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  private async sweep(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const deleted = await db
        .delete(notificationsTable)
        .where(and(eq(notificationsTable.read, true), lt(notificationsTable.createdAt, cutoff)))
        .returning({ id: notificationsTable.id });
      if (deleted.length > 0) {
        logger.info({ count: deleted.length, olderThan: cutoff.toISOString() }, "NotificationService: swept stale read notifications");
      }
    } catch (err) {
      logger.warn({ err }, "NotificationService: sweep failed");
    }
  }

  async createNotification(spec: NotificationSpec): Promise<void> {
    try {
      const [row] = await db.insert(notificationsTable).values({
        type:     spec.type,
        severity: spec.severity,
        title:    spec.title,
        message:  spec.message,
        metadata: spec.metadata ?? {},
      }).returning();

      bus.emit({
        source: "notification-service",
        target: null,
        type:   "notification.created",
        payload: {
          id:        row!.id,
          type:      row!.type,
          severity:  row!.severity,
          title:     row!.title,
          message:   row!.message,
          read:      row!.read,
          metadata:  row!.metadata,
          createdAt: row!.createdAt.toISOString(),
        },
      });
    } catch (err) {
      logger.warn({ err }, "NotificationService: failed to create notification");
    }
  }

  async markRead(id: number): Promise<boolean> {
    const result = await db.update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.id, id))
      .returning({ id: notificationsTable.id });
    return result.length > 0;
  }

  async markAllRead(): Promise<void> {
    await db.update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.read, false));
  }

  async clearAll(): Promise<void> {
    await db.delete(notificationsTable);
  }

  async list(limit = 50): Promise<typeof notificationsTable.$inferSelect[]> {
    return db.select().from(notificationsTable)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);
  }

  async unreadCount(): Promise<number> {
    const rows = await db.select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(eq(notificationsTable.read, false));
    return rows.length;
  }

  start(): void {
    // device.disconnected → warning
    this.subIds.push(bus.subscribe("device.disconnected", async (e: BusEvent) => {
      if (e.type !== "device.disconnected") return;
      const p = e.payload as Record<string, unknown>;
      const deviceId = String(p["deviceId"] ?? p["id"] ?? "unknown");
      await this.createNotification({
        type:     "device.disconnected",
        severity: "warning",
        title:    "Device Disconnected",
        message:  `Device "${deviceId}" has left the network.`,
        metadata: p,
      });
    }));

    // device.geofence.triggered → warning
    this.subIds.push(bus.subscribe("device.geofence.triggered", async (e: BusEvent) => {
      if (e.type !== "device.geofence.triggered") return;
      const p = e.payload as Record<string, unknown>;
      const deviceId = String(p["deviceId"] ?? "unknown");
      const zone     = String(p["zone"] ?? p["geofence"] ?? "unknown zone");
      await this.createNotification({
        type:     "device.geofence.triggered",
        severity: "warning",
        title:    "Geofence Alert",
        message:  `Device "${deviceId}" triggered geofence: ${zone}.`,
        metadata: p,
      });
    }));

    // autonomy.confirmation.required → critical
    this.subIds.push(bus.subscribe("autonomy.confirmation.required", async (e: BusEvent) => {
      if (e.type !== "autonomy.confirmation.required") return;
      const p = e.payload as Record<string, unknown>;
      const action = String(p["action"] ?? "unknown action");
      await this.createNotification({
        type:     "autonomy.confirmation.required",
        severity: "critical",
        title:    "Action Requires Confirmation",
        message:  `JARVIS needs your approval to: ${action}.`,
        metadata: p,
      });
    }));

    // goal.stale → info
    this.subIds.push(bus.subscribe("goal.stale", async (e: BusEvent) => {
      if (e.type !== "goal.stale") return;
      const p = e.payload as Record<string, unknown>;
      const title = String(p["title"] ?? p["goalTitle"] ?? "a goal");
      await this.createNotification({
        type:     "goal.stale",
        severity: "info",
        title:    "Goal Going Stale",
        message:  `"${title}" hasn't progressed recently and may need attention.`,
        metadata: p,
      });
    }));

    // memory.stored with notificationType="routine" → info
    // Emitted by the send_notification routine action; persisted here so the
    // notification inbox receives the user-defined title and message.
    this.subIds.push(bus.subscribe("memory.stored", async (e: BusEvent) => {
      if (e.type !== "memory.stored") return;
      const p = e.payload as Record<string, unknown>;
      if (String(p["notificationType"] ?? "") !== "routine") return;
      const title   = String(p["title"]   ?? "JARVIS Notification");
      const message = String(p["message"] ?? "Routine notification fired.");
      await this.createNotification({
        type:     "routine.notification",
        severity: "info",
        title,
        message,
        metadata: p,
      });
    }));

    // routine.completed → error: warning notification always
    //                    → success: info notification only when notifyOnComplete=true
    this.subIds.push(bus.subscribe("routine.completed", async (e: BusEvent) => {
      if (e.type !== "routine.completed") return;
      const p = e.payload as Record<string, unknown>;
      const outcome          = String(p["outcome"] ?? "success");
      const name             = String(p["routineName"] ?? p["name"] ?? "A routine");
      const result           = String(p["result"] ?? "");
      const notifyOnComplete = Boolean(p["notifyOnComplete"] ?? false);

      if (outcome === "error") {
        await this.createNotification({
          type:     "routine.completed",
          severity: "warning",
          title:    "Routine Failed",
          message:  result ? `"${name}" failed: ${result}` : `"${name}" encountered an error.`,
          metadata: p,
        });
        return;
      }

      if (outcome === "success" && notifyOnComplete) {
        await this.createNotification({
          type:     "routine.completed",
          severity: "info",
          title:    "Routine Completed",
          message:  result ? `"${name}" finished: ${result}` : `"${name}" completed successfully.`,
          metadata: p,
        });
      }
    }));

    // briefing.generated → info
    this.subIds.push(bus.subscribe("briefing.generated", async (e: BusEvent) => {
      if (e.type !== "briefing.generated") return;
      const p = e.payload as Record<string, unknown>;
      const date = String(p["date"] ?? new Date().toISOString().slice(0, 10));
      await this.createNotification({
        type:     "briefing.generated",
        severity: "info",
        title:    "Daily Briefing Ready",
        message:  `JARVIS daily briefing for ${date} is now available.`,
        metadata: p,
      });
    }));

    // system.resource.alert → warning / critical
    this.subIds.push(bus.subscribe("system.resource.alert", async (e: BusEvent) => {
      if (e.type !== "system.resource.alert") return;
      const p = e.payload as Record<string, unknown>;
      const resource  = String(p["resource"] ?? "unknown").toUpperCase();
      const value     = typeof p["value"]     === "number" ? p["value"].toFixed(1)  : String(p["value"]  ?? "?");
      const threshold = typeof p["threshold"] === "number" ? p["threshold"].toFixed(0) : String(p["threshold"] ?? "?");
      const isCritical = (p["resource"] === "cpu"    && (p["value"] as number) > 90)
                      || (p["resource"] === "memory" && (p["value"] as number) > 95);
      await this.createNotification({
        type:     "system.resource.alert",
        severity: isCritical ? "critical" : "warning",
        title:    `High ${resource} Usage`,
        message:  String(p["message"] ?? `${resource} is at ${value}% (threshold: ${threshold}%)`),
        metadata: p,
      });
    }));

    // system.error → critical
    this.subIds.push(bus.subscribe("system.error", async (e: BusEvent) => {
      if (e.type !== "system.error") return;
      const p = e.payload as Record<string, unknown>;
      const msg = String(p["message"] ?? p["error"] ?? "An unexpected error occurred.");
      await this.createNotification({
        type:     "system.error",
        severity: "critical",
        title:    "System Error",
        message:  msg,
        metadata: p,
      });
    }));

    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    void this.sweep();

    logger.info(
      { subscriptions: this.subIds.length, sweepIntervalHours: SWEEP_INTERVAL_MS / 3_600_000, retentionDays: RETENTION_DAYS },
      "NotificationService started",
    );
  }

  stop(): void {
    for (const id of this.subIds) bus.unsubscribe(id);
    this.subIds = [];
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

export const notificationService = new NotificationService();

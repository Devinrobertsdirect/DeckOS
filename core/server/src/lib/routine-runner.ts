/**
 * Routine Runner Service
 *
 * Background service that evaluates cron-based and event-based routine triggers.
 * Runs on a 60-second tick for cron routines; subscribes to the event bus for
 * event-based triggers.
 *
 * Supported action types:
 *   generate_briefing, send_notification, refresh_memory,
 *   query_goals_summary, run_health_check, emit_bus_event
 */
import { db, routinesTable, routineExecutionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { bus } from "./bus.js";
import { logger } from "./logger.js";
import { generateBriefing } from "./briefing-generator.js";
import type { BusEvent, EventType } from "@workspace/event-bus";

const TICK_MS = 60_000;

// ── Minimal cron parser ──────────────────────────────────────────────────────
// Supports standard 5-field cron: minute hour dom month dow
// Each field supports: * N N,M N-M */N

function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      if (isNaN(step) || step <= 0) continue;
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (isNaN(a) || isNaN(b)) continue;
      for (let i = a; i <= b; i++) values.add(i);
      continue;
    }
    const n = parseInt(part);
    if (!isNaN(n)) values.add(n);
  }

  return values;
}

/**
 * Returns true if the given Date matches the cron expression.
 * Fields: minute(0-59) hour(0-23) dom(1-31) month(1-12) dow(0-6, 0=Sun)
 */
export function matchesCron(cron: string, d: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minF, hrF, domF, monF, dowF] = fields;

  const minute = d.getMinutes();
  const hour   = d.getHours();
  const dom    = d.getDate();
  const month  = d.getMonth() + 1; // 1-based
  const dow    = d.getDay();        // 0=Sun

  return (
    parseCronField(minF,  0, 59).has(minute) &&
    parseCronField(hrF,   0, 23).has(hour)   &&
    parseCronField(domF,  1, 31).has(dom)    &&
    parseCronField(monF,  1, 12).has(month)  &&
    parseCronField(dowF,  0,  6).has(dow)
  );
}

/**
 * Compute next Date that matches the cron expression, starting from `after`.
 * Scans forward minute-by-minute up to 8 days.
 */
export function nextCronDate(cron: string, after: Date = new Date()): Date | null {
  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(candidate.getTime() + 8 * 24 * 60 * 60_000);

  while (candidate < limit) {
    if (matchesCron(cron, candidate)) return new Date(candidate);
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

// ── Action executor ──────────────────────────────────────────────────────────

type ActionParams = Record<string, unknown>;

async function executeAction(actionType: string, params: ActionParams): Promise<string> {
  switch (actionType) {
    case "generate_briefing": {
      const briefing = await generateBriefing();
      return `Daily briefing generated (id=${briefing.id}, date=${briefing.date}, model=${briefing.modelUsed})`;
    }

    case "send_notification": {
      const title   = (params["title"]   as string) || "JARVIS Notification";
      const message = (params["message"] as string) || "Routine notification fired.";
      bus.emit({
        source: "routine-runner",
        target: null,
        type: "memory.stored",
        payload: { notificationType: "routine", title, message, layer: "episodic", timestamp: new Date().toISOString() },
      });
      return `Notification sent: ${title} — ${message}`;
    }

    case "refresh_memory": {
      bus.emit({
        source: "routine-runner",
        target: null,
        type: "memory.stored",
        payload: { event: "routine.memory_refresh", layer: "episodic", timestamp: new Date().toISOString() },
      });
      return "Memory refresh event emitted";
    }

    case "query_goals_summary": {
      bus.emit({
        source: "routine-runner",
        target: null,
        type: "ai.chat.request",
        payload: {
          message: "Summarize the current state of all active goals and flag any that are overdue or stale.",
          channel: "routine",
          sessionId: "routine-goals",
        },
      });
      return "Goals summary query dispatched";
    }

    case "run_health_check": {
      bus.emit({
        source: "routine-runner",
        target: null,
        type: "system.monitor.request",
        payload: { requestedBy: "routine-runner", timestamp: new Date().toISOString() },
      });
      return "System health check requested";
    }

    case "emit_bus_event": {
      const eventType = (params["eventType"] as string) || "routine.triggered";
      const payload   = (params["payload"]   as Record<string, unknown>) || {};
      // Emit the requested event type directly; bus validates and rejects unknown types gracefully
      bus.emit({
        source: "routine-runner",
        target: null,
        type: eventType as EventType,
        payload: { ...payload, timestamp: new Date().toISOString() },
      });
      return `Bus event emitted: ${eventType}`;
    }

    default:
      return `Unknown action type: ${actionType}`;
  }
}

// ── Runner class ─────────────────────────────────────────────────────────────

export class RoutineRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private eventSubIds: string[] = [];
  private eventRoutineIds = new Set<number>();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.cronTick(), TICK_MS);
    setTimeout(() => void this.cronTick(), 5_000);
    void this.resubscribeEventRoutines();
    logger.info({ tickMs: TICK_MS }, "RoutineRunner started");
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const subId of this.eventSubIds) bus.unsubscribe(subId);
    this.eventSubIds = [];
    this.eventRoutineIds.clear();
  }

  // Called after create/update/delete to refresh event subscriptions
  async resubscribeEventRoutines(): Promise<void> {
    // Clear old subscriptions using their IDs
    for (const subId of this.eventSubIds) bus.unsubscribe(subId);
    this.eventSubIds = [];
    this.eventRoutineIds.clear();

    try {
      const routines = await db.select().from(routinesTable)
        .where(eq(routinesTable.triggerType, "event"));

      // Internal lifecycle events must never be used as triggers — doing so causes
      // unbounded self-trigger cascades (every execution fires another execution).
      const BLOCKED_TRIGGERS = new Set(["routine.triggered", "routine.completed"]);

      for (const r of routines) {
        if (!r.enabled) continue;
        if (BLOCKED_TRIGGERS.has(r.triggerValue)) {
          logger.warn({ routineId: r.id, triggerValue: r.triggerValue },
            "RoutineRunner: skipping subscription to internal lifecycle event — would cause infinite loop");
          continue;
        }
        this.eventRoutineIds.add(r.id);
        // bus.subscribe accepts EventType | string — no cast needed
        const subId = bus.subscribe(r.triggerValue, async (event: BusEvent) => {
          if (!r.enabled) return;
          if (event.type !== r.triggerValue) return;
          // Reject events sourced from routine-runner to prevent cross-trigger cascades
          if ((event.source as string) === "routine-runner") return;
          logger.info({ routineId: r.id, event: r.triggerValue }, "RoutineRunner: event trigger fired");
          await this.executeRoutine(r);
        });
        this.eventSubIds.push(subId);
      }

      logger.debug({ count: routines.length }, "RoutineRunner: event subscriptions refreshed");
    } catch (err) {
      logger.warn({ err }, "RoutineRunner: failed to resubscribe event routines");
    }
  }

  // ── Cron tick ───────────────────────────────────────────────────────────────

  async cronTick(): Promise<void> {
    const now = new Date();
    now.setSeconds(0, 0);

    try {
      const routines = await db.select().from(routinesTable)
        .where(eq(routinesTable.triggerType, "cron"));

      for (const r of routines) {
        if (!r.enabled) continue;
        try {
          if (!matchesCron(r.triggerValue, now)) continue;
          logger.info({ routineId: r.id, name: r.name }, "RoutineRunner: cron trigger matched");
          await this.executeRoutine(r);
        } catch (err) {
          logger.warn({ err, routineId: r.id }, "RoutineRunner: error checking routine");
        }
      }
    } catch (err) {
      logger.warn({ err }, "RoutineRunner: cron tick error");
    }
  }

  // ── Execute a single routine ────────────────────────────────────────────────

  async executeRoutine(r: typeof routinesTable.$inferSelect): Promise<void> {
    const params = (r.actionParams ?? {}) as Record<string, unknown>;

    bus.emit({
      source: "routine-runner",
      target: null,
      type: "routine.triggered",
      payload: {
        routineId: r.id,
        routineName: r.name,
        actionType: r.actionType,
        timestamp: new Date().toISOString(),
      },
    });

    let outcome = "success";
    let result  = "";

    try {
      result = await executeAction(r.actionType, params);
    } catch (err) {
      outcome = "error";
      result  = err instanceof Error ? err.message : String(err);
      logger.warn({ err, routineId: r.id }, "RoutineRunner: action execution error");
    }

    // Persist execution log
    try {
      await db.insert(routineExecutionsTable).values({
        routineId: r.id,
        outcome,
        result,
      });
    } catch (err) {
      logger.warn({ err }, "RoutineRunner: failed to persist execution");
    }

    // Update last/next run times
    try {
      const nextRun = r.triggerType === "cron"
        ? nextCronDate(r.triggerValue)
        : null;

      await db.update(routinesTable)
        .set({
          lastRunAt: new Date(),
          nextRunAt: nextRun ?? undefined,
        })
        .where(eq(routinesTable.id, r.id));
    } catch (err) {
      logger.warn({ err }, "RoutineRunner: failed to update run timestamps");
    }

    bus.emit({
      source: "routine-runner",
      target: null,
      type: "routine.completed",
      payload: {
        routineId:        r.id,
        routineName:      r.name,
        outcome,
        result,
        notifyOnComplete: r.notifyOnComplete,
        timestamp:        new Date().toISOString(),
      },
    });

    logger.info({ routineId: r.id, outcome, result }, "RoutineRunner: routine completed");
  }
}

export const routineRunner = new RoutineRunner();

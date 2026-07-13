import { EventBus } from "@workspace/event-bus";
import { db, systemEventsTable } from "@workspace/db";
import type { BusEvent } from "@workspace/event-bus";
import { logger } from "./logger.js";
import { traceState } from "./trace.js";

function persistEvent(event: BusEvent): void {
  db.insert(systemEventsTable)
    .values({
      level: "info",
      message: event.type,
      source: event.source,
      data: {
        eventId: event.id,
        version: event.version,
        target: event.target,
        payload: event.payload,
        timestamp: event.timestamp,
      } as Record<string, unknown>,
    })
    .then(() => {})
    .catch((err: unknown) => {
      logger.error({ err, eventId: event.id }, "EventBus: failed to persist event");
    });
}

export const bus = new EventBus({
  persist: persistEvent,
  logError: (msg, data) => logger.error({ data }, msg),
  trace: {
    isEnabled: () => traceState.isEnabled(),
    log: (msg, data) => traceState.log(msg, data),
  },
});

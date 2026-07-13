import { randomUUID } from "crypto";
import { BusEventSchema, PluginBusEventSchema } from "./types.js";
import type { BusEvent, EventFilter, EventHandler, EventType, PluginBusEvent } from "./types.js";

type Subscription = {
  id: string;
  type: string;
  handler: EventHandler;
};

type PersistFn = (event: BusEvent) => void;
type LogFn = (msg: string, data?: unknown) => void;

type TraceHooks = {
  isEnabled: () => boolean;
  log: (msg: string, data?: unknown) => void;
};

export class EventBus {
  private subscriptions: Subscription[] = [];
  private queue: BusEvent[] = [];
  private processing = false;
  private memoryHistory: BusEvent[] = [];
  private readonly maxMemoryHistory = 500;
  private persistFn?: PersistFn;
  private logError: LogFn = console.error;
  private trace?: TraceHooks;

  constructor(opts?: { persist?: PersistFn; logError?: LogFn; trace?: TraceHooks }) {
    this.persistFn = opts?.persist;
    if (opts?.logError) this.logError = opts.logError;
    if (opts?.trace) this.trace = opts.trace;
  }

  emit(event: Omit<BusEvent, "id" | "timestamp" | "version">): void {
    const full = {
      ...event,
      version: "v1" as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const parsed = BusEventSchema.safeParse(full);
    if (!parsed.success) {
      this.logError("EventBus: rejected invalid event", {
        type: (event as { type?: unknown }).type,
        issues: parsed.error.issues,
      });
      return;
    }

    const validated = parsed.data;
    this.traceLog("queued", { eventId: validated.id, type: validated.type, source: validated.source });
    this.queue.push(validated);
    this.drain();
  }

  emitPlugin(event: Omit<PluginBusEvent, "id" | "timestamp" | "version">): void {
    const full = {
      ...event,
      version: "v1" as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const parsed = PluginBusEventSchema.safeParse(full);
    if (!parsed.success) {
      this.logError("EventBus: rejected invalid plugin event", {
        type: (event as { type?: unknown }).type,
        issues: parsed.error.issues,
      });
      return;
    }
    const validated = parsed.data as BusEvent;
    this.traceLog("queued[plugin]", { eventId: validated.id, type: validated.type, source: validated.source });
    this.queue.push(validated);
    this.drain();
  }

  subscribe(type: EventType | string, handler: EventHandler): string {
    const id = randomUUID();
    this.subscriptions.push({ id, type, handler });
    return id;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== subscriptionId);
  }

  history(filter?: EventFilter): BusEvent[] {
    let results = [...this.memoryHistory];

    if (filter?.type) results = results.filter((e) => e.type === filter.type);
    if (filter?.source) results = results.filter((e) => e.source === filter.source);

    results = results.reverse();
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  private traceLog(stage: string, data: unknown): void {
    if (this.trace?.isEnabled()) {
      this.trace.log(`EventBus[${stage}]`, data);
    }
  }

  private drain(): void {
    if (this.processing) return;
    this.processing = true;
    void this.processLoop();
  }

  private async processLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      await this.dispatch(event);
    }
    this.processing = false;
  }

  private async dispatch(event: BusEvent): Promise<void> {
    this.memoryHistory.push(event);
    if (this.memoryHistory.length > this.maxMemoryHistory) this.memoryHistory.shift();

    if (this.persistFn) {
      try {
        this.persistFn(event);
      } catch (err) {
        this.logError("EventBus: persist error", err);
      }
    }

    this.traceLog("dispatched", { eventId: event.id, type: event.type, source: event.source });

    const matching = this.subscriptions.filter(
      (s) =>
        s.type === "*" ||
        s.type === event.type ||
        event.type.startsWith(s.type + ".") ||
        event.target === s.type,
    );

    for (const sub of matching) {
      this.traceLog("handler-start", { eventId: event.id, type: event.type, source: event.source, subscriptionId: sub.id });
      try {
        await sub.handler(event);
        this.traceLog("handler-end", { eventId: event.id, type: event.type, source: event.source, subscriptionId: sub.id, result: "ok" });
      } catch (err) {
        this.traceLog("handler-end", { eventId: event.id, type: event.type, source: event.source, subscriptionId: sub.id, result: "error", err: String(err) });
        this.logError(`EventBus: handler error for type=${event.type}`, err);
      }
    }
  }
}

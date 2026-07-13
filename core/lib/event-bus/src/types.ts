import { z } from "zod";

export const EventCategorySchema = z.enum([
  "system",
  "plugin",
  "device",
  "ai",
  "memory",
  "client",
]);

export type EventCategory = z.infer<typeof EventCategorySchema>;

export const SystemEventTypeSchema = z.enum([
  "system.boot",
  "system.shutdown",
  "system.error",
  "system.heartbeat",
  "system.config_changed",
  "system.monitor.metrics",
  "system.monitor.request",
  "system.cognitive_tick",
  "system.maintenance",
  "system.resource.alert",
  "system.resource.clear",
]);

export const PluginEventTypeSchema = z.enum([
  "plugin.loaded",
  "plugin.unloaded",
  "plugin.error",
  "plugin.executed",
  "plugin.status_changed",
  "plugin.list.request",
  "plugin.list.response",
  "plugin.toggle.request",
  "plugin.installed",
  "plugin.uninstalled",
  "plugin.reload",
]);

export const DeviceEventTypeSchema = z.enum([
  "device.connected",
  "device.disconnected",
  "device.reading",
  "device.command_sent",
  "device.command.send",
  "device.command.ack",
  "device.state.changed",
  "device.error",
  "device.list.request",
  "device.list.response",
  "device.registry.snapshot",
  "device.location.updated",
  "device.geofence.triggered",
  "device.status.updated",
  "device.discovery.new",
  "device.discovery.initialized",
]);

export const AiEventTypeSchema = z.enum([
  "ai.inference_started",
  "ai.inference_completed",
  "ai.model_changed",
  "ai.mode.set",
  "ai.router.status",
  "ai.error",
  "ai.chat.request",
  "ai.chat.token",
  "ai.chat.response",
]);

export const MemoryEventTypeSchema = z.enum([
  "memory.stored",
  "memory.retrieved",
  "memory.deleted",
  "memory.expired",
  "memory.search.request",
  "memory.search.response",
  "memory.recent.request",
  "memory.recent.response",
  "memory.ucm_enriched",
]);

export const AutonomyEventTypeSchema = z.enum([
  "autonomy.action.request",
  "autonomy.action.executed",
  "autonomy.action.blocked",
  "autonomy.action.skipped",
  "autonomy.confirmation.required",
  "prediction.generated",
  "goal.created",
  "goal.completed",
  "goal.stale",
  "routine.triggered",
  "routine.completed",
  "briefing.generated",
]);

export const ClientEventTypeSchema = z.enum([
  "client.connected",
  "client.disconnected",
]);

export const NotificationEventTypeSchema = z.enum([
  "notification.created",
]);

export const AceraEventTypeSchema = z.enum([
  "acera.tracking.started",
  "acera.tracking.stopped",
  "acera.gesture.detected",
  "acera.scene.update",
]);

export const StarkEventTypeSchema = z.enum([
  "stark.tracking.started",
  "stark.tracking.stopped",
  "stark.signal.event",
  "stark.scene.update",
]);

// Custom events: plugins and services may emit any namespaced "domain.action"
// name without editing this union (e.g. "lie_detector.analyze.request").
export const CustomEventTypeSchema = z.custom<`${string}.${string}`>(
  (v) => typeof v === "string" && /^[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(v),
);

export const EventTypeSchema = z.union([
  SystemEventTypeSchema,
  PluginEventTypeSchema,
  DeviceEventTypeSchema,
  AiEventTypeSchema,
  MemoryEventTypeSchema,
  AutonomyEventTypeSchema,
  ClientEventTypeSchema,
  NotificationEventTypeSchema,
  AceraEventTypeSchema,
  StarkEventTypeSchema,
  CustomEventTypeSchema,
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const BusEventSchema = z.object({
  id: z.string(),
  version: z.literal("v1"),
  source: z.string(),
  target: z.string().nullable(),
  type: EventTypeSchema,
  payload: z.unknown(),
  timestamp: z.string(),
});

export const PluginBusEventSchema = z.object({
  id: z.string(),
  version: z.literal("v1"),
  source: z.string(),
  target: z.string().nullable(),
  type: z.string().min(1),
  payload: z.unknown(),
  timestamp: z.string(),
});

export type PluginBusEvent = z.infer<typeof PluginBusEventSchema>;

export type BusEvent = z.infer<typeof BusEventSchema>;

export type EventHandler = (event: BusEvent) => Promise<void> | void;

export type EventFilter = {
  type?: string;
  source?: string;
  limit?: number;
  offset?: number;
};

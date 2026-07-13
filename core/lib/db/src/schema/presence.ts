import { pgTable, serial, text, real, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const presenceStateTable = pgTable("presence_state", {
  id: serial("id").primaryKey(),
  availability: text("availability").notNull().default("passive"), // "active" | "idle" | "passive"
  activeChannel: text("active_channel").notNull().default("web"),  // "web" | "mobile" | "whatsapp" | "voice"
  preferredModality: text("preferred_modality").notNull().default("text"), // "text" | "voice"
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }).notNull().defaultNow(),
  sessionCount: integer("session_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const nudgesTable = pgTable("nudges", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // "goal_decay" | "deadline" | "check_in" | "continuation" | "insight" | "thread_resurfaced"
  content: text("content").notNull(),
  urgencyScore: real("urgency_score").notNull().default(0.5), // 0–1
  targetGoalId: integer("target_goal_id"),
  targetThreadId: integer("target_thread_id"),
  dismissed: boolean("dismissed").notNull().default(false),
  surfacedAt: timestamp("surfaced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const narrativeThreadsTable = pgTable("narrative_threads", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("active"), // "active" | "dormant" | "resolved"
  relatedGoalIds: integer("related_goal_ids").array().notNull().default([]),
  tags: text("tags").array().notNull().default([]),
  relevanceScore: real("relevance_score").notNull().default(0.5),
  meta: jsonb("meta").notNull().default({}),
  lastEngagedAt: timestamp("last_engaged_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const initiativeConfigTable = pgTable("initiative_config", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  initiativeLevel: real("initiative_level").notNull().default(0.5), // 0=silent, 1=very proactive
  checkInAfterMinutes: integer("check_in_after_minutes").notNull().default(30),
  goalDecayThreshold: real("goal_decay_threshold").notNull().default(0.6), // urgency score to trigger nudge
  maxActiveNudges: integer("max_active_nudges").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PresenceState = typeof presenceStateTable.$inferSelect;
export type Nudge = typeof nudgesTable.$inferSelect;
export type NarrativeThread = typeof narrativeThreadsTable.$inferSelect;
export type InitiativeConfig = typeof initiativeConfigTable.$inferSelect;

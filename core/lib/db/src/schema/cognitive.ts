import { pgTable, serial, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const goalsTable = pgTable("goals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  priority: integer("priority").notNull().default(50),
  parentGoalId: integer("parent_goal_id"),
  completionPct: integer("completion_pct").notNull().default(0),
  decayRatePerHour: real("decay_rate_per_hour").notNull().default(0.5),
  tags: text("tags").array().notNull().default([]),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const goalPlansTable = pgTable("goal_plans", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull(),
  steps: jsonb("steps").notNull().default([]),
  status: text("status").notNull().default("draft"),
  confidence: real("confidence").notNull().default(0.5),
  riskAssessment: text("risk_assessment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const feedbackSignalsTable = pgTable("feedback_signals", {
  id: serial("id").primaryKey(),
  signalType: text("signal_type").notNull(),
  context: jsonb("context").notNull().default({}),
  weight: real("weight").notNull().default(1.0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const behaviorProfileTable = pgTable("behavior_profile", {
  id: serial("id").primaryKey(),
  verbosityLevel: real("verbosity_level").notNull().default(0.5),
  proactiveFrequency: real("proactive_frequency").notNull().default(0.5),
  toneFormality: real("tone_formality").notNull().default(0.5),
  confidenceThreshold: real("confidence_threshold").notNull().default(0.7),
  totalSignals: integer("total_signals").notNull().default(0),
  learnedPatterns: jsonb("learned_patterns").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const predictionsTable = pgTable("predictions", {
  id: serial("id").primaryKey(),
  prediction: text("prediction").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  suggestedAction: text("suggested_action"),
  triggerWindow: text("trigger_window"),
  basis: jsonb("basis").notNull().default({}),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const autonomyConfigTable = pgTable("autonomy_config", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  safetyLevel: text("safety_level").notNull().default("strict"),
  confirmationRequired: boolean("confirmation_required").notNull().default(true),
  allowedActions: jsonb("allowed_actions").notNull().default([]),
  blockedActions: jsonb("blocked_actions").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const autonomyLogTable = pgTable("autonomy_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  actionType: text("action_type").notNull(),
  parameters: jsonb("parameters").notNull().default({}),
  outcome: text("outcome"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const routinesTable = pgTable("routines", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  enabled:      boolean("enabled").notNull().default(true),
  triggerType:  text("trigger_type").notNull().default("cron"),
  triggerValue: text("trigger_value").notNull(),
  actionType:   text("action_type").notNull(),
  actionParams:     jsonb("action_params").notNull().default({}),
  notifyOnComplete: boolean("notify_on_complete").notNull().default(false),
  lastRunAt:        timestamp("last_run_at", { withTimezone: true }),
  nextRunAt:        timestamp("next_run_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const routineExecutionsTable = pgTable("routine_executions", {
  id:          serial("id").primaryKey(),
  routineId:   integer("routine_id").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  outcome:     text("outcome").notNull().default("success"),
  result:      text("result"),
});

export type Goal = typeof goalsTable.$inferSelect;
export type GoalPlan = typeof goalPlansTable.$inferSelect;
export type FeedbackSignal = typeof feedbackSignalsTable.$inferSelect;
export type BehaviorProfile = typeof behaviorProfileTable.$inferSelect;
export type Prediction = typeof predictionsTable.$inferSelect;
export type AutonomyConfig = typeof autonomyConfigTable.$inferSelect;
export type AutonomyLog = typeof autonomyLogTable.$inferSelect;
export const notificationsTable = pgTable("notifications", {
  id:        serial("id").primaryKey(),
  type:      text("type").notNull(),
  severity:  text("severity").notNull().default("info"), // info | warning | critical
  title:     text("title").notNull(),
  message:   text("message").notNull(),
  read:      boolean("read").notNull().default(false),
  metadata:  jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type Routine = typeof routinesTable.$inferSelect;
export type RoutineExecution = typeof routineExecutionsTable.$inferSelect;

export const briefingsTable = pgTable("briefings", {
  id:          serial("id").primaryKey(),
  date:        text("date").notNull(),
  summary:     text("summary").notNull(),
  stats:       jsonb("stats").notNull().default({}),
  modelUsed:   text("model_used").notNull().default("rule-engine-v1"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Briefing = typeof briefingsTable.$inferSelect;

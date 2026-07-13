import { pgTable, serial, timestamp, boolean, text, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const LayerSchema = z.record(z.string(), z.unknown());
export type Layer = z.infer<typeof LayerSchema>;

export const userCognitiveModelTable = pgTable("user_cognitive_model", {
  id: serial("id").primaryKey(),
  identity: jsonb("identity").notNull().default({}),
  preferences: jsonb("preferences").notNull().default({}),
  context: jsonb("context").notNull().default({}),
  goals: jsonb("goals").notNull().default({}),
  behaviorPatterns: jsonb("behavior_patterns").notNull().default({}),
  emotionalModel: jsonb("emotional_model").notNull().default({}),
  domainExpertise: jsonb("domain_expertise").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const ucmSettingsTable = pgTable("ucm_settings", {
  id: serial("id").primaryKey(),
  proactiveMode: boolean("proactive_mode").notNull().default(false),
  memoryRetentionLevel: text("memory_retention_level").notNull().default("medium"),
  emotionalModelingEnabled: boolean("emotional_modeling_enabled").notNull().default(true),
  personalizationLevel: text("personalization_level").notNull().default("full"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const UCM_LAYERS = [
  "identity",
  "preferences",
  "context",
  "goals",
  "behaviorPatterns",
  "emotionalModel",
  "domainExpertise",
] as const;

export type UCMLayer = typeof UCM_LAYERS[number];

export type UserCognitiveModel = typeof userCognitiveModelTable.$inferSelect;
export type UCMSettings = typeof ucmSettingsTable.$inferSelect;

import { pgTable, serial, timestamp, text, integer } from "drizzle-orm/pg-core";

export const aiPersonaTable = pgTable("ai_persona", {
  id:                   serial("id").primaryKey(),
  aiName:               text("ai_name").notNull().default("JARVIS"),
  gender:               text("gender").notNull().default("neutral"),
  voice:                text("voice").notNull().default("onyx"),
  attitude:             text("attitude").notNull().default("professional"),
  thinkingDepth:        text("thinking_depth").notNull().default("standard"),
  responseLength:       text("response_length").notNull().default("balanced"),
  textColor:            text("text_color").notNull().default("#00d4ff"),
  // Personality dials — 0–100 sliders
  gravityLevel:         integer("gravity_level").notNull().default(50),       // 0=silly/unserious  → 100=gravely serious
  snarkinessLevel:      integer("snarkiness_level").notNull().default(20),    // 0=sincere/earnest  → 100=maximum snark
  flirtatiousnessLevel: integer("flirtatiousness_level").notNull().default(0),// 0=clinical/neutral → 100=charming/flirty
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiPersona = typeof aiPersonaTable.$inferSelect;
export type NewAiPersona = typeof aiPersonaTable.$inferInsert;

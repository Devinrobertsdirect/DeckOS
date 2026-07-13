import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().default("default"),
  role: text("role").notNull(), // "user" | "assistant" | "system"
  content: text("content").notNull(),
  channel: text("channel").notNull().default("web"), // "web" | "mobile" | "whatsapp" | "voice"
  modelUsed: text("model_used"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

export const voiceIdentityTable = pgTable("voice_identity", {
  id: serial("id").primaryKey(),
  voiceId: text("voice_id").notNull().default("jarvis_v1"),
  tone: text("tone").notNull().default("calm, precise, slightly witty"),
  pacing: text("pacing").notNull().default("medium"),
  formality: integer("formality").notNull().default(70),
  verbosity: integer("verbosity").notNull().default(40),
  emotionRange: text("emotion_range").notNull().default("controlled"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVoiceIdentitySchema = createInsertSchema(voiceIdentityTable).omit({ id: true, updatedAt: true });
export type InsertVoiceIdentity = z.infer<typeof insertVoiceIdentitySchema>;
export type VoiceIdentity = typeof voiceIdentityTable.$inferSelect;

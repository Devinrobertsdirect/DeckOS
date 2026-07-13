import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commandHistoryTable = pgTable("command_history", {
  id: serial("id").primaryKey(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  success: boolean("success").notNull().default(true),
  plugin: text("plugin"),
  command: text("command"),
  modeUsed: text("mode_used").notNull().default("DIRECT_EXECUTION"),
  aiAssisted: boolean("ai_assisted").notNull().default(false),
  executionTimeMs: integer("execution_time_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommandHistorySchema = createInsertSchema(commandHistoryTable).omit({ id: true, createdAt: true });
export type InsertCommandHistory = z.infer<typeof insertCommandHistorySchema>;
export type CommandHistory = typeof commandHistoryTable.$inferSelect;

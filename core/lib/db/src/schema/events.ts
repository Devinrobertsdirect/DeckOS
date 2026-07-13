import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemEventsTable = pgTable("system_events", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  source: text("source").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSystemEventSchema = createInsertSchema(systemEventsTable).omit({ id: true, createdAt: true });
export type InsertSystemEvent = z.infer<typeof insertSystemEventSchema>;
export type SystemEvent = typeof systemEventsTable.$inferSelect;

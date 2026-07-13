import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoryEntriesTable = pgTable("memory_entries", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("short_term"),
  content: text("content").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  source: text("source").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMemoryEntrySchema = createInsertSchema(memoryEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMemoryEntry = z.infer<typeof insertMemoryEntrySchema>;
export type MemoryEntry = typeof memoryEntriesTable.$inferSelect;

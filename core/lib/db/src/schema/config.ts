import { pgTable, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appConfigTable = pgTable("app_config", {
  key:       varchar("key", { length: 100 }).primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type AppConfigRow    = typeof appConfigTable.$inferSelect;
export type NewAppConfigRow = typeof appConfigTable.$inferInsert;

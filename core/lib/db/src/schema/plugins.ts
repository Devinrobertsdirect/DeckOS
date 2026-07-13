import { pgTable, serial, text, integer, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const pluginStateTable = pgTable("plugin_state", {
  pluginId: text("plugin_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  lastActivity: timestamp("last_activity", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PluginState = typeof pluginStateTable.$inferSelect;
export type InsertPluginState = typeof pluginStateTable.$inferInsert;

export const communityPluginsTable = pgTable("community_plugins", {
  id: serial("id").primaryKey(),
  pluginId: text("plugin_id").notNull().unique(),
  name: text("name").notNull(),
  author: text("author").notNull(),
  description: text("description").notNull(),
  version: text("version").notNull(),
  category: text("category").notNull().default("community"),
  permissions: text("permissions").array().notNull().default([]),
  entrypointUrl: text("entrypoint_url"),
  iconUrl: text("icon_url"),
  tags: text("tags").array().notNull().default([]),
  installCount: integer("install_count").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommunityPlugin = typeof communityPluginsTable.$inferSelect;
export type InsertCommunityPlugin = typeof communityPluginsTable.$inferInsert;

export const pluginReviewsTable = pgTable(
  "plugin_reviews",
  {
    id: serial("id").primaryKey(),
    pluginId: text("plugin_id").notNull().unique(),
    rating: integer("rating").notNull(),
    review: text("review"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [check("rating_range", sql`${t.rating} >= 1 AND ${t.rating} <= 5`)],
);

export type PluginReview = typeof pluginReviewsTable.$inferSelect;
export type InsertPluginReview = typeof pluginReviewsTable.$inferInsert;

import { pgTable, text, boolean, jsonb, timestamp, serial } from "drizzle-orm/pg-core";

export const deviceReadingsTable = pgTable("device_readings", {
  id:        serial("id").primaryKey(),
  deviceId:  text("device_id").notNull(),
  sensor:    text("sensor").notNull(),
  value:     text("value").notNull(),
  unit:      text("unit"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceReadingRow = typeof deviceReadingsTable.$inferSelect;
export type NewDeviceReadingRow = typeof deviceReadingsTable.$inferInsert;

export const deviceProfilesTable = pgTable("device_profiles", {
  deviceId:     text("device_id").primaryKey(),
  displayName:  text("display_name").notNull(),
  icon:         text("icon").notNull().default("cpu"),
  description:  text("description"),
  protocol:     text("protocol").notNull().default("unknown"),
  deviceType:   text("device_type").notNull().default("unknown"),
  category:     text("category").notNull().default("sensor"),
  capabilities: text("capabilities").array().notNull().default([]),
  eventSchema:  jsonb("event_schema").notNull().default({}),
  controlStubs: jsonb("control_stubs").notNull().default([]),
  tags:         text("tags").array().notNull().default([]),
  initialized:  boolean("initialized").notNull().default(false),
  location:     text("location"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DeviceProfile = typeof deviceProfilesTable.$inferSelect;
export type NewDeviceProfile = typeof deviceProfilesTable.$inferInsert;

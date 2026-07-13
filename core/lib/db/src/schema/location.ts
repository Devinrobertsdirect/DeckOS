import { pgTable, serial, text, real, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const deviceLocationsTable = pgTable("device_locations", {
  id:         serial("id").primaryKey(),
  deviceId:   text("device_id").notNull(),
  deviceType: text("device_type").notNull().default("unknown"),
  lat:        real("lat").notNull(),
  lng:        real("lng").notNull(),
  accuracy:   real("accuracy"),
  altitude:   real("altitude"),
  speed:      real("speed"),
  heading:    real("heading"),
  battery:    real("battery"),
  signal:     text("signal"),
  source:     text("source").notNull().default("api"),
  extra:      jsonb("extra").notNull().default({}),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const geofencesTable = pgTable("geofences", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  lat:          real("lat").notNull(),
  lng:          real("lng").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(100),
  color:        text("color").notNull().default("#3f84f3"),
  active:       boolean("active").notNull().default(true),
  tags:         text("tags").array().notNull().default([]),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const geofenceEventsTable = pgTable("geofence_events", {
  id:          serial("id").primaryKey(),
  geofenceId:  integer("geofence_id").notNull(),
  deviceId:    text("device_id").notNull(),
  action:      text("action").notNull(),
  lat:         real("lat").notNull(),
  lng:         real("lng").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceLocation  = typeof deviceLocationsTable.$inferSelect;
export type Geofence        = typeof geofencesTable.$inferSelect;
export type GeofenceEvent   = typeof geofenceEventsTable.$inferSelect;

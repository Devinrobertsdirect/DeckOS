import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Is a REAL Postgres actually available?
 *
 * The desktop app is local-first and ships with no database. Electron passes a
 * placeholder DATABASE_URL purely so this module can load (see main.js), which
 * meant every query still dialled 127.0.0.1:5432, failed with ECONNREFUSED, and
 * logged a full stack trace — slow, and it buried real errors at boot.
 *
 * Call sites should check `dbEnabled` and skip the query (falling back to their
 * in-memory/file path) instead of attempting a connection that cannot succeed.
 * Server deployments with a genuine DATABASE_URL are unaffected.
 */
export const dbEnabled: boolean =
  process.env.NEURA_NO_DB !== "1" &&
  process.env.DATABASE_URL !== "postgresql://127.0.0.1/neura";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// With no database, short-circuit the pool so queries reject IMMEDIATELY instead
// of opening a TCP connection to a port nothing is listening on. Callers already
// try/catch and fall back to in-memory/file paths; this just makes the failure
// instant and cheap rather than a per-query connect + ECONNREFUSED + stack trace.
// Hot paths (device readings, routine polling) ran this on every tick.
if (!dbEnabled) {
  const noDb = () =>
    Promise.reject(
      Object.assign(new Error("No database configured (local-first mode)"), { code: "NO_DB" }),
    );
  pool.query = noDb as unknown as typeof pool.query;
  pool.connect = noDb as unknown as typeof pool.connect;
}

export const db = drizzle(pool, { schema });

export * from "./schema";

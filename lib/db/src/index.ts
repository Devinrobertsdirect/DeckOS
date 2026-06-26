import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const url = process.env["DATABASE_URL"];

if (!url) {
  console.warn(
    "[db] DATABASE_URL not set — database features disabled. " +
    "Add DATABASE_URL to .env to enable persistence.",
  );
}

export const pool = url ? new Pool({ connectionString: url }) : null;
export const db = pool ? drizzle(pool, { schema }) : null;

export * from "./schema";

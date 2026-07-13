/**
 * app-config.ts — Runtime configuration service
 *
 * Reads/writes key-value settings from the `app_config` DB table.
 * In-memory cache with 30 s TTL so every inference call doesn't hit the DB.
 *
 * Known keys (all optional; fall back to env vars or defaults):
 *   OLLAMA_HOST       — Ollama base URL  (default: http://localhost:11434)
 *   REASONING_MODEL   — Cortex model     (default: gemma3:9b)
 *   FAST_MODEL        — Reflex model     (default: phi3)
 *   OPENAI_API_KEY    — Cloud API key    (sensitive — masked on read)
 *   ANTHROPIC_API_KEY — Cloud API key    (sensitive — masked on read)
 */

import { db, appConfigTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const SENSITIVE_KEYS = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
const CACHE_TTL_MS   = 30_000;

const cache   = new Map<string, string>();
let cacheTime = 0;

async function refresh(): Promise<void> {
  const rows = await db.select().from(appConfigTable);
  cache.clear();
  for (const row of rows) cache.set(row.key, row.value);
  cacheTime = Date.now();
}

export async function getConfig(key: string): Promise<string | null> {
  if (Date.now() - cacheTime > CACHE_TTL_MS) await refresh();
  return cache.get(key) ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await db
    .insert(appConfigTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value, updatedAt: sql`now()` },
    });
  cache.set(key, value);
}

export async function deleteConfig(key: string): Promise<void> {
  await db.delete(appConfigTable).where(eq(appConfigTable.key, key));
  cache.delete(key);
}

export function invalidateConfigCache(): void {
  cacheTime = 0;
}

/** Returns all config values — sensitive keys are masked */
export async function getAllConfig(): Promise<Record<string, string>> {
  if (Date.now() - cacheTime > CACHE_TTL_MS) await refresh();
  const out: Record<string, string> = {};
  for (const [k, v] of cache.entries()) {
    out[k] = SENSITIVE_KEYS.has(k) ? maskSecret(v) : v;
  }
  return out;
}

export function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

/**
 * Migrate stale config values to updated defaults.
 * Call once at server startup — safe to run multiple times.
 */
export async function migrateConfig(): Promise<void> {
  try {
    const old = await getConfig("REASONING_MODEL");
    if (old === "gemma3:9b") {
      await setConfig("REASONING_MODEL", "gemma4");
    }
    const oldOc = await getConfig("OPENCLAW_MODEL");
    if (oldOc === "gemma3:9b") {
      await setConfig("OPENCLAW_MODEL", "gemma4");
    }
  } catch {
    // non-fatal — DB may not be ready yet
  }
}

function maskSecret(val: string): string {
  if (val.length <= 8) return "••••••••";
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
}

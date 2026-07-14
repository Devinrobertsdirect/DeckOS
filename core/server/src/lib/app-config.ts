/**
 * app-config.ts — Runtime configuration service
 *
 * Key-value settings (API keys, model choices, preferences) with a two-tier,
 * local-first persistence model so Atlas "runs anywhere":
 *
 *   1. A durable JSON file on disk (the source of truth for a single machine).
 *      Default: ~/.atlas/config.json  (override with ATLAS_CONFIG_FILE or
 *      ATLAS_DATA_DIR). This is what makes keys survive restarts even with no
 *      database — the common case on a laptop, a Pi, or a bot.
 *   2. The `app_config` Postgres table (optional — for server/multi-device
 *      deployments). Best-effort: a missing DB is never fatal.
 *
 * On boot the file is loaded synchronously into the cache AND mirrored into
 * process.env, so env-reading code (the inference gateway, provider clients)
 * sees saved keys immediately. Every write goes to the file first (durable),
 * then to the DB best-effort.
 *
 * Known keys (all optional; fall back to env vars or defaults):
 *   OLLAMA_HOST · REASONING_MODEL · FAST_MODEL · OPENAI_API_KEY ·
 *   ANTHROPIC_API_KEY · ELEVENLABS_API_KEY · CLAUDE_MODEL · CLOUD_PREFERENCE ·
 *   CLAUDE_MAX_TOKENS · SPEED_MODE · ELEVENLABS_VOICE_ID · …
 */

import { db, appConfigTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const SENSITIVE_KEYS = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY"]);
const CACHE_TTL_MS   = 30_000;

const cache   = new Map<string, string>();
let cacheTime = 0;

// ── Durable local file ────────────────────────────────────────────────────────
function resolveConfigFile(): string {
  const explicit = process.env["ATLAS_CONFIG_FILE"];
  if (explicit && explicit.trim()) return explicit.trim();
  const dataDir = process.env["ATLAS_DATA_DIR"]?.trim() || join(homedir() || ".", ".atlas");
  return join(dataDir, "config.json");
}
const CONFIG_FILE = resolveConfigFile();

/** Some keys have an aliased env var the rest of the app reads. */
function applyEnv(key: string, value: string): void {
  process.env[key] = value;
  if (key === "OPENAI_API_KEY") process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] = value;
}
function clearEnv(key: string): void {
  delete process.env[key];
  if (key === "OPENAI_API_KEY") delete process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
}

function readFileConfig(): Record<string, string> {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {}; // missing/corrupt file → empty; first run or read-only FS
  }
}

function writeFileConfig(entries: Map<string, string>): void {
  try {
    mkdirSync(dirname(CONFIG_FILE), { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of entries) obj[k] = v;
    // Atomic-ish: write to a temp file then rename over the target.
    const tmp = `${CONFIG_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
    renameSync(tmp, CONFIG_FILE);
  } catch {
    // Read-only FS or permissions — DB/env still hold the value this session.
  }
}

// Seed the cache + process.env from disk at module load, before any request.
(function seedFromFile() {
  const fileCfg = readFileConfig();
  for (const [k, v] of Object.entries(fileCfg)) {
    cache.set(k, v);
    applyEnv(k, v);
  }
  cacheTime = Date.now(); // don't force a DB refresh just to serve the file config
})();

async function refresh(): Promise<void> {
  // File is the base; DB (if reachable) overlays it. File keeps us alive with no DB.
  cache.clear();
  const fileCfg = readFileConfig();
  for (const [k, v] of Object.entries(fileCfg)) cache.set(k, v);
  try {
    const rows = await db.select().from(appConfigTable);
    for (const row of rows) cache.set(row.key, row.value);
  } catch {
    // No database — the file config stands.
  }
  // Keep process.env in sync so env-readers see the latest.
  for (const [k, v] of cache) applyEnv(k, v);
  cacheTime = Date.now();
}

export async function getConfig(key: string): Promise<string | null> {
  if (Date.now() - cacheTime > CACHE_TTL_MS) await refresh();
  return cache.get(key) ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  // 1) Durable + live FIRST so it works with no database and survives restart.
  cache.set(key, value);
  applyEnv(key, value);
  writeFileConfig(cache);
  // 2) DB best-effort — a missing DB is non-fatal.
  try {
    await db
      .insert(appConfigTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appConfigTable.key,
        set: { value, updatedAt: sql`now()` },
      });
  } catch {
    /* file + env already hold it */
  }
}

export async function deleteConfig(key: string): Promise<void> {
  cache.delete(key);
  clearEnv(key);
  writeFileConfig(cache);
  try {
    await db.delete(appConfigTable).where(eq(appConfigTable.key, key));
  } catch {
    /* file + env already cleared */
  }
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

/** Where the durable config lives — surfaced for diagnostics / the CLI. */
export function configFilePath(): string {
  return CONFIG_FILE;
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

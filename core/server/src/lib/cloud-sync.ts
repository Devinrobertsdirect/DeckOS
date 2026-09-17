/**
 * cloud-sync.ts — how a robot becomes its owner's Nobi.
 *
 * Two roads, same destination (the account's keys + profile, applied here):
 *
 *   1. SAID: the owner gets three words from the site and says them —
 *      "hey Nobi, sync apple river stone". We redeem them for a session.
 *   2. PUSHED: the owner presses "Push to my Nobi" on their account page and
 *      we collect it with nothing but our own bot number (POST /v1/units/pull).
 *      The first collection enrols a device id we mint here and keep; from then
 *      on that id alone re-authorises, so "Sync now" works forever after — no
 *      code, no typing on a robot that has no keyboard.
 *
 * Either way there is no login on the robot, ever. Keys land in the same config
 * slots the setup UI writes; names/persona go out as provision.apply.
 *
 * Config: NOBI_CLOUD_URL, NOBI_BOT_NUMBER (provisioning), NOBI_CLOUD_TOKEN +
 * NOBI_DEVICE_ID (minted/stored here).
 */
import { randomBytes } from "node:crypto";
import { getConfig, setConfig } from "./app-config.js";
import { broadcast } from "./ws-server.js";
import { refreshOllamaDetection } from "./inference.js";

const KEY_SLOTS = new Set(["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
const MIND_TO_PERSONA: Record<string, string> = { workshop: "rocky", stealth: "jarvis", forge: "friday", codex: "alfred" };

export interface SyncResult { ok: boolean; error?: string; ownerName?: string; botName?: string; keys?: string[]; email?: string; enrolled?: boolean }

async function cloudUrl(): Promise<string> {
  const u = (await getConfig("NOBI_CLOUD_URL").catch(() => null)) ?? process.env["NOBI_CLOUD_URL"] ?? "";
  return u.replace(/\/+$/, "");
}

/** This robot's own id for the cloud — minted once, never leaves the device except to enrol. */
async function deviceId(): Promise<string> {
  const existing = (await getConfig("NOBI_DEVICE_ID").catch(() => null)) ?? "";
  if (existing) return existing;
  const id = randomBytes(24).toString("base64url");
  await setConfig("NOBI_DEVICE_ID", id);
  return id;
}

/** Collect a session using our bot number: works after an owner Push, or once enrolled. */
async function pullSession(base: string): Promise<{ token?: string; error?: string }> {
  const botNumber = (await getConfig("NOBI_BOT_NUMBER").catch(() => null)) ?? "";
  if (!botNumber) return { error: "no_bot_number" };
  try {
    const r = await fetch(`${base}/v1/units/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botNumber, deviceId: await deviceId() }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 403) return { error: "not_pushed" };
    if (r.status === 404) return { error: "unknown_unit" };
    if (!r.ok) return { error: `pull_${r.status}` };
    const j = (await r.json()) as { token?: string };
    if (!j.token) return { error: "pull_no_token" };
    await setConfig("NOBI_CLOUD_TOKEN", j.token);
    return { token: j.token };
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
}

/** Redeem a code (optional) or collect a pushed session, then pull + apply keys and profile. */
export async function syncFromCloud(code?: string): Promise<SyncResult> {
  const base = await cloudUrl();
  if (!base) return { ok: false, error: "no_cloud" };
  let token = (await getConfig("NOBI_CLOUD_TOKEN").catch(() => null)) ?? "";
  let enrolled = false;
  try {
    if (code) {
      const r = await fetch(`${base}/v1/sync/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { ok: false, error: r.status === 404 ? "bad_code" : `redeem_${r.status}` };
      const j = (await r.json()) as { token?: string };
      if (!j.token) return { ok: false, error: "redeem_no_token" };
      token = j.token;
      await setConfig("NOBI_CLOUD_TOKEN", token);
    }
    // No session yet (or never had one): try collecting by bot number.
    if (!token) {
      const pulled = await pullSession(base);
      if (!pulled.token) return { ok: false, error: pulled.error ?? "no_token" };
      token = pulled.token; enrolled = true;
    }
    let r = await fetch(`${base}/v1/sync`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    // A stale session is not a dead end once we're enrolled — collect a fresh one and retry.
    if (r.status === 401) {
      const pulled = await pullSession(base);
      if (!pulled.token) return { ok: false, error: pulled.error === "not_pushed" ? "expired" : (pulled.error ?? "expired") };
      token = pulled.token;
      r = await fetch(`${base}/v1/sync`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    }
    if (!r.ok) return { ok: false, error: r.status === 401 ? "expired" : `sync_${r.status}` };
    const data = (await r.json()) as { email?: string; profile?: Record<string, unknown>; keys?: Record<string, string> };
    const applied: string[] = [];
    for (const [name, value] of Object.entries(data.keys ?? {})) {
      if (KEY_SLOTS.has(name) && typeof value === "string" && value.trim()) { await setConfig(name, value.trim()); applied.push(name); }
    }
    if (applied.length) void refreshOllamaDetection().catch(() => undefined);
    const p = data.profile ?? {};
    const bp = (p["buildProfile"] ?? {}) as Record<string, unknown>;
    const botName = String(p["botName"] ?? bp["name"] ?? "").trim() || undefined;
    const ownerName = String(p["ownerName"] ?? bp["owner"] ?? "").trim() || undefined;
    const mind = String(bp["mind"] ?? "").trim();
    const personaId = mind ? (MIND_TO_PERSONA[mind] ?? undefined) : undefined;
    const eyeTheme = typeof p["eyeTheme"] === "string" ? (p["eyeTheme"] as string) : undefined;
    if (botName) await setConfig("ATLAS_BOT_NAME", botName);
    // The owner's name has to survive a robot with no database: the system
    // prompt reads this config (via env) when the cognitive model can't be read,
    // which is why an unsynced robot calls everyone "Commander".
    if (ownerName) await setConfig("ATLAS_USER_NAME", ownerName);
    if (typeof p["botNumber"] === "string" && /^\d{1,7}$/.test(p["botNumber"] as string)) await setConfig("NOBI_BOT_NUMBER", (p["botNumber"] as string).padStart(7, "0"));
    await setConfig("NOBI_BUILD_PROFILE", JSON.stringify({ botName, ownerName, personaId, eyeTheme, at: new Date().toISOString(), build: bp, source: "cloud-sync", email: data.email }));
    broadcast({ type: "provision.apply", source: "cloud-sync", payload: { botName, ownerName, personaId, eyeTheme }, timestamp: new Date().toISOString() });
    return { ok: true, ownerName, botName, keys: applied, email: data.email, enrolled };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }
}

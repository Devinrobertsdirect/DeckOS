/**
 * cloud-sync.ts — "hey Nobi, sync apple river stone".
 *
 * The owner gets a three-word code from the site (signed in, owners only),
 * says it to the robot, and the robot redeems it with Nobi Cloud — no login
 * on the robot, ever. Redeeming yields a session of the robot's own; with it
 * the robot pulls the account's profile (names, personality, eyes) and the
 * account's own API keys, and applies both: keys into the brain's config
 * (the same slots the setup UI writes), names/persona via provision.apply.
 *
 * Config: NOBI_CLOUD_URL (set at provisioning), NOBI_CLOUD_TOKEN (stored here).
 */
import { getConfig, setConfig } from "./app-config.js";
import { broadcast } from "./ws-server.js";
import { refreshOllamaDetection } from "./inference.js";

const KEY_SLOTS = new Set(["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
const MIND_TO_PERSONA: Record<string, string> = { workshop: "rocky", stealth: "jarvis", forge: "friday", codex: "alfred" };

export interface SyncResult { ok: boolean; error?: string; ownerName?: string; botName?: string; keys?: string[]; email?: string }

async function cloudUrl(): Promise<string> {
  const u = (await getConfig("NOBI_CLOUD_URL").catch(() => null)) ?? process.env["NOBI_CLOUD_URL"] ?? "";
  return u.replace(/\/+$/, "");
}

/** Redeem a code (optional) and pull + apply the account's profile and keys. */
export async function syncFromCloud(code?: string): Promise<SyncResult> {
  const base = await cloudUrl();
  if (!base) return { ok: false, error: "no_cloud" };
  let token = (await getConfig("NOBI_CLOUD_TOKEN").catch(() => null)) ?? "";
  try {
    if (code) {
      const r = await fetch(`${base}/v1/sync/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { ok: false, error: r.status === 404 ? "bad_code" : `redeem_${r.status}` };
      const j = (await r.json()) as { token?: string };
      if (!j.token) return { ok: false, error: "redeem_no_token" };
      token = j.token;
      await setConfig("NOBI_CLOUD_TOKEN", token);
    }
    if (!token) return { ok: false, error: "no_token" };
    const r = await fetch(`${base}/v1/sync`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
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
    await setConfig("NOBI_BUILD_PROFILE", JSON.stringify({ botName, ownerName, personaId, eyeTheme, at: new Date().toISOString(), build: bp, source: "cloud-sync", email: data.email }));
    broadcast({ type: "provision.apply", source: "cloud-sync", payload: { botName, ownerName, personaId, eyeTheme }, timestamp: new Date().toISOString() });
    return { ok: true, ownerName, botName, keys: applied, email: data.email };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }
}

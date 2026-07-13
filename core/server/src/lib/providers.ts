/**
 * providers.ts — Cloud provider connectors (Apex + companion tiers)
 *
 * Raw-fetch callers for the cloud AI providers surfaced in the Genesis setup
 * wizard and Settings UI. Mirrors the style of inference.ts (no SDK deps, keys
 * read from getConfig() with a process.env fallback, 60 s AbortSignal).
 *
 * Key resolution order for every provider:
 *   1. explicit override key (used by the setup wizard to test BEFORE saving)
 *   2. getConfig(KEY_NAME)   — the app_config DB table
 *   3. process.env[KEY_NAME] — (plus an optional env fallback name)
 *
 * Secrets are NEVER echoed back: testProvider() redacts any resolved key out of
 * error messages before returning them.
 */

import { getConfig } from "./app-config.js";
import { callClaude, getAnthropicApiKey, getClaudeModel } from "./inference.js";

// ── Types ────────────────────────────────────────────────────────────────────
export type ProviderMessage = { role: string; content: string };
type CallOptions = { model?: string; key?: string };

const TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 15_000;

// ── Key resolution ───────────────────────────────────────────────────────────
/**
 * Resolve an API key: explicit override → DB config → env (+ optional fallback
 * env name). Returns "" when nothing is configured. Never throws.
 */
async function resolveKey(
  keyName: string,
  override?: string,
  fallbackEnv?: string,
): Promise<string> {
  const o = override?.trim();
  if (o) return o;
  try {
    const fromDb = await getConfig(keyName);
    if (fromDb) return fromDb;
  } catch {
    /* DB not ready — fall back to env */
  }
  return process.env[keyName] ?? (fallbackEnv ? process.env[fallbackEnv] ?? "" : "");
}

/** Boolean-only presence check — never returns the value itself. */
async function isConfigured(keyName: string, fallbackEnv?: string): Promise<boolean> {
  try {
    if (await getConfig(keyName)) return true;
  } catch {
    /* ignore */
  }
  return !!(process.env[keyName] || (fallbackEnv ? process.env[fallbackEnv] : undefined));
}

/** Strip any resolved secrets out of a surfaced error string. */
function redact(err: unknown, ...secrets: Array<string | undefined>): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const s of secrets) {
    if (s && s.length >= 4) msg = msg.split(s).join("***");
  }
  return msg || "Unknown error";
}

// ── Gemini (Google Generative Language API) ─────────────────────────────────
/**
 * Convert OpenAI-style messages to Gemini `contents`:
 *  - system messages fold into a single leading user preamble
 *  - assistant → model, everything else → user
 */
function toGeminiContents(
  messages: ProviderMessage[],
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  const systemParts: string[] = [];
  const rest: ProviderMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") systemParts.push(m.content);
    else rest.push(m);
  }

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  const preamble = systemParts.join("\n\n").trim();
  if (preamble) contents.push({ role: "user", parts: [{ text: preamble }] });
  for (const m of rest) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  return contents;
}

export async function callGemini(
  messages: ProviderMessage[],
  opts: CallOptions = {},
): Promise<string> {
  const key = await resolveKey("GEMINI_API_KEY", opts.key);
  if (!key) throw new Error("Gemini API key not configured");
  const model = opts.model ?? "gemini-2.0-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: toGeminiContents(messages) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  return text || "[No response from Gemini]";
}

// ── OpenAI-compatible chat (OpenAI + Perplexity) ────────────────────────────
async function openAiCompatibleChat(
  url: string,
  key: string,
  model: string,
  messages: ProviderMessage[],
  maxTokens?: number,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "[No response]";
}

export async function callPerplexity(
  messages: ProviderMessage[],
  opts: CallOptions = {},
): Promise<string> {
  const key = await resolveKey("PERPLEXITY_API_KEY", opts.key);
  if (!key) throw new Error("Perplexity API key not configured");
  const model = opts.model ?? "sonar";
  return openAiCompatibleChat("https://api.perplexity.ai/chat/completions", key, model, messages);
}

export async function callOpenAIChat(
  messages: ProviderMessage[],
  opts: CallOptions = {},
): Promise<string> {
  const key = await resolveKey("OPENAI_API_KEY", opts.key, "AI_INTEGRATIONS_OPENAI_API_KEY");
  if (!key) throw new Error("OpenAI API key not configured");
  const model = opts.model ?? "gpt-4o-mini";
  return openAiCompatibleChat("https://api.openai.com/v1/chat/completions", key, model, messages);
}

// ── Provider testing ─────────────────────────────────────────────────────────
export const PROVIDER_IDS = ["claude", "gemini", "perplexity", "openai", "elevenlabs"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

type TestResult = { ok: boolean; detail: string };

/** Claude reachability. Reuses callClaude for stored-key tests; falls back to a
 *  direct 1-token call when an override key is supplied (pre-save wizard test). */
async function testClaude(overrideKey?: string): Promise<TestResult> {
  const model = await getClaudeModel();
  const override = overrideKey?.trim();

  if (override) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": override,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` };
    return { ok: true, detail: `Claude reachable (${model})` };
  }

  const apiKey = await getAnthropicApiKey();
  if (!apiKey) return { ok: false, detail: "No API key configured" };
  await callClaude([{ role: "user", content: "Hi" }], model, 1);
  return { ok: true, detail: `Claude reachable (${model})` };
}

async function testElevenLabs(overrideKey?: string): Promise<TestResult> {
  const apiKey = await resolveKey("ELEVENLABS_API_KEY", overrideKey);
  if (!apiKey) return { ok: false, detail: "No API key configured" };
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` };
  return { ok: true, detail: "ElevenLabs reachable" };
}

/**
 * Test a provider with a tiny, cheap call. When `key` is supplied it is used
 * instead of the stored key (so the setup wizard can validate before saving).
 * Never throws — returns { ok:false, detail } on any error, with the key redacted.
 */
export async function testProvider(id: string, key?: string): Promise<TestResult> {
  const probe = "Reply with the single word: ok";
  try {
    switch (id) {
      case "claude":
        return await testClaude(key);
      case "gemini":
        await callGemini([{ role: "user", content: probe }], { key });
        return { ok: true, detail: "Gemini reachable" };
      case "perplexity":
        await callPerplexity([{ role: "user", content: probe }], { key });
        return { ok: true, detail: "Perplexity reachable" };
      case "openai":
        await callOpenAIChat([{ role: "user", content: probe }], { key });
        return { ok: true, detail: "OpenAI reachable" };
      case "elevenlabs":
        return await testElevenLabs(key);
      default:
        return { ok: false, detail: `Unknown provider: ${id}` };
    }
  } catch (err) {
    return { ok: false, detail: redact(err, key) };
  }
}

// ── Provider status ──────────────────────────────────────────────────────────
/**
 * Configured-or-not flags for every provider — booleans only, never values.
 * Includes the media generators (midjourney / higgsfield) which have no caller
 * yet but are surfaced so the setup UI can show their connection state.
 */
export async function providerStatus(): Promise<Array<{ id: string; configured: boolean }>> {
  const checks: Array<{ id: string; keyName: string; fallbackEnv?: string }> = [
    { id: "claude", keyName: "ANTHROPIC_API_KEY" },
    { id: "gemini", keyName: "GEMINI_API_KEY" },
    { id: "perplexity", keyName: "PERPLEXITY_API_KEY" },
    { id: "openai", keyName: "OPENAI_API_KEY", fallbackEnv: "AI_INTEGRATIONS_OPENAI_API_KEY" },
    { id: "elevenlabs", keyName: "ELEVENLABS_API_KEY" },
    { id: "midjourney", keyName: "MIDJOURNEY_API_KEY" },
    { id: "higgsfield", keyName: "HIGGSFIELD_API_KEY" },
  ];
  return Promise.all(
    checks.map(async ({ id, keyName, fallbackEnv }) => ({
      id,
      configured: await isConfigured(keyName, fallbackEnv),
    })),
  );
}

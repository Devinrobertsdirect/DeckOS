import os from "os";
import { getConfig } from "./app-config.js";

// ── Task types ─────────────────────────────────────────────────────────────
// Callers declare what they're asking for — the gateway picks the right model.
export type TaskType =
  // Gemma (Cortex / Thinking layer) — reasoning-intensive
  | "chat"          // user conversation
  | "reasoning"     // complex analysis / multi-step thinking
  | "planning"      // goal breakdown, strategy
  | "summarization" // memory/log summarization
  | "prediction"    // predictions requiring inference
  | "briefing"      // daily briefing synthesis
  // phi3 (Reflex layer) — fast lightweight responses
  | "classification"// intent classification, label extraction
  | "routing"       // deciding which action to take
  | "command"       // parsing a user command
  | "lightweight"   // any quick-response task
  // Rule engine (Autopilot layer) — deterministic, no LLM
  | "system"        // system status checks
  | "device"        // device polling / state commands
  | "monitor"       // health/uptime checks
  | "fallback";     // explicit fallback

export type InferenceMode = "fast" | "deep" | "none";

export type InferenceOptions = {
  prompt: string;
  mode: InferenceMode;
  task?: TaskType;
  context?: Array<{ role: string; content: string }>;
  useCache?: boolean;
  latencyBudgetMs?: number; // if set and < 200, forces fast model
  /** Called synchronously once tier+model are resolved, BEFORE the slow LLM call */
  onTierResolved?: (tier: "cortex" | "reflex" | "autopilot", model: string) => void;
};

export type InferenceResult = {
  response: string;
  modelUsed: string;
  latencyMs: number;
  fromCache: boolean;
  tier: "cortex" | "reflex" | "autopilot";
};

// ── Model name config (env-driven so users can change without code edits) ──
export const MODEL_CONFIG = {
  // Gemma — "Cortex / Thinking layer"
  // Handles: chat, planning, reasoning, goal breakdown, summarization, predictions
  REASONING: process.env["REASONING_MODEL"] ?? "gemma4",

  // phi3 — "Reflex layer"
  // Handles: quick responses, classification, routing, lightweight commands
  FAST: process.env["FAST_MODEL"] ?? "phi3",

  // Rule engine — "Autopilot layer"
  // Handles: system commands, device polling, deterministic actions, fallback
  RULE_ENGINE: "rule-engine-v1",
} as const;

// ── Inference state ─────────────────────────────────────────────────────────
const inferenceState: {
  totalRequests: number;
  cacheHits: number;
  cortexRequests: number;
  reflexRequests: number;
  autopilotRequests: number;
  cache: Map<string, { response: string; model: string; tier: string; timestamp: number }>;
  ollamaAvailable: boolean | null;
  openWebUIAvailable: boolean | null;
  openclawAvailable: boolean | null;
  lastDetected: Date;
  /** Models discovered from Ollama /api/tags — populated on each detection */
  ollamaModels: string[];
} = {
  totalRequests:      0,
  cacheHits:          0,
  cortexRequests:     0,
  reflexRequests:     0,
  autopilotRequests:  0,
  cache:              new Map(),
  ollamaAvailable:    null,
  openWebUIAvailable: null,
  openclawAvailable:  null,
  lastDetected:       new Date(),
  ollamaModels:       [],
};

export function getInferenceState() {
  return inferenceState;
}

// ── Dynamic config helpers ───────────────────────────────────────────────────
export async function getOllamaBaseUrl(): Promise<string> {
  try {
    const fromDb = await getConfig("OLLAMA_HOST");
    return fromDb ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  } catch {
    return process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  }
}

async function getDynamicModels(): Promise<{ reasoning: string; fast: string }> {
  try {
    const [reasoning, fast] = await Promise.all([
      getConfig("REASONING_MODEL"),
      getConfig("FAST_MODEL"),
    ]);
    const configuredReasoning = reasoning ?? process.env["REASONING_MODEL"] ?? MODEL_CONFIG.REASONING;
    const configuredFast      = fast      ?? process.env["FAST_MODEL"]      ?? MODEL_CONFIG.FAST;
    // Use discovered Ollama models when available — overrides hardcoded defaults
    return {
      reasoning: resolveBestModel("cortex", configuredReasoning),
      fast:      resolveBestModel("reflex", configuredFast),
    };
  } catch {
    return {
      reasoning: resolveBestModel("cortex", MODEL_CONFIG.REASONING),
      fast:      resolveBestModel("reflex", MODEL_CONFIG.FAST),
    };
  }
}

// ── Ollama detection ────────────────────────────────────────────────────────
export async function detectOllama(): Promise<boolean> {
  try {
    const base = await getOllamaBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    // Cache available models so inference can pick real ones
    const data = await res.json() as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name).filter(Boolean);
    if (names.length > 0) inferenceState.ollamaModels = names;
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the best available Ollama model for the given tier.
 * Falls back to whatever's installed rather than hardcoded names.
 *
 * Cortex (heavy reasoning): prefers gemma, llama, mistral, deepseek, qwen large
 * Reflex (fast):            prefers phi, qwen-small, smollm, tinyllama
 * Fallback:                 first model in the list, or the configured default
 */
export function resolveBestModel(tier: "cortex" | "reflex", configuredModel: string): string {
  const available = inferenceState.ollamaModels;
  if (available.length === 0) return configuredModel;

  // First check: if the configured model is actually available, use it
  if (available.some((m) => m === configuredModel || m.startsWith(configuredModel + ":"))) {
    return configuredModel;
  }

  if (tier === "reflex") {
    const fastPatterns = [/phi/i, /qwen.*[0-9]\.?[0-9]?b/i, /smollm/i, /tinyllama/i, /gemma.*2b/i, /llama.*1b/i];
    for (const pat of fastPatterns) {
      const match = available.find((m) => pat.test(m));
      if (match) return match;
    }
  }

  // Cortex or no reflex match found — prefer large capable models
  const cortexPatterns = [/gemma/i, /llama/i, /mistral/i, /deepseek/i, /qwen/i, /phi/i, /mixtral/i];
  for (const pat of cortexPatterns) {
    const match = available.find((m) => pat.test(m));
    if (match) return match;
  }

  // Last resort: use whatever is installed
  return available[0]!;
}

export const OPENCLAW_BASE = "http://localhost:18789";

export async function detectOpenClaw(): Promise<boolean> {
  const endpoints = [
    `${OPENCLAW_BASE}/api/tags`,
    `${OPENCLAW_BASE}/health`,
    `${OPENCLAW_BASE}/`,
  ];
  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2_000);
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status < 500) return true;
    } catch { /* try next */ }
  }
  return false;
}

/** Returns the best available local Ollama-compatible base URL.
 *  Priority: Ollama (configured host) → OpenClaw (port 18789) → null */
export async function getActiveOllamaBase(): Promise<string | null> {
  if (inferenceState.ollamaAvailable)    return getOllamaBaseUrl();
  if (inferenceState.openclawAvailable)  return OPENCLAW_BASE;
  return null;
}

export async function refreshOllamaDetection(): Promise<void> {
  [inferenceState.ollamaAvailable, inferenceState.openWebUIAvailable, inferenceState.openclawAvailable] =
    await Promise.all([detectOllama(), detectOpenWebUI(), detectOpenClaw()]);
  inferenceState.lastDetected = new Date();
}

// ── Open WebUI helpers ──────────────────────────────────────────────────────
// Open WebUI ("Openclaw") exposes an OpenAI-compatible API at {host}/v1/
// Set OPENWEBUI_HOST in Settings → Connection to enable it.

export async function getOpenWebUIBaseUrl(): Promise<string> {
  try {
    const fromDb = await getConfig("OPENWEBUI_HOST");
    return ((fromDb ?? process.env["OPENWEBUI_HOST"]) ?? "").trim();
  } catch {
    return (process.env["OPENWEBUI_HOST"] ?? "").trim();
  }
}

async function getOpenWebUIApiKey(): Promise<string> {
  try {
    return (await getConfig("OPENWEBUI_API_KEY")) ?? process.env["OPENWEBUI_API_KEY"] ?? "";
  } catch {
    return process.env["OPENWEBUI_API_KEY"] ?? "";
  }
}

export async function detectOpenWebUI(): Promise<boolean> {
  const base = await getOpenWebUIBaseUrl();
  if (!base) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    try {
      // Fallback: try the models endpoint if /health is not available
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 2000);
      const res2 = await fetch(`${base}/v1/models`, { signal: controller2.signal });
      clearTimeout(timeout2);
      return res2.ok;
    } catch {
      return false;
    }
  }
}

async function callOpenWebUI(
  messages: Array<{ role: string; content: string }>,
  model: string,
): Promise<string> {
  const base = await getOpenWebUIBaseUrl();
  const apiKey = await getOpenWebUIApiKey();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
    },
    body:   JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Open WebUI ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as { choices: [{ message: { content: string } }] };
  return data.choices[0]?.message?.content ?? "[No response from Open WebUI]";
}

async function callOpenWebUIStreaming(
  messages: Array<{ role: string; content: string }>,
  model: string,
  onToken: (token: string) => void,
): Promise<string> {
  const base = await getOpenWebUIBaseUrl();
  const apiKey = await getOpenWebUIApiKey();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
    },
    body:   JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Open WebUI ${res.status}`);
  if (!res.body) throw new Error("No body from Open WebUI");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const parsed = JSON.parse(data) as { choices: [{ delta: { content?: string } }] };
        const token = parsed.choices[0]?.delta?.content ?? "";
        if (token) { fullText += token; onToken(token); }
      } catch { /* skip malformed */ }
    }
  }
  return fullText || "[No response from Open WebUI]";
}

// Build an OpenAI-style messages array (compatible with Ollama + Open WebUI)
function buildMessages(
  prompt: string,
  context: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const hasSystem = context.some((m) => m.role === "system");
  return [
    ...(!hasSystem ? [{ role: "system", content: "You are an advanced AI assistant integrated into DeckOS. Be concise and precise." }] : []),
    ...context,
    { role: "user", content: prompt },
  ];
}

// ── MODEL ROUTING GATEWAY ───────────────────────────────────────────────────
//
// Priority: RULE ENGINE → FAST (phi3) → CORTEX (Gemma) → Cloud
//
//  Tier        Model       When to use
//  ──────────  ──────────  ─────────────────────────────────────────
//  autopilot   rule-engine system checks, device polling, safety fallback
//  reflex      phi3        classification, routing, commands, <200ms budget
//  cortex      gemma3:9b   chat, planning, reasoning, summarization, briefing
//
type Tier = "cortex" | "reflex" | "autopilot";

function resolveGateway(task: TaskType | undefined, mode: InferenceMode, latencyBudgetMs?: number): Tier {
  // No local AI available (Ollama, OpenClaw, or Open WebUI) → autopilot (rule engine)
  const hasLocalAI = inferenceState.ollamaAvailable || inferenceState.openclawAvailable || inferenceState.openWebUIAvailable;
  if (mode === "none" || !hasLocalAI) return "autopilot";

  // Strict latency budget under 200ms → reflex
  if (latencyBudgetMs !== undefined && latencyBudgetMs < 200) return "reflex";

  // Route by task type
  switch (task) {
    // ── Cortex tasks (Gemma) ──────────────────────────────────────────────
    case "chat":
    case "reasoning":
    case "planning":
    case "summarization":
    case "prediction":
    case "briefing":
      return "cortex";

    // ── Reflex tasks (phi3) ───────────────────────────────────────────────
    case "classification":
    case "routing":
    case "command":
    case "lightweight":
      return "reflex";

    // ── Autopilot tasks (rule engine) ─────────────────────────────────────
    case "system":
    case "device":
    case "monitor":
    case "fallback":
      return "autopilot";

    // ── Legacy mode fallback (no task specified) ──────────────────────────
    default:
      // "deep" maps to cortex, "fast" maps to reflex
      return mode === "deep" ? "cortex" : "reflex";
  }
}

function tierToModel(tier: Tier): string {
  switch (tier) {
    case "cortex":    return MODEL_CONFIG.REASONING;
    case "reflex":    return MODEL_CONFIG.FAST;
    case "autopilot": return MODEL_CONFIG.RULE_ENGINE;
  }
}

// ── Legacy helper kept for backward-compat callers ─────────────────────────
export function selectModel(mode: InferenceMode): string {
  if (mode === "none" || !inferenceState.ollamaAvailable) return MODEL_CONFIG.RULE_ENGINE;
  if (mode === "fast") return MODEL_CONFIG.FAST;
  return MODEL_CONFIG.REASONING;
}

// ── Rule engine ─────────────────────────────────────────────────────────────
export function generateRuleBasedResponse(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("status") || p.includes("health")) {
    return `[RULE ENGINE] System status: NOMINAL. All subsystems operational. Uptime: ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m.`;
  }
  if (p.includes("cpu") || p.includes("memory") || p.includes("ram")) {
    const mem = os.totalmem() - os.freemem();
    return `[RULE ENGINE] CPU Load: ${os.loadavg()[0]!.toFixed(2)}. Memory used: ${Math.round(mem / 1024 / 1024)}MB / ${Math.round(os.totalmem() / 1024 / 1024)}MB.`;
  }
  if (p.includes("help") || p.includes("commands")) {
    return `[RULE ENGINE] Available commands: status, monitor, plugins list, devices list, memory search <query>, infer <prompt>.`;
  }
  if (p.includes("hello") || p.includes("jarvis") || p.includes("deck")) {
    return `[RULE ENGINE] DECK OS online. I am your local-first AI command center. All systems nominal. How may I assist?`;
  }
  return `[RULE ENGINE] Command processed. No LLM available — operating in deterministic fallback mode. Input received: "${prompt.substring(0, 80)}"`;
}

// ── Ollama caller ───────────────────────────────────────────────────────────
export async function callOllama(
  prompt: string,
  model: string,
  context: Array<{ role: string; content: string }>,
  baseOverride?: string,
): Promise<string> {
  const base = baseOverride ?? await getOllamaBaseUrl();
  const hasSystemMsg = context.some((m) => m.role === "system");
  const messages = [
    ...(!hasSystemMsg
      ? [{ role: "system", content: "You are an advanced AI assistant integrated into DeckOS. Be concise and precise." }]
      : []),
    ...context,
    { role: "user", content: prompt },
  ];

  const res = await fetch(`${base}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model, messages, stream: false }),
    signal:  AbortSignal.timeout(60_000), // 60s for larger models (Gemma 9B)
  });

  if (!res.ok) throw new Error(`Ollama error ${res.status} for model ${model}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "[No response from model]";
}

// ── Streaming Ollama caller ─────────────────────────────────────────────────
export async function callOllamaStreaming(
  prompt: string,
  model: string,
  context: Array<{ role: string; content: string }>,
  onToken: (token: string) => void,
  baseOverride?: string,
): Promise<string> {
  const hasSystemMsg = context.some((m) => m.role === "system");
  const messages = [
    ...(!hasSystemMsg
      ? [{ role: "system", content: "You are an advanced AI assistant integrated into DeckOS. Be concise and precise." }]
      : []),
    ...context,
    { role: "user", content: prompt },
  ];

  const base = baseOverride ?? await getOllamaBaseUrl();
  const res = await fetch(`${base}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model, messages, stream: true }),
    signal:  AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(`Ollama error ${res.status} for model ${model}`);
  if (!res.body) throw new Error("No response body from Ollama");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const token = parsed.message?.content ?? "";
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return fullText || "[No response from model]";
}

// ── Streaming rule-based response ──────────────────────────────────────────
export async function streamRuleBasedResponse(
  prompt: string,
  onToken: (token: string) => void,
  delayMs = 40,
): Promise<string> {
  const full = generateRuleBasedResponse(prompt);
  const words = full.split(" ");
  for (let i = 0; i < words.length; i++) {
    const token = (i === 0 ? "" : " ") + words[i];
    onToken(token);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return full;
}

// ── Streaming inference entry point ─────────────────────────────────────────
export async function runInferenceStreaming(
  opts: InferenceOptions,
  onToken: (token: string) => void,
): Promise<InferenceResult> {
  const { prompt, mode, task, context = [], latencyBudgetMs, onTierResolved } = opts;
  inferenceState.totalRequests++;

  const tier = resolveGateway(task, mode, latencyBudgetMs);
  // Use discovered Ollama models when available — never use hardcoded defaults blindly
  const model = tier === "cortex"
    ? resolveBestModel("cortex", MODEL_CONFIG.REASONING)
    : tier === "reflex"
      ? resolveBestModel("reflex", MODEL_CONFIG.FAST)
      : MODEL_CONFIG.RULE_ENGINE;
  if (onTierResolved) onTierResolved(tier, model);

  const start = Date.now();
  let response = "";
  let modelUsed: string = MODEL_CONFIG.RULE_ENGINE;
  let usedTier: Tier = "autopilot";

  // Priority: Ollama → OpenClaw (Ollama-compatible on :18789) → OpenWebUI → rule engine
  const ollamaBase    = inferenceState.ollamaAvailable   ? await getOllamaBaseUrl() : null;
  const openClawBase  = !ollamaBase && inferenceState.openclawAvailable ? OPENCLAW_BASE : null;
  const useOpenWebUI  = !ollamaBase && !openClawBase && !!inferenceState.openWebUIAvailable;
  const activeBase    = ollamaBase ?? openClawBase;  // best Ollama-compatible endpoint
  const msgs = buildMessages(prompt, context);

  const modelLabel = (base: string, m: string) =>
    base === OPENCLAW_BASE ? `openclaw:${m}` : m;

  try {
    if (tier === "autopilot" || !activeBase && !useOpenWebUI) {
      response  = await streamRuleBasedResponse(prompt, onToken);
      modelUsed = MODEL_CONFIG.RULE_ENGINE;
      usedTier  = "autopilot";
      inferenceState.autopilotRequests++;
    } else if (activeBase) {
      response  = await callOllamaStreaming(prompt, model, context, onToken, activeBase);
      modelUsed = modelLabel(activeBase, model);
      usedTier  = tier;
      if (tier === "cortex") inferenceState.cortexRequests++;
      if (tier === "reflex") inferenceState.reflexRequests++;
    } else if (useOpenWebUI) {
      response  = await callOpenWebUIStreaming(msgs, model, onToken);
      modelUsed = `openwebui:${model}`;
      usedTier  = tier;
      if (tier === "cortex") inferenceState.cortexRequests++;
      if (tier === "reflex") inferenceState.reflexRequests++;
    }
  } catch {
    // Graceful degradation: cortex→reflex→OpenWebUI→rule engine
    let recovered = false;
    if (tier === "cortex" && activeBase) {
      try {
        response  = await callOllamaStreaming(prompt, MODEL_CONFIG.FAST, context, onToken, activeBase);
        modelUsed = modelLabel(activeBase, MODEL_CONFIG.FAST);
        usedTier  = "reflex";
        inferenceState.reflexRequests++;
        recovered = true;
      } catch { /* fall through */ }
    }
    if (!recovered && inferenceState.openWebUIAvailable) {
      try {
        response  = await callOpenWebUIStreaming(msgs, model, onToken);
        modelUsed = `openwebui:${model}`;
        usedTier  = tier;
        if (tier === "cortex") inferenceState.cortexRequests++;
        if (tier === "reflex") inferenceState.reflexRequests++;
        recovered = true;
      } catch { /* fall through */ }
    }
    if (!recovered) {
      response  = await streamRuleBasedResponse(prompt, onToken);
      modelUsed = MODEL_CONFIG.RULE_ENGINE;
      usedTier  = "autopilot";
      inferenceState.autopilotRequests++;
    }
  }

  const latencyMs = Date.now() - start;
  return { response, modelUsed, latencyMs, fromCache: false, tier: usedTier };
}

// ── Primary inference entry point ───────────────────────────────────────────
export async function runInference(opts: InferenceOptions): Promise<InferenceResult> {
  const { prompt, mode, task, context = [], useCache = true, latencyBudgetMs, onTierResolved } = opts;
  inferenceState.totalRequests++;

  // Read dynamic model overrides from DB/env
  const dynModels = await getDynamicModels();
  const tier  = resolveGateway(task, mode, latencyBudgetMs);
  const model = tier === "cortex"  ? dynModels.reasoning
              : tier === "reflex"  ? dynModels.fast
              : MODEL_CONFIG.RULE_ENGINE;

  const cacheKey = `${tier}:${prompt}`;
  if (useCache && inferenceState.cache.has(cacheKey)) {
    const cached = inferenceState.cache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < 300_000) {
      inferenceState.cacheHits++;
      return {
        response:  cached.response,
        modelUsed: cached.model,
        latencyMs: 0,
        fromCache: true,
        tier:      cached.tier as Tier,
      };
    }
  }

  // Notify caller which tier/model was resolved — happens before the slow LLM call
  if (onTierResolved) onTierResolved(tier, model);

  const start = Date.now();
  let response = "";
  let modelUsed: string = MODEL_CONFIG.RULE_ENGINE;
  let usedTier: Tier = "autopilot";

  // Priority: Ollama → OpenClaw (Ollama-compatible on :18789) → OpenWebUI → rule engine
  const ollamaBase2   = inferenceState.ollamaAvailable   ? await getOllamaBaseUrl() : null;
  const openClawBase2 = !ollamaBase2 && inferenceState.openclawAvailable ? OPENCLAW_BASE : null;
  const useOpenWebUI2 = !ollamaBase2 && !openClawBase2 && !!inferenceState.openWebUIAvailable;
  const activeBase2   = ollamaBase2 ?? openClawBase2;
  const msgs = buildMessages(prompt, context);

  const modelLabel2 = (base: string, m: string) =>
    base === OPENCLAW_BASE ? `openclaw:${m}` : m;

  try {
    if (tier === "autopilot" || !activeBase2 && !useOpenWebUI2) {
      response  = generateRuleBasedResponse(prompt);
      modelUsed = MODEL_CONFIG.RULE_ENGINE;
      usedTier  = "autopilot";
      inferenceState.autopilotRequests++;
    } else if (activeBase2) {
      response  = await callOllama(prompt, model, context, activeBase2);
      modelUsed = modelLabel2(activeBase2, model);
      usedTier  = tier;
      if (tier === "cortex") inferenceState.cortexRequests++;
      if (tier === "reflex") inferenceState.reflexRequests++;
    } else if (useOpenWebUI2) {
      response  = await callOpenWebUI(msgs, model);
      modelUsed = `openwebui:${model}`;
      usedTier  = tier;
      if (tier === "cortex") inferenceState.cortexRequests++;
      if (tier === "reflex") inferenceState.reflexRequests++;
    }
  } catch {
    // Graceful degradation: cortex→reflex→OpenWebUI→rule engine
    let recovered = false;
    if (tier === "cortex" && activeBase2) {
      try {
        response  = await callOllama(prompt, dynModels.fast, context, activeBase2);
        modelUsed = modelLabel2(activeBase2, dynModels.fast);
        usedTier  = "reflex";
        inferenceState.reflexRequests++;
        recovered = true;
      } catch { /* fall through */ }
    }
    if (!recovered && inferenceState.openWebUIAvailable) {
      try {
        response  = await callOpenWebUI(msgs, model);
        modelUsed = `openwebui:${model}`;
        usedTier  = tier;
        if (tier === "cortex") inferenceState.cortexRequests++;
        if (tier === "reflex") inferenceState.reflexRequests++;
        recovered = true;
      } catch { /* fall through */ }
    }
    if (!recovered) {
      response  = generateRuleBasedResponse(prompt);
      modelUsed = MODEL_CONFIG.RULE_ENGINE;
      usedTier  = "autopilot";
      inferenceState.autopilotRequests++;
    }
  }

  const latencyMs = Date.now() - start;

  if (useCache) {
    inferenceState.cache.set(cacheKey, {
      response,
      model: modelUsed,
      tier: usedTier,
      timestamp: Date.now(),
    });
    if (inferenceState.cache.size > 200) {
      const firstKey = inferenceState.cache.keys().next().value;
      if (firstKey) inferenceState.cache.delete(firstKey);
    }
  }

  return { response, modelUsed, latencyMs, fromCache: false, tier: usedTier };
}

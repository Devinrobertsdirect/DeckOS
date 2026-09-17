/*
 * local-model.ts — always keep a working brain, prefer a free local model.
 *
 * Boot (and a 30s loop) already detect + hook a local Ollama model when one is
 * present. This adds the missing halves:
 *   • getBrainStatus() — a single, clear answer to "can Nobi reach a brain?"
 *     (local model? cloud key? which is active?).
 *   • ensureLocalModel() — if a local runtime (Ollama) is reachable but has NO
 *     model, auto-pull a small default so there's always a local brain, then
 *     re-detect so it's hooked immediately. Idempotent + fire-and-forget.
 *
 * Disable auto-pull with NEURA_AUTO_PULL=0; pick the model with NEURA_LOCAL_MODEL.
 */
import {
  getActiveOllamaBase,
  getInferenceState,
  refreshOllamaDetection,
  getAnthropicApiKey,
  resolveBestModel,
  MODEL_CONFIG,
} from "./inference.js";

/** The active local brain (base URL + best available reasoning model), or null. */
export async function getLocalBrain(): Promise<{ base: string; model: string } | null> {
  const base = await getActiveOllamaBase().catch(() => null);
  if (!base) return null;
  const models = getInferenceState().ollamaModels ?? [];
  if (models.length === 0) return null;
  return { base, model: resolveBestModel("cortex", MODEL_CONFIG.REASONING) };
}

const DEFAULT_LOCAL_MODEL = process.env.NEURA_LOCAL_MODEL || "llama3.2:3b";

let pulling = false;
let pullStatus = "";
let warmed = false;

/**
 * Warm the local model into memory (once) so the FIRST offline chat is fast and
 * actually uses the local LLM instead of timing out into the rule-engine. Uses
 * keep_alive:-1 so Ollama keeps it resident. Disable with NEURA_WARM_MODEL=0.
 */
async function warmLocalModel(base: string, model: string): Promise<void> {
  if (warmed || process.env.NEURA_WARM_MODEL === "0") return;
  warmed = true;
  try {
    await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "hi", stream: false, keep_alive: -1, options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    warmed = false; // let it retry on the next detection tick
  }
}

export function localPullState(): { pulling: boolean; status: string; model: string } {
  return { pulling, status: pullStatus, model: DEFAULT_LOCAL_MODEL };
}

/**
 * Ensure a local model exists when a local runtime is available. If Ollama is
 * reachable but has zero models, pull the default. Safe to call on every boot
 * and on the detection loop — it early-returns when a model is already present
 * (already hooked) or no runtime is found (nothing to install into).
 */
export async function ensureLocalModel(): Promise<void> {
  if (process.env.NEURA_AUTO_PULL === "0") return;
  if (pulling) return;
  const base = await getActiveOllamaBase().catch(() => null);
  if (!base) return; // no local runtime → nothing to auto-install into
  const state = getInferenceState();
  if ((state.ollamaModels?.length ?? 0) > 0) {
    // Already have a model → make sure it's warm so offline chat is instant.
    void warmLocalModel(base, state.ollamaModels[0]!);
    return;
  }

  pulling = true;
  pullStatus = `pulling ${DEFAULT_LOCAL_MODEL}…`;
  try {
    const res = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: DEFAULT_LOCAL_MODEL, stream: true }),
    });
    if (!res.ok || !res.body) {
      pullStatus = `pull failed (HTTP ${res.status})`;
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const line = dec.decode(value, { stream: true }).trim().split("\n").pop();
      if (line) {
        try {
          const j = JSON.parse(line) as { status?: string };
          if (j.status) pullStatus = j.status;
        } catch {
          /* partial line */
        }
      }
    }
    pullStatus = "installed";
    await refreshOllamaDetection().catch(() => {}); // hook it in immediately
    void warmLocalModel(base, DEFAULT_LOCAL_MODEL); // load it so first chat is fast
  } catch (e) {
    pullStatus = `pull error: ${(e as Error).message}`;
  } finally {
    pulling = false;
  }
}

export type BrainStatus = {
  reachable: boolean;
  active: { source: "local" | "cloud"; model: string } | null;
  local: { reachable: boolean; models: string[]; hasModel: boolean };
  cloud: { configured: boolean };
  autoPull: ReturnType<typeof localPullState>;
  message: string;
};

/** One clear answer: can Nobi reach a brain, and which one is active? */
export async function getBrainStatus(): Promise<BrainStatus> {
  const base = await getActiveOllamaBase().catch(() => null);
  const state = getInferenceState();
  const models = state.ollamaModels ?? [];
  const localReachable = !!base;
  const localHasModel = localReachable && models.length > 0;
  const cloudConfigured = !!(await getAnthropicApiKey().catch(() => ""));

  const reachable = localHasModel || cloudConfigured;
  const active: BrainStatus["active"] = localHasModel
    ? { source: "local", model: models[0]! }
    : cloudConfigured
      ? { source: "cloud", model: "claude" }
      : null;

  return {
    reachable,
    active,
    local: { reachable: localReachable, models, hasModel: localHasModel },
    cloud: { configured: cloudConfigured },
    autoPull: localPullState(),
    message: reachable
      ? `Brain online — running ${active?.source === "local" ? `a local model (${active.model})` : "on Claude (cloud)"}.`
      : localReachable
        ? `Local runtime found but no model yet — installing ${DEFAULT_LOCAL_MODEL}.`
        : "No brain reachable. Add an API key, or install Ollama for a free local brain.",
  };
}

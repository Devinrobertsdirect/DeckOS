import { Router } from "express";
import {
  GetAiRouterStatusResponse,
  ListAvailableModelsResponse,
  RouteInferenceBody,
  RouteInferenceResponse,
  GetIntelligenceModeResponse,
  SetIntelligenceModeBody,
  SetIntelligenceModeResponse,
} from "@workspace/api-zod";
import {
  runInference,
  refreshOllamaDetection,
  getInferenceState,
  resolveBestModel,
  MODEL_CONFIG,
} from "../lib/inference.js";
import { bus } from "../lib/bus.js";
import { broadcast } from "../lib/ws-server.js";
import { getConfig } from "../lib/app-config.js";

const router = Router();

type IntelligenceMode = "DIRECT_EXECUTION" | "LIGHT_REASONING" | "DEEP_REASONING" | "HYBRID_MODE";

const routerState: { mode: IntelligenceMode } = {
  mode: "DIRECT_EXECUTION",
};

async function detectCloud(): Promise<boolean> {
  const [oaiDb, anthDb] = await Promise.all([
    getConfig("OPENAI_API_KEY").catch(() => null),
    getConfig("ANTHROPIC_API_KEY").catch(() => null),
  ]);
  return !!(
    oaiDb || process.env.OPENAI_API_KEY ||
    anthDb || process.env.ANTHROPIC_API_KEY
  );
}

// ── Ollama availability broadcast helper ─────────────────────────────────────
function broadcastOllamaStatus() {
  const state = getInferenceState();
  broadcast({
    type: "ai.router.status",
    source: "ai-router",
    payload: {
      ollamaAvailable:   state.ollamaAvailable  ?? false,
      openclawAvailable: state.openclawAvailable ?? false,
      lastDetectedAt:    state.lastDetected.toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
}

// ── Startup detection + periodic polling ─────────────────────────────────────
refreshOllamaDetection()
  .then(broadcastOllamaStatus)
  .catch(() => {
    getInferenceState().ollamaAvailable = false;
  });

setInterval(() => {
  const wasAvailable = getInferenceState().ollamaAvailable;
  refreshOllamaDetection()
    .then(() => {
      const nowAvailable = getInferenceState().ollamaAvailable;
      // Broadcast whenever the availability flips (or always — cheap)
      if (wasAvailable !== nowAvailable) broadcastOllamaStatus();
    })
    .catch(() => {});
}, 15_000);

const MODELS = [
  // ── Cortex / Thinking layer ────────────────────────────────────────────
  // Chat, planning, reasoning, summarization, predictions, briefings
  {
    id:            MODEL_CONFIG.REASONING,
    name:          `${MODEL_CONFIG.REASONING} (Cortex)`,
    type:          "local_ollama",
    contextLength: 8192,
    speed:         "thoughtful",
    tier:          "cortex",
    role:          "Reasoning: chat · planning · summarization · predictions",
    endpoint:      "http://localhost:11434",
  },
  // ── Reflex layer ───────────────────────────────────────────────────────
  // Classification, routing, quick commands, UI interactions
  {
    id:            MODEL_CONFIG.FAST,
    name:          `${MODEL_CONFIG.FAST} (Reflex)`,
    type:          "local_ollama",
    contextLength: 4096,
    speed:         "fast",
    tier:          "reflex",
    role:          "Reflex: classification · routing · commands · quick responses",
    endpoint:      "http://localhost:11434",
  },
  // ── Autopilot layer ────────────────────────────────────────────────────
  // System commands, device polling, deterministic actions, fallback
  {
    id:            "rule-engine-v1",
    name:          "Rule Engine (Autopilot)",
    type:          "rule_engine",
    contextLength: 0,
    speed:         "instant",
    tier:          "autopilot",
    role:          "Autopilot: system · devices · deterministic actions · fallback",
    endpoint:      null,
  },
];

const MODE_DESCRIPTIONS: Record<IntelligenceMode, string> = {
  DIRECT_EXECUTION: "No LLM — run deterministic rule-based logic only",
  LIGHT_REASONING: "Use a small fast local model (phi-3-mini, mistral:instruct)",
  DEEP_REASONING: "Use a larger local or cloud model for complex reasoning",
  HYBRID_MODE: "Combine rule engine with LLM for balanced response",
};

router.get("/ai-router/status", async (req, res) => {
  const cloudAvailable = await detectCloud();
  const state = getInferenceState();

  // Use resolved models (from Ollama discovery) so the UI always shows what's actually in use
  const resolvedCortex = resolveBestModel("cortex", MODEL_CONFIG.REASONING);
  const resolvedReflex  = resolveBestModel("reflex",  MODEL_CONFIG.FAST);
  const activeModel     = state.ollamaAvailable ? resolvedCortex : null;

  const body = GetAiRouterStatusResponse.parse({
    mode: routerState.mode,
    activeModel,
    ollamaAvailable: state.ollamaAvailable ?? false,
    cloudAvailable,
    fallbackMode: !state.ollamaAvailable && !cloudAvailable,
    cacheHitRate: state.totalRequests > 0 ? state.cacheHits / state.totalRequests : 0,
    totalRequests: state.totalRequests,
    lastDetectedAt: state.lastDetected.toISOString(),
  });

  res.json({
    ...body,
    openclawAvailable: state.openclawAvailable ?? false,
    ollamaModels: state.ollamaModels,
    models: {
      cortex:    resolvedCortex,
      reflex:    resolvedReflex,
      autopilot: MODEL_CONFIG.RULE_ENGINE,
    },
    tierStats: {
      cortexRequests:    state.cortexRequests,
      reflexRequests:    state.reflexRequests,
      autopilotRequests: state.autopilotRequests,
    },
  });
});

router.get("/ai-router/models", async (req, res) => {
  const state = getInferenceState();
  const isOllamaUp = state.ollamaAvailable ?? false;
  const models = MODELS.map((m) => ({
    ...m,
    available: m.type === "rule_engine" ? true : m.type === "local_ollama" ? isOllamaUp : false,
  }));
  const body = ListAvailableModelsResponse.parse({ models });
  res.json(body);
});

router.post("/ai-router/infer", async (req, res) => {
  const parsed = RouteInferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { prompt, mode, context = [], useCache = true } = parsed.data;
  const state = getInferenceState();
  const modelSelected = state.ollamaAvailable ? "mistral:instruct" : "rule-engine-v1";

  bus.emit({
    source: "ai-router",
    target: null,
    type: "ai.inference_started",
    payload: {
      prompt: prompt.substring(0, 200),
      mode,
      modelSelected,
    },
  });

  const startMs = Date.now();

  try {
    const result = await runInference({
      prompt,
      mode,
      context: context as Array<{ role: string; content: string }>,
      useCache,
    });

    bus.emit({
      source: "ai-router",
      target: null,
      type: "ai.inference_completed",
      payload: {
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        fromCache: result.fromCache,
      },
    });

    const body = RouteInferenceResponse.parse({
      response: result.response,
      modelUsed: result.modelUsed,
      mode,
      fromCache: result.fromCache,
      latencyMs: result.latencyMs,
      tokens: null,
    });
    res.json(body);
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    bus.emit({
      source: "ai-router",
      target: null,
      type: "ai.inference_completed",
      payload: {
        modelUsed: "unknown",
        latencyMs,
        fromCache: false,
        status: "error",
        error: String(err),
      },
    });
    bus.emit({
      source: "ai-router",
      target: null,
      type: "ai.error",
      payload: { error: String(err), latencyMs },
    });
    req.log.error({ err }, "Inference failed");
    res.status(500).json({ error: "Inference failed" });
  }
});

router.get("/ai-router/mode", (req, res) => {
  const body = GetIntelligenceModeResponse.parse({
    mode: routerState.mode,
    description: MODE_DESCRIPTIONS[routerState.mode],
    preferLocal: true,
  });
  res.json(body);
});

router.put("/ai-router/mode", (req, res) => {
  const parsed = SetIntelligenceModeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const oldMode = routerState.mode;
  routerState.mode = parsed.data.mode as IntelligenceMode;

  bus.emit({
    source: "ai-router",
    target: null,
    type: "ai.model_changed",
    payload: { oldMode, newMode: routerState.mode },
  });

  req.log.info({ mode: routerState.mode }, "Intelligence mode changed");

  const body = SetIntelligenceModeResponse.parse({
    mode: routerState.mode,
    description: MODE_DESCRIPTIONS[routerState.mode],
    preferLocal: true,
  });
  res.json(body);
});

// ── Force-refresh Ollama detection immediately ────────────────────────────────
// Called by the frontend on page load so the server re-probes Ollama without
// waiting for the next 15-second polling tick.
router.post("/ai-router/refresh", async (req, res) => {
  await refreshOllamaDetection().catch(() => {});
  broadcastOllamaStatus();
  const state = getInferenceState();
  const cloudAvailable = await detectCloud();
  res.json({
    ollamaAvailable:   state.ollamaAvailable  ?? false,
    openclawAvailable: state.openclawAvailable ?? false,
    cloudAvailable,
    lastDetectedAt:    state.lastDetected.toISOString(),
  });
});

export default router;

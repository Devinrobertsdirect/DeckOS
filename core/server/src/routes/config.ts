import { Router } from "express";
import { z } from "zod/v4";
import { getConfig, setConfig, deleteConfig, getAllConfig } from "../lib/app-config.js";
import { invalidateConfigCache } from "../lib/app-config.js";
import { detectOllama, detectOpenWebUI, getInferenceState } from "../lib/inference.js";
import { isLocalTtsAvailable } from "../lib/local-tts.js";

const router = Router();

// ── GET /api/features ────────────────────────────────────────────────────────
// Returns which capabilities are available based on configured keys and local
// service availability. Used by the frontend to show/hide cloud feature UI.
router.get("/features", async (_req, res) => {
  const state = getInferenceState();

  const [oaiFromDb, elFromDb, owFromDb] = await Promise.all([
    getConfig("OPENAI_API_KEY").catch(() => null),
    getConfig("ELEVENLABS_API_KEY").catch(() => null),
    getConfig("OPENWEBUI_HOST").catch(() => null),
  ]);

  const hasOpenAi = !!(oaiFromDb ?? process.env["OPENAI_API_KEY"]);
  const hasElevenLabs = !!elFromDb;
  const ttsLocal = isLocalTtsAvailable();
  const ttsProvider = hasElevenLabs ? "elevenlabs" : hasOpenAi ? "openai" : ttsLocal ? "local" : null;

  const ollamaOnline = state.ollamaAvailable ?? (await detectOllama().catch(() => false));
  const owHostConfigured = !!((owFromDb ?? process.env["OPENWEBUI_HOST"] ?? "").trim());
  const owOnline = owHostConfigured ? (state.openWebUIAvailable ?? (await detectOpenWebUI().catch(() => false))) : false;
  const localAiOnline = ollamaOnline || owOnline;

  res.json({
    inference: {
      available: localAiOnline,
      provider: ollamaOnline ? "ollama" : owOnline ? "openwebui" : "rule-engine",
      local: true,
      fallback: "rule-engine",
    },
    tts: {
      available: hasElevenLabs || hasOpenAi || ttsLocal,
      provider: ttsProvider,
      local: ttsLocal,
    },
    stt: {
      available: hasOpenAi,
      provider: hasOpenAi ? "openai-whisper" : null,
      local: false,
    },
    vision: {
      available: hasOpenAi,
      provider: hasOpenAi ? "openai-gpt4v" : null,
      local: false,
    },
    store: {
      available: true,
      provider: process.env["PLUGIN_REGISTRY_URL"] ? "remote" : "local",
      local: !process.env["PLUGIN_REGISTRY_URL"],
    },
  });
});

// ── GET /api/config ────────────────────────────────────────────────────────
router.get("/config", async (_req, res) => {
  const config = await getAllConfig();

  // Merge with env defaults so the UI always shows a value
  const merged: Record<string, string> = {
    OLLAMA_HOST:     process.env["OLLAMA_HOST"]     ?? "http://localhost:11434",
    REASONING_MODEL: process.env["REASONING_MODEL"] ?? "gemma4",
    FAST_MODEL:      process.env["FAST_MODEL"]      ?? "phi3",
    ...config,
  };

  res.json({ config: merged });
});

// ── PUT /api/config ─────────────────────────────────────────────────────────
const UpdateSchema = z.record(z.string(), z.string());

router.put("/config", async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Body must be a flat { key: value } object" });
    return;
  }

  const updates = parsed.data;
  for (const [key, value] of Object.entries(updates)) {
    await setConfig(key, value);
    // Mirror to process.env so live code picks it up without restart
    process.env[key] = value;
    if (key === "OPENAI_API_KEY") {
      process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] = value;
    }
  }

  invalidateConfigCache();
  res.json({ ok: true, updated: Object.keys(updates) });
});

// ── DELETE /api/config/:key ──────────────────────────────────────────────────
router.delete("/config/:key", async (req, res) => {
  const key = req.params.key ?? "";
  if (!key) {
    res.status(400).json({ error: "Key required" });
    return;
  }
  await deleteConfig(key);
  res.json({ ok: true, deleted: key });
});

// ── POST /api/config/test-connection ─────────────────────────────────────────
const TestSchema = z.object({
  url:  z.string().url(),
  type: z.enum(["ollama", "openwebui"]).optional().default("ollama"),
});

router.post("/config/test-connection", async (req, res) => {
  const parsed = TestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Provide { url: '...' }" });
    return;
  }

  const { url, type } = parsed.data;
  const base = url.replace(/\/$/, "");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    if (type === "openwebui") {
      // Open WebUI has an OpenAI-compatible /v1/models endpoint
      const r = await fetch(`${base}/v1/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) {
        res.json({ ok: false, error: `Open WebUI responded with HTTP ${r.status}` });
        return;
      }
      const data = await r.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => m.id);
      res.json({ ok: true, models, count: models.length });
    } else {
      // Ollama native API
      const r = await fetch(`${base}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) {
        res.json({ ok: false, error: `Ollama responded with HTTP ${r.status}` });
        return;
      }
      const data = await r.json() as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m: { name: string }) => m.name);
      res.json({ ok: true, models, count: models.length });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, error: msg });
  }
});

export default router;

import { Plugin } from "@workspace/event-bus";
import type { PluginContext, BusEvent } from "@workspace/event-bus";
import {
  runInference,
  generateRuleBasedResponse,
  refreshOllamaDetection,
  getInferenceState,
} from "../lib/inference.js";

const FRONTEND_MODE_MAP: Record<string, "fast" | "deep" | "none"> = {
  DIRECT_EXECUTION: "none",
  LIGHT_REASONING: "fast",
  DEEP_REASONING: "deep",
  HYBRID_MODE: "fast",
  fast: "fast",
  deep: "deep",
  none: "none",
};

function resolveMode(raw: unknown): "fast" | "deep" | "none" {
  const key = String(raw ?? "DIRECT_EXECUTION");
  return FRONTEND_MODE_MAP[key] ?? "fast";
}

export default class AiChatPlugin extends Plugin {
  readonly id = "ai_chat";
  readonly name = "AI Chat";
  readonly version = "2.1.0";
  readonly description = "Conversational AI interface routed through the AI Router";
  readonly category = "ai";

  private ctx!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.ctx = context;

    await refreshOllamaDetection();

    // NOTE: ai.chat.request is handled exclusively by the bootstrap WS handler
    // (bootstrap.ts) which uses broadcast() for all token/response events.
    // This plugin's execute() method handles direct plugin invocations only.

    context.logger.info("AI Chat plugin initialized");
  }

  async on_event(event: BusEvent): Promise<void> {
    if (event.type !== "ai.chat.request") return;
  }

  async execute(payload: unknown): Promise<unknown> {
    const p = payload as Record<string, unknown> | null;
    const prompt = String(p?.prompt ?? p?.message ?? "");
    const mode = resolveMode(p?.mode);

    if (!prompt) {
      return { response: "No prompt provided.", modelUsed: "rule-engine-v1" };
    }

    const state = getInferenceState();
    if (!state.ollamaAvailable) {
      return {
        response: generateRuleBasedResponse(prompt),
        modelUsed: "rule-engine-v1",
      };
    }

    const result = await runInference({ prompt, mode, task: "chat" });
    return result;
  }

  async shutdown(): Promise<void> {
    this.ctx?.logger.info("AI Chat plugin stopped");
  }
}

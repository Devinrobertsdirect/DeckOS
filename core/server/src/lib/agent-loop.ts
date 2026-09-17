/*
 * agent-loop.ts — the tool-use loop that makes Nobi an operator.
 *
 * Runs the Anthropic Messages API with `tools`: the model may request a tool,
 * we execute it (agent-tools.ts) and feed the result back, repeating until it
 * produces a final answer. Self-contained — the plain callClaude path is
 * untouched, so this can only add capability, never regress existing chat.
 */
import { getAnthropicApiKey } from "./inference.js";
import { getToolRegistry } from "./agent-tools.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

type ContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
};
type Msg = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type ToolLoopResult = { text: string; toolsUsed: string[] };

/** Does this request plausibly benefit from tools? Cheap gate so trivial chats
 *  skip the (slightly heavier) tool path entirely. */
export function mightNeedTools(text: string): boolean {
  return /\b(cpu|memory|ram|system|performance|uptime|device|robot|connected|hardware|search|look up|latest|news|price|today|current|weather|who won|how much)\b/i.test(
    text,
  );
}

export async function runToolLoop(
  system: string,
  userMessages: Array<{ role: "user" | "assistant"; content: string }>,
  model: string,
  maxTokens: number,
  opts?: { maxTurns?: number },
): Promise<ToolLoopResult> {
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) throw new Error("Anthropic API key not configured");
  // Assemble the tool registry ONCE (core capabilities + every installed plugin).
  const registry = await getToolRegistry();
  const maxTurns = Math.max(1, opts?.maxTurns ?? 5);
  const toolsUsed: string[] = [];
  const messages: Msg[] = userMessages.map((m) => ({ role: m.role, content: m.content }));
  let lastText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    // On the final allowed turn, drop tools so the model must produce an answer.
    const offerTools = turn < maxTurns - 1;
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        ...(offerTools ? { tools: registry.defs } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as { content?: ContentBlock[]; stop_reason?: string };
    const content = data.content ?? [];

    const text = content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (text) lastText = text;

    const toolUses = content.filter((b) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { text: lastText || "[No response from Nobi]", toolsUsed };
    }

    // Echo the assistant's tool-use turn, then answer with tool_result blocks.
    messages.push({ role: "assistant", content });
    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      toolsUsed.push(tu.name || "unknown");
      const out = await registry.exec(tu.name || "", tu.input || {});
      results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: lastText || "[Reached tool-use limit]", toolsUsed };
}

/**
 * The SAME tool loop, but over a local Ollama/OpenClaw model (`/api/chat` with
 * OpenAI-style `tools`). This is what lets Nobi wield tools with NO Anthropic —
 * fully local/offline. Reuses the exact same registry. Falls through (throws) if
 * the local model doesn't support tools, so the caller can degrade to plain chat.
 */
export async function runLocalToolLoop(
  system: string,
  userMessages: Array<{ role: "user" | "assistant"; content: string }>,
  model: string,
  base: string,
  opts?: { maxTurns?: number },
): Promise<ToolLoopResult> {
  const registry = await getToolRegistry();
  const tools = registry.defs.map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: d.input_schema },
  }));
  const maxTurns = Math.max(1, opts?.maxTurns ?? 4);
  const toolsUsed: string[] = [];
  // Ollama chat messages (loose shape — assistant carries tool_calls, tool carries results).
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: system },
    ...userMessages.map((m) => ({ role: m.role, content: m.content })),
  ];
  let lastText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const offerTools = turn < maxTurns - 1;
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, ...(offerTools ? { tools } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Ollama chat ${res.status}`);
    const data = (await res.json()) as {
      message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
    };
    const msg = data.message ?? {};
    if (msg.content) lastText = msg.content;
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return { text: lastText || "[No response from Nobi]", toolsUsed };

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const c of calls) {
      const name = c.function?.name ?? "";
      const rawArgs = c.function?.arguments;
      const args: Record<string, unknown> =
        typeof rawArgs === "string"
          ? (() => { try { return JSON.parse(rawArgs); } catch { return {}; } })()
          : (rawArgs as Record<string, unknown>) ?? {};
      toolsUsed.push(name);
      const out = await registry.exec(name, args);
      messages.push({ role: "tool", content: out });
    }
  }
  return { text: lastText || "[Reached tool-use limit]", toolsUsed };
}

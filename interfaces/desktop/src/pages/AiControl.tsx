import { useEffect, useRef, useState, useCallback } from "react";
import { Brain, Zap, Database, Globe, Loader2, Copy, Check, Mic } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useWebSocket, useLatestPayload, useWsEvents } from "@/contexts/WebSocketContext";
import { AIFace, useFaceStyle } from "@/components/AIFace";
import { useAiName } from "@/hooks/useAiName";
import { useUserName } from "@/hooks/useUserName";
import { VoiceMicButton } from "@/components/VoiceMicButton";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";

const GREET_SESSION_KEY = "deckos_ai_greeted";

function getTimeGreeting(): string {
  try {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    if (hour >= 17 && hour < 22) return "Good evening";
    return "Good night";
  } catch {
    return "Hello";
  }
}

const MODES = ["DIRECT_EXECUTION", "LIGHT_REASONING", "DEEP_REASONING", "HYBRID_MODE"] as const;
type Mode = typeof MODES[number];

const MODE_COLORS: Record<Mode, string> = {
  DIRECT_EXECUTION: "text-[#22ff44]",
  LIGHT_REASONING: "text-[#00d4ff]",
  DEEP_REASONING: "text-[#ffaa00]",
  HYBRID_MODE: "text-[#cc44ff]",
};

const MODE_ICONS: Record<Mode, React.ElementType> = {
  DIRECT_EXECUTION: Zap,
  LIGHT_REASONING: Brain,
  DEEP_REASONING: Database,
  HYBRID_MODE: Globe,
};

type RouterStatusPayload = {
  mode?: string;
  ollamaAvailable?: boolean;
  cloudAvailable?: boolean;
  openclawAvailable?: boolean;
  totalRequests?: number;
  cacheHitRate?: number;
  lastDetectedAt?: string;
  timestamp?: string;
  models?: { cortex?: string; reflex?: string; autopilot?: string };
  tierStats?: { cortexRequests?: number; reflexRequests?: number; autopilotRequests?: number };
};

type OpenClawStatus = {
  running: boolean;
  gateway: string;
  model: string;
  port: number;
};

type ChatResponsePayload = {
  model?: string;
  modelUsed?: string;
  mode?: string;
  latencyMs?: number;
  fromCache?: boolean;
  response?: string;
  requestId?: string;
};

type TierStatus = {
  cortex:    string;
  reflex:    string;
  autopilot: string;
  tierStats: { cortexRequests: number; reflexRequests: number; autopilotRequests: number };
  ollamaAvailable: boolean;
};

type LocalMessage = {
  id?: string;
  type: "ai.chat.response";
  source: "browser-ollama";
  timestamp: string;
  payload: ChatResponsePayload;
};

type BrowserOllamaState = {
  available: boolean;
  model: string;
  models: string[];
};

export default function AiControl() {
  const { sendEvent } = useWebSocket();
  const [prompt, setPrompt] = useState("");
  const [currentMode, setCurrentMode] = useState<Mode>("DEEP_REASONING");
  const [sending, setSending] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [tierStatus, setTierStatus] = useState<TierStatus | null>(null);
  const [openclawStatus, setOpenclawStatus] = useState<OpenClawStatus | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [browserOllama, setBrowserOllama] = useState<BrowserOllamaState>({ available: false, model: "", models: [] });
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const processedTokenKeysRef = useRef(new Set<string>());
  const faceStyle = useFaceStyle();
  const aiName = useAiName();
  const userName = useUserName();
  const { speak, playbackState } = useAudioPlayback();

  // ── Browser-side Ollama detection ────────────────────────────────────────
  // The server (Replit cloud) can't reach localhost:11434 on the user's machine.
  // But the browser CAN — so we probe directly and route chat through the browser
  // when Ollama is locally available.
  useEffect(() => {
    const detect = async () => {
      try {
        const res = await fetch("http://localhost:11434/api/tags", {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = await res.json() as { models?: Array<{ name: string }> };
          const models = (data.models ?? []).map((m) => m.name);
          const preferred = models.find(m => /gemma|llama|mistral|phi/i.test(m)) ?? models[0] ?? "";
          setBrowserOllama({ available: true, model: preferred, models });
          // Also notify the server so the status pills update
          fetch(`${import.meta.env.BASE_URL}api/ai-router/refresh`, { method: "POST" }).catch(() => {});
        } else {
          setBrowserOllama({ available: false, model: "", models: [] });
        }
      } catch {
        setBrowserOllama({ available: false, model: "", models: [] });
      }
    };
    void detect();
    const id = setInterval(detect, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Server-side Ollama refresh on mount ──────────────────────────────────
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/ai-router/refresh`, { method: "POST" }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Greeting: fires once per browser session when this page mounts ──────
  useEffect(() => {
    if (sessionStorage.getItem(GREET_SESSION_KEY)) return;
    sessionStorage.setItem(GREET_SESSION_KEY, "1");

    const greet = async () => {
      setGreetingLoading(true);
      try {
        const timeGreeting = getTimeGreeting();
        const nameClause = userName ? `, ${userName}` : "";
        const res = await fetch(`${import.meta.env.BASE_URL}api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Greet the user as they open the app. Start your greeting with "${timeGreeting}${nameClause}." — use exactly that phrase to open. Be brief, warm, and natural — one or two sentences at most. Do not list capabilities or ask what you can help with. Just say hello.`,
            channel: "system",
          }),
        });
        if (!res.ok) return;
        const data = await res.json() as { response?: string };
        const text = data.response?.trim();
        if (!text) return;

        // Try to speak the greeting (silently fails if browser blocks autoplay)
        try {
          const ttsRes = await fetch(`${import.meta.env.BASE_URL}api/vision/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (ttsRes.ok) {
            const { audio, format } = await ttsRes.json() as { audio?: string; format?: string };
            if (audio) await speak(audio, format ?? "mp3").catch(() => {});
          }
        } catch { /* autoplay blocked — text greeting still shows via WS */ }
      } catch { /* network error — silently skip */ } finally {
        setGreetingLoading(false);
      }
    };

    void greet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Voice transcript handler for VoiceMicButton ──────────────────────────
  const handleVoiceTranscript = useCallback(async (transcript: string): Promise<string> => {
    const requestId = `voice-${Date.now()}`;
    setSending(true);
    setPendingRequestId(requestId);
    setStreamingText("");
    processedTokenKeysRef.current.clear();
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: transcript, channel: "voice", mode: currentMode, requestId }),
      });
      const data = await res.json() as { response?: string };
      return data.response ?? "";
    } catch {
      return "";
    } finally {
      setSending(false);
      setPendingRequestId(null);
      setStreamingText("");
    }
  }, [currentMode]);

  useEffect(() => {
    const fetchTiers = () => {
      fetch(`${import.meta.env.BASE_URL}api/ai-router/status`)
        .then(r => r.json())
        .then((data: RouterStatusPayload & { models?: { cortex?: string; reflex?: string; autopilot?: string }; tierStats?: { cortexRequests?: number; reflexRequests?: number; autopilotRequests?: number } }) => {
          if (data.models) {
            setTierStatus({
              cortex:    data.models.cortex    ?? "gemma4",
              reflex:    data.models.reflex    ?? "phi3",
              autopilot: data.models.autopilot ?? "rule-engine-v1",
              tierStats: {
                cortexRequests:    data.tierStats?.cortexRequests    ?? 0,
                reflexRequests:    data.tierStats?.reflexRequests    ?? 0,
                autopilotRequests: data.tierStats?.autopilotRequests ?? 0,
              },
              ollamaAvailable: data.ollamaAvailable ?? false,
            });
          }
        })
        .catch(() => {});
    };
    fetchTiers();
    const id = setInterval(fetchTiers, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const fetchClaw = () => {
      fetch(`${import.meta.env.BASE_URL}api/openclaw/status`)
        .then(r => r.json())
        .then((d: OpenClawStatus) => setOpenclawStatus(d))
        .catch(() => {});
    };
    fetchClaw();
    const id = setInterval(fetchClaw, 15_000);
    return () => clearInterval(id);
  }, []);

  const routerStatus = useLatestPayload<RouterStatusPayload>("ai.router.status");
  const aiEvents = useWsEvents((e) =>
    e.type === "ai.router.status" ||
    e.type === "ai.inference_started" ||
    e.type === "ai.inference_completed" ||
    e.type === "ai.chat.request" ||
    e.type === "ai.chat.response"
  );

  const chatResponses = useWsEvents((e) => e.type === "ai.chat.response");
  const chatTokens = useWsEvents((e) => e.type === "ai.chat.token");

  useEffect(() => {
    const mode = routerStatus?.mode as Mode | undefined;
    if (mode && MODES.includes(mode)) setCurrentMode(mode);
  }, [routerStatus]);

  // ── Auto-switch to DEEP_REASONING when Ollama becomes available ──────────
  const prevOllamaRef = useRef<boolean | null>(null);
  useEffect(() => {
    const available = tierStatus?.ollamaAvailable ?? false;
    if (available && prevOllamaRef.current === false) {
      // Ollama just came online — switch to LLM mode unless user already chose one
      setCurrentMode(m => m === "DIRECT_EXECUTION" ? "DEEP_REASONING" : m);
    }
    prevOllamaRef.current = available;
  }, [tierStatus?.ollamaAvailable]);

  useEffect(() => {
    if (!pendingRequestId) return;
    chatTokens.forEach((evt) => {
      const p = evt.payload as { requestId?: string; token?: string };
      if (p.requestId !== pendingRequestId) return;
      const evtKey = `token:${evt.timestamp}:${evt.id ?? ""}`;
      if (processedTokenKeysRef.current.has(evtKey)) return;
      processedTokenKeysRef.current.add(evtKey);
      setStreamingText((prev) => prev + (p.token ?? ""));
    });
  }, [chatTokens, pendingRequestId]);

  useEffect(() => {
    if (!pendingRequestId) return;
    const matched = chatResponses.some((e) => {
      const p = e.payload as ChatResponsePayload;
      return p.requestId === pendingRequestId;
    });
    if (matched) {
      setSending(false);
      setPendingRequestId(null);
      setStreamingText("");
    }
  }, [chatResponses, pendingRequestId]);

  // ── Browser-direct Ollama streaming chat ────────────────────────────────
  // Streams tokens from localhost:11434 directly in the browser — works even
  // when the server is cloud-hosted and can't reach the user's local Ollama.
  const sendBrowserChat = useCallback(async (promptText: string, requestId: string, model: string) => {
    const start = Date.now();
    try {
      const res = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are JARVIS, a precise and capable AI assistant integrated into DeckOS. Be concise and precise." },
            { role: "user", content: promptText },
          ],
          stream: true,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n").filter((l) => l.trim())) {
          try {
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const token = parsed.message?.content ?? "";
            if (token) {
              fullText += token;
              setStreamingText((prev) => prev + token);
            }
          } catch { }
        }
      }

      const latencyMs = Date.now() - start;
      const msg: LocalMessage = {
        id: requestId,
        type: "ai.chat.response",
        source: "browser-ollama",
        timestamp: new Date().toISOString(),
        payload: { requestId, response: fullText || "[No response from Ollama]", modelUsed: model, latencyMs, fromCache: false, mode: currentMode },
      };
      setLocalMessages((prev) => [...prev, msg]);
    } catch {
      // CORS or connection error — fall back to server WebSocket
      sendEvent({ type: "ai.chat.request", payload: { prompt: promptText, mode: currentMode, requestId } });
      return;
    }
    setSending(false);
    setPendingRequestId(null);
    setStreamingText("");
  }, [currentMode, sendEvent]);

  const handleSetMode = (m: Mode) => {
    setCurrentMode(m);
    sendEvent({ type: "ai.mode.set", payload: { mode: m } });
  };

  const handleInfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || sending) return;
    const requestId = `req-${Date.now()}`;
    const promptText = prompt.trim();
    setSending(true);
    setPendingRequestId(requestId);
    setStreamingText("");
    processedTokenKeysRef.current.clear();
    setPrompt("");

    // Route through browser → local Ollama when available (bypasses cloud server limitation)
    if (browserOllama.available && browserOllama.model && currentMode !== "DIRECT_EXECUTION") {
      void sendBrowserChat(promptText, requestId, browserOllama.model);
    } else {
      sendEvent({ type: "ai.chat.request", payload: { prompt: promptText, mode: currentMode, requestId } });
    }
  };

  const ollamaOk = browserOllama.available || (routerStatus?.ollamaAvailable ?? false);
  const cloudOk = routerStatus?.cloudAvailable ?? false;
  const clawOk = openclawStatus?.running ?? (routerStatus?.openclawAvailable ?? false);

  // Merge WS responses and browser-direct local messages, sorted by time, newest last
  const outputItems = [...chatResponses, ...localMessages]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-20)
    .reverse();

  const ollamaDetail = browserOllama.available
    ? `${browserOllama.model || "local"} · browser`
    : ollamaOk
      ? (tierStatus?.cortex ?? "server")
      : "offline";

  return (
    <div className="flex flex-col h-full">

      {/* ── Top: connection status + mode selector ─────────────────────── */}
      <div className="shrink-0 border-b border-primary/25 bg-card/70 px-4 py-2.5 flex flex-wrap items-center gap-3 font-mono text-xs">
        <ConnPill label="OLLAMA" ok={ollamaOk} detail={ollamaDetail} />
        <ConnPill label="OPENCLAW" ok={clawOk} detail={clawOk ? (openclawStatus?.gateway ?? ":18789") : "offline"} />
        <ConnPill label="CLOUD.API" ok={cloudOk} detail={cloudOk ? "available" : "unavailable"} />
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {MODES.map((m) => {
            const Icon = MODE_ICONS[m];
            const active = currentMode === m;
            return (
              <button
                key={m}
                data-testid={`mode-btn-${m}`}
                onClick={() => handleSetMode(m)}
                title={m}
                className={`flex items-center gap-1.5 px-2.5 py-1 border text-[10px] font-mono tracking-wider transition-all ${
                  active
                    ? `border-primary/70 bg-primary/15 ${MODE_COLORS[m]}`
                    : "border-primary/20 text-primary/50 hover:text-primary/80 hover:border-primary/40"
                }`}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="hidden sm:inline">{m.replace(/_/g, ".")}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AI face + status strip ──────────────────────────────────────── */}
      <div className="shrink-0 border-b border-primary/20 bg-primary/[0.03] px-5 py-2 flex items-center gap-4">
        <AIFace
          style={faceStyle}
          speaking={!!streamingText || playbackState === "speaking"}
          size={faceStyle === "iris" ? 36 : 52}
          color="var(--color-primary)"
        />
        <div className="font-mono flex flex-col gap-0.5">
          <span className="text-primary text-xs uppercase tracking-widest font-bold">
            {streamingText ? "STREAMING RESPONSE" : sending ? "PROCESSING REQUEST" : greetingLoading ? "INITIALIZING" : "STANDING BY"}
          </span>
          <span className="text-primary/60 text-[10px]">// {aiName} · MODE: {currentMode.replace(/_/g, " ")}</span>
        </div>
        {(sending || greetingLoading) && <Loader2 className="w-4 h-4 text-primary/50 animate-spin ml-auto" />}
        {!sending && !greetingLoading && aiEvents.length > 0 && (
          <span className="ml-auto font-mono text-[10px] text-primary/40">{aiEvents.length} EVENTS</span>
        )}
      </div>

      {/* ── AI.CHAT.CONSOLE — fills all remaining height ───────────────── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 font-mono text-sm min-h-0">
        {outputItems.length === 0 && !sending && !greetingLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-px h-12 bg-primary/20" />
            <div className="font-mono text-sm text-primary/70 tracking-widest uppercase">{aiName} STANDING BY</div>
            <div className="font-mono text-base text-primary/80 max-w-sm leading-relaxed">
              Type a message below, or hold the mic button to speak.
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="font-mono text-xs text-primary/50 border border-primary/20 px-3 py-1">TYPE</span>
              <span className="text-primary/35 font-mono text-sm">or</span>
              <span className="font-mono text-xs text-primary/50 border border-primary/20 px-3 py-1 flex items-center gap-1.5">
                <Mic className="w-3 h-3" /> SPEAK
              </span>
            </div>
            <div className="w-px h-12 bg-primary/20" />
          </div>
        )}
        {outputItems.length === 0 && !sending && greetingLoading && (
          <div className="flex items-center gap-3 py-20 justify-center text-primary/60 font-mono text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{aiName} is initializing…</span>
          </div>
        )}
        {outputItems.map((item, i) => {
          const p = item.payload as ChatResponsePayload;
          const isCopied = copiedIdx === i;
          const isEgg = (p.modelUsed ?? p.model ?? "") === "easter-egg-v1";
          return (
            <div
              key={i}
              className={`group/resp border p-4 bg-background/60 space-y-2 transition-all ${
                isEgg ? "border-[#ff3c00]/40 bg-[#ff3c00]/[0.04]" : "border-primary/20"
              }`}
            >
              <div className="flex justify-between items-center text-xs text-primary/60">
                {isEgg ? (
                  <span className="flex items-center gap-1.5 text-[#ff6a00] font-bold tracking-widest text-xs">
                    <Zap className="w-3 h-3" /> CORE.MEMORY // CLASSIFIED
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span>MODEL: {p.modelUsed ?? p.model ?? "---"}</span>
                    {p.latencyMs != null && <span className="text-primary/40">· {p.latencyMs}ms</span>}
                    {p.fromCache && <span className="text-[#ffaa00]">· CACHED</span>}
                  </span>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(p.response ?? "");
                    setCopiedIdx(i);
                    setTimeout(() => setCopiedIdx(null), 1500);
                  }}
                  className="opacity-0 group-hover/resp:opacity-100 transition-opacity text-primary/50 hover:text-primary"
                  title="Copy response"
                >
                  {isCopied
                    ? <span className="flex items-center gap-1 text-[#22ff44] text-xs"><Check className="w-3 h-3" />COPIED</span>
                    : <Copy className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
              <div className={`whitespace-pre-wrap text-sm leading-relaxed ${isEgg ? "text-[#ffa040] italic" : "text-foreground"}`}>
                {p.response ?? "---"}
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="border border-primary/25 p-4 bg-background/60 space-y-2">
            <div className="flex items-center gap-2 text-primary/60 text-xs mb-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>STREAMING…</span>
            </div>
            <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
              {streamingText || <span className="text-primary/40">Waiting for tokens…</span>}
              {streamingText && (
                <span className="inline-block w-[2px] h-[1em] bg-primary align-middle ml-[1px] animate-[blink_1s_step-end_infinite]" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Input bar ──────────────────────────────────────────────────── */}
      <form onSubmit={handleInfer} className="shrink-0 border-t border-primary/30 p-4 flex items-center gap-3 bg-card/70">
        <span className="text-primary font-mono text-base shrink-0 font-bold">&gt;</span>
        <Input
          data-testid="infer-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="font-mono border-none bg-transparent focus-visible:ring-0 text-foreground text-sm px-0 placeholder:text-primary/40"
          placeholder={`Message ${aiName}, or hold mic to speak…`}
        />
        <VoiceMicButton
          onTranscript={handleVoiceTranscript}
          disabled={sending}
          compact
        />
        <button
          type="submit"
          data-testid="infer-submit"
          disabled={sending || !prompt.trim()}
          className="border border-primary/50 px-5 py-2 font-mono text-sm text-primary hover:bg-primary/15 transition-all disabled:opacity-40 shrink-0 tracking-wider"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "SEND"}
        </button>
      </form>
    </div>
  );
}

function ConnPill({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-[#22ff44] animate-pulse" : "bg-[#ff3333]/60"}`} />
      <span className={`font-bold tracking-wider ${ok ? "text-primary" : "text-primary/50"}`}>{label}</span>
      <span className={`text-[10px] ${ok ? "text-primary/60" : "text-primary/35"}`}>{detail}</span>
    </div>
  );
}

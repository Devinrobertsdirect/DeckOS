import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Terminal, Cpu, MemoryStick, HardDrive, Activity, Network, Circle, Radio, Zap, Send, MapPin, Battery, Wifi, Eye, CheckCircle2, AlertTriangle, Power, ChevronRight, X, Newspaper, RefreshCw, Loader2, History, RotateCcw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VoiceMicButton } from "@/components/VoiceMicButton";
import { type LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useWebSocket, useLatestPayload, useWsEvents } from "@/contexts/WebSocketContext";
import { MiniMap } from "@/components/MiniMap";
import { HudCorners } from "@/components/HudCorners";

type MetricsPayload = {
  cpu?: { usage?: number };
  memory?: { percentage?: number };
  disk?: { percentage?: number; total?: number; used?: number; free?: number; path?: string };
  uptime?: number;
};

type AiPayload = {
  mode?: string;
  ollamaAvailable?: boolean;
  cloudAvailable?: boolean;
  cacheHitRate?: number;
  totalRequests?: number;
};

type PluginEntry = {
  id?: string;
  name?: string;
  status?: string;
  enabled?: boolean;
  lastActivity?: string | null;
};

type PluginPayload = {
  plugins?: PluginEntry[];
  count?: number;
};

type DeviceReadingPayload = {
  deviceId?:   string;
  deviceType?: string;
  sensorType?: string;
  values?:     Record<string, unknown>;
  timestamp?:  string;
};

type MobileSensors = {
  gps?:         { lat: number; lon: number; accuracy: number; speed?: number };
  battery?:     { level: number; charging: boolean };
  network?:     { type: string; downlink?: number; effectiveType?: string };
  orientation?: { alpha: number; beta: number; gamma: number };
};

type ConsoleLine = {
  id: number;
  kind: "cmd" | "ok" | "error" | "system";
  text: string;
};

function useFieldSensors() {
  const deviceEvents = useWsEvents((e) => e.type === "device.reading");
  return useMemo(() => {
    let mobile: (DeviceReadingPayload & { values?: MobileSensors }) | null = null;
    let vision: { description?: string; timestamp?: string } | null = null;
    for (let i = deviceEvents.length - 1; i >= 0; i--) {
      const p = deviceEvents[i]!.payload as DeviceReadingPayload | null;
      if (!p) continue;
      if (!mobile && p.deviceType === "mobile_browser") {
        mobile = p as DeviceReadingPayload & { values?: MobileSensors };
      }
      if (!vision && p.deviceType === "camera.vision") {
        const v = p.values as { description?: string } | undefined;
        vision = { description: v?.description, timestamp: p.timestamp };
      }
      if (mobile && vision) break;
    }
    return { mobile, vision };
  }, [deviceEvents]);
}

const CONSOLE_SESSION_KEY    = "deckos.console.history";
const CMD_HISTORY_SESSION_KEY = "deckos.cmd.history"; // legacy sessionStorage key
const CMD_HISTORY_LOCAL_KEY   = "deckos.cmd.history.local";
const CMD_HISTORY_MAX         = 100;

const BOOT_LINES: ConsoleLine[] = [
  { id: 0, kind: "system", text: "> System initialized — SYS.VER.9.4.2" },
  { id: 1, kind: "system", text: "> EventBus online — type a command below" },
];

function loadHistory(): ConsoleLine[] {
  try {
    const raw = sessionStorage.getItem(CONSOLE_SESSION_KEY);
    if (raw) return JSON.parse(raw) as ConsoleLine[];
  } catch {
  }
  return BOOT_LINES;
}

function saveHistory(lines: ConsoleLine[]) {
  try {
    sessionStorage.setItem(CONSOLE_SESSION_KEY, JSON.stringify(lines));
  } catch {
  }
}

function loadCmdHistory(): string[] {
  // Migrate from sessionStorage if present (one-time, best-effort)
  try {
    const legacy = sessionStorage.getItem(CMD_HISTORY_SESSION_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as string[];
      localStorage.setItem(CMD_HISTORY_LOCAL_KEY, JSON.stringify(parsed.slice(-CMD_HISTORY_MAX)));
      sessionStorage.removeItem(CMD_HISTORY_SESSION_KEY);
      return parsed.slice(-CMD_HISTORY_MAX);
    }
  } catch {
    // Malformed legacy data — remove it so we don't retry on next load
    try { sessionStorage.removeItem(CMD_HISTORY_SESSION_KEY); } catch { }
  }
  // Normal load from localStorage
  try {
    const raw = localStorage.getItem(CMD_HISTORY_LOCAL_KEY);
    if (raw) return (JSON.parse(raw) as string[]).slice(-CMD_HISTORY_MAX);
  } catch {
  }
  return [];
}

function saveCmdHistory(history: string[]) {
  try {
    localStorage.setItem(CMD_HISTORY_LOCAL_KEY, JSON.stringify(history.slice(-CMD_HISTORY_MAX)));
  } catch {
  }
}

type BriefingStats = {
  goalsActive: number;
  goalsCompleted: number;
  autonomyActionsTotal: number;
  memoriesStored: number;
  feedbackSignals: number;
  devicesOnline: number;
};

type BriefingData = {
  id: number;
  date: string;
  summary: string;
  stats: BriefingStats;
  modelUsed: string;
  generatedAt: string;
};

type CommandEntry = {
  id: string;
  name: string;
  description: string;
  syntax: string;
  examples?: string[];
};

export default function Dashboard() {
  const { sendEvent, events } = useWebSocket();

  const metrics = useLatestPayload<MetricsPayload>("system.monitor.metrics");
  const aiInferred = useLatestPayload<AiPayload>("ai.router.status");
  const pluginList = useLatestPayload<PluginPayload>("plugin.list.response");

  const cpuAlerted = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type !== "system.resource.alert" && e.type !== "system.resource.clear") continue;
      if ((e.payload as Record<string, unknown>)?.["resource"] !== "cpu") continue;
      return e.type === "system.resource.alert";
    }
    return false;
  }, [events]);

  const memAlerted = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type !== "system.resource.alert" && e.type !== "system.resource.clear") continue;
      if ((e.payload as Record<string, unknown>)?.["resource"] !== "memory") continue;
      return e.type === "system.resource.alert";
    }
    return false;
  }, [events]);
  const { mobile: mobileSnap, vision: cameraSnap } = useFieldSensors();
  const { toast } = useToast();

  const pluginStatusEvents = useWsEvents((e) => e.type === "plugin.status_changed");
  useEffect(() => {
    if (pluginStatusEvents.length > 0) {
      sendEvent({ type: "plugin.list.request", payload: {} });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginStatusEvents.length]);

  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);

  const [lines, setLines] = useState<ConsoleLine[]>(loadHistory);
  const [cmdInput, setCmdInput] = useState("");
  const [busy, setBusy] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(0);

  const [cmdHistory, setCmdHistory] = useState<string[]>(loadCmdHistory);
  const cmdHistoryRef = useRef<string[]>(loadCmdHistory());
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef("");

  const [showHistory, setShowHistory] = useState(false);

  const handleClearHistory = useCallback(() => {
    setCmdHistory([]);
    cmdHistoryRef.current = [];
    historyIndexRef.current = -1;
    savedInputRef.current = "";
    try {
      localStorage.removeItem(CMD_HISTORY_LOCAL_KEY);
    } catch {
    }
    setShowHistory(false);
    toast({ title: "Command history cleared" });
  }, [toast]);

  const [commandList, setCommandList] = useState<CommandEntry[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);

  const suggestions = useMemo<CommandEntry[]>(() => {
    const trimmed = cmdInput.trim().toLowerCase();
    if (!trimmed) return [];
    return commandList.filter(
      (c) => c.name.toLowerCase().startsWith(trimmed) && c.name.toLowerCase() !== trimmed
    );
  }, [cmdInput, commandList]);

  const uniqueHistory = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = cmdHistory.length - 1; i >= 0; i--) {
      const cmd = cmdHistory[i]!;
      if (!seen.has(cmd)) {
        seen.add(cmd);
        result.push(cmd);
      }
    }
    return result;
  }, [cmdHistory]);

  useEffect(() => {
    setSuggestionIndex(-1);
  }, [cmdInput]);

  useEffect(() => {
    if (suggestions.length > 0) {
      setShowHistory(false);
    }
  }, [suggestions.length]);

  useEffect(() => {
    fetch("/api/commands")
      .then((r) => r.json())
      .then((d: { commands?: CommandEntry[] }) => {
        if (Array.isArray(d.commands)) setCommandList(d.commands);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    lineIdRef.current = lines.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLatestBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const r = await fetch("/api/briefings/latest");
      if (r.ok) {
        const d = await r.json() as { briefing: BriefingData | null };
        setBriefing(d.briefing ?? null);
      }
    } catch { /* silent */ }
    finally { setBriefingLoading(false); }
  }, []);

  const generateNow = useCallback(async () => {
    setGeneratingBriefing(true);
    try {
      const r = await fetch("/api/briefings/generate", { method: "POST" });
      if (r.ok) {
        const d = await r.json() as { briefing: BriefingData };
        setBriefing(d.briefing);
      }
    } catch { /* silent */ }
    finally { setGeneratingBriefing(false); }
  }, []);

  useEffect(() => {
    void fetchLatestBriefing();
  }, [fetchLatestBriefing]);

  useEffect(() => {
    sendEvent({ type: "system.monitor.request", payload: {} });
    sendEvent({ type: "plugin.list.request", payload: {} });
  }, [sendEvent]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const activePlugins = pluginList?.plugins?.filter((p) => p.status === "active").length ?? 0;
  const totalPlugins = pluginList?.plugins?.length ?? 0;

  const addLine = useCallback((kind: ConsoleLine["kind"], text: string) => {
    setLines((prev) => {
      const newLine: ConsoleLine = { id: lineIdRef.current++, kind, text };
      const next = [...prev, newLine];
      saveHistory(next);
      return next;
    });
  }, []);

  const runCommand = useCallback(async (cmd: string): Promise<string> => {
    setBusy(true);
    addLine("cmd", `> ${cmd}`);
    let responseText = "";
    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: cmd, mode: "auto" }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        addLine("error", `  ERR [${res.status}] ${errText.substring(0, 120)}`);
      } else {
        const data = await res.json();
        const output: string = data.output ?? "(no output)";
        output.split("\n").forEach((line) => addLine("ok", `  ${line}`));
        if (data.executionTimeMs !== undefined) {
          addLine("system", `  [${data.modeUsed ?? "AUTO"} · ${data.executionTimeMs}ms]`);
        }
        responseText = data.output ?? "";
      }
    } catch (err) {
      addLine("error", `  ERR ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
    return responseText;
  }, [addLine]);

  const handleVoiceTranscript = useCallback(async (transcript: string): Promise<string> => {
    addLine("system", `  [VOICE] "${transcript}"`);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: transcript, channel: "voice" }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { response: string };
    addLine("ok", `  ${data.response}`);
    addLine("system", `  [VOICE.REPLY]`);
    return data.response ?? "";
  }, [addLine]);

  const acceptSuggestion = useCallback((cmd: CommandEntry) => {
    setCmdInput(cmd.name);
    setSuggestionIndex(-1);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const cmd = cmdInput.trim();
      if (!cmd || busy) return;
      setSuggestionIndex(-1);
      setShowHistory(false);
      setCmdInput("");
      historyIndexRef.current = -1;
      savedInputRef.current = "";
      setCmdHistory((prev) => {
        const next = [...prev, cmd].slice(-CMD_HISTORY_MAX);
        cmdHistoryRef.current = next;
        saveCmdHistory(next);
        return next;
      });
      await runCommand(cmd);
    },
    [cmdInput, busy, runCommand]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Tab") {
        if (suggestions.length > 0) {
          e.preventDefault();
          const idx = suggestionIndex < 0 ? 0 : suggestionIndex;
          const chosen = suggestions[idx];
          if (chosen) acceptSuggestion(chosen);
        }
        return;
      }

      if (e.key === "Escape") {
        setSuggestionIndex(-1);
        setShowHistory(false);
        return;
      }

      if (suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (suggestionIndex > 0) {
            setSuggestionIndex((i) => i - 1);
          } else if (suggestionIndex === 0) {
            setSuggestionIndex(-1);
          } else {
            setSuggestionIndex(suggestions.length - 1);
          }
          return;
        }
      }

      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const history = cmdHistoryRef.current;
      if (history.length === 0) return;
      let idx = historyIndexRef.current;
      if (e.key === "ArrowUp") {
        if (idx === -1) {
          savedInputRef.current = cmdInput;
          idx = history.length - 1;
        } else if (idx > 0) {
          idx -= 1;
        }
        historyIndexRef.current = idx;
        setCmdInput(history[idx] ?? "");
      } else {
        if (idx === -1) return;
        if (idx < history.length - 1) {
          idx += 1;
          historyIndexRef.current = idx;
          setCmdInput(history[idx] ?? "");
        } else {
          historyIndexRef.current = -1;
          setCmdInput(savedInputRef.current);
        }
      }
    },
    [cmdInput, suggestions, suggestionIndex, acceptSuggestion]
  );

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <MetricCard
          title="CPU.LOAD"
          value={`${(metrics?.cpu?.usage ?? 0).toFixed(1)}%`}
          icon={Cpu}
          live={!!metrics}
          alert={cpuAlerted}
        />
        <MetricCard
          title="MEM.USAGE"
          value={`${(metrics?.memory?.percentage ?? 0).toFixed(1)}%`}
          icon={MemoryStick}
          live={!!metrics}
          alert={memAlerted}
        />
        <MetricCard
          title="DISK.USAGE"
          value={`${(metrics?.disk?.percentage ?? 0).toFixed(1)}%`}
          icon={HardDrive}
          live={!!metrics}
        />
        <MetricCard
          title="AI.MODE"
          value={aiInferred?.mode ?? "DIRECT_EXEC"}
          icon={Activity}
          highlight
          compact
        />
        <PluginsCard
          plugins={pluginList?.plugins ?? []}
          activePlugins={activePlugins}
          totalPlugins={totalPlugins}
          live={!!pluginList}
        />
      </div>

      <BriefingCard
        briefing={briefing}
        loading={briefingLoading}
        generating={generatingBriefing}
        onGenerate={generateNow}
      />

      <PresenceStrip />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <div className="col-span-2 flex flex-col border border-primary/20 bg-card/40 relative overflow-hidden">
          <HudCorners />
          <div className="border-b border-primary/20 bg-primary/5 p-3 flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" /> MAIN.CONSOLE
            </div>
            <LiveBadge />
          </div>

          <div className="flex-1 p-4 font-mono text-xs space-y-0.5 overflow-y-auto">
            {lines.map((line) => (
              <ConsoleLine key={line.id} kind={line.kind}>
                {line.text}
              </ConsoleLine>
            ))}
            {busy && (
              <ConsoleLine kind="system">
                {"  "}<span className="animate-pulse">▋ processing…</span>
              </ConsoleLine>
            )}
            <div ref={consoleEndRef} />
          </div>

          <div className="relative border-t border-primary/20">
            {showHistory && uniqueHistory.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 z-50 border border-primary/30 bg-[hsl(var(--background))] shadow-[0_0_16px_rgba(0,212,255,0.12)]">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-primary/10 bg-primary/5">
                  <span className="font-mono text-[10px] text-primary/40 uppercase tracking-widest flex items-center gap-1.5">
                    <History className="w-3 h-3" /> CMD.HISTORY
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHistory(false)}
                    className="text-primary/30 hover:text-primary/70 transition-colors"
                    aria-label="Close history"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <ul className="max-h-48 overflow-y-auto">
                  {uniqueHistory.map((cmd, i) => (
                    <li key={`${cmd}-${i}`}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setCmdInput(cmd);
                          setShowHistory(false);
                          historyIndexRef.current = -1;
                        }}
                        className="w-full text-left px-3 py-1.5 font-mono text-xs flex items-center gap-2 text-primary/70 hover:bg-primary/10 hover:text-primary transition-colors group"
                      >
                        <RotateCcw className="w-3 h-3 text-primary/25 group-hover:text-primary/50 shrink-0" />
                        <span className="truncate">{cmd}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="px-3 py-1 border-t border-primary/10 text-[10px] font-mono text-primary/25">
                  {uniqueHistory.length} recent command{uniqueHistory.length !== 1 ? "s" : ""} · click to fill
                </div>
              </div>
            )}
            {suggestions.length > 0 && (
              <ul className="absolute bottom-full left-0 right-0 z-50 border border-primary/30 bg-[hsl(var(--background))] shadow-[0_0_16px_rgba(0,212,255,0.12)] max-h-64 overflow-y-auto">
                {suggestions.map((s, i) => {
                  const active = i === suggestionIndex;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          acceptSuggestion(s);
                        }}
                        onMouseEnter={() => setSuggestionIndex(i)}
                        className={`w-full text-left px-3 py-1.5 font-mono text-xs flex items-center justify-between gap-4 transition-colors ${
                          active
                            ? "bg-primary/15 text-primary"
                            : "text-primary/70 hover:bg-primary/10 hover:text-primary"
                        }`}
                      >
                        <span className="font-semibold">{s.name}</span>
                        <span className="text-primary/35 truncate">{s.description}</span>
                      </button>
                      {active && (s.syntax || (s.examples && s.examples.length > 0)) && (
                        <div className="px-3 pb-2 pt-1 border-t border-primary/10 bg-primary/5 space-y-1">
                          {s.syntax && (
                            <div className="flex items-baseline gap-2">
                              <span className="text-[9px] font-mono text-primary/30 uppercase tracking-widest shrink-0">SYNTAX</span>
                              <span className="text-[11px] font-mono text-primary/80">{s.syntax}</span>
                            </div>
                          )}
                          {s.examples && s.examples.length > 0 && (
                            <div className="flex items-baseline gap-2">
                              <span className="text-[9px] font-mono text-primary/30 uppercase tracking-widest shrink-0">EX</span>
                              <span className="text-[11px] font-mono text-primary/50 truncate">
                                {s.examples.slice(0, 2).join("  ·  ")}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                <li className="px-3 py-1 border-t border-primary/10 text-[10px] font-mono text-primary/25 flex items-center gap-2">
                  <ChevronRight className="w-2.5 h-2.5" />
                  TAB to complete · ↑↓ to navigate · ESC to dismiss
                </li>
              </ul>
            )}
            <form
              onSubmit={handleSubmit}
              className="p-3 flex items-center gap-2"
            >
              <span className="font-mono text-xs text-primary/40 shrink-0">{">"}</span>
              <input
                type="text"
                value={cmdInput}
                onChange={(e) => {
                  setCmdInput(e.target.value);
                  historyIndexRef.current = -1;
                }}
                onKeyDown={handleKeyDown}
                placeholder={busy ? "waiting…" : "type a command (help, status, ping…)"}
                disabled={busy}
                className="flex-1 bg-transparent font-mono text-xs text-primary placeholder-primary/25 outline-none border-none focus:ring-0"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                disabled={busy || uniqueHistory.length === 0}
                className={`transition-colors disabled:opacity-20 ${showHistory ? "text-primary" : "text-primary/40 hover:text-primary"}`}
                aria-label="Toggle command history"
                title="Command history"
              >
                <History className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleClearHistory}
                disabled={busy || cmdHistory.length === 0}
                className="text-primary/40 hover:text-red-400 disabled:opacity-20 transition-colors"
                aria-label="Clear command history"
                title="Clear command history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <VoiceMicButton
                onTranscript={handleVoiceTranscript}
                disabled={busy}
                compact
              />
              <button
                type="submit"
                disabled={busy || !cmdInput.trim()}
                className="text-primary/40 hover:text-primary disabled:opacity-20 transition-colors"
                aria-label="Send command"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-col border border-primary/20 bg-card/40 relative overflow-hidden">
          <HudCorners />
          <div className="border-b border-primary/20 bg-primary/5 p-3 flex items-center justify-between">
            <div className="font-mono text-xs text-primary flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" /> SYS.SUMMARY
            </div>
          </div>
          <div className="p-4 font-mono text-xs space-y-3">
            <SummaryRow label="STATUS" value="OPTIMAL" valueClass="text-[#00ff88]" />
            <SummaryRow label="UPTIME" value="ACTIVE" valueClass="text-primary" />
            <SummaryRow label="PLUGINS" value={`${activePlugins} / ${totalPlugins}`} valueClass="text-primary/80" />
            <SummaryRow label="AI CACHE" value={aiInferred ? `${((aiInferred.cacheHitRate ?? 0) * 100).toFixed(0)}% HIT` : "---"} valueClass="text-primary/70" />
            <SummaryRow label="REQUESTS" value={String(aiInferred?.totalRequests ?? 0)} valueClass="text-primary/70" />
          </div>
          <div className="p-4 border-t border-primary/10 space-y-1.5">
            <div className="font-mono text-xs text-primary/50 uppercase mb-2">INFERENCE</div>
            <StatusDot label="Ollama"      active={aiInferred?.ollamaAvailable ?? false} />
            <StatusDot label="Cloud API"   active={aiInferred?.cloudAvailable  ?? false} />
            <StatusDot label="Rule Engine" active />
          </div>

          {(mobileSnap || cameraSnap) && (
            <div className="border-t border-primary/10 p-4 space-y-3 font-mono text-xs">
              <div className="text-primary/50 uppercase tracking-wider mb-2">FIELD.SENSORS</div>

              {mobileSnap?.values?.gps && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-3 h-3 text-primary/50 mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <div className="text-primary/50 uppercase text-[10px] tracking-wider">GPS</div>
                    <div className="text-primary/70">
                      {mobileSnap.values.gps.lat.toFixed(4)}, {mobileSnap.values.gps.lon.toFixed(4)}
                    </div>
                    <div className="text-primary/30 text-[10px]">±{mobileSnap.values.gps.accuracy}m</div>
                  </div>
                </div>
              )}

              {mobileSnap?.values?.battery && (
                <div className="flex items-center gap-2">
                  <Battery className="w-3 h-3 text-primary/50 shrink-0" />
                  <div>
                    <span className="text-primary/50 uppercase text-[10px] tracking-wider mr-2">BATTERY</span>
                    <span className={
                      mobileSnap.values.battery.level > 0.5 ? "text-[#00ff88]/80" :
                      mobileSnap.values.battery.level > 0.2 ? "text-yellow-400/80" : "text-red-400/80"
                    }>
                      {(mobileSnap.values.battery.level * 100).toFixed(0)}%
                    </span>
                    {mobileSnap.values.battery.charging && (
                      <span className="text-primary/30 ml-2">⚡ charging</span>
                    )}
                  </div>
                </div>
              )}

              {mobileSnap?.values?.network && (
                <div className="flex items-center gap-2">
                  <Wifi className="w-3 h-3 text-primary/50 shrink-0" />
                  <div>
                    <span className="text-primary/50 uppercase text-[10px] tracking-wider mr-2">NET</span>
                    <span className="text-primary/70">
                      {mobileSnap.values.network.effectiveType?.toUpperCase() ?? mobileSnap.values.network.type.toUpperCase()}
                    </span>
                    {mobileSnap.values.network.downlink != null && (
                      <span className="text-primary/30 ml-2">{mobileSnap.values.network.downlink} Mb/s</span>
                    )}
                  </div>
                </div>
              )}

              {cameraSnap?.description && (
                <div className="flex items-start gap-2">
                  <Eye className="w-3 h-3 text-primary/50 mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <div className="text-primary/50 uppercase text-[10px] tracking-wider">VISION</div>
                    <div className="text-primary/60 leading-relaxed">{cameraSnap.description}</div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5 pt-1">
                <Circle className="w-1.5 h-1.5 fill-[#00ff88] text-[#00ff88] animate-pulse" />
                <span className="text-primary/25 text-[10px] uppercase tracking-wider">
                  {mobileSnap ? "MOBILE ONLINE" : "VISION ONLY"}
                </span>
              </div>
            </div>
          )}

          {!mobileSnap && !cameraSnap && (
            <div className="p-4 border-t border-primary/10 font-mono">
              <div className="text-primary/40 text-xs uppercase tracking-wider mb-1">FIELD.SENSORS</div>
              <div className="text-primary/35 text-[10px] leading-relaxed">
                No live sensor feeds. Open DeckOS on your phone to stream location, battery, and network data.
              </div>
            </div>
          )}

          {/* SPATIAL.TRACKER mini-map */}
          <div className="border-t border-primary/10 p-4 space-y-2">
            <div className="hud-glow-hover font-mono text-[10px] text-primary/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> SPATIAL.TRACKER
            </div>
            <MiniMap />
          </div>
        </div>
      </div>
    </div>
  );
}


function LiveBadge() {
  return (
    <div className="flex items-center gap-1 font-mono text-xs text-[#00ff88]">
      <Circle className="w-2 h-2 fill-[#00ff88] animate-pulse" />
      LIVE
    </div>
  );
}

function ConsoleLine({ children, kind }: { children: React.ReactNode; kind: "cmd" | "ok" | "error" | "system" }) {
  const color = {
    cmd: "text-primary",
    ok: "text-[#00ff88]/80",
    error: "text-[#ff3333]/80",
    system: "text-primary/40",
  }[kind];
  return <div className={`hud-glow-hover ${color} whitespace-pre-wrap break-all leading-5`}>{children}</div>;
}

function SummaryRow({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="hud-glow-hover flex items-center justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="hud-glow-hover flex items-center gap-2 font-mono text-xs">
      <Circle className={`w-1.5 h-1.5 fill-current ${active ? "text-[#00ff88]" : "text-primary/35"}`} />
      <span className={active ? "text-primary/70" : "text-primary/40"}>{label}</span>
    </div>
  );
}

const PLUGIN_STATUS_COLOR: Record<string, string> = {
  active: "text-[#00ff88]",
  error: "text-[#ff3333]",
  inactive: "text-primary/30",
  loading: "text-yellow-400",
};

function PluginStatusIcon({ status }: { status?: string }) {
  if (status === "active") return <CheckCircle2 className="w-3 h-3 text-[#00ff88]" />;
  if (status === "error") return <AlertTriangle className="w-3 h-3 text-[#ff3333]" />;
  return <Power className="w-3 h-3 text-primary/30" />;
}

function formatLastChecked(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function PluginsCard({
  plugins, activePlugins, totalPlugins, live,
}: {
  plugins: PluginEntry[];
  activePlugins: number;
  totalPlugins: number;
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { sendEvent } = useWebSocket();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="hud-glow-hover w-full text-left relative border overflow-hidden metric-card-glow border-primary/20 bg-primary/5 hover:border-primary/40 transition-colors"
        aria-expanded={open}
      >
        <HudCorners />
        <div className="p-4 flex flex-col gap-2 h-full min-h-[100px]">
          <div className="flex justify-between items-start">
            <span className="text-xs font-mono text-muted-foreground tracking-wider">PLUGINS.ACT</span>
            <Network className="w-4 h-4 shrink-0 text-primary/60" />
          </div>
          <div className="font-mono font-bold text-3xl text-primary metric-value">
            {activePlugins}/{totalPlugins}
          </div>
          <div className="mt-auto flex items-center gap-1.5">
            {live && <Circle className="w-1.5 h-1.5 fill-[#00ff88] text-[#00ff88] animate-pulse" />}
            <span className="font-mono text-[10px] text-primary/45 uppercase tracking-wider">click for details</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 border border-primary/30 bg-[hsl(var(--background))] shadow-[0_0_20px_rgba(0,212,255,0.15)] min-w-[260px]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-primary/20 bg-primary/5">
            <span className="font-mono text-xs text-primary uppercase tracking-wider">PLUGIN STATUS</span>
            <button onClick={() => setOpen(false)} className="text-primary/40 hover:text-primary transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-primary/10">
            {plugins.length === 0 && (
              <div className="px-3 py-3 font-mono text-xs text-primary/30">No plugins loaded yet</div>
            )}
            {plugins.map((p) => {
              const statusColor = PLUGIN_STATUS_COLOR[p.status ?? "inactive"] ?? "text-primary/30";
              const isEnabled = p.enabled !== false;
              return (
                <div
                  key={p.id ?? p.name}
                  className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-primary/5 transition-colors group"
                >
                  <PluginStatusIcon status={p.status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-primary/80 truncate group-hover:text-primary transition-colors">
                      {p.name ?? p.id ?? "Unknown"}
                    </div>
                    <div className="font-mono text-[10px] text-primary/30">
                      checked {formatLastChecked(p.lastActivity)}
                    </div>
                  </div>
                  <div className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${statusColor}`}>
                    {isEnabled ? (p.status ?? "active").toUpperCase() : "DISABLED"}
                  </div>
                  <button
                    title={isEnabled ? "Disable plugin" : "Enable plugin"}
                    onClick={(e) => {
                      e.stopPropagation();
                      sendEvent({
                        type: "plugin.toggle.request",
                        payload: { pluginId: p.id, enabled: !isEnabled },
                      });
                    }}
                    className={`p-1 border transition-all shrink-0 ${isEnabled ? "border-primary/40 text-primary hover:bg-primary/10" : "border-primary/20 text-primary/30 hover:text-primary/60"}`}
                  >
                    <Power className="w-3 h-3" />
                  </button>
                  <button
                    title="Open in Plugin Manager"
                    onClick={() => {
                      setOpen(false);
                      navigate(`/plugins?selected=${encodeURIComponent(p.id ?? "")}`);
                    }}
                    className="p-0.5 hover:bg-primary/10 transition-colors shrink-0"
                  >
                    <ChevronRight className="w-3 h-3 text-primary/20 group-hover:text-primary/60 transition-colors" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2 border-t border-primary/10 bg-primary/5">
            <button
              onClick={() => { setOpen(false); navigate("/plugins"); }}
              className="font-mono text-[10px] text-primary/40 hover:text-primary transition-colors uppercase tracking-wider w-full text-left"
            >
              View all in Plugin Manager →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  title, value, icon: Icon, highlight = false, live = false, compact = false, alert = false,
}: {
  title: string;
  value: string | number;
  icon: LucideIcon;
  highlight?: boolean;
  live?: boolean;
  compact?: boolean;
  alert?: boolean;
}) {
  const str   = String(value);
  const isLong = str.length > 10;
  const textSize = isLong ? "text-lg leading-tight" : "text-3xl";
  const pct   = (() => {
    const m = str.match(/^([\d.]+)%/);
    return m ? Math.min(100, parseFloat(m[1])) : null;
  })();

  const borderCls = alert     ? "border-red-500/50 bg-red-500/5"
                  : highlight ? "border-yellow-400/40 bg-yellow-400/5"
                  :             "border-primary/20 bg-primary/5";
  const iconCls   = alert     ? "text-red-400 animate-pulse"
                  : highlight ? "text-yellow-400"
                  :             "text-primary/60";
  const valueCls  = alert     ? "text-red-400"
                  : highlight ? "text-yellow-400"
                  :             "text-primary";

  return (
    <div className={`hud-glow-hover relative border overflow-hidden metric-card-glow ${borderCls}`}>
      <HudCorners />
      <div className="p-4 flex flex-col gap-2 h-full min-h-[100px]">
        <div className="flex justify-between items-start">
          <span className="text-xs font-mono text-muted-foreground tracking-wider">{title}</span>
          <div className="flex items-center gap-1">
            {alert && <AlertTriangle className="w-3 h-3 text-red-400 animate-pulse" />}
            <Icon className={`w-4 h-4 shrink-0 ${iconCls}`} />
          </div>
        </div>
        <div className={`font-mono font-bold truncate metric-value ${textSize} ${valueCls}`} title={str}>
          {str}
        </div>
        {pct !== null && (
          <div className="w-full h-0.5 bg-primary/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: pct > 85 ? "rgba(240,80,50,0.8)" : pct > 65 ? "rgba(255,200,32,0.8)" : "rgba(var(--primary-rgb),0.75)",
                boxShadow: `0 0 6px rgba(var(--primary-rgb),0.5)`,
              }}
            />
          </div>
        )}
        <div className="mt-auto flex items-center gap-1.5">
          {alert ? (
            <span className="font-mono text-[10px] text-red-400 tracking-widest">THRESHOLD EXCEEDED</span>
          ) : live ? (
            <Circle className="w-1.5 h-1.5 fill-[#00ff88] text-[#00ff88] animate-pulse" />
          ) : compact ? (
            <span className="font-mono text-xs text-primary/40">ON-DEMAND</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BriefingCard({
  briefing, loading, generating, onGenerate,
}: {
  briefing: BriefingData | null;
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  const stats = briefing?.stats;
  const generatedDate = briefing
    ? new Date(briefing.generatedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : null;

  return (
    <div className="border border-primary/20 bg-card/40 relative overflow-hidden">
      <HudCorners />
      <div className="border-b border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary">
          <Newspaper className="w-3.5 h-3.5" />
          DAILY.BRIEFING
          {generatedDate && (
            <span className="text-primary/30 ml-1">— {generatedDate}</span>
          )}
          {briefing && (
            <span className="text-primary/20 text-[10px] border border-primary/15 px-1.5 py-0.5">
              {briefing.modelUsed.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/briefings" className="font-mono text-[10px] text-primary/30 hover:text-primary transition-colors uppercase tracking-wider">
            ARCHIVE →
          </Link>
          <button
            onClick={onGenerate}
            disabled={generating || loading}
            className="flex items-center gap-1.5 border border-primary/20 bg-primary/5 hover:bg-primary/15 hover:border-primary/40 px-2.5 py-1 font-mono text-[10px] text-primary/60 hover:text-primary transition-all disabled:opacity-30"
          >
            {generating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            GENERATE NOW
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 font-mono text-xs text-primary/30">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            LOADING BRIEFING…
          </div>
        )}
        {generating && (
          <div className="flex items-center gap-2 font-mono text-xs text-primary/40 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            JARVIS IS GENERATING YOUR BRIEFING…
          </div>
        )}
        {!loading && !generating && !briefing && (
          <div className="font-mono text-xs text-primary/45">
            No briefings generated yet. Click GENERATE NOW to create the first one, or wait for 06:00.
          </div>
        )}
        {!loading && !generating && briefing && (
          <div className="space-y-3">
            <p className="font-mono text-xs text-primary/70 leading-relaxed">{briefing.summary}</p>
            {stats && (
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  { label: "GOALS ACTIVE", value: stats.goalsActive },
                  { label: "COMPLETED", value: stats.goalsCompleted },
                  { label: "DEVICES REG.", value: stats.devicesOnline },
                  { label: "ACTIONS", value: stats.autonomyActionsTotal },
                  { label: "MEMORIES", value: stats.memoriesStored },
                  { label: "FEEDBACK", value: stats.feedbackSignals },
                ].map(({ label, value }) => (
                  <div key={label} className="hud-glow-hover border border-primary/20 bg-primary/5 px-2 py-1 font-mono text-[10px] flex items-center gap-1.5">
                    <span className="text-primary/50 uppercase tracking-wider">{label}</span>
                    <span className="text-primary/90 font-bold">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const AVAIL_COLOR: Record<string, string> = { active: "#00ff88", idle: "#ffcc00", passive: "rgba(var(--primary-rgb),0.33)" };

function PresenceStrip() {
  const presenceEvent = useLatestPayload<{ presence?: { availability?: string; activeChannel?: string; minutesSinceLastInteraction?: number } }>("system.heartbeat");

  const presence = presenceEvent?.presence;
  const avColor = presence ? (AVAIL_COLOR[presence.availability ?? ""] ?? "rgba(var(--primary-rgb),0.33)") : "rgba(var(--primary-rgb),0.2)";

  return (
    <div className="hud-glow-hover border border-primary/20 bg-card/30 px-4 py-2.5 flex items-center gap-4 font-mono text-xs">
      <div className="flex items-center gap-2 shrink-0">
        <Radio className="w-3.5 h-3.5 text-primary/60" />
        <span className="text-primary/55 uppercase tracking-wider">COGNITIVE.PULSE</span>
      </div>
      <div className="w-px h-4 bg-primary/10 shrink-0" />
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-primary/45">PRESENCE</span>
        <span className="font-bold uppercase" style={{ color: avColor }}>
          {presence ? presence.availability : "MONITORING"}
        </span>
        {presence && (
          <span className="text-primary/30">
            via {presence.activeChannel} · {(presence.minutesSinceLastInteraction ?? 0) < 1 ? "now" : `${presence.minutesSinceLastInteraction}m ago`}
          </span>
        )}
      </div>
      <div className="w-px h-4 bg-primary/10 shrink-0" />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <Zap className="w-3 h-3 text-primary/45 shrink-0" />
        <span className="text-primary/40">Event stream active — monitoring all channels</span>
      </div>
      <Link href="/commands" className="shrink-0 text-primary/45 hover:text-primary transition-colors uppercase tracking-wider">
        CONSOLE →
      </Link>
    </div>
  );
}

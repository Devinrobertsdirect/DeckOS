import { useState, useEffect, useCallback } from "react";
import { Activity, Radio, Zap, BookOpen, Settings, RefreshCw, X, ChevronRight, Clock } from "lucide-react";

interface Presence {
  availability: "active" | "idle" | "passive";
  activeChannel: string;
  lastInteractionAt: string;
  minutesSinceLastInteraction: number;
}

interface Nudge {
  id: number;
  category: string;
  content: string;
  urgencyScore: number;
  targetGoalId: number | null;
  dismissed: boolean;
  createdAt: string;
}

interface NarrativeThread {
  id: number;
  title: string;
  summary: string;
  status: string;
  relevanceScore: number;
  relatedGoalIds: number[];
  tags: string[];
  lastEngagedAt: string;
}

interface InitiativeConfig {
  enabled: boolean;
  initiativeLevel: number;
  checkInAfterMinutes: number;
  goalDecayThreshold: number;
  maxActiveNudges: number;
}

const AVAILABILITY_COLOR: Record<string, string> = {
  active:  "#00ff88",
  idle:    "#ffcc00",
  passive: "#00c8ff55",
};

const CATEGORY_LABEL: Record<string, string> = {
  goal_decay:       "DECAY",
  deadline:         "DEADLINE",
  check_in:         "CHECK-IN",
  continuation:     "THREAD",
  insight:          "INSIGHT",
  thread_resurfaced:"THREAD",
};

const URGENCY_COLOR = (s: number) =>
  s > 0.8 ? "#ff3333" : s > 0.6 ? "#ffcc00" : s > 0.4 ? "#00c8ff" : "#00c8ff66";

function Bar({ value, max = 1, color = "#00c8ff" }: { value: number; max?: number; color?: string }) {
  return (
    <div className="h-1 bg-primary/10 w-full rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
    </div>
  );
}

function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <span className="inline-block border px-1.5 py-0.5 text-xs font-mono" style={{ borderColor: color ?? "#00c8ff44", color: color ?? "#00c8ff99" }}>
      {label}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CognitivePulse() {
  const [presence, setPresence] = useState<Presence | null>(null);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [threads, setThreads] = useState<{ active: NarrativeThread[]; dormant: NarrativeThread[] }>({ active: [], dormant: [] });
  const [config, setConfig] = useState<InitiativeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [tick, setTick] = useState(0);

  const API = window.location.origin;

  const load = useCallback(async () => {
    try {
      const [pRes, nRes, tRes, cRes] = await Promise.all([
        fetch(`${API}/api/presence`),
        fetch(`${API}/api/presence/nudges`),
        fetch(`${API}/api/presence/threads`),
        fetch(`${API}/api/presence/config`),
      ]);
      if (pRes.ok) {
        const d = await pRes.json();
        setPresence(d.presence);
      }
      if (nRes.ok) setNudges(await nRes.json());
      if (tRes.ok) setThreads(await tRes.json());
      if (cRes.ok) setConfig(await cRes.json());
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (tick > 0) void load(); }, [tick, load]);

  const dismissNudge = async (id: number) => {
    await fetch(`${API}/api/presence/nudges/${id}/dismiss`, { method: "PUT" });
    setNudges(n => n.filter(x => x.id !== id));
  };

  const syncThreads = async () => {
    setSyncing(true);
    await fetch(`${API}/api/presence/threads/sync`, { method: "POST" });
    await load();
    setSyncing(false);
  };

  const touchThread = async (id: number) => {
    await fetch(`${API}/api/presence/threads/${id}/touch`, { method: "PUT" });
    await load();
  };

  const resolveThread = async (id: number) => {
    await fetch(`${API}/api/presence/threads/${id}/resolve`, { method: "PUT" });
    await load();
  };

  const updateConfig = async (patch: Partial<InitiativeConfig>) => {
    const res = await fetch(`${API}/api/presence/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) setConfig(await res.json());
  };

  const toggleInitiative = () => config && updateConfig({ enabled: !config.enabled });

  const avColor = presence ? (AVAILABILITY_COLOR[presence.availability] ?? "#00c8ff44") : "#00c8ff44";

  return (
    <div className="h-full font-mono flex flex-col gap-5">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-primary text-lg tracking-widest uppercase flex items-center gap-2">
            <Radio className="w-5 h-5" /> COG.PULSE
          </h1>
          <p className="text-primary/40 text-xs mt-0.5">Persistent cognitive loop — presence · initiative · narrative</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncThreads} disabled={syncing} className="flex items-center gap-1.5 border border-primary/30 px-3 py-1.5 text-xs text-primary/60 hover:text-primary hover:border-primary/60 transition-colors">
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            SYNC.THREADS
          </button>
          <button onClick={() => setShowConfig(o => !o)} className="flex items-center gap-1.5 border border-primary/30 px-3 py-1.5 text-xs text-primary/60 hover:text-primary hover:border-primary/60 transition-colors">
            <Settings className="w-3 h-3" />
            CONFIG
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-primary/30 tracking-widest animate-pulse">LOADING COGNITIVE STATE...</div>
      ) : (
        <div className="flex-1 grid grid-cols-12 gap-4 auto-rows-min">

          {/* PRESENCE PANEL */}
          <div className="col-span-12 md:col-span-4 border border-primary/20 bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-primary/50 text-xs tracking-widest uppercase flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> PRESENCE
              </span>
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: avColor }} />
            </div>

            {presence ? (
              <div className="space-y-3">
                <div>
                  <div className="text-2xl font-bold tracking-widest" style={{ color: avColor }}>
                    {presence.availability.toUpperCase()}
                  </div>
                  <div className="text-primary/40 text-xs mt-0.5">
                    {presence.minutesSinceLastInteraction < 1
                      ? "Interacted just now"
                      : `${presence.minutesSinceLastInteraction}min since last interaction`}
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-primary/40">CHANNEL</span>
                    <span className="text-primary uppercase">{presence.activeChannel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-primary/40">LAST.SEEN</span>
                    <span className="text-primary">{timeAgo(presence.lastInteractionAt)}</span>
                  </div>
                </div>

                <div>
                  <div className="text-primary/30 text-xs mb-1">AVAILABILITY INDEX</div>
                  <Bar
                    value={presence.availability === "active" ? 1 : presence.availability === "idle" ? 0.5 : 0.15}
                    color={avColor}
                  />
                </div>

                {/* Threshold markers */}
                <div className="border border-primary/10 p-2 space-y-1 text-xs text-primary/40">
                  <div className="flex justify-between">
                    <span>● active</span><span>&lt; 5min</span>
                  </div>
                  <div className="flex justify-between">
                    <span>● idle</span><span>5–20min</span>
                  </div>
                  <div className="flex justify-between">
                    <span>● passive</span><span>&gt; 20min</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-primary/30 text-xs">No presence recorded yet</div>
            )}
          </div>

          {/* INITIATIVE / NUDGES PANEL */}
          <div className="col-span-12 md:col-span-8 border border-primary/20 bg-card/50 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-primary/50 text-xs tracking-widest uppercase flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> INITIATIVE ENGINE
              </span>
              {config && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-primary/40">
                    LVL: {Math.round((config.initiativeLevel ?? 0.5) * 100)}%
                  </span>
                  <button
                    onClick={toggleInitiative}
                    className={`px-2 py-0.5 text-xs border transition-colors ${
                      config.enabled
                        ? "border-[#00ff88]/50 text-[#00ff88]"
                        : "border-primary/20 text-primary/30"
                    }`}
                  >
                    {config.enabled ? "ACTIVE" : "SILENT"}
                  </button>
                </div>
              )}
            </div>

            {nudges.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-primary/20 text-xs gap-1 py-6">
                <Zap className="w-6 h-6 opacity-30" />
                <span>No pending nudges — system monitoring</span>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-64">
                {nudges.map(nudge => (
                  <div
                    key={nudge.id}
                    className="border border-primary/15 p-3 flex items-start gap-3"
                    style={{ borderLeftColor: URGENCY_COLOR(nudge.urgencyScore), borderLeftWidth: 2 }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Pill label={CATEGORY_LABEL[nudge.category] ?? nudge.category} color={URGENCY_COLOR(nudge.urgencyScore)} />
                        <span className="text-primary/30 text-xs">{timeAgo(nudge.createdAt)}</span>
                        <span className="ml-auto text-xs tabular-nums" style={{ color: URGENCY_COLOR(nudge.urgencyScore) }}>
                          {Math.round(nudge.urgencyScore * 100)}%
                        </span>
                      </div>
                      <p className="text-primary/80 text-xs leading-relaxed">{nudge.content}</p>
                    </div>
                    <button onClick={() => dismissNudge(nudge.id)} className="text-primary/30 hover:text-primary/70 transition-colors shrink-0 mt-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* NARRATIVE THREADS — ACTIVE */}
          <div className="col-span-12 border border-primary/20 bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-primary/50 text-xs tracking-widest uppercase flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> NARRATIVE.THREADS
              </span>
              <span className="text-primary/30 text-xs">{threads.active.length} active · {threads.dormant.length} dormant</span>
            </div>

            {threads.active.length === 0 && threads.dormant.length === 0 ? (
              <div className="text-center text-primary/20 text-xs py-8">
                No narrative threads — sync goals to generate threads
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {threads.active.map(thread => (
                  <div key={thread.id} className="border border-primary/20 p-3 relative group">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00ff88] shrink-0 mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-primary text-xs font-bold truncate tracking-wider">{thread.title}</div>
                        <div className="text-primary/40 text-xs">{timeAgo(thread.lastEngagedAt)}</div>
                      </div>
                    </div>
                    <p className="text-primary/60 text-xs leading-relaxed mb-3">{thread.summary}</p>
                    <div className="mb-2">
                      <Bar value={thread.relevanceScore} color="#00c8ff" />
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {thread.tags.slice(0, 3).map(tag => (
                        <Pill key={tag} label={tag} />
                      ))}
                    </div>
                    <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                      <button onClick={() => touchThread(thread.id)} title="Mark as engaged" className="p-1 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/50 transition-colors">
                        <ChevronRight className="w-3 h-3" />
                      </button>
                      <button onClick={() => resolveThread(thread.id)} title="Resolve thread" className="p-1 border border-primary/20 text-primary/40 hover:text-[#00ff88] hover:border-[#00ff88]/50 transition-colors">
                        <Activity className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {threads.dormant.map(thread => (
                  <div key={thread.id} className="border border-primary/10 p-3 opacity-50 relative group">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/30 shrink-0 mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-primary/60 text-xs font-bold truncate tracking-wider">{thread.title}</div>
                        <div className="text-primary/30 text-xs">dormant · {timeAgo(thread.lastEngagedAt)}</div>
                      </div>
                    </div>
                    <p className="text-primary/40 text-xs leading-relaxed mb-2">{thread.summary}</p>
                    <button onClick={() => touchThread(thread.id)} className="text-xs text-primary/30 hover:text-primary transition-colors hidden group-hover:block">
                      RESURFACE →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CONFIG PANEL (collapsible) */}
          {showConfig && config && (
            <div className="col-span-12 border border-primary/20 bg-card/50 p-4">
              <div className="text-primary/50 text-xs tracking-widest uppercase mb-4 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" /> INITIATIVE.CONFIG
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                <ConfigSlider
                  label="Initiative Level"
                  value={config.initiativeLevel}
                  min={0} max={1} step={0.05}
                  display={`${Math.round(config.initiativeLevel * 100)}%`}
                  onChange={v => updateConfig({ initiativeLevel: v })}
                />
                <ConfigSlider
                  label="Decay Threshold"
                  value={config.goalDecayThreshold}
                  min={0.3} max={0.95} step={0.05}
                  display={`${Math.round(config.goalDecayThreshold * 100)}%`}
                  onChange={v => updateConfig({ goalDecayThreshold: v })}
                />
                <ConfigSlider
                  label="Check-in After (min)"
                  value={config.checkInAfterMinutes}
                  min={5} max={120} step={5}
                  display={`${config.checkInAfterMinutes}m`}
                  onChange={v => updateConfig({ checkInAfterMinutes: v })}
                />
                <ConfigSlider
                  label="Max Active Nudges"
                  value={config.maxActiveNudges}
                  min={1} max={20} step={1}
                  display={`${config.maxActiveNudges}`}
                  onChange={v => updateConfig({ maxActiveNudges: v })}
                />

              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

function ConfigSlider({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-primary/50 uppercase tracking-wider">{label}</span>
        <span className="text-primary tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
        onMouseUp={e => onChange(parseFloat((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

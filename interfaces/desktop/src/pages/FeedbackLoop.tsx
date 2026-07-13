import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, TrendingUp, RotateCcw, Loader2, ChevronUp, ChevronDown, Minus, Send, BarChart3 } from "lucide-react";

const API = "/api";
const apiFetch = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

type BehaviorProfile = {
  verbosityLevel: number;
  proactiveFrequency: number;
  toneFormality: number;
  confidenceThreshold: number;
  totalSignals: number;
  learnedPatterns: Record<string, number>;
  updatedAt: string;
  interpretation: { verbosity: string; proactivity: string; tone: string };
};

type Signal = { id: number; signalType: string; weight: number; context: Record<string, unknown>; createdAt: string };

const SIGNAL_TYPES = [
  { type: "response.accepted", label: "Response Accepted", color: "#00ff88", weight: "+1.0" },
  { type: "response.ignored", label: "Response Ignored", color: "#ffaa00", weight: "-0.5" },
  { type: "response.rejected", label: "Response Rejected", color: "#ff3333", weight: "-1.0" },
  { type: "command.repeated", label: "Command Repeated", color: "#00d4ff", weight: "+0.3" },
  { type: "suggestion.acted_on", label: "Suggestion Acted On", color: "#00ff88", weight: "+1.5" },
  { type: "suggestion.dismissed", label: "Suggestion Dismissed", color: "#ff6688", weight: "-0.8" },
  { type: "error.occurred", label: "Error Occurred", color: "#ff3333", weight: "-0.3" },
  { type: "session.long", label: "Long Session", color: "#aa88ff", weight: "+0.2" },
  { type: "session.short", label: "Short Session", color: "#ffaa00", weight: "-0.1" },
];

function GaugeBar({ label, value, max = 100, color = "#00d4ff" }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.round((value / max) * 100);
  const delta = value - 50;
  const Icon = delta > 5 ? ChevronUp : delta < -5 ? ChevronDown : Minus;
  const iconColor = delta > 5 ? "#00ff88" : delta < -5 ? "#ff3333" : "#aaa";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className="text-primary/60 uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-1">
          <Icon className="w-3 h-3" style={{ color: iconColor }} />
          <span style={{ color }}>{value}</span>
        </div>
      </div>
      <div className="h-1.5 bg-primary/10 rounded">
        <div className="h-1.5 rounded transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function FeedbackLoop() {
  const qc = useQueryClient();
  const [selectedSignal, setSelectedSignal] = useState<string>("response.accepted");

  const { data: profile, isLoading: profileLoading } = useQuery<BehaviorProfile>({
    queryKey: ["feedback-profile"],
    queryFn: () => apiFetch("/feedback/profile"),
    refetchInterval: 30_000,
  });

  const { data: signalsData, isLoading: signalsLoading } = useQuery<{ signals: Signal[]; total: number }>({
    queryKey: ["feedback-signals"],
    queryFn: () => apiFetch("/feedback/signals?limit=30"),
    refetchInterval: 30_000,
  });

  const recordSignal = useMutation({
    mutationFn: (signalType: string) => apiFetch("/feedback/signal", {
      method: "POST",
      body: JSON.stringify({ signalType, context: { source: "manual", timestamp: new Date().toISOString() } }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-profile"] });
      qc.invalidateQueries({ queryKey: ["feedback-signals"] });
    },
  });

  const resetProfile = useMutation({
    mutationFn: () => apiFetch("/feedback/profile/reset", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback-profile"] }),
  });

  const signals = signalsData?.signals ?? [];

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
          <Activity className="w-4 h-4 text-primary" />
          <span>FEEDBACK.LOOP // ADAPTIVE BEHAVIOR ENGINE</span>
        </div>
        <button
          onClick={() => resetProfile.mutate()}
          disabled={resetProfile.isPending}
          className="flex items-center gap-1 font-mono text-xs text-[#ff3333]/50 hover:text-[#ff3333] border border-[#ff3333]/20 px-3 py-1.5 transition-all"
        >
          {resetProfile.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          RESET PROFILE
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-4">
          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="font-mono text-xs text-primary/40 uppercase mb-4 flex items-center gap-2">
              <BarChart3 className="w-3 h-3" /> BEHAVIOR PROFILE
              {profile && <span className="ml-auto text-primary/30">{profile.totalSignals} signals</span>}
            </div>

            {profileLoading && <div className="font-mono text-xs text-primary/30">LOADING...</div>}

            {profile && (
              <div className="space-y-4">
                <GaugeBar label="Verbosity" value={profile.verbosityLevel} color="#00d4ff" />
                <GaugeBar label="Proactivity" value={profile.proactiveFrequency} color="#aa88ff" />
                <GaugeBar label="Formality" value={profile.toneFormality} color="#ffaa00" />
                <GaugeBar label="Confidence Threshold" value={profile.confidenceThreshold} color="#00ff88" />

                <div className="border-t border-primary/10 pt-3 space-y-1 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-primary/40">VERBOSITY</span>
                    <span className="text-primary uppercase">{profile.interpretation.verbosity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-primary/40">PROACTIVITY</span>
                    <span className="text-primary uppercase">{profile.interpretation.proactivity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-primary/40">TONE</span>
                    <span className="text-primary uppercase">{profile.interpretation.tone}</span>
                  </div>
                </div>

                <div className="border-t border-primary/10 pt-3">
                  <div className="font-mono text-xs text-primary/40 mb-2">SIGNAL WEIGHTS ACCUMULATED</div>
                  {Object.entries(profile.learnedPatterns as Record<string, number>).map(([k, v]) => (
                    <div key={k} className="flex justify-between font-mono text-xs py-0.5">
                      <span className="text-primary/50">{k}</span>
                      <span className={v >= 0 ? "text-[#00ff88]" : "text-[#ff3333]"}>{v > 0 ? "+" : ""}{v.toFixed(1)}</span>
                    </div>
                  ))}
                  {Object.keys(profile.learnedPatterns).length === 0 && (
                    <div className="text-primary/30">// No signals recorded yet</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="font-mono text-xs text-primary/40 uppercase mb-3 flex items-center gap-2">
              <Send className="w-3 h-3" /> INJECT SIGNAL
            </div>
            <div className="space-y-1 mb-3">
              {SIGNAL_TYPES.map(({ type, label, color, weight }) => (
                <button
                  key={type}
                  onClick={() => setSelectedSignal(type)}
                  className={`w-full flex items-center justify-between px-3 py-2 border font-mono text-xs transition-all ${selectedSignal === type ? "border-primary/60 bg-primary/10" : "border-primary/10 hover:border-primary/30"}`}
                >
                  <span className="text-primary">{label}</span>
                  <span style={{ color }}>{weight}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => recordSignal.mutate(selectedSignal)}
              disabled={recordSignal.isPending}
              className="w-full flex items-center justify-center gap-2 font-mono text-xs border border-primary/40 py-2 text-primary hover:bg-primary/10 disabled:opacity-40 transition-all"
            >
              {recordSignal.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
              RECORD SIGNAL
            </button>
          </div>
        </div>

        <div className="overflow-y-auto">
          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="font-mono text-xs text-primary/40 uppercase mb-3">SIGNAL HISTORY</div>
            {signalsLoading && <div className="font-mono text-xs text-primary/30">LOADING...</div>}
            <div className="space-y-1">
              {signals.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-1.5 border-b border-primary/5 last:border-0">
                  <div>
                    <div className="font-mono text-xs text-primary">{s.signalType}</div>
                    <div className="font-mono text-xs text-primary/30">{new Date(s.createdAt).toLocaleTimeString()}</div>
                  </div>
                  <span className={`font-mono text-xs ${s.weight >= 0 ? "text-[#00ff88]" : "text-[#ff3333]"}`}>
                    {s.weight > 0 ? "+" : ""}{s.weight.toFixed(1)}
                  </span>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="font-mono text-xs text-primary/30 py-4 text-center">
                  // No signals recorded yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

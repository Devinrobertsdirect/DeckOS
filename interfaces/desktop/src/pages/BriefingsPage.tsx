import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Newspaper, RefreshCw, ChevronDown, ChevronRight, Loader2,
  AlertTriangle, Circle, Calendar, Brain, Zap, MemoryStick, Activity, Network
} from "lucide-react";
import { HudCorners } from "@/components/HudCorners";

const API = "/api";

interface BriefingStats {
  goalsActive: number;
  goalsCompleted: number;
  autonomyActionsTotal: number;
  memoriesStored: number;
  feedbackSignals: number;
  devicesOnline: number;
  windowHours: number;
}

interface Briefing {
  id: number;
  date: string;
  summary: string;
  stats: BriefingStats;
  modelUsed: string;
  generatedAt: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour12: false, hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function StatBadge({ label, value, icon: Icon }: {
  label: string;
  value: number | string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-1.5 border border-primary/15 bg-primary/5 px-2 py-1">
      <Icon className="w-3 h-3 text-primary/40 shrink-0" />
      <span className="text-primary/40 font-mono text-[10px] uppercase tracking-wider">{label}</span>
      <span className="text-primary/80 font-mono text-[10px] font-bold ml-auto">{value}</span>
    </div>
  );
}

function BriefingRow({ briefing, isLatest }: { briefing: Briefing; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(isLatest);
  const stats = briefing.stats as BriefingStats;

  return (
    <div className={`border font-mono relative ${isLatest ? "border-primary/40 bg-primary/5" : "border-primary/15 bg-card/30"}`}>
      {isLatest && <HudCorners />}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-primary/5 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isLatest && (
              <span className="text-[10px] border border-primary/40 text-primary/60 px-1.5 py-0.5 uppercase tracking-wider">
                LATEST
              </span>
            )}
            <span className="text-xs text-primary/80 uppercase tracking-wider">{formatDate(briefing.generatedAt)}</span>
            <span className="text-primary/30 text-[10px]">{formatTime(briefing.generatedAt)}</span>
          </div>
          <p className={`text-xs text-primary/60 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
            {briefing.summary}
          </p>
        </div>
        <div className="shrink-0 text-primary/30 mt-1">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-primary/10 px-4 pb-4 pt-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatBadge label="Goals Active"    value={stats?.goalsActive ?? 0}          icon={Activity} />
            <StatBadge label="Completed"       value={stats?.goalsCompleted ?? 0}        icon={Zap} />
            <StatBadge label="Devices Reg."    value={stats?.devicesOnline ?? 0}         icon={Network} />
            <StatBadge label="Actions"         value={stats?.autonomyActionsTotal ?? 0}  icon={Brain} />
            <StatBadge label="Memories"        value={stats?.memoriesStored ?? 0}        icon={MemoryStick} />
            <StatBadge label="Feedback"        value={stats?.feedbackSignals ?? 0}       icon={Circle} />
          </div>
          <div className="flex items-center gap-2 text-primary/25 text-[10px]">
            <span>MODEL: {briefing.modelUsed.toUpperCase()}</span>
            <span>·</span>
            <span>WINDOW: {stats?.windowHours ?? 24}H</span>
            <span>·</span>
            <span>ID: #{briefing.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BriefingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<{ briefings: Briefing[]; count: number }>({
    queryKey: ["briefings"],
    queryFn: () => fetch(`${API}/briefings`).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      fetch(`${API}/briefings/generate`, { method: "POST" }).then((r) => {
        if (!r.ok) throw new Error("Failed to generate briefing");
        return r.json();
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["briefings"] });
      void queryClient.invalidateQueries({ queryKey: ["briefings-latest"] });
    },
  });

  const briefings = data?.briefings ?? [];

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="border border-primary/30 bg-primary/5 p-2">
            <Newspaper className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-bold text-primary uppercase tracking-widest">Daily Briefings</h1>
            <p className="font-mono text-xs text-primary/40">
              AI-generated morning summaries — auto-generated at 06:00
            </p>
          </div>
        </div>

        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="flex items-center gap-2 border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 px-3 py-2 font-mono text-xs text-primary transition-all disabled:opacity-40"
        >
          {generateMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          GENERATE NOW
        </button>
      </div>

      {generateMutation.isError && (
        <div className="border border-[#f03248]/30 bg-[#f03248]/5 p-3 font-mono text-xs text-[#f03248] flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Generation failed. The AI inference engine may be unavailable.
        </div>
      )}

      {generateMutation.isSuccess && (
        <div className="border border-[#11d97a]/30 bg-[#11d97a]/5 p-3 font-mono text-xs text-[#11d97a] flex items-center gap-2">
          <Circle className="w-1.5 h-1.5 fill-current animate-pulse" />
          Briefing generated successfully.
        </div>
      )}

      {isLoading && (
        <div className="flex-1 flex items-center justify-center text-primary/30 font-mono text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          LOADING BRIEFINGS…
        </div>
      )}

      {isError && (
        <div className="border border-[#f03248]/30 bg-[#f03248]/5 p-4 font-mono text-xs text-[#f03248] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Failed to fetch briefings.
        </div>
      )}

      {!isLoading && !isError && briefings.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 border border-primary/10 bg-card/20 p-8">
          <Newspaper className="w-10 h-10 text-primary/15" />
          <div>
            <div className="font-mono text-xs text-primary/40 uppercase tracking-wider mb-1">No briefings yet</div>
            <div className="font-mono text-[11px] text-primary/20">
              The first briefing will generate automatically at 06:00,<br />
              or click Generate Now above to create one immediately.
            </div>
          </div>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="flex items-center gap-2 border border-primary/30 bg-primary/5 hover:bg-primary/10 px-4 py-2 font-mono text-xs text-primary transition-all"
          >
            {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Generate first briefing
          </button>
        </div>
      )}

      {!isLoading && briefings.length > 0 && (
        <div className="flex flex-col gap-3 overflow-y-auto">
          {briefings.map((b, i) => (
            <BriefingRow key={b.id} briefing={b} isLatest={i === 0} />
          ))}

          <div className="flex items-center gap-2 font-mono text-[10px] text-primary/20 px-1">
            <Calendar className="w-3 h-3" />
            <span>{briefings.length} briefing{briefings.length !== 1 ? "s" : ""} total · auto-generated at 06:00 daily</span>
          </div>
        </div>
      )}
    </div>
  );
}

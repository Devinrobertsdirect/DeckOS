import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock, Plus, Trash2, Play, ToggleLeft, ToggleRight,
  ChevronDown, ChevronRight, Loader2, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Calendar, Zap, ListOrdered,
  History, Bell
} from "lucide-react";

const API = "/api";
const apiFetch = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json() as Promise<unknown>;
};

type TriggerType  = "cron" | "event";
type ActionType   = "generate_briefing" | "send_notification" | "refresh_memory" | "query_goals_summary" | "run_health_check" | "emit_bus_event";

type Routine = {
  id: number; name: string; enabled: boolean;
  triggerType: TriggerType; triggerValue: string;
  actionType: ActionType; actionParams: Record<string, unknown>;
  notifyOnComplete: boolean;
  lastRunAt: string | null; nextRunAt: string | null;
  createdAt: string; updatedAt: string;
};

type Execution = {
  id: number; routineId: number; triggeredAt: string;
  outcome: string; result: string | null;
};

type HistoryExecution = Execution & {
  routineName: string;
  actionType: ActionType | null;
};

const ACTION_LABELS: Record<ActionType, string> = {
  generate_briefing:   "Generate AI Briefing",
  send_notification:   "Send Notification",
  refresh_memory:      "Refresh Memory",
  query_goals_summary: "Summarise Goals",
  run_health_check:    "System Health Check",
  emit_bus_event:      "Emit Bus Event",
};

const ACTION_TYPES: ActionType[] = Object.keys(ACTION_LABELS) as ActionType[];

const CRON_PRESETS = [
  { label: "Every minute",      value: "* * * * *"   },
  { label: "Every hour",        value: "0 * * * *"   },
  { label: "Daily at 07:00",    value: "0 7 * * *"   },
  { label: "Daily at midnight", value: "0 0 * * *"   },
  { label: "Every Mon 09:00",   value: "0 9 * * 1"   },
  { label: "Custom…",           value: "__custom__"  },
];

// Internal lifecycle events (routine.triggered, routine.completed) are intentionally
// excluded — subscribing to them as triggers causes infinite execution cascades.
const EVENT_TYPES = [
  "device.connected", "device.disconnected", "device.reading",
  "device.geofence.triggered", "system.boot", "system.shutdown",
  "goal.created", "goal.completed",
  "ai.chat.request", "memory.stored",
];

function CronHint({ expr }: { expr: string }) {
  const preset = CRON_PRESETS.find(p => p.value === expr);
  if (preset && preset.value !== "__custom__") return <span className="text-primary/40 text-xs font-mono">{preset.label}</span>;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return <span className="text-[#f03248]/60 text-xs font-mono">Must be 5 fields: min hr dom mon dow</span>;
  return <span className="text-primary/40 text-xs font-mono">Custom cron expression</span>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

// ── Create/Edit Form ────────────────────────────────────────────────────────
function RoutineForm({ onSave, onCancel, initial }: {
  onSave: (data: Omit<Routine, "id" | "lastRunAt" | "nextRunAt" | "createdAt" | "updatedAt">) => void;
  onCancel: () => void;
  initial?: Partial<Routine>;
}) {
  const [name,         setName]         = useState(initial?.name ?? "");
  const [triggerType,  setTriggerType]  = useState<TriggerType>(initial?.triggerType ?? "cron");
  const [cronPreset,   setCronPreset]   = useState(() => {
    const v = initial?.triggerValue ?? "0 7 * * *";
    return CRON_PRESETS.find(p => p.value === v)?.value ?? "__custom__";
  });
  const [cronCustom,   setCronCustom]   = useState(initial?.triggerValue ?? "0 7 * * *");
  const [eventType,    setEventType]    = useState(initial?.triggerValue ?? "device.disconnected");
  const [actionType,   setActionType]   = useState<ActionType>(initial?.actionType ?? "run_health_check");
  const [paramsJson,       setParamsJson]       = useState(() => JSON.stringify(initial?.actionParams ?? {}, null, 2));
  const [paramsErr,        setParamsErr]        = useState("");
  const [notifyOnComplete, setNotifyOnComplete] = useState(initial?.notifyOnComplete ?? false);

  const triggerValue = triggerType === "cron"
    ? (cronPreset === "__custom__" ? cronCustom : cronPreset)
    : eventType;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let actionParams: Record<string, unknown> = {};
    try { actionParams = JSON.parse(paramsJson) as Record<string, unknown>; setParamsErr(""); }
    catch { setParamsErr("Invalid JSON"); return; }
    onSave({ name, enabled: initial?.enabled ?? true, triggerType, triggerValue, actionType, actionParams, notifyOnComplete });
  }

  const inputCls = "w-full bg-background/50 border border-primary/20 px-3 py-2 font-mono text-sm text-primary focus:outline-none focus:border-primary/60 transition-colors";
  const labelCls = "block font-mono text-xs text-primary/40 uppercase tracking-wider mb-1";

  return (
    <form onSubmit={handleSubmit} className="border border-primary/20 bg-card/60 p-5 space-y-4">
      <div className="font-mono text-xs text-primary/40 uppercase tracking-widest mb-2">
        {initial?.id ? "— EDIT ROUTINE —" : "— NEW ROUTINE —"}
      </div>

      <div>
        <label className={labelCls}>Name</label>
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Daily health check" required />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Trigger Type</label>
          <select className={inputCls} value={triggerType} onChange={e => setTriggerType(e.target.value as TriggerType)}>
            <option value="cron">Cron (time-based)</option>
            <option value="event">Event (bus event)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Action</label>
          <select className={inputCls} value={actionType} onChange={e => setActionType(e.target.value as ActionType)}>
            {ACTION_TYPES.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
        </div>
      </div>

      {triggerType === "cron" ? (
        <div className="space-y-2">
          <label className={labelCls}>Cron Schedule</label>
          <select className={inputCls} value={cronPreset} onChange={e => setCronPreset(e.target.value)}>
            {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {cronPreset === "__custom__" && (
            <input className={inputCls} value={cronCustom} onChange={e => setCronCustom(e.target.value)}
              placeholder="0 7 * * *" spellCheck={false} />
          )}
          <CronHint expr={triggerValue} />
        </div>
      ) : (
        <div>
          <label className={labelCls}>Event Type</label>
          <select className={inputCls} value={eventType} onChange={e => setEventType(e.target.value)}>
            {EVENT_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className={labelCls}>Action Parameters (JSON)</label>
        <textarea
          className={`${inputCls} resize-none h-20 font-mono text-xs`}
          value={paramsJson}
          onChange={e => { setParamsJson(e.target.value); setParamsErr(""); }}
          spellCheck={false}
        />
        {paramsErr && <div className="text-[#f03248] text-xs mt-1 font-mono">{paramsErr}</div>}
        {actionType === "send_notification" && (
          <div className="text-primary/30 text-xs mt-1 font-mono">
            Hint: {`{"title": "Alert", "message": "Something happened"}`}
          </div>
        )}
        {actionType === "emit_bus_event" && (
          <div className="text-primary/30 text-xs mt-1 font-mono">
            Hint: {`{"eventType": "routine.triggered", "payload": {}}`}
          </div>
        )}
      </div>

      <label className="flex items-center gap-3 cursor-pointer select-none group w-fit">
        <div
          onClick={() => setNotifyOnComplete(v => !v)}
          className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${notifyOnComplete ? "bg-primary/60" : "bg-primary/15"}`}
        >
          <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${notifyOnComplete ? "left-4 bg-primary" : "left-0.5 bg-primary/40"}`} />
        </div>
        <span className="font-mono text-xs text-primary/50 group-hover:text-primary/70 transition-colors flex items-center gap-1.5">
          <Bell className="w-3 h-3" /> Notify on completion
        </span>
      </label>

      <div className="flex gap-3 pt-1">
        <button type="submit"
          className="border border-primary/50 px-4 py-2 font-mono text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-all">
          {initial?.id ? "SAVE CHANGES" : "CREATE ROUTINE"}
        </button>
        <button type="button" onClick={onCancel}
          className="border border-primary/20 px-4 py-2 font-mono text-xs text-primary/40 hover:text-primary hover:border-primary/40 transition-all">
          CANCEL
        </button>
      </div>
    </form>
  );
}

// ── Execution Log Drawer ────────────────────────────────────────────────────
function ExecutionLog({ routineId, onClose }: { routineId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["routine-executions", routineId],
    queryFn: () => apiFetch(`/routines/${routineId}/executions`) as Promise<{ executions: Execution[] }>,
    refetchInterval: 10_000,
  });

  return (
    <div className="border border-primary/20 bg-card/60 p-4 mt-2">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-xs text-primary/40 uppercase tracking-widest flex items-center gap-1.5">
          <ListOrdered className="w-3.5 h-3.5" /> Execution Log
        </div>
        <button onClick={onClose} className="font-mono text-xs text-primary/30 hover:text-primary transition-colors">
          [close]
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-primary/30 font-mono text-xs">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : !data?.executions?.length ? (
        <div className="font-mono text-xs text-primary/50">No executions yet.</div>
      ) : (
        <div className="space-y-1 max-h-52 overflow-y-auto">
          {data.executions.map(e => (
            <div key={e.id} className={`flex items-start gap-2 border-l-2 pl-2 py-0.5 ${
              e.outcome === "success" ? "border-[#11d97a]/40" : "border-[#f03248]/40"
            }`}>
              {e.outcome === "success"
                ? <CheckCircle2 className="w-3 h-3 text-[#11d97a] shrink-0 mt-0.5" />
                : <XCircle      className="w-3 h-3 text-[#f03248] shrink-0 mt-0.5" />
              }
              <div>
                <div className="font-mono text-xs text-primary/60">{timeAgo(e.triggeredAt)}</div>
                {e.result && <div className="font-mono text-[11px] text-primary/35 mt-0.5 break-all">{e.result}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Routine Row ─────────────────────────────────────────────────────────────
function RoutineRow({ routine, onToggle, onDelete, onTrigger, onEdit }: {
  routine: Routine;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
  onTrigger: (id: number) => void;
  onEdit: (r: Routine) => void;
}) {
  const [showLog, setShowLog] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border transition-colors ${routine.enabled ? "border-primary/25" : "border-primary/10"}`}>
      <div className="flex items-center gap-3 p-3 bg-card/40">
        {/* Enabled toggle */}
        <button onClick={() => onToggle(routine.id, !routine.enabled)} className="shrink-0">
          {routine.enabled
            ? <ToggleRight className="w-5 h-5 text-[#11d97a]" />
            : <ToggleLeft  className="w-5 h-5 text-primary/25"  />
          }
        </button>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-sm font-semibold truncate ${routine.enabled ? "text-primary" : "text-primary/40"}`}>
              {routine.name}
            </span>
            <span className={`shrink-0 font-mono text-[10px] px-1.5 py-0.5 border ${
              routine.triggerType === "cron"
                ? "border-[#3f84f3]/30 text-[#3f84f3]"
                : "border-[#ffc820]/30 text-[#ffc820]"
            }`}>
              {routine.triggerType === "cron" ? "CRON" : "EVENT"}
            </span>
            {routine.notifyOnComplete && (
              <Bell className="w-3 h-3 shrink-0 text-primary/40" aria-label="Notifies on completion" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="font-mono text-[11px] text-primary/60">{routine.triggerValue}</span>
            <span className="font-mono text-[11px] text-primary/40">→</span>
            <span className="font-mono text-[11px] text-primary/70">{ACTION_LABELS[routine.actionType]}</span>
          </div>
        </div>

        {/* Timing */}
        <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 w-24">
          <div className="font-mono text-[10px] text-primary/60">last: {timeAgo(routine.lastRunAt)}</div>
          <div className="font-mono text-[10px] text-primary/60">
            {routine.triggerType === "cron" ? `next: ${timeUntil(routine.nextRunAt)}` : "—"}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onTrigger(routine.id)}
            title="Run now"
            className="w-7 h-7 flex items-center justify-center border border-[#11d97a]/20 text-[#11d97a]/50 hover:text-[#11d97a] hover:border-[#11d97a]/50 transition-all"
          >
            <Play className="w-3 h-3" />
          </button>
          <button
            onClick={() => setShowLog(l => !l)}
            title="Execution log"
            className={`w-7 h-7 flex items-center justify-center border transition-all ${
              showLog ? "border-primary/50 text-primary bg-primary/10" : "border-primary/20 text-primary/30 hover:text-primary/60"
            }`}
          >
            <ListOrdered className="w-3 h-3" />
          </button>
          <button
            onClick={() => { setExpanded(e => !e); }}
            title="Edit"
            className="w-7 h-7 flex items-center justify-center border border-primary/20 text-primary/30 hover:text-primary/60 transition-all"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onDelete(routine.id)}
            title="Delete"
            className="w-7 h-7 flex items-center justify-center border border-[#f03248]/20 text-[#f03248]/30 hover:text-[#f03248]/70 hover:border-[#f03248]/50 transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-primary/10 p-3">
          <RoutineForm
            initial={routine}
            onSave={(data) => { onEdit({ ...routine, ...data }); setExpanded(false); }}
            onCancel={() => setExpanded(false)}
          />
        </div>
      )}

      {showLog && <ExecutionLog routineId={routine.id} onClose={() => setShowLog(false)} />}
    </div>
  );
}

// ── Unified History View ─────────────────────────────────────────────────────
function HistoryView({ routines }: { routines: Routine[] }) {
  const [filterRoutineId, setFilterRoutineId] = useState<string>("");
  const [filterOutcome,   setFilterOutcome]   = useState<string>("");
  const [filterFrom,      setFilterFrom]      = useState<string>("");
  const [filterTo,        setFilterTo]        = useState<string>("");

  const params = new URLSearchParams();
  if (filterRoutineId) params.set("routineId", filterRoutineId);
  if (filterOutcome)   params.set("outcome",   filterOutcome);
  if (filterFrom)      params.set("from",      filterFrom);
  if (filterTo)        params.set("to",        filterTo);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["history-executions", filterRoutineId, filterOutcome, filterFrom, filterTo],
    queryFn: () => apiFetch(`/routines/executions/all${qs}`) as Promise<{ executions: HistoryExecution[]; total: number }>,
    refetchInterval: 15_000,
  });

  const selectCls = "bg-background/50 border border-primary/20 px-2 py-1.5 font-mono text-xs text-primary focus:outline-none focus:border-primary/50 transition-colors";
  const inputCls  = "bg-background/50 border border-primary/20 px-2 py-1.5 font-mono text-xs text-primary focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="border border-primary/15 bg-card/30 p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-primary/30 uppercase tracking-wider">Routine</span>
          <select className={selectCls} value={filterRoutineId} onChange={e => setFilterRoutineId(e.target.value)}>
            <option value="">All routines</option>
            {routines.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-primary/30 uppercase tracking-wider">Outcome</span>
          <select className={selectCls} value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}>
            <option value="">All outcomes</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-primary/30 uppercase tracking-wider">From</span>
          <input type="date" className={inputCls} value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-primary/30 uppercase tracking-wider">To</span>
          <input type="date" className={inputCls} value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        </div>
        {(filterRoutineId || filterOutcome || filterFrom || filterTo) && (
          <button
            onClick={() => { setFilterRoutineId(""); setFilterOutcome(""); setFilterFrom(""); setFilterTo(""); }}
            className="font-mono text-xs text-primary/30 hover:text-primary transition-colors self-end pb-1.5"
          >
            [clear]
          </button>
        )}
        <button
          onClick={() => void refetch()}
          className="ml-auto self-end border border-primary/20 p-1.5 text-primary/30 hover:text-primary hover:border-primary/50 transition-all"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Results count */}
      {data && (
        <div className="font-mono text-xs text-primary/55 px-0.5">
          {data.total} execution{data.total !== 1 ? "s" : ""} found
          {data.total === 200 ? " (showing latest 200)" : ""}
        </div>
      )}

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-primary/30 p-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
        </div>
      )}
      {error && (
        <div className="border border-[#f03248]/30 bg-[#f03248]/5 p-3 flex items-center gap-2 font-mono text-xs text-[#f03248]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load history — {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data?.executions.length === 0 && (
        <div className="border border-primary/10 p-8 text-center">
          <History className="w-8 h-8 text-primary/10 mx-auto mb-3" />
          <div className="font-mono text-sm text-primary/55">No executions found.</div>
          <div className="font-mono text-xs text-primary/45 mt-1">Trigger a routine or adjust filters.</div>
        </div>
      )}

      {/* Timeline */}
      {data && data.executions.length > 0 && (
        <div className="space-y-1">
          {/* Header row */}
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-center px-3 py-1.5 font-mono text-[10px] text-primary/50 uppercase tracking-wider border-b border-primary/10">
            <span className="w-5" />
            <span>Routine · Action</span>
            <span className="w-20 text-right">Outcome</span>
            <span className="w-24 text-right">When</span>
          </div>
          {data.executions.map(e => (
            <div
              key={e.id}
              className={`grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-start px-3 py-2 border-l-2 transition-colors hover:bg-primary/5 ${
                e.outcome === "success" ? "border-[#11d97a]/40" : "border-[#f03248]/40"
              }`}
            >
              {/* Icon */}
              <div className="w-5 pt-0.5">
                {e.outcome === "success"
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-[#11d97a]" />
                  : <XCircle      className="w-3.5 h-3.5 text-[#f03248]" />
                }
              </div>

              {/* Name + result */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-primary font-semibold truncate">{e.routineName}</span>
                  {e.actionType && (
                    <span className="font-mono text-[10px] text-primary/35 shrink-0">
                      {ACTION_LABELS[e.actionType] ?? e.actionType}
                    </span>
                  )}
                </div>
                {e.result && (
                  <div className="font-mono text-[11px] text-primary/35 mt-0.5 break-all line-clamp-2">{e.result}</div>
                )}
              </div>

              {/* Outcome badge */}
              <div className={`w-20 text-right font-mono text-[10px] font-semibold uppercase tracking-wider pt-0.5 ${
                e.outcome === "success" ? "text-[#11d97a]" : "text-[#f03248]"
              }`}>
                {e.outcome}
              </div>

              {/* Timestamp */}
              <div className="w-24 text-right font-mono text-[10px] text-primary/30 pt-0.5" title={e.triggeredAt}>
                {timeAgo(e.triggeredAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function RoutinesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<"routines" | "history">("routines");

  const { data, isLoading, error } = useQuery({
    queryKey: ["routines"],
    queryFn: () => apiFetch("/routines") as Promise<{ routines: Routine[]; total: number }>,
    refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: (body: unknown) => apiFetch("/routines", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["routines"] }); setShowCreate(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      apiFetch(`/routines/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["routines"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/routines/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["routines"] }),
  });

  const triggerMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/routines/${id}/trigger`, { method: "POST" }),
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ["routines"] }), 1500),
  });

  function handleToggle(id: number, enabled: boolean) {
    updateMut.mutate({ id, enabled });
  }

  function handleEdit(r: Routine) {
    updateMut.mutate({ id: r.id, name: r.name, triggerType: r.triggerType, triggerValue: r.triggerValue, actionType: r.actionType, actionParams: r.actionParams, notifyOnComplete: r.notifyOnComplete });
  }

  const routines = data?.routines ?? [];
  const enabled  = routines.filter(r => r.enabled).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl text-primary font-bold tracking-widest uppercase flex items-center gap-2">
            <Clock className="w-5 h-5" /> ROUTINES
          </h1>
          <p className="font-mono text-xs text-primary/30 mt-1">
            Automated actions triggered by time or event
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border border-primary/20 px-3 py-1.5 font-mono text-xs text-primary/40">
            <span className="text-[#11d97a] font-bold">{enabled}</span> / {routines.length} active
          </div>
          {activeTab === "routines" && (
            <button
              onClick={() => setShowCreate(s => !s)}
              className={`flex items-center gap-2 border px-3 py-2 font-mono text-xs transition-all ${
                showCreate ? "border-primary bg-primary/10 text-primary" : "border-primary/30 text-primary/60 hover:border-primary/60 hover:text-primary"
              }`}
            >
              <Plus className="w-3.5 h-3.5" /> NEW ROUTINE
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-0 border-b border-primary/15">
        <button
          onClick={() => setActiveTab("routines")}
          className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all border-b-2 -mb-px ${
            activeTab === "routines"
              ? "border-primary text-primary"
              : "border-transparent text-primary/35 hover:text-primary/60"
          }`}
        >
          <Clock className="w-3 h-3" /> Routines
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all border-b-2 -mb-px ${
            activeTab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-primary/35 hover:text-primary/60"
          }`}
        >
          <History className="w-3 h-3" /> History
        </button>
      </div>

      {/* History tab content */}
      {activeTab === "history" && <HistoryView routines={routines} />}

      {/* Routines tab content */}
      {activeTab === "routines" && (
        <>
          {/* Status bar */}
          <div className="border border-primary/15 bg-card/30 p-3 flex flex-wrap items-center gap-4 font-mono text-xs text-primary/30">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-[#ffc820]" />
              <span>Runner: <span className="text-[#11d97a]">ONLINE</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              <span>Cron tick: 60s</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              <span>Events: live bus subscriptions</span>
            </div>
          </div>

          {/* Create form */}
          {showCreate && (
            <RoutineForm
              onSave={(data) => createMut.mutate(data)}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {/* Error */}
          {error && (
            <div className="border border-[#f03248]/30 bg-[#f03248]/5 p-3 flex items-center gap-2 font-mono text-xs text-[#f03248]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Failed to load routines — {error instanceof Error ? error.message : "unknown error"}
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center gap-2 font-mono text-xs text-primary/30 p-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading routines…
            </div>
          )}

          {/* Routine list */}
          {!isLoading && routines.length === 0 && (
            <div className="border border-primary/10 p-8 text-center">
              <Clock className="w-8 h-8 text-primary/10 mx-auto mb-3" />
              <div className="font-mono text-sm text-primary/55">No routines configured.</div>
              <div className="font-mono text-xs text-primary/45 mt-1">Create your first routine above.</div>
            </div>
          )}

          {routines.length > 0 && (
            <div className="space-y-2">
              {/* Enabled section */}
              {routines.filter(r => r.enabled).length > 0 && (
                <div>
                  <div className="font-mono text-[10px] text-primary/55 uppercase tracking-widest px-1 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#11d97a] inline-block animate-pulse" />
                    Active
                  </div>
                  <div className="space-y-1.5">
                    {routines.filter(r => r.enabled).map(r => (
                      <RoutineRow
                        key={r.id} routine={r}
                        onToggle={handleToggle}
                        onDelete={(id) => deleteMut.mutate(id)}
                        onTrigger={(id) => triggerMut.mutate(id)}
                        onEdit={handleEdit}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Disabled section */}
              {routines.filter(r => !r.enabled).length > 0 && (
                <div className="mt-4">
                  <div className="font-mono text-[10px] text-primary/45 uppercase tracking-widest px-1 mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/20 inline-block" />
                    Disabled
                  </div>
                  <div className="space-y-1.5">
                    {routines.filter(r => !r.enabled).map(r => (
                      <RoutineRow
                        key={r.id} routine={r}
                        onToggle={handleToggle}
                        onDelete={(id) => deleteMut.mutate(id)}
                        onTrigger={(id) => triggerMut.mutate(id)}
                        onEdit={handleEdit}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

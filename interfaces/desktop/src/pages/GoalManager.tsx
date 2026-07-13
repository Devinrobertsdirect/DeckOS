import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Target, Plus, ChevronDown, ChevronRight, Check, Trash2,
  Clock, Zap, BarChart2, Loader2, AlertTriangle, GitBranch,
  Play, Pause, RefreshCw, FileText
} from "lucide-react";

const API = "/api";
const apiFetch = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
};

type PlanStep = { step: number; action: string; dependencies: number[]; status: "pending" | "in_progress" | "done" | "skipped"; notes?: string };
type Plan = { id: number; goalId: number; steps: PlanStep[]; status: string; confidence: number; riskAssessment: string | null; createdAt: string };
type Goal = {
  id: number; title: string; description: string | null; status: string;
  priority: number; parentGoalId: number | null; completionPct: number;
  decayRatePerHour: number; tags: string[]; dueAt: string | null;
  completedAt: string | null; createdAt: string;
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-[#00ff88]",
  completed: "text-[#00d4ff]",
  paused: "text-[#ffaa00]",
  decayed: "text-[#ff3333]",
};

const STEP_COLOR: Record<string, string> = {
  pending: "text-primary/40",
  in_progress: "text-[#ffaa00]",
  done: "text-[#00ff88]",
  skipped: "text-primary/30",
};

function PriorityBar({ value }: { value: number }) {
  const color = value >= 70 ? "#ff3333" : value >= 40 ? "#ffaa00" : "#00d4ff";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 bg-primary/10 rounded">
        <div className="h-1 rounded transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-xs" style={{ color }}>{value}</span>
    </div>
  );
}

function CompletionBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 bg-primary/10 rounded">
        <div className="h-1.5 rounded transition-all bg-[#00ff88]" style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-xs text-[#00ff88]">{value}%</span>
    </div>
  );
}

function GoalRow({ goal, onSelect, selected }: { goal: Goal; onSelect: () => void; selected: boolean }) {
  return (
    <div
      onClick={onSelect}
      className={`border p-3 cursor-pointer transition-all font-mono text-xs ${selected ? "border-primary bg-primary/10" : "border-primary/20 bg-card/30 hover:border-primary/40"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className="w-3 h-3 text-primary/60" />
          <span className="text-primary font-bold truncate max-w-[200px]">{goal.title}</span>
          {goal.parentGoalId && <GitBranch className="w-3 h-3 text-primary/30" />}
        </div>
        <span className={`uppercase tracking-wider ${STATUS_COLOR[goal.status] ?? "text-primary/40"}`}>{goal.status}</span>
      </div>
      <div className="flex items-center justify-between">
        <CompletionBar value={goal.completionPct} />
        <PriorityBar value={goal.priority} />
      </div>
      {goal.dueAt && (
        <div className="mt-1 text-primary/40 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          DUE: {new Date(goal.dueAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

export default function GoalManager() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");

  const [form, setForm] = useState({ title: "", description: "", priority: 50, dueAt: "", tags: "" });

  const { data: goalsData, isLoading } = useQuery<{ goals: Goal[]; total: number }>({
    queryKey: ["goals", statusFilter],
    queryFn: () => apiFetch(`/goals?status=${statusFilter}`),
    refetchInterval: 30_000,
  });

  const { data: detail } = useQuery<{ goal: Goal; subgoals: Goal[]; plans: Plan[] }>({
    queryKey: ["goal-detail", selected],
    queryFn: () => apiFetch(`/goals/${selected}`),
    enabled: selected !== null,
    refetchInterval: 30_000,
  });

  const createGoal = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/goals", {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        description: data.description || undefined,
        priority: data.priority,
        dueAt: data.dueAt || undefined,
        tags: data.tags ? data.tags.split(",").map((t) => t.trim()) : [],
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goals"] }); setShowCreate(false); setForm({ title: "", description: "", priority: 50, dueAt: "", tags: "" }); },
  });

  const updateGoal = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      apiFetch(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goals"] }); qc.invalidateQueries({ queryKey: ["goal-detail", selected] }); },
  });

  const deleteGoal = useMutation({
    mutationFn: (id: number) => apiFetch(`/goals/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goals"] }); setSelected(null); },
  });

  const generatePlan = useMutation({
    mutationFn: (goalId: number) => apiFetch(`/goals/${goalId}/plan`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goal-detail", selected] }),
  });

  const updateStep = useMutation({
    mutationFn: ({ goalId, planId, stepNum, status }: { goalId: number; planId: number; stepNum: number; status: string }) =>
      apiFetch(`/goals/${goalId}/plan/${planId}/step/${stepNum}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["goal-detail", selected] }); qc.invalidateQueries({ queryKey: ["goals"] }); },
  });

  const goals = goalsData?.goals ?? [];
  const activePlan = detail?.plans?.[0];

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
          <Target className="w-4 h-4 text-primary" />
          <span>GOAL.MANAGER // INTENT + PLANNING ENGINE</span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 font-mono text-xs text-[#00ff88] border border-[#00ff88]/30 px-3 py-1.5 hover:bg-[#00ff88]/10 transition-all"
        >
          <Plus className="w-3 h-3" /> NEW GOAL
        </button>
      </div>

      {showCreate && (
        <div className="border border-primary/30 bg-card/40 p-4 space-y-3">
          <div className="font-mono text-xs text-primary/60 uppercase tracking-widest">CREATE GOAL</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-xs text-primary/40 block mb-1">TITLE *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1.5 focus:outline-none focus:border-primary"
                placeholder="Goal title..." />
            </div>
            <div>
              <label className="font-mono text-xs text-primary/40 block mb-1">DUE DATE</label>
              <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                className="w-full bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1.5 focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="font-mono text-xs text-primary/40 block mb-1">DESCRIPTION</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1.5 focus:outline-none focus:border-primary"
                placeholder="What does success look like?" />
            </div>
            <div>
              <label className="font-mono text-xs text-primary/40 block mb-1">TAGS (comma-separated)</label>
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1.5 focus:outline-none focus:border-primary"
                placeholder="dev, personal, health..." />
            </div>
          </div>
          <div>
            <label className="font-mono text-xs text-primary/40 block mb-1">PRIORITY: {form.priority}</label>
            <input type="range" min={0} max={100} value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) })}
              className="w-full accent-primary" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => createGoal.mutate(form)} disabled={!form.title || createGoal.isPending}
              className="flex items-center gap-1 font-mono text-xs text-[#00ff88] border border-[#00ff88]/40 px-3 py-1.5 hover:bg-[#00ff88]/10 disabled:opacity-40">
              {createGoal.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} CREATE
            </button>
            <button onClick={() => setShowCreate(false)} className="font-mono text-xs text-primary/40 border border-primary/20 px-3 py-1.5 hover:text-primary">
              CANCEL
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1 font-mono text-xs">
        {["active", "completed", "paused", "decayed", ""].map((s) => (
          <button key={s || "all"} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 border transition-all ${statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-primary/20 text-primary/40 hover:text-primary"}`}>
            {s || "ALL"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 flex-1 min-h-0 overflow-hidden">
        <div className="xl:col-span-2 overflow-y-auto space-y-2">
          {isLoading && <div className="font-mono text-xs text-primary/40 p-4">LOADING...</div>}
          {!isLoading && goals.length === 0 && (
            <div className="font-mono text-xs text-primary/30 p-4 border border-primary/10 text-center">
              // NO {statusFilter.toUpperCase() || ""} GOALS — create one to begin
            </div>
          )}
          {goals.map((g) => (
            <GoalRow key={g.id} goal={g} selected={selected === g.id} onSelect={() => setSelected(g.id)} />
          ))}
        </div>

        <div className="xl:col-span-3 overflow-y-auto">
          {!detail && (
            <div className="font-mono text-xs text-primary/30 h-full flex items-center justify-center border border-primary/10">
              ← SELECT A GOAL TO VIEW DETAILS + PLAN
            </div>
          )}

          {detail && (
            <div className="space-y-4">
              <div className="border border-primary/30 bg-card/40 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-mono text-sm text-primary font-bold">{detail.goal.title}</div>
                    {detail.goal.description && <div className="font-mono text-xs text-primary/50 mt-1">{detail.goal.description}</div>}
                  </div>
                  <div className="flex gap-2">
                    {detail.goal.status === "active" && (
                      <button onClick={() => updateGoal.mutate({ id: detail.goal.id, data: { status: "paused" } })}
                        className="font-mono text-xs text-[#ffaa00] border border-[#ffaa00]/30 px-2 py-1 hover:bg-[#ffaa00]/10">
                        <Pause className="w-3 h-3" />
                      </button>
                    )}
                    {detail.goal.status === "paused" && (
                      <button onClick={() => updateGoal.mutate({ id: detail.goal.id, data: { status: "active" } })}
                        className="font-mono text-xs text-[#00ff88] border border-[#00ff88]/30 px-2 py-1 hover:bg-[#00ff88]/10">
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                    {detail.goal.status !== "completed" && (
                      <button onClick={() => updateGoal.mutate({ id: detail.goal.id, data: { status: "completed", completionPct: 100 } })}
                        className="font-mono text-xs text-[#00d4ff] border border-[#00d4ff]/30 px-2 py-1 hover:bg-[#00d4ff]/10">
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={() => deleteGoal.mutate(detail.goal.id)}
                      className="font-mono text-xs text-[#ff3333]/60 border border-[#ff3333]/20 px-2 py-1 hover:bg-[#ff3333]/10">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 font-mono text-xs border-t border-primary/10 pt-3">
                  <div>
                    <div className="text-primary/40 mb-1">COMPLETION</div>
                    <CompletionBar value={detail.goal.completionPct} />
                  </div>
                  <div>
                    <div className="text-primary/40 mb-1">PRIORITY</div>
                    <PriorityBar value={detail.goal.priority} />
                  </div>
                  <div>
                    <div className="text-primary/40 mb-1">STATUS</div>
                    <span className={`uppercase ${STATUS_COLOR[detail.goal.status]}`}>{detail.goal.status}</span>
                  </div>
                </div>

                {detail.goal.tags.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {detail.goal.tags.map((t) => (
                      <span key={t} className="font-mono text-xs border border-primary/20 px-1.5 py-0.5 text-primary/50">{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {detail.subgoals.length > 0 && (
                <div className="border border-primary/20 bg-card/30 p-3">
                  <div className="font-mono text-xs text-primary/40 uppercase mb-2 flex items-center gap-1">
                    <GitBranch className="w-3 h-3" /> SUBGOALS ({detail.subgoals.length})
                  </div>
                  {detail.subgoals.map((sg) => (
                    <div key={sg.id} className="flex items-center justify-between py-1 border-b border-primary/10 last:border-0">
                      <span className="font-mono text-xs text-primary">{sg.title}</span>
                      <CompletionBar value={sg.completionPct} />
                    </div>
                  ))}
                </div>
              )}

              <div className="border border-primary/20 bg-card/30 p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-mono text-xs text-primary/40 uppercase flex items-center gap-1">
                    <FileText className="w-3 h-3" /> EXECUTION PLAN
                  </div>
                  {!activePlan && (
                    <button onClick={() => generatePlan.mutate(detail.goal.id)} disabled={generatePlan.isPending}
                      className="flex items-center gap-1 font-mono text-xs text-[#aa88ff] border border-[#aa88ff]/30 px-2 py-1 hover:bg-[#aa88ff]/10 disabled:opacity-40">
                      {generatePlan.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      GENERATE PLAN
                    </button>
                  )}
                  {activePlan && (
                    <button onClick={() => generatePlan.mutate(detail.goal.id)} disabled={generatePlan.isPending}
                      className="flex items-center gap-1 font-mono text-xs text-primary/40 border border-primary/20 px-2 py-1 hover:text-primary disabled:opacity-40">
                      {generatePlan.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      REVISE
                    </button>
                  )}
                </div>

                {!activePlan && (
                  <div className="font-mono text-xs text-primary/30 py-3 text-center">
                    // NO PLAN — generate one to decompose this goal into steps
                  </div>
                )}

                {activePlan && (
                  <>
                    <div className="flex gap-4 font-mono text-xs mb-3 pb-2 border-b border-primary/10">
                      <div>
                        <span className="text-primary/40">CONFIDENCE: </span>
                        <span className="text-[#aa88ff]">{Math.round(activePlan.confidence * 100)}%</span>
                      </div>
                      <div>
                        <span className="text-primary/40">STATUS: </span>
                        <span className="text-primary uppercase">{activePlan.status}</span>
                      </div>
                    </div>
                    {activePlan.riskAssessment && (
                      <div className="font-mono text-xs text-[#ffaa00]/60 mb-3 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                        {activePlan.riskAssessment}
                      </div>
                    )}
                    <div className="space-y-1">
                      {activePlan.steps.map((step) => (
                        <div key={step.step} className="flex items-center gap-2 group py-1 border-b border-primary/5 last:border-0">
                          <button
                            onClick={() => updateStep.mutate({
                              goalId: detail.goal.id,
                              planId: activePlan.id,
                              stepNum: step.step,
                              status: step.status === "done" ? "pending" : "done",
                            })}
                            className={`w-4 h-4 border flex items-center justify-center shrink-0 transition-all ${step.status === "done" ? "border-[#00ff88] bg-[#00ff88]/20" : "border-primary/30 hover:border-primary"}`}
                          >
                            {step.status === "done" && <Check className="w-2.5 h-2.5 text-[#00ff88]" />}
                          </button>
                          <span className="font-mono text-xs text-primary/30 w-5 shrink-0">{step.step}.</span>
                          <span className={`font-mono text-xs flex-1 ${step.status === "done" ? "line-through text-primary/30" : "text-primary/80"}`}>
                            {step.action}
                          </span>
                          <span className={`font-mono text-xs uppercase shrink-0 ${STEP_COLOR[step.status]}`}>{step.status}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

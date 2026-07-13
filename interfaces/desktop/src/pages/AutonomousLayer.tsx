import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu, Zap, Shield, AlertTriangle, Check, X, Loader2,
  Play, Eye, ToggleLeft, ToggleRight, Clock, ChevronRight
} from "lucide-react";

const API = "/api";
const apiFetch = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

type AutonomyConfig = {
  enabled: boolean;
  safetyLevel: "strict" | "moderate" | "permissive";
  confirmationRequired: boolean;
  allowedActions: string[];
  blockedActions: string[];
  updatedAt: string;
};

type Prediction = {
  id: number;
  prediction: string;
  confidence: number;
  suggestedAction: string | null;
  triggerWindow: string | null;
  basis: Record<string, unknown>;
  status: string;
  createdAt: string;
};

type AutoLog = {
  id: number; action: string; actionType: string;
  parameters: Record<string, unknown>; outcome: string | null;
  reason: string | null; createdAt: string;
};

const SAFETY_COLORS: Record<string, string> = {
  strict: "text-[#00ff88]",
  moderate: "text-[#ffaa00]",
  permissive: "text-[#ff3333]",
};

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? "#00ff88" : value >= 60 ? "#ffaa00" : "#ff6688";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 bg-primary/10 rounded">
        <div className="h-1 rounded" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-xs" style={{ color }}>{value}%</span>
    </div>
  );
}

const LOG_TYPE_COLOR: Record<string, string> = {
  allowed: "text-[#00ff88]",
  blocked: "text-[#ff3333]",
  requires_confirmation: "text-[#ffaa00]",
};

export default function AutonomousLayer() {
  const qc = useQueryClient();
  const [execAction, setExecAction] = useState("fetch_device_status");
  const [execResult, setExecResult] = useState<Record<string, unknown> | null>(null);

  const { data: config, isLoading: configLoading } = useQuery<AutonomyConfig>({
    queryKey: ["autonomy-config"],
    queryFn: () => apiFetch("/autonomy/config"),
    refetchInterval: 15000,
  });

  const { data: predictions, isLoading: predsLoading } = useQuery<{ predictions: Prediction[]; total: number }>({
    queryKey: ["predictions", "pending"],
    queryFn: () => apiFetch("/predictions?status=pending"),
    refetchInterval: 10000,
  });

  const { data: logData, isLoading: logLoading } = useQuery<{ logs: AutoLog[]; total: number }>({
    queryKey: ["autonomy-log"],
    queryFn: () => apiFetch("/autonomy/log?limit=20"),
    refetchInterval: 10000,
  });

  const updateConfig = useMutation({
    mutationFn: (patch: Partial<AutonomyConfig>) => apiFetch("/autonomy/config", { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autonomy-config"] }),
  });

  const generatePredictions = useMutation({
    mutationFn: () => apiFetch("/predictions/generate", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["predictions"] }),
  });

  const resolvePrediction = useMutation({
    mutationFn: ({ id, resolution }: { id: number; resolution: "executed" | "rejected" }) =>
      apiFetch(`/predictions/${id}`, { method: "PATCH", body: JSON.stringify({ resolution }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["predictions"] }),
  });

  const executeAction = useMutation({
    mutationFn: (action: string) => apiFetch("/autonomy/execute", {
      method: "POST",
      body: JSON.stringify({ action, parameters: {}, requestedBy: "user" }),
    }),
    onSuccess: (data) => {
      setExecResult(data as Record<string, unknown>);
      qc.invalidateQueries({ queryKey: ["autonomy-log"] });
    },
  });

  const pendingPredictions = predictions?.predictions ?? [];
  const logs = logData?.logs ?? [];

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
        <Cpu className="w-4 h-4 text-primary" />
        <span>AUTONOMOUS.LAYER // PREDICTION + EXECUTION ENGINE</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 flex-1 min-h-0 overflow-y-auto">

        {/* PREDICTION ENGINE */}
        <div className="xl:col-span-2 space-y-4">
          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-xs text-primary/40 uppercase flex items-center gap-2">
                <Eye className="w-3 h-3" /> PREDICTION ENGINE
                <span className="text-primary/30">({pendingPredictions.length} pending)</span>
              </div>
              <button
                onClick={() => generatePredictions.mutate()}
                disabled={generatePredictions.isPending}
                className="flex items-center gap-1 font-mono text-xs text-[#aa88ff] border border-[#aa88ff]/30 px-3 py-1.5 hover:bg-[#aa88ff]/10 disabled:opacity-40"
              >
                {generatePredictions.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                ANALYZE + PREDICT
              </button>
            </div>

            {predsLoading && <div className="font-mono text-xs text-primary/30">LOADING...</div>}

            {pendingPredictions.length === 0 && !predsLoading && (
              <div className="font-mono text-xs text-primary/30 py-6 text-center border border-primary/10">
                // No pending predictions — run analysis to generate
              </div>
            )}

            <div className="space-y-2">
              {pendingPredictions.map((p) => (
                <div key={p.id} className="border border-primary/20 bg-background/30 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="font-mono text-xs text-primary/90">{p.prediction}</div>
                      {p.suggestedAction && (
                        <div className="font-mono text-xs text-[#aa88ff]/70 mt-1 flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" />{p.suggestedAction}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => resolvePrediction.mutate({ id: p.id, resolution: "executed" })}
                        className="border border-[#00ff88]/30 p-1 hover:bg-[#00ff88]/10 text-[#00ff88]"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => resolvePrediction.mutate({ id: p.id, resolution: "rejected" })}
                        className="border border-[#ff3333]/30 p-1 hover:bg-[#ff3333]/10 text-[#ff3333]/60"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <ConfidenceBar value={p.confidence} />
                    {p.triggerWindow && (
                      <div className="flex items-center gap-1 font-mono text-xs text-primary/40">
                        <Clock className="w-3 h-3" />{p.triggerWindow}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* EXECUTION LOG */}
          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="font-mono text-xs text-primary/40 uppercase mb-3">AUTONOMY EXECUTION LOG</div>
            {logLoading && <div className="font-mono text-xs text-primary/30">LOADING...</div>}
            <div className="space-y-1">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-1.5 border-b border-primary/5 last:border-0 font-mono text-xs">
                  <div className="flex-1">
                    <div className="text-primary">{l.action}</div>
                    {l.reason && <div className="text-primary/30 truncate max-w-xs">{l.reason}</div>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`uppercase ${LOG_TYPE_COLOR[l.actionType] ?? "text-primary/40"}`}>{l.actionType.replace("_", " ")}</span>
                    <span className="text-primary/30">{new Date(l.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="font-mono text-xs text-primary/30 py-4 text-center">// No actions executed yet</div>
              )}
            </div>
          </div>
        </div>

        {/* AUTONOMY CONFIG + EXECUTOR */}
        <div className="space-y-4">
          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="font-mono text-xs text-primary/40 uppercase mb-4 flex items-center gap-2">
              <Shield className="w-3 h-3" /> AUTONOMY CONTROLLER
            </div>

            {configLoading && <div className="font-mono text-xs text-primary/30">LOADING...</div>}

            {config && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs text-primary">ENABLED</div>
                    <div className="font-mono text-xs text-primary/40">Master switch</div>
                  </div>
                  <button
                    onClick={() => updateConfig.mutate({ enabled: !config.enabled })}
                    className={`flex items-center gap-1 font-mono text-xs transition-all ${config.enabled ? "text-[#00ff88]" : "text-primary/40"}`}
                  >
                    {config.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {config.enabled ? "ON" : "OFF"}
                  </button>
                </div>

                <div>
                  <div className="font-mono text-xs text-primary/40 mb-2">SAFETY LEVEL</div>
                  <div className="flex gap-1">
                    {(["strict", "moderate", "permissive"] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => updateConfig.mutate({ safetyLevel: l })}
                        className={`flex-1 font-mono text-xs py-1.5 border transition-all ${config.safetyLevel === l ? `border-primary bg-primary/10 ${SAFETY_COLORS[l]}` : "border-primary/20 text-primary/40 hover:border-primary/40"}`}
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {config.safetyLevel === "permissive" && (
                    <div className="flex items-center gap-1 font-mono text-xs text-[#ff3333]/60 mt-1">
                      <AlertTriangle className="w-3 h-3" /> High autonomy — use with caution
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-xs text-primary">REQUIRE CONFIRM</div>
                    <div className="font-mono text-xs text-primary/40">Before execution</div>
                  </div>
                  <button
                    onClick={() => updateConfig.mutate({ confirmationRequired: !config.confirmationRequired })}
                    className={`flex items-center gap-1 font-mono text-xs ${config.confirmationRequired ? "text-[#00ff88]" : "text-primary/40"}`}
                  >
                    {config.confirmationRequired ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {config.confirmationRequired ? "ON" : "OFF"}
                  </button>
                </div>

                <div className="border-t border-primary/10 pt-3">
                  <div className="font-mono text-xs text-primary/40 mb-2">ALLOWED ACTIONS ({(config.allowedActions as string[]).length})</div>
                  {(config.allowedActions as string[]).map((a) => (
                    <div key={a} className="font-mono text-xs text-[#00ff88]/60 py-0.5">{a}</div>
                  ))}
                </div>

                <div className="border-t border-primary/10 pt-3">
                  <div className="font-mono text-xs text-primary/40 mb-2">BLOCKED ACTIONS ({(config.blockedActions as string[]).length})</div>
                  {(config.blockedActions as string[]).map((a) => (
                    <div key={a} className="font-mono text-xs text-[#ff3333]/40 py-0.5">{a}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border border-primary/20 bg-card/30 p-4">
            <div className="font-mono text-xs text-primary/40 uppercase mb-3 flex items-center gap-2">
              <Play className="w-3 h-3" /> TEST EXECUTOR
            </div>
            <select
              value={execAction}
              onChange={(e) => setExecAction(e.target.value)}
              className="w-full bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-2 mb-2 focus:outline-none focus:border-primary"
            >
              {(config?.allowedActions as string[] ?? []).map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button
              onClick={() => executeAction.mutate(execAction)}
              disabled={executeAction.isPending || !config?.enabled}
              className="w-full flex items-center justify-center gap-2 font-mono text-xs border border-primary/40 py-2 text-primary hover:bg-primary/10 disabled:opacity-40 transition-all"
            >
              {executeAction.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              EXECUTE
            </button>
            {!config?.enabled && (
              <div className="font-mono text-xs text-[#ffaa00]/60 text-center mt-1">Enable autonomy to execute</div>
            )}
            {execResult && (
              <div className="mt-2 border border-primary/20 p-2 font-mono text-xs">
                <div className={`mb-1 uppercase ${(execResult.status as string) === "executed" ? "text-[#00ff88]" : (execResult.status as string) === "blocked" ? "text-[#ff3333]" : "text-[#ffaa00]"}`}>
                  {execResult.status as string}
                </div>
                <div className="text-primary/60">{(execResult.result as string) ?? (execResult.reason as string)}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

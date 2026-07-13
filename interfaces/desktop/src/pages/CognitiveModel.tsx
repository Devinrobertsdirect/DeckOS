import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Shield, Settings2, Trash2, Edit3, Check, X, ChevronDown, ChevronRight, AlertTriangle, Loader2, RotateCcw, ToggleLeft, ToggleRight, Download, Upload } from "lucide-react";

const API_BASE = "/api";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

type LayerData = Record<string, unknown>;

type UCMLayer = {
  label: string;
  data: LayerData;
};

type UCMResponse = {
  id: number;
  updatedAt: string;
  layers: {
    identity: UCMLayer;
    preferences: UCMLayer;
    context: UCMLayer;
    goals: UCMLayer;
    behaviorPatterns: UCMLayer;
    emotionalModel: UCMLayer;
    domainExpertise: UCMLayer;
  };
};

type UCMSettings = {
  proactiveMode: boolean;
  memoryRetentionLevel: "low" | "medium" | "high";
  emotionalModelingEnabled: boolean;
  personalizationLevel: "off" | "minimal" | "full";
  updatedAt: string;
};

const LAYER_KEYS = [
  "identity",
  "preferences",
  "context",
  "goals",
  "behaviorPatterns",
  "emotionalModel",
  "domainExpertise",
] as const;

type LayerKey = typeof LAYER_KEYS[number];

const LAYER_COLORS: Record<LayerKey, string> = {
  identity: "text-[#00d4ff]",
  preferences: "text-[#ffcc00]",
  context: "text-[#ff8800]",
  goals: "text-[#00ff88]",
  behaviorPatterns: "text-[#aa88ff]",
  emotionalModel: "text-[#ff6688]",
  domainExpertise: "text-[#44ddff]",
};

const LAYER_DESC: Record<LayerKey, string> = {
  identity: "Stable traits and persistent attributes",
  preferences: "Medium-stability likes, dislikes, style",
  context: "Current life state and active situation",
  goals: "Active objectives and desired outcomes",
  behaviorPatterns: "Learned interaction habits",
  emotionalModel: "Response tendencies and emotional patterns",
  domainExpertise: "Domains of knowledge and skill levels",
};

function KeyValueEditor({
  layerKey,
  data,
  onSave,
  onClear,
  saving,
}: {
  layerKey: LayerKey;
  data: LayerData;
  onSave: (key: string, value: string) => void;
  onClear: () => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingKey, setEditingKey] = useState("");
  const [editingVal, setEditingVal] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const entries = Object.entries(data);

  return (
    <div className="border border-primary/20 bg-card/30">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-all"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-primary/40" /> : <ChevronRight className="w-3 h-3 text-primary/40" />}
        <span className={`font-mono text-xs font-bold uppercase tracking-widest ${LAYER_COLORS[layerKey]}`}>
          {layerKey}
        </span>
        <span className="font-mono text-xs text-primary/40 ml-1">// {LAYER_DESC[layerKey]}</span>
        <span className="ml-auto font-mono text-xs text-primary/30">{entries.length} fields</span>
      </button>

      {expanded && (
        <div className="border-t border-primary/10 px-4 py-3 space-y-2">
          {entries.length === 0 && (
            <div className="font-mono text-xs text-primary/30 py-2">// LAYER EMPTY — add fields below</div>
          )}

          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 group">
              {editingKey === k ? (
                <>
                  <span className="font-mono text-xs text-primary/60 w-32 shrink-0">{k}:</span>
                  <input
                    autoFocus
                    value={editingVal}
                    onChange={(e) => setEditingVal(e.target.value)}
                    className="flex-1 bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1 focus:outline-none focus:border-primary"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { onSave(k, editingVal); setEditingKey(""); }
                      if (e.key === "Escape") setEditingKey("");
                    }}
                  />
                  <button onClick={() => { onSave(k, editingVal); setEditingKey(""); }} className="text-[#00ff88] hover:opacity-80"><Check className="w-3 h-3" /></button>
                  <button onClick={() => setEditingKey("")} className="text-[#ff3333] hover:opacity-80"><X className="w-3 h-3" /></button>
                </>
              ) : (
                <>
                  <span className="font-mono text-xs text-primary/50 w-32 shrink-0 truncate">{k}:</span>
                  <span className="font-mono text-xs text-primary/80 flex-1 truncate">{String(v)}</span>
                  <button
                    onClick={() => { setEditingKey(k); setEditingVal(String(v)); }}
                    className="opacity-0 group-hover:opacity-100 text-primary/50 hover:text-primary transition-all"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))}

          {addOpen ? (
            <div className="flex gap-2 pt-2 border-t border-primary/10">
              <input
                placeholder="key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-28 bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1 focus:outline-none focus:border-primary"
              />
              <input
                placeholder="value"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                className="flex-1 bg-background/60 border border-primary/30 font-mono text-xs text-primary px-2 py-1 focus:outline-none focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newKey.trim()) {
                    onSave(newKey.trim(), newVal);
                    setNewKey(""); setNewVal(""); setAddOpen(false);
                  }
                }}
              />
              <button
                onClick={() => { if (newKey.trim()) { onSave(newKey.trim(), newVal); setNewKey(""); setNewVal(""); setAddOpen(false); } }}
                disabled={!newKey.trim() || saving}
                className="border border-[#00ff88]/40 px-2 py-1 font-mono text-xs text-[#00ff88] hover:bg-[#00ff88]/10 disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
              <button onClick={() => setAddOpen(false)} className="border border-primary/20 px-2 py-1 font-mono text-xs text-primary/50 hover:text-primary">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 pt-2 border-t border-primary/10">
              <button
                onClick={() => setAddOpen(true)}
                className="font-mono text-xs text-primary/40 hover:text-primary transition-all px-2 py-1 border border-primary/10 hover:border-primary/30"
              >
                + ADD FIELD
              </button>
              {entries.length > 0 && (
                <button
                  onClick={onClear}
                  className="font-mono text-xs text-[#ff3333]/40 hover:text-[#ff3333] transition-all px-2 py-1 border border-[#ff3333]/10 hover:border-[#ff3333]/30 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> CLEAR LAYER
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`flex items-center gap-1 font-mono text-xs transition-all ${enabled ? "text-[#00ff88]" : "text-primary/40"}`}>
      {enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
      {enabled ? "ON" : "OFF"}
    </button>
  );
}

export default function CognitiveModel() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [importMsg, setImportMsg] = useState("");
  const [importReplace, setImportReplace] = useState(false);

  async function handleExport() {
    const res = await fetch(`${API_BASE}/ucm/export`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = cd.match(/filename="([^"]+)"/);
    a.download = match?.[1] ?? `deckos-profile-${Date.now()}.json`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportStatus("loading");
    setImportMsg("");
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch(`${API_BASE}/ucm/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...json, replace: importReplace }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { restored: string[] };
      setImportStatus("ok");
      setImportMsg(`Restored: ${data.restored.join(", ")}`);
      qc.invalidateQueries({ queryKey: ["ucm"] });
      qc.invalidateQueries({ queryKey: ["ucm-settings"] });
      setTimeout(() => setImportStatus("idle"), 4000);
    } catch (err) {
      setImportStatus("error");
      setImportMsg(err instanceof Error ? err.message : "Import failed");
      setTimeout(() => setImportStatus("idle"), 5000);
    }
  }

  const { data: ucm, isLoading: ucmLoading, error: ucmError } = useQuery<UCMResponse>({
    queryKey: ["ucm"],
    queryFn: () => apiFetch("/ucm"),
    refetchInterval: 15000,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<UCMSettings>({
    queryKey: ["ucm-settings"],
    queryFn: () => apiFetch("/ucm/settings"),
    refetchInterval: 30000,
  });

  const patchLayer = useMutation({
    mutationFn: ({ layer, data }: { layer: LayerKey; data: LayerData }) =>
      apiFetch(`/ucm/${layer}`, { method: "PATCH", body: JSON.stringify({ data, merge: true }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ucm"] }),
  });

  const clearLayer = useMutation({
    mutationFn: (layer: LayerKey) =>
      apiFetch(`/ucm/${layer}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ucm"] }),
  });

  const resetAll = useMutation({
    mutationFn: () => apiFetch("/ucm", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ucm"] }),
  });

  const patchSettings = useMutation({
    mutationFn: (patch: Partial<UCMSettings>) =>
      apiFetch("/ucm/settings", { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ucm-settings"] }),
  });

  const handleSaveField = (layer: LayerKey, key: string, value: string) => {
    patchLayer.mutate({ layer, data: { [key]: value } });
  };

  if (ucmLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center h-full font-mono text-primary/50 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm tracking-widest">LOADING COGNITIVE MODEL...</span>
      </div>
    );
  }

  if (ucmError) {
    return (
      <div className="flex items-center gap-3 font-mono text-xs text-[#ff3333] p-6 border border-[#ff3333]/20">
        <AlertTriangle className="w-4 h-4" />
        <span>UCM SERVICE UNAVAILABLE — {(ucmError as Error).message}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
          <Brain className="w-4 h-4 text-primary" />
          <span>USER.COGNITIVE.MODEL // STRUCTURED IDENTITY LAYER</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-primary/30">
            LAST.UPDATE: {ucm ? new Date(ucm.updatedAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}
          </span>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1 font-mono text-xs text-primary/50 hover:text-primary border border-primary/20 hover:border-primary/40 px-3 py-1.5 transition-all"
            title="Download your full cognitive profile as JSON"
          >
            <Download className="w-3 h-3" />
            EXPORT
          </button>

          {/* Import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importStatus === "loading"}
            className={`flex items-center gap-1 font-mono text-xs border px-3 py-1.5 transition-all disabled:opacity-40 ${
              importStatus === "ok"
                ? "text-[#00ff88] border-[#00ff88]/40"
                : importStatus === "error"
                ? "text-[#ff3333] border-[#ff3333]/40"
                : "text-primary/50 hover:text-primary border-primary/20 hover:border-primary/40"
            }`}
            title="Restore a cognitive profile from a JSON export"
          >
            {importStatus === "loading"
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Upload className="w-3 h-3" />
            }
            {importStatus === "ok" ? "IMPORTED" : importStatus === "error" ? "FAILED" : "IMPORT"}
          </button>

          {/* Replace toggle — replaces existing goals/memories/feedback on import */}
          <label
            className="flex items-center gap-1 font-mono text-[10px] text-primary/40 cursor-pointer select-none"
            title="When enabled, existing goals, memories and feedback signals are cleared before restoring"
          >
            <input
              type="checkbox"
              checked={importReplace}
              onChange={(e) => setImportReplace(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            REPLACE
          </label>

          <button
            onClick={() => resetAll.mutate()}
            disabled={resetAll.isPending}
            className="flex items-center gap-1 font-mono text-xs text-[#ff3333]/50 hover:text-[#ff3333] border border-[#ff3333]/20 hover:border-[#ff3333]/40 px-3 py-1.5 transition-all disabled:opacity-40"
          >
            {resetAll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            FULL RESET
          </button>
        </div>
      </div>

      {/* Import status message */}
      {importStatus !== "idle" && importMsg && (
        <div className={`font-mono text-xs px-3 py-2 border ${
          importStatus === "ok"
            ? "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5"
            : "text-[#ff3333] border-[#ff3333]/30 bg-[#ff3333]/5"
        }`}>
          {importStatus === "ok" ? "✓ " : "✗ "}{importMsg}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 flex-1 min-h-0 overflow-y-auto">
        {/* Model Layers */}
        <div className="xl:col-span-2 space-y-2">
          <div className="font-mono text-xs text-primary/40 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Shield className="w-3 h-3" /> COGNITIVE LAYERS
          </div>

          {ucm && LAYER_KEYS.map((layerKey) => (
            <KeyValueEditor
              key={layerKey}
              layerKey={layerKey}
              data={ucm.layers[layerKey].data as LayerData}
              saving={patchLayer.isPending}
              onSave={(key, value) => handleSaveField(layerKey, key, value)}
              onClear={() => clearLayer.mutate(layerKey)}
            />
          ))}
        </div>

        {/* Control Panel */}
        <div className="space-y-4">
          <div className="font-mono text-xs text-primary/40 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Settings2 className="w-3 h-3" /> CONTROL KNOBS
          </div>

          {settings && (
            <div className="border border-primary/20 bg-card/30 divide-y divide-primary/10">
              {/* Proactive Mode */}
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-mono text-xs text-primary">PROACTIVE.MODE</div>
                  <div className="font-mono text-xs text-primary/40">Trigger suggestions unsolicited</div>
                </div>
                <Toggle
                  enabled={settings.proactiveMode}
                  onToggle={() => patchSettings.mutate({ proactiveMode: !settings.proactiveMode })}
                />
              </div>

              {/* Emotional Modeling */}
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-mono text-xs text-primary">EMOTIONAL.MODEL</div>
                  <div className="font-mono text-xs text-primary/40">Track response tendencies</div>
                </div>
                <Toggle
                  enabled={settings.emotionalModelingEnabled}
                  onToggle={() => patchSettings.mutate({ emotionalModelingEnabled: !settings.emotionalModelingEnabled })}
                />
              </div>

              {/* Memory Retention */}
              <div className="px-4 py-3">
                <div className="font-mono text-xs text-primary mb-2">MEMORY.RETENTION</div>
                <div className="flex gap-1">
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => patchSettings.mutate({ memoryRetentionLevel: level })}
                      className={`flex-1 font-mono text-xs py-1.5 border transition-all ${
                        settings.memoryRetentionLevel === level
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-primary/20 text-primary/40 hover:border-primary/40 hover:text-primary/70"
                      }`}
                    >
                      {level.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Personalization Level */}
              <div className="px-4 py-3">
                <div className="font-mono text-xs text-primary mb-2">PERSONALIZATION</div>
                <div className="flex gap-1">
                  {(["off", "minimal", "full"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => patchSettings.mutate({ personalizationLevel: level })}
                      className={`flex-1 font-mono text-xs py-1.5 border transition-all ${
                        settings.personalizationLevel === level
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-primary/20 text-primary/40 hover:border-primary/40 hover:text-primary/70"
                      }`}
                    >
                      {level.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 py-3">
                <div className="font-mono text-xs text-primary/30">
                  UPDATED: {new Date(settings.updatedAt).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {/* Architecture diagram */}
          <div className="border border-primary/20 bg-card/30 p-4 space-y-1 font-mono text-xs">
            <div className="text-primary/40 mb-3 uppercase tracking-widest">COGNITIVE STACK</div>
            {[
              { n: "1", label: "EVENT BUS", color: "text-[#00d4ff]" },
              { n: "2", label: "USER COG. MODEL ◀", color: "text-[#00ff88]", active: true },
              { n: "3", label: "MEMORY SYSTEM", color: "text-[#ffcc00]" },
              { n: "4", label: "INFERENCE ENGINE", color: "text-[#aa88ff]" },
              { n: "5", label: "AI ROUTER", color: "text-[#ff8800]" },
              { n: "6", label: "PLUGIN SYSTEM", color: "text-[#44ddff]" },
              { n: "7", label: "PROACTIVE ENGINE", color: "text-primary/30" },
              { n: "8", label: "VOICE LAYER", color: "text-primary/30" },
            ].map(({ n, label, color, active }) => (
              <div key={n} className={`flex items-center gap-2 py-0.5 ${active ? "border-l-2 border-[#00ff88] pl-2 -ml-2" : ""}`}>
                <span className="text-primary/30 w-4">{n}.</span>
                <span className={color}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

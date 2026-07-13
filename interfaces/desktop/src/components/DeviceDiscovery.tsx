import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu, Smartphone, Radio, Thermometer, Zap, Wifi, X,
  ChevronDown, ChevronRight, Sparkles, Check, AlertCircle,
} from "lucide-react";
import { useWsEvents } from "@/contexts/WebSocketContext";
import type { WsEvent } from "@/contexts/WebSocketContext";
import { HudCorners } from "@/components/HudCorners";

// ── Types ─────────────────────────────────────────────────────────────────

interface ControlStub {
  action:      string;
  label:       string;
  description: string;
  params:      Record<string, string>;
  example?:    string;
}

interface ProfileSuggestion {
  displayName:  string;
  icon:         string;
  description:  string;
  eventSchema:  Record<string, unknown>;
  controlStubs: ControlStub[];
}

interface DiscoveryEvent {
  deviceId:     string;
  protocol:     string;
  deviceType:   string;
  deviceName:   string;
  capabilities: string[];
  suggestion:   ProfileSuggestion;
  timestamp:    string;
}

// ── Icon map ──────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  smartphone: Smartphone,
  radio:      Radio,
  thermometer:Thermometer,
  zap:        Zap,
  wifi:       Wifi,
  cpu:        Cpu,
};

function DeviceIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Cpu;
  return <Icon className={className} />;
}

// ── Collapsed discovery banner ─────────────────────────────────────────────

function DiscoveryBanner({
  event,
  onInitialize,
  onDismiss,
}: {
  event: DiscoveryEvent;
  onInitialize: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="relative flex items-center gap-3 bg-card/90 border border-primary/40 backdrop-blur px-4 py-3 font-mono text-xs
                    animate-in slide-in-from-top-2 duration-300">
      <HudCorners />
      <div className="w-7 h-7 rounded-full border border-primary/50 flex items-center justify-center bg-primary/10 shrink-0">
        <DeviceIcon name={event.suggestion.icon} className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[#ffc820] font-bold tracking-wider">NEW DEVICE DETECTED</span>
          <span className="text-primary/30">·</span>
          <span className="text-primary/60 uppercase">{event.deviceType || event.protocol}</span>
        </div>
        <div className="text-primary/40 text-[10px] truncate mt-0.5">
          {event.deviceId}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onInitialize}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 bg-primary/10
                     hover:bg-primary/25 text-primary font-mono text-xs tracking-wider transition-all"
        >
          <Sparkles className="w-3 h-3" /> INITIALIZE
        </button>
        <button
          onClick={onDismiss}
          className="p-1.5 rounded border border-primary/10 hover:border-primary/30 text-primary/30 hover:text-primary/60 transition-all"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Init panel (expanded) ─────────────────────────────────────────────────

function InitPanel({
  event,
  onConfirm,
  onDismiss,
}: {
  event: DiscoveryEvent;
  onConfirm: (name: string) => void;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(event.suggestion.icon !== "cpu"
    ? event.suggestion.displayName
    : event.suggestion.displayName
  );
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [stubsOpen, setStubsOpen] = useState(true);

  return (
    <div className="relative bg-card/95 border border-primary/40 backdrop-blur font-mono text-xs
                    animate-in slide-in-from-top-2 duration-300 max-h-[80vh] overflow-y-auto">
      <HudCorners />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full border border-primary/50 flex items-center justify-center bg-primary/10">
            <DeviceIcon name={event.suggestion.icon} className="w-3.5 h-3.5 text-primary animate-pulse" />
          </div>
          <div>
            <div className="text-primary flex items-center gap-2">
              <span className="text-[#ffc820] tracking-wider">DEVICE INITIALIZATION</span>
            </div>
            <div className="text-primary/30 text-[10px]">{event.deviceId}</div>
          </div>
        </div>
        <button onClick={onDismiss} className="text-primary/30 hover:text-primary/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Auto-generated label */}
        <div className="flex items-start gap-2 bg-primary/5 border border-primary/15 rounded p-3">
          <Sparkles className="w-3.5 h-3.5 text-primary/50 mt-0.5 shrink-0" />
          <div>
            <div className="text-primary/50 text-[10px] uppercase tracking-wider mb-1">AUTO-GENERATED PROFILE</div>
            <div className="text-primary/60 leading-relaxed">{event.suggestion.description}</div>
          </div>
        </div>

        {/* Display name */}
        <div className="space-y-1.5">
          <label className="text-primary/40 text-[10px] uppercase tracking-wider">DISPLAY NAME</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-card/40 border border-primary/20 rounded px-3 py-2 font-mono text-xs text-primary/90
                       placeholder:text-primary/25 outline-none focus:border-primary/50 focus:bg-primary/5 transition-all"
            placeholder="e.g. MY-PHONE, SENSOR-LAB-01…"
          />
        </div>

        {/* Device metadata */}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="bg-primary/5 border border-primary/10 rounded p-2">
            <div className="text-primary/30 uppercase mb-1">PROTOCOL</div>
            <div className="text-primary/70 uppercase">{event.protocol || "websocket"}</div>
          </div>
          <div className="bg-primary/5 border border-primary/10 rounded p-2">
            <div className="text-primary/30 uppercase mb-1">TYPE</div>
            <div className="text-primary/70 uppercase">{event.deviceType || "unknown"}</div>
          </div>
          {event.capabilities.length > 0 && (
            <div className="col-span-2 bg-primary/5 border border-primary/10 rounded p-2">
              <div className="text-primary/30 uppercase mb-1.5">CAPABILITIES</div>
              <div className="flex flex-wrap gap-1">
                {event.capabilities.map(cap => (
                  <span key={cap} className="bg-primary/15 text-primary/60 rounded px-1.5 py-0.5 text-[9px] uppercase">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Control stubs */}
        <div className="border border-primary/15 rounded overflow-hidden">
          <button
            onClick={() => setStubsOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
          >
            <span className="text-primary/50 uppercase tracking-wider text-[10px]">
              CONTROL STUBS ({event.suggestion.controlStubs.length})
            </span>
            {stubsOpen ? <ChevronDown className="w-3 h-3 text-primary/30" /> : <ChevronRight className="w-3 h-3 text-primary/30" />}
          </button>
          {stubsOpen && (
            <div className="divide-y divide-primary/10">
              {event.suggestion.controlStubs.map(stub => (
                <div key={stub.action} className="px-3 py-2 flex items-start gap-2">
                  <span className="bg-primary/15 text-primary font-bold rounded px-1.5 py-0.5 text-[9px] uppercase shrink-0 mt-0.5">
                    {stub.label}
                  </span>
                  <div>
                    <div className="text-primary/60">{stub.description}</div>
                    {stub.example && (
                      <div className="text-primary/30 text-[9px] mt-0.5 font-mono">params: {stub.example}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event schema */}
        <div className="border border-primary/15 rounded overflow-hidden">
          <button
            onClick={() => setSchemaOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
          >
            <span className="text-primary/50 uppercase tracking-wider text-[10px]">EVENT SCHEMA</span>
            {schemaOpen ? <ChevronDown className="w-3 h-3 text-primary/30" /> : <ChevronRight className="w-3 h-3 text-primary/30" />}
          </button>
          {schemaOpen && (
            <pre className="px-3 py-2 text-[9px] text-primary/50 overflow-x-auto bg-black/20 leading-relaxed">
              {JSON.stringify(event.suggestion.eventSchema, null, 2)}
            </pre>
          )}
        </div>

        {/* Confirm */}
        <button
          onClick={() => onConfirm(name.trim() || event.suggestion.displayName)}
          disabled={!name.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded border border-primary/40
                     bg-primary/15 hover:bg-primary/25 text-primary font-mono text-xs tracking-widest
                     disabled:opacity-40 transition-all"
        >
          <Check className="w-3.5 h-3.5" /> CONFIRM INITIALIZATION
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function DeviceDiscovery() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<DiscoveryEvent[]>([]);
  const [expanded, setExpanded]   = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const discoveryEvents = useWsEvents((e: WsEvent) => e.type === "device.discovery.new");

  // Push new events onto the queue (deduplicated)
  useEffect(() => {
    for (const evt of discoveryEvents) {
      const payload = evt.payload as DiscoveryEvent;
      if (!payload?.deviceId) continue;
      setQueue(prev => {
        if (prev.some(q => q.deviceId === payload.deviceId)) return prev;
        return [...prev, payload];
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryEvents.length]);

  const save = useMutation({
    mutationFn: ({ deviceId, name, event }: { deviceId: string; name: string; event: DiscoveryEvent }) =>
      fetch(`${import.meta.env.BASE_URL}api/devices/profile/${deviceId}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName:  name,
          icon:         event.suggestion.icon,
          description:  event.suggestion.description,
          protocol:     event.protocol,
          deviceType:   event.deviceType,
          category:     "sensor",
          capabilities: event.capabilities,
          eventSchema:  event.suggestion.eventSchema,
          controlStubs: event.suggestion.controlStubs,
          initialized:  true,
        }),
      }).then(r => r.json()),
    onSuccess: (_, { deviceId }) => {
      qc.invalidateQueries({ queryKey: ["device-profiles"] });
      dismissDevice(deviceId);
    },
  });

  const dismissDevice = useCallback((deviceId: string) => {
    setDismissed(prev => new Set([...prev, deviceId]));
    setExpanded(false);
    // Remove from queue after animation
    setTimeout(() => {
      setQueue(prev => prev.filter(q => q.deviceId !== deviceId));
    }, 300);
  }, []);

  // Filter out already-dismissed
  const visible = queue.filter(q => !dismissed.has(q.deviceId));
  if (visible.length === 0) return null;

  const current = visible[0]!;

  return (
    <div className="fixed top-14 left-0 right-0 z-[2000] mx-4 mt-2 shadow-2xl max-w-2xl ml-auto mr-4 sm:ml-auto">
      {expanded ? (
        <InitPanel
          event={current}
          onConfirm={(name) => save.mutate({ deviceId: current.deviceId, name, event: current })}
          onDismiss={() => { setExpanded(false); dismissDevice(current.deviceId); }}
        />
      ) : (
        <div className="space-y-1">
          <DiscoveryBanner
            event={current}
            onInitialize={() => setExpanded(true)}
            onDismiss={() => dismissDevice(current.deviceId)}
          />
          {visible.length > 1 && (
            <div className="bg-card/70 border border-primary/20 px-4 py-1.5 font-mono text-[10px] text-primary/30 text-center">
              +{visible.length - 1} more new device{visible.length - 1 > 1 ? "s" : ""} pending initialization
            </div>
          )}
        </div>
      )}

      {save.isError && (
        <div className="mt-1 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 font-mono text-xs text-red-400">
          <AlertCircle className="w-3 h-3" /> Failed to save profile — check API connection
        </div>
      )}
    </div>
  );
}

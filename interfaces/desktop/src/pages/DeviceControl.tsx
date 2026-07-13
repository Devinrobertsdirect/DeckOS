import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Network, Cpu, Thermometer, Wifi, Monitor, Zap, AlertTriangle,
  CheckCircle2, Moon, Send, Sparkles, BookOpen, RefreshCw, History,
  Activity, Clock, Link, Unlink, Terminal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useWsEvents } from "@/contexts/WebSocketContext";
import { useListDevices, useGetDevice, useControlDevice, getListDevicesQueryKey, getGetDeviceQueryKey } from "@workspace/api-client-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";

interface DeviceProfile {
  deviceId: string;
  displayName: string;
  icon: string;
  description: string;
  protocol: string;
  deviceType: string;
  capabilities: string[];
  eventSchema: Record<string, unknown>;
  controlStubs: { action: string; label: string; description: string; params: Record<string, string>; example?: string }[];
  initialized: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  online: "text-[#22ff44]",
  offline: "text-[#ff3333]",
  error: "text-[#ff6600]",
  standby: "text-[#ffaa00]",
};

const STATUS_BG: Record<string, string> = {
  online: "border-[#22ff44]/30",
  offline: "border-[#ff3333]/30",
  error: "border-[#ff6600]/30",
  standby: "border-[#ffaa00]/30",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  online: CheckCircle2,
  offline: AlertTriangle,
  error: AlertTriangle,
  standby: Moon,
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  sensor: Thermometer,
  actuator: Zap,
  display: Monitor,
  network: Wifi,
  simulated: Cpu,
};

const TYPE_COLORS: Record<string, string> = {
  sensor: "text-[#00d4ff]",
  actuator: "text-[#ffaa00]",
  display: "text-[#cc44ff]",
  network: "text-[#22ff44]",
  simulated: "text-muted-foreground",
};

type DeviceReading = {
  sensor?: string;
  value?: unknown;
  unit?: string | null;
  timestamp?: string;
};

type DeviceShape = {
  id: string;
  name: string;
  type?: string;
  protocol?: string;
  status?: string;
  lastSeen?: string | null;
  location?: string | null;
  capabilities?: string[];
  readings?: DeviceReading[];
};

type WsDeviceReadingPayload = { deviceId?: string; readings?: DeviceReading[]; status?: string; newStatus?: string };
type WsDeviceConnPayload = { deviceId?: string; status?: string; newStatus?: string };
type WsDeviceCommandAckPayload = { deviceId?: string; commandId?: string; success?: boolean; action?: string; error?: string };

type ReadingSnapshot = DeviceReading[];

function useDeviceHistory(deviceId: string | null) {
  const [history, setHistory] = useState<ReadingSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/devices/${deviceId}/history`);
      if (!res.ok) return;
      const json = await res.json();
      setHistory((json.history as ReadingSnapshot[]) ?? []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    setHistory([]);
    fetch_();
  }, [deviceId, fetch_]);

  const appendSnapshot = useCallback((snapshot: ReadingSnapshot) => {
    setHistory((prev) => [...prev, snapshot].slice(-200));
  }, []);

  return { history, loading, refetch: fetch_, appendSnapshot };
}

const CHART_COLORS = [
  "#00d4ff", "#22ff44", "#ffaa00", "#cc44ff", "#ff6600", "#ff3333", "#44ffcc",
];

type NonNumericEvent = {
  type: "connect" | "disconnect" | "command" | "reading";
  label: string;
  timestamp: string;
};

function SensorHistoryPanel({
  history,
  loading,
}: {
  history: DeviceReading[][];
  loading: boolean;
}) {
  const { numericChartData, numericSensors, nonNumericEvents } = useMemo(() => {
    const sensorMap: Record<string, { unit: string | null }> = {};
    const chartPoints: Record<string, number | string>[] = [];
    const events: NonNumericEvent[] = [];

    for (const snapshot of history) {
      if (!snapshot || snapshot.length === 0) continue;

      const ts = snapshot[0]?.timestamp;
      if (!ts) continue;

      const label = new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      let hasNumeric = false;
      const point: Record<string, number | string> = { time: label, _ts: new Date(ts).getTime() };

      for (const r of snapshot) {
        if (!r.sensor) continue;
        const v = r.value;

        if (typeof v === "number") {
          sensorMap[r.sensor] = { unit: r.unit ?? null };
          point[r.sensor] = v;
          hasNumeric = true;
        } else if (typeof v === "boolean") {
          events.push({
            type: "reading",
            label: `${(r.sensor ?? "").replace(/_/g, " ")}: ${v ? "ON" : "OFF"}`,
            timestamp: ts,
          });
        } else if (typeof v === "string") {
          const lower = v.toLowerCase();
          if (lower === "connected" || lower === "online") {
            events.push({ type: "connect", label: `${(r.sensor ?? "device").replace(/_/g, " ")} connected`, timestamp: ts });
          } else if (lower === "disconnected" || lower === "offline") {
            events.push({ type: "disconnect", label: `${(r.sensor ?? "device").replace(/_/g, " ")} disconnected`, timestamp: ts });
          } else if (lower.startsWith("cmd:") || lower.startsWith("command:")) {
            events.push({ type: "command", label: v, timestamp: ts });
          } else {
            events.push({ type: "reading", label: `${(r.sensor ?? "").replace(/_/g, " ")}: ${v}`, timestamp: ts });
          }
        }
      }

      if (hasNumeric) chartPoints.push(point);
    }

    chartPoints.sort((a, b) => (a["_ts"] as number) - (b["_ts"] as number));

    return {
      numericChartData: chartPoints,
      numericSensors: Object.keys(sensorMap).map((k) => ({ key: k, unit: sensorMap[k].unit })),
      nonNumericEvents: events.slice().reverse().slice(0, 30),
    };
  }, [history]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-primary/30 font-mono text-xs">
        <RefreshCw className="w-3 h-3 animate-spin" /> Loading history...
      </div>
    );
  }

  if (history.length === 0) {
    return <div className="text-primary/30 font-mono text-xs">// No history entries found for this device.</div>;
  }

  return (
    <div className="space-y-4">
      {numericSensors.length > 0 && numericChartData.length >= 1 && (
        <div>
          <div className="text-primary/40 text-[9px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Activity className="w-3 h-3" /> SENSOR TREND
          </div>
          <div className="border border-primary/15 bg-background/40 p-2">
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={numericChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,212,255,0.08)" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "rgba(0,212,255,0.35)", fontSize: 8, fontFamily: "monospace" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(0,212,255,0.15)" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "rgba(0,212,255,0.35)", fontSize: 8, fontFamily: "monospace" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(0,212,255,0.15)" }}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(0,10,20,0.92)",
                    border: "1px solid rgba(0,212,255,0.25)",
                    borderRadius: 0,
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "#00d4ff",
                  }}
                  labelStyle={{ color: "rgba(0,212,255,0.5)", fontSize: 9, marginBottom: 4 }}
                  itemStyle={{ color: "#00d4ff" }}
                />
                {numericSensors.length > 1 && (
                  <Legend
                    wrapperStyle={{ fontSize: 9, fontFamily: "monospace", color: "rgba(0,212,255,0.5)" }}
                  />
                )}
                {numericSensors.map((s, idx) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.key.replace(/_/g, " ").toUpperCase() + (s.unit ? ` (${s.unit})` : "")}
                    stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                    strokeWidth={1.5}
                    dot={numericChartData.length === 1 ? { r: 4, strokeWidth: 0, fill: CHART_COLORS[idx % CHART_COLORS.length] } : false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    isAnimationActive={true}
                    animationDuration={600}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {numericChartData.length === 1 && (
            <div className="mt-1 font-mono text-[9px] text-primary/30">
              // One reading — collect more data to see a trend.
            </div>
          )}
        </div>
      )}

      {nonNumericEvents.length > 0 && (
        <div>
          <div className="text-primary/40 text-[9px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <History className="w-3 h-3" /> EVENT TIMELINE
          </div>
          <div className="space-y-1">
            {nonNumericEvents.map((ev, i) => {
              const EventIcon = ev.type === "connect" ? Link
                : ev.type === "disconnect" ? Unlink
                : ev.type === "command" ? Terminal
                : Activity;
              const color = ev.type === "connect" ? "text-[#22ff44]"
                : ev.type === "disconnect" ? "text-[#ff3333]"
                : ev.type === "command" ? "text-[#ffaa00]"
                : "text-primary/60";
              return (
                <div key={i} className="flex items-center gap-2 border-l-2 border-primary/10 pl-2 py-0.5 font-mono text-[10px]">
                  <EventIcon className={`w-2.5 h-2.5 shrink-0 ${color}`} />
                  <span className={color}>{ev.label}</span>
                  <span className="ml-auto text-primary/25 text-[9px] shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {numericSensors.length === 0 && nonNumericEvents.length === 0 && (
        <div className="text-primary/30 font-mono text-xs">// History loaded but no plottable data found.</div>
      )}
    </div>
  );
}

type TypeFilter   = "all" | "sensor" | "actuator" | "display" | "network" | "simulated";
type StatusFilter = "all" | "online" | "offline" | "error" | "standby";

export default function DeviceControl() {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [controlLog, setControlLog] = useState<Array<{ deviceId: string; action: string; status: string; timestamp: string }>>([]);
  const [activeTab, setActiveTab] = useState<"control" | "history">("control");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ackFlash, setAckFlash] = useState<Record<string, "success" | "fail">>({});
  const ackFlashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const { data: profilesData } = useQuery<{ profiles: DeviceProfile[] }>({
    queryKey: ["device-profiles"],
    queryFn: () => fetch(`${import.meta.env.BASE_URL}api/devices/profiles`).then(r => r.json()),
    refetchInterval: 30_000,
  });
  const profiles = profilesData?.profiles ?? [];
  const profileMap = Object.fromEntries(profiles.map(p => [p.deviceId, p]));

  const { data: restData, isLoading, dataUpdatedAt, refetch } = useListDevices({
    query: { queryKey: getListDevicesQueryKey(), refetchInterval: 5_000 },
  });
  const restDevices: DeviceShape[] = restData?.devices ?? [];

  const { data: selectedRestDevice } = useGetDevice(selectedDevice ?? "", {
    query: {
      queryKey: getGetDeviceQueryKey(selectedDevice ?? ""),
      enabled: !!selectedDevice,
      refetchInterval: 3_000,
    },
  });

  const controlMutation = useControlDevice();

  const readingEvents = useWsEvents((e) => e.type === "device.reading");
  const connEvents = useWsEvents((e) => e.type === "device.connected" || e.type === "device.disconnected");
  const stateChangedEvents = useWsEvents((e) => e.type === "device.state.changed");
  const commandEvents = useWsEvents((e) => e.type === "device.command.send" || e.type === "device.command_sent");
  const ackEvents = useWsEvents((e) => e.type === "device.command.ack");
  const processedAckCountRef = useRef(0);

  useEffect(() => {
    if (dataUpdatedAt) setLastRefresh(new Date(dataUpdatedAt));
  }, [dataUpdatedAt]);

  const devices = useMemo<DeviceShape[]>(() => {
    return restDevices.map((d) => {
      const latestReading = readingEvents
        .filter((e) => (e.payload as WsDeviceReadingPayload).deviceId === d.id)
        .at(-1);
      const latestConn = connEvents
        .filter((e) => (e.payload as WsDeviceConnPayload).deviceId === d.id)
        .at(-1);
      const latestStateChange = stateChangedEvents
        .filter((e) => (e.payload as WsDeviceConnPayload).deviceId === d.id)
        .at(-1);

      const statePayload = latestStateChange?.payload as WsDeviceReadingPayload | undefined;
      const wsStatus = statePayload?.newStatus ?? statePayload?.status
        ?? (latestConn
          ? (latestConn.type === "device.connected" ? "online" : "offline")
          : undefined);
      const status = wsStatus ?? d.status ?? "offline";

      const wsReadings = statePayload?.readings?.length
        ? statePayload.readings
        : latestReading
          ? ((latestReading.payload as WsDeviceReadingPayload).readings ?? undefined)
          : undefined;

      const readings = wsReadings ?? d.readings ?? [];
      return { ...d, status, readings };
    });
  }, [restDevices, readingEvents, connEvents, stateChangedEvents]);

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedDevice) ?? null,
    [devices, selectedDevice],
  );

  const selectedDetail = selectedRestDevice ?? selected;

  const filteredDevices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return devices.filter((d) => {
      if (q) {
        const nameMatch = d.name.toLowerCase().includes(q);
        const idMatch   = d.id.toLowerCase().includes(q);
        if (!nameMatch && !idMatch) return false;
      }
      if (typeFilter !== "all" && (d.type ?? "simulated") !== typeFilter) return false;
      if (statusFilter !== "all" && (d.status ?? "offline") !== statusFilter) return false;
      return true;
    });
  }, [devices, searchQuery, typeFilter, statusFilter]);

  const onlineCount  = filteredDevices.filter((d) => d.status === "online").length;
  const offlineCount = filteredDevices.filter((d) => d.status === "offline").length;
  const errorCount   = filteredDevices.filter((d) => d.status === "error").length;

  useEffect(() => {
    if (selectedDevice && !filteredDevices.some((d) => d.id === selectedDevice)) {
      setSelectedDevice(null);
    }
  }, [filteredDevices, selectedDevice]);

  const { history: deviceHistory, loading: historyLoading, appendSnapshot } = useDeviceHistory(
    activeTab === "history" ? selectedDevice : null,
  );

  const recentDeviceReadings = useMemo(() => {
    if (!selectedDevice) return [];
    return readingEvents
      .filter((e) => (e.payload as WsDeviceReadingPayload).deviceId === selectedDevice)
      .slice(-10)
      .reverse();
  }, [readingEvents, selectedDevice]);

  const processedReadingCountRef = useRef(0);
  useEffect(() => {
    if (activeTab !== "history" || !selectedDevice) {
      processedReadingCountRef.current = readingEvents.length;
      return;
    }
    const newEvents = readingEvents.slice(processedReadingCountRef.current);
    for (const ev of newEvents) {
      const p = ev.payload as WsDeviceReadingPayload;
      if (p.deviceId !== selectedDevice) continue;
      const readings = p.readings;
      if (!readings || readings.length === 0) continue;
      const ts = ev.timestamp ?? new Date().toISOString();
      const snapshot: ReadingSnapshot = readings.map((r) => ({
        sensor: r.sensor,
        value: r.value,
        unit: r.unit,
        timestamp: ts,
      }));
      appendSnapshot(snapshot);
    }
    processedReadingCountRef.current = readingEvents.length;
  }, [readingEvents, activeTab, selectedDevice, appendSnapshot]);

  useEffect(() => {
    const newAcks = ackEvents.slice(processedAckCountRef.current);
    processedAckCountRef.current = ackEvents.length;
    if (newAcks.length === 0) return;

    for (const ev of newAcks) {
      const p = ev.payload as WsDeviceCommandAckPayload;
      const deviceId = p.deviceId;
      if (!deviceId) continue;

      const success = p.success !== false;
      const commandId = p.commandId ?? "";
      const action = p.action ?? "ack";
      const status = success ? "ACK:OK" : "ACK:FAIL";

      setControlLog((prev) => [
        {
          deviceId,
          action: commandId ? `${action} [${commandId.slice(0, 8)}]` : action,
          status,
          timestamp: ev.timestamp ?? new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 30));

      if (ackFlashTimers.current[deviceId]) {
        clearTimeout(ackFlashTimers.current[deviceId]);
      }
      setAckFlash((prev) => ({ ...prev, [deviceId]: success ? "success" : "fail" }));
      ackFlashTimers.current[deviceId] = setTimeout(() => {
        setAckFlash((prev) => {
          const next = { ...prev };
          delete next[deviceId];
          return next;
        });
        delete ackFlashTimers.current[deviceId];
      }, 1200);
    }
  }, [ackEvents]);

  useEffect(() => {
    const timers = ackFlashTimers.current;
    return () => {
      for (const id of Object.values(timers)) clearTimeout(id);
    };
  }, []);

  const handleControl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice || !action.trim()) return;
    const act = action.trim();
    setAction("");

    try {
      const result = await controlMutation.mutateAsync({
        deviceId: selectedDevice,
        data: { action: act, parameters: {} },
      });
      setControlLog((prev) => [
        {
          deviceId: selectedDevice,
          action: act,
          status: result.success ? "OK" : "FAIL",
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 30));
    } catch {
      setControlLog((prev) => [
        { deviceId: selectedDevice, action: act, status: "ERR", timestamp: new Date().toISOString() },
        ...prev,
      ].slice(0, 30));
    }
  };

  const sendQuickCommand = async (deviceId: string, act: string) => {
    try {
      await controlMutation.mutateAsync({ deviceId, data: { action: act, parameters: {} } });
    } catch {}
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between font-mono text-xs text-primary/60 uppercase tracking-widest">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          <span>DEVICE.CONTROL // IOT ABSTRACTION LAYER</span>
        </div>
        <div className="flex items-center gap-3">
          {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-primary/40" />}
          <span className="flex items-center gap-1 text-primary/30">
            <Clock className="w-3 h-3" />
            {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <button
            onClick={() => refetch()}
            className="border border-primary/20 px-2 py-1 hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> SYNC
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="border border-primary/20 bg-card/40 p-3 font-mono text-center">
          <div className="text-2xl text-primary font-bold">{filteredDevices.length}</div>
          <div className="text-xs text-muted-foreground">
            {filteredDevices.length < devices.length ? `FILTERED / ${devices.length}` : "TOTAL"}
          </div>
        </div>
        <div className={`border bg-card/40 p-3 font-mono text-center ${onlineCount > 0 ? "border-[#22ff44]/30" : "border-primary/10"}`}>
          <div className="text-2xl text-[#22ff44] font-bold">{onlineCount}</div>
          <div className="text-xs text-muted-foreground">ONLINE</div>
        </div>
        <div className={`border bg-card/40 p-3 font-mono text-center ${offlineCount > 0 ? "border-[#ff3333]/30" : "border-primary/10"}`}>
          <div className="text-2xl text-[#ff3333] font-bold">{offlineCount}</div>
          <div className="text-xs text-muted-foreground">OFFLINE</div>
        </div>
        <div className={`border bg-card/40 p-3 font-mono text-center ${errorCount > 0 ? "border-[#ff6600]/30" : "border-primary/10"}`}>
          <div className="text-2xl text-[#ff6600] font-bold">{errorCount}</div>
          <div className="text-xs text-muted-foreground">ERROR</div>
        </div>
      </div>

      {/* ── Search + Filter bar ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or ID…"
            className="font-mono text-xs pl-8 bg-card/40 border-primary/20 focus:border-primary/60 h-8"
          />
          <Network className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-primary/30 pointer-events-none" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-primary text-xs font-mono leading-none"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["all", "sensor", "actuator", "online", "offline"] as const).map((f) => {
            const isType = ["sensor", "actuator"].includes(f);
            const isStatus = ["online", "offline"].includes(f);
            const active = isType
              ? typeFilter === f
              : isStatus
              ? statusFilter === f
              : (typeFilter === "all" && statusFilter === "all");
            const colorMap: Record<string, string> = {
              all: "border-primary/40 text-primary bg-primary/10",
              sensor: "border-[#00d4ff]/50 text-[#00d4ff] bg-[#00d4ff]/10",
              actuator: "border-[#ffaa00]/50 text-[#ffaa00] bg-[#ffaa00]/10",
              online: "border-[#22ff44]/50 text-[#22ff44] bg-[#22ff44]/10",
              offline: "border-[#ff3333]/50 text-[#ff3333] bg-[#ff3333]/10",
            };
            return (
              <button
                key={f}
                onClick={() => {
                  if (f === "all") { setTypeFilter("all"); setStatusFilter("all"); }
                  else if (isType)   setTypeFilter(typeFilter === f ? "all" : (f as TypeFilter));
                  else if (isStatus) setStatusFilter(statusFilter === f ? "all" : (f as StatusFilter));
                }}
                className={`h-8 px-3 border font-mono text-xs tracking-wider uppercase transition-all ${
                  active ? colorMap[f] : "border-primary/10 text-primary/40 hover:border-primary/30 hover:text-primary/70"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="col-span-2 overflow-y-auto space-y-3">
          {isLoading && devices.length === 0 && (
            <div className="font-mono text-xs text-primary/30 p-4 border border-primary/10 text-center flex items-center justify-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" />
              // Polling /api/devices...
            </div>
          )}
          {!isLoading && filteredDevices.length === 0 && (
            <div className="font-mono text-xs text-primary/30 p-4 border border-primary/10 text-center">
              {devices.length === 0
                ? "// No devices registered. Connect a device or check MQTT config."
                : "// No devices match the current search or filter."}
            </div>
          )}
          {filteredDevices.map((device) => {
            const StatusIcon = STATUS_ICONS[device.status ?? "offline"] ?? AlertTriangle;
            const TypeIcon = TYPE_ICONS[device.type ?? "simulated"] ?? Cpu;
            const isSelected = selectedDevice === device.id;
            const isActuator = device.type === "actuator" || device.capabilities?.includes("toggle");
            const profile = profileMap[device.id];
            const recentReadings = readingEvents
              .filter((e) => (e.payload as WsDeviceReadingPayload).deviceId === device.id)
              .slice(-5);

            const ackState = ackFlash[device.id];

            return (
              <div
                key={device.id}
                data-testid={`device-${device.id}`}
                onClick={() => setSelectedDevice(isSelected ? null : device.id)}
                className={`border bg-card/40 p-4 cursor-pointer font-mono
                  transition-[border-color,box-shadow,background-color] duration-300
                  ${ackState === "success"
                    ? "border-[#22ff44] shadow-[0_0_18px_rgba(34,255,68,0.35)] bg-[#22ff44]/5"
                    : ackState === "fail"
                      ? "border-[#ff3333] shadow-[0_0_18px_rgba(255,51,51,0.35)] bg-[#ff3333]/5"
                      : isSelected
                        ? "border-primary shadow-[0_0_15px_rgba(0,212,255,0.15)]"
                        : `${STATUS_BG[device.status ?? "offline"] ?? "border-primary/20"} hover:border-primary/50`}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 border ${isSelected ? "border-primary bg-primary/10" : "border-primary/20"}`}>
                      <TypeIcon className={`w-4 h-4 ${TYPE_COLORS[device.type ?? "simulated"] ?? "text-primary"}`} />
                    </div>
                    <div>
                      <div className="text-sm text-primary font-bold flex items-center gap-2">
                        {profile?.displayName ?? device.name}
                        {profile?.initialized && (
                          <span className="flex items-center gap-1 text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded px-1.5 py-0.5 uppercase tracking-wider font-bold">
                            <Sparkles className="w-2.5 h-2.5" /> PROFILED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        [{(device.type ?? "device").toUpperCase()}] // {(device.protocol ?? "WS").toUpperCase()}
                        {device.location && ` // ${device.location}`}
                      </div>
                      {device.lastSeen && (
                        <div className="text-[10px] text-primary/30 mt-0.5">
                          LAST SEEN: {new Date(device.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {ackState === "success" && (
                      <span className="flex items-center gap-1 text-[9px] bg-[#22ff44]/15 text-[#22ff44] border border-[#22ff44]/40 px-1.5 py-0.5 uppercase tracking-wider font-bold animate-pulse">
                        <CheckCircle2 className="w-2.5 h-2.5" /> ACK
                      </span>
                    )}
                    {ackState === "fail" && (
                      <span className="flex items-center gap-1 text-[9px] bg-[#ff3333]/15 text-[#ff3333] border border-[#ff3333]/40 px-1.5 py-0.5 uppercase tracking-wider font-bold animate-pulse">
                        <AlertTriangle className="w-2.5 h-2.5" /> FAIL
                      </span>
                    )}
                    {isActuator && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          sendQuickCommand(device.id, "toggle");
                        }}
                        disabled={controlMutation.isPending}
                        className="border border-[#ffaa00]/40 text-[#ffaa00] px-2 py-1 text-xs hover:bg-[#ffaa00]/10 transition-all disabled:opacity-40"
                      >
                        TOGGLE
                      </button>
                    )}
                    <div className={`text-xs flex items-center gap-1 ${STATUS_COLORS[device.status ?? "offline"] ?? "text-muted-foreground"}`}>
                      <StatusIcon className="w-3 h-3" />
                      {(device.status ?? "offline").toUpperCase()}
                    </div>
                  </div>
                </div>

                {device.readings && device.readings.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                    {device.readings.map((r, ri) => (
                      <div key={ri} className="border border-primary/10 bg-background/50 p-2 text-center">
                        <div className="text-xs text-muted-foreground uppercase">{(r.sensor ?? "").replace(/_/g, " ")}</div>
                        <div className="text-sm text-primary font-bold">
                          {typeof r.value === "boolean" ? (r.value ? "ON" : "OFF") : String(r.value ?? "---")}
                          {r.unit && <span className="text-xs text-muted-foreground ml-1">{r.unit}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {recentReadings.length > 1 && (
                  <div className="flex gap-0.5 h-6 items-end mt-1">
                    {recentReadings.map((re, ri) => {
                      const p = re.payload as WsDeviceReadingPayload;
                      const r = p.readings?.[0];
                      const v = typeof r?.value === "number" ? r.value : 0;
                      const pct = Math.min(100, Math.max(5, v));
                      return (
                        <div key={ri} className="flex-1 bg-primary/20 rounded-sm" style={{ height: `${pct}%` }} />
                      );
                    })}
                  </div>
                )}

                {device.capabilities && device.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {device.capabilities.map((cap) => (
                      <span key={cap} className="text-xs border border-primary/20 px-1.5 py-0.5 text-primary/50">{cap}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Card className="bg-card/40 border-primary/20 rounded-none flex flex-col min-h-0">
          <CardHeader className="border-b border-primary/20 p-4 pb-0">
            <CardTitle className="font-mono text-sm text-primary mb-3">
              {selected ? `CONTROL // ${selected.id.toUpperCase()}` : "DEVICE.CONTROL"}
            </CardTitle>
            {selected && (
              <div className="flex gap-0 font-mono text-[10px]">
                <button
                  onClick={() => setActiveTab("control")}
                  className={`px-3 py-1.5 border-b-2 transition-all ${activeTab === "control" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-primary/60"}`}
                >
                  <Activity className="w-3 h-3 inline mr-1" />CONTROL
                </button>
                <button
                  onClick={() => setActiveTab("history")}
                  className={`px-3 py-1.5 border-b-2 transition-all ${activeTab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-primary/60"}`}
                >
                  <History className="w-3 h-3 inline mr-1" />HISTORY
                </button>
              </div>
            )}
          </CardHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs min-h-0">
            {activeTab === "control" && (
              <>
                {selected && selectedDetail && (
                  <div className="space-y-3 mb-3">
                    {(() => {
                      const sp = profileMap[selected.id];
                      if (sp?.initialized) return (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-emerald-400/70 text-[10px]">
                            <Sparkles className="w-3 h-3" />
                            <span className="uppercase tracking-wider">Profile: {sp.displayName}</span>
                          </div>
                          {sp.description && <div className="text-primary/30 leading-relaxed">{sp.description}</div>}
                          {sp.controlStubs.length > 0 && (
                            <div>
                              <div className="text-primary/40 mb-1.5 flex items-center gap-1.5">
                                <BookOpen className="w-2.5 h-2.5" /> CONTROL STUBS:
                              </div>
                              <div className="space-y-1.5">
                                {sp.controlStubs.map(stub => (
                                  <button
                                    key={stub.action}
                                    onClick={() => sendQuickCommand(selected.id, stub.action)}
                                    disabled={controlMutation.isPending}
                                    className="w-full text-left flex items-start gap-2 border border-primary/15 hover:border-primary/40 bg-primary/5 hover:bg-primary/10 px-2.5 py-2 rounded transition-all disabled:opacity-40"
                                  >
                                    <span className="bg-primary/20 text-primary font-bold rounded px-1.5 py-0.5 text-[9px] uppercase shrink-0">{stub.label}</span>
                                    <span className="text-primary/50 text-[10px]">{stub.description}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                      return (
                        <div className="text-primary/40 space-y-1">
                          <div>CAPABILITIES:</div>
                          {(selected.capabilities ?? []).map((c) => <div key={c} className="pl-2 text-primary/60">// {c}</div>)}
                          {(selected.capabilities ?? []).length === 0 && <div className="pl-2 text-primary/20">none listed</div>}
                        </div>
                      );
                    })()}

                    {selectedDetail.readings && selectedDetail.readings.length > 0 && (
                      <div>
                        <div className="text-primary/40 mb-1.5 flex items-center gap-1.5">
                          <Activity className="w-2.5 h-2.5" /> LIVE READINGS:
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(selectedDetail.readings as DeviceReading[]).map((r, i) => (
                            <div key={i} className="border border-primary/15 bg-background/60 p-1.5 text-center">
                              <div className="text-[9px] text-muted-foreground uppercase">{(r.sensor ?? "").replace(/_/g, " ")}</div>
                              <div className="text-primary font-bold">
                                {typeof r.value === "boolean" ? (r.value ? "ON" : "OFF") : String(r.value ?? "---")}
                                {r.unit && <span className="text-muted-foreground ml-1">{r.unit}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {recentDeviceReadings.length > 0 && (
                      <div>
                        <div className="text-primary/40 mb-1">RECENT WS READINGS:</div>
                        {recentDeviceReadings.slice(0, 5).map((re, i) => {
                          const p = re.payload as WsDeviceReadingPayload;
                          const readings = p.readings ?? [];
                          return (
                            <div key={i} className="text-primary/50 py-0.5 border-b border-primary/10 flex justify-between items-center">
                              <span>
                                {readings.map((r, ri) => (
                                  <span key={ri} className="mr-2">
                                    {r.sensor}: <span className="text-primary">{String(r.value)}{r.unit ? r.unit : ""}</span>
                                  </span>
                                ))}
                              </span>
                              <span className="text-primary/30 text-[9px] shrink-0">{new Date(re.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {controlLog.map((log, i) => {
                  const isAck = log.status.startsWith("ACK:");
                  const isOk = log.status === "OK" || log.status === "ACK:OK";
                  return (
                    <div
                      key={i}
                      className={`border p-2 ${isAck
                        ? isOk
                          ? "border-[#22ff44]/30 bg-[#22ff44]/5"
                          : "border-[#ff3333]/30 bg-[#ff3333]/5"
                        : "border-primary/20"}`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-primary/40 flex items-center gap-1.5">
                          {isAck && <CheckCircle2 className={`w-3 h-3 shrink-0 ${isOk ? "text-[#22ff44]" : "text-[#ff3333]"}`} />}
                          &gt; [{log.deviceId.slice(0, 12)}] {log.action}
                        </span>
                        <span className={`text-[10px] font-bold ${isOk ? "text-[#22ff44]" : "text-[#ff3333]"}`}>{log.status}</span>
                      </div>
                      <div className="text-primary/30 text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</div>
                    </div>
                  );
                })}

                {commandEvents.slice(-5).reverse().map((e, i) => (
                  <div key={i} className="border border-[#22ff44]/20 p-2">
                    <div className="text-[#22ff44]/60">&gt; device.command.send</div>
                    <div className="text-primary/40 text-xs">{JSON.stringify(e.payload).slice(0, 80)}</div>
                  </div>
                ))}

                {!selected && (
                  <div className="text-primary/30">// Select a device to view details and send commands</div>
                )}
              </>
            )}

            {activeTab === "history" && selected && (
              <SensorHistoryPanel
                history={deviceHistory}
                loading={historyLoading}
              />
            )}
          </div>

          <form onSubmit={handleControl} className="border-t border-primary/20 p-4 flex gap-2">
            <span className="text-primary font-mono mt-2 text-sm">&gt;</span>
            <Input
              data-testid="device-action-input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              disabled={!selected || controlMutation.isPending}
              className="font-mono border-none bg-transparent focus-visible:ring-0 text-primary px-0 disabled:opacity-40"
              placeholder={selected ? "Action (on, off, read, toggle...)" : "Select a device first"}
            />
            <button
              type="submit"
              data-testid="device-control-submit"
              disabled={!selected || controlMutation.isPending}
              className="border border-primary/40 px-3 font-mono text-xs text-primary hover:bg-primary/10 transition-all disabled:opacity-40"
            >
              {controlMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}

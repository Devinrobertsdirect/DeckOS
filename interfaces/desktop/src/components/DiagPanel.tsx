import { useCallback, useEffect, useState } from "react";
import { Activity, Cpu, HardDrive, Loader2, MemoryStick, RefreshCw, Thermometer, Wifi, WifiOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface DiagData {
  uptimeSec: number;
  mem: { totalMb: number; freeMb: number };
  disk: { totalMb: number; freeMb: number };
  cpu: { load1: number; tempC: number | null };
  versions: { node: string; brain: string };
  net: { connected: boolean; ssid: string | null; ip: string | null; signal: number | null };
  hal: { profile: string | null; modules: { pigpio: boolean; i2cBus: boolean } };
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const hms = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return d > 0 ? `${d}d ${hms}` : hms;
}

function formatMb(mb: number): string {
  return mb >= 10240 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** CPU temp accent: red >80°C, amber >70°C, green otherwise. */
function tempColor(tempC: number): string {
  if (tempC > 80) return "text-[#f03248]";
  if (tempC > 70) return "text-[#ffc820]";
  return "text-[#11d97a]";
}

/**
 * Compact field-diagnostics readout — one glance tells you everything about a
 * robot in the field. Fetches /api/diag once on mount; REFRESH re-fetches on
 * demand (no auto-poll loops — this can sit on the robot's screen all day).
 */
export function DiagPanel() {
  const [diag, setDiag] = useState<DiagData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiag = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/diag");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDiag((await res.json()) as DiagData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiag();
  }, [fetchDiag]);

  const memUsedMb = diag ? diag.mem.totalMb - diag.mem.freeMb : 0;

  return (
    <Card className="bg-card/40 border-primary/20 rounded-none">
      <CardHeader className="border-b border-primary/20 p-4">
        <CardTitle className="font-mono text-xs text-primary flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" />
            SYSTEM.DIAG // FIELD READOUT
          </span>
          <button
            onClick={fetchDiag}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 border border-primary/40 font-mono text-xs text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />
            }
            REFRESH
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!diag && loading && (
          <div className="flex items-center gap-2 p-6 font-mono text-xs text-primary/40">
            <Loader2 className="w-4 h-4 animate-spin" />
            READING DIAGNOSTICS...
          </div>
        )}
        {error && (
          <div className="p-4 font-mono text-xs text-[#f03248]">
            DIAG FETCH FAILED — {error}
          </div>
        )}
        {diag && (
          <div className="divide-y divide-primary/10 font-mono text-xs">
            <div className="p-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-primary/60 uppercase tracking-widest">
                <Activity className="w-3.5 h-3.5" />
                Uptime
              </span>
              <span className="text-primary">{formatUptime(diag.uptimeSec)}</span>
            </div>
            <div className="p-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-primary/60 uppercase tracking-widest">
                <MemoryStick className="w-3.5 h-3.5" />
                RAM
              </span>
              <span className="text-primary">
                {formatMb(memUsedMb)} / {formatMb(diag.mem.totalMb)}
                <span className="text-primary/40"> used</span>
              </span>
            </div>
            <div className="p-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-primary/60 uppercase tracking-widest">
                <HardDrive className="w-3.5 h-3.5" />
                Disk
              </span>
              <span className="text-primary">
                {formatMb(diag.disk.freeMb)}
                <span className="text-primary/40"> free of </span>
                {formatMb(diag.disk.totalMb)}
              </span>
            </div>
            <div className="p-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-primary/60 uppercase tracking-widest">
                <Cpu className="w-3.5 h-3.5" />
                CPU
              </span>
              <span className="flex items-center gap-3">
                <span className="text-primary">load {diag.cpu.load1.toFixed(2)}</span>
                {diag.cpu.tempC !== null ? (
                  <span className={`flex items-center gap-1 ${tempColor(diag.cpu.tempC)}`}>
                    <Thermometer className="w-3 h-3" />
                    {diag.cpu.tempC.toFixed(1)}°C
                  </span>
                ) : (
                  <span className="text-primary/30">no temp</span>
                )}
              </span>
            </div>
            <div className="p-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-primary/60 uppercase tracking-widest">
                {diag.net.connected
                  ? <Wifi className="w-3.5 h-3.5" />
                  : <WifiOff className="w-3.5 h-3.5" />
                }
                Wifi
              </span>
              {diag.net.connected ? (
                <span className="text-primary">
                  {diag.net.ssid}
                  {diag.net.signal !== null && (
                    <span className="text-[#11d97a]"> {diag.net.signal}%</span>
                  )}
                  {diag.net.ip && <span className="text-primary/40"> {diag.net.ip}</span>}
                </span>
              ) : (
                <span className="text-primary/30">OFFLINE</span>
              )}
            </div>
            <div className="p-3 flex items-center justify-between">
              <span className="text-primary/60 uppercase tracking-widest">Brain</span>
              <span className="text-primary">
                {diag.versions.brain}
                <span className="text-primary/40"> node {diag.versions.node}</span>
              </span>
            </div>
            <div className="p-3 flex items-center justify-between">
              <span className="text-primary/60 uppercase tracking-widest">HAL</span>
              <span className="flex items-center gap-2">
                <span className="text-primary">{diag.hal.profile ?? "auto"}</span>
                <span className={`px-1.5 py-0.5 border ${diag.hal.modules.pigpio ? "border-[#11d97a]/40 text-[#11d97a]" : "border-primary/10 text-primary/25"}`}>
                  pigpio
                </span>
                <span className={`px-1.5 py-0.5 border ${diag.hal.modules.i2cBus ? "border-[#11d97a]/40 text-[#11d97a]" : "border-primary/10 text-primary/25"}`}>
                  i2c
                </span>
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

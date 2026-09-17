import { useCallback, useEffect, useRef, useState } from "react";
import { Wifi, WifiOff, Bluetooth, Loader2, Lock, RefreshCw, Check } from "lucide-react";

/**
 * ConnectivityPanel — join WiFi and pair a Bluetooth speaker straight from the
 * face, no terminal. Talks to the loopback-guarded /api/net + /api/bt endpoints
 * the brain exposes on a robot; on a plain desktop those answer {available:false}
 * and this renders a single quiet "not available here" line instead of erroring.
 *
 * Keyboard-first (native <button>/<input>, the global focus ring shows what's
 * selected) and compact enough for the 480x480 round screen.
 */

type WifiStatus = { connected: boolean; ssid: string | null; ip: string | null; signal: number | null };
type WifiNet = { ssid: string; signal: number; security: string; active: boolean };
type BtDevice = { mac: string; name: string; paired: boolean; connected: boolean };

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
async function postJSON<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return (await r.json().catch(() => ({}))) as T;
  } catch {
    return null;
  }
}

const bars = (sig: number | null) => (sig == null ? "" : sig >= 70 ? "▂▄▆█" : sig >= 45 ? "▂▄▆" : sig >= 20 ? "▂▄" : "▂");

export function ConnectivityPanel() {
  const [available, setAvailable] = useState<boolean | null>(null);

  // ── WiFi ──────────────────────────────────────────────────────────────────
  const [wifi, setWifi] = useState<WifiStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [nets, setNets] = useState<WifiNet[] | null>(null);
  const [chosen, setChosen] = useState<WifiNet | null>(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);

  const refreshWifi = useCallback(async () => {
    const s = await getJSON<{ available: boolean; wifi: WifiStatus }>("/api/net/status");
    if (s) { setAvailable(s.available); setWifi(s.wifi); }
    else setAvailable(false);
  }, []);
  useEffect(() => { void refreshWifi(); }, [refreshWifi]);

  async function scanWifi() {
    setScanning(true); setNets(null); setChosen(null); setJoinMsg(null);
    const r = await getJSON<{ networks: WifiNet[] }>("/api/net/wifi/networks");
    setNets(r?.networks ?? []);
    setScanning(false);
  }
  async function joinWifi() {
    if (!chosen) return;
    setJoining(true); setJoinMsg(null);
    const r = await postJSON<{ ok: boolean; error?: string }>("/api/net/wifi/connect", { ssid: chosen.ssid, password: pw || undefined });
    setJoining(false);
    if (r?.ok) { setJoinMsg(`Connected to ${chosen.ssid}`); setChosen(null); setPw(""); setNets(null); void refreshWifi(); }
    else setJoinMsg(r?.error ? `Failed: ${r.error}` : "Couldn't connect — check the password.");
  }

  // ── Bluetooth ───────────────────────────────────────────────────────────────
  const [bt, setBt] = useState<{ powered: boolean; discovering: boolean; devices: BtDevice[] } | null>(null);
  const [btScanning, setBtScanning] = useState(false);
  const [btBusy, setBtBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshBt = useCallback(async () => {
    const r = await getJSON<{ available: boolean; powered: boolean; discovering: boolean; devices: BtDevice[] }>("/api/bt/status");
    if (r?.available) setBt({ powered: r.powered, discovering: r.discovering, devices: r.devices });
  }, []);
  useEffect(() => { void refreshBt(); }, [refreshBt]);
  useEffect(() => () => { // cleanup any live scan on unmount
    if (pollRef.current) clearInterval(pollRef.current);
    if (stopRef.current) clearTimeout(stopRef.current);
    void postJSON("/api/bt/scan", { on: false });
  }, []);

  async function btPower(on: boolean) {
    setBtBusy("power");
    await postJSON("/api/bt/power", { on });
    setBtBusy(null);
    await refreshBt();
  }
  function stopBtScan() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (stopRef.current) { clearTimeout(stopRef.current); stopRef.current = null; }
    setBtScanning(false);
    void postJSON("/api/bt/scan", { on: false });
  }
  async function startBtScan() {
    setBtScanning(true);
    await postJSON("/api/bt/scan", { on: true });
    await refreshBt();
    // the server holds an ~8s scan window; re-kick it and poll status for ~20s
    pollRef.current = setInterval(() => { void postJSON("/api/bt/scan", { on: true }); void refreshBt(); }, 6000);
    stopRef.current = setTimeout(stopBtScan, 20000);
  }
  async function btPair(d: BtDevice) {
    setBtBusy(d.mac);
    const r = await postJSON<{ ok: boolean; error?: string }>("/api/bt/pair", { mac: d.mac });
    setBtBusy(null);
    if (!r?.ok && r?.error) setJoinMsg(null); // pairing errors surface in the row via refresh
    await refreshBt();
  }
  async function btDisconnect(d: BtDevice) {
    setBtBusy(d.mac);
    await postJSON("/api/bt/disconnect", { mac: d.mac });
    setBtBusy(null);
    await refreshBt();
  }

  if (available === false) {
    return <p className="text-[11px] text-muted-foreground">Network controls aren't available on this device — they run on the robot.</p>;
  }
  if (available === null) {
    return <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking connectivity…</p>;
  }

  const btn = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors";
  const btnGhost = btn + " border-primary/25 text-primary/80 hover:border-primary/60 hover:text-primary disabled:opacity-40";
  const btnSolid = btn + " border-primary/60 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40";

  return (
    <div className="space-y-6">
      {/* WIFI */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            {wifi?.connected ? <Wifi className="h-4 w-4 text-primary" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
            <span className="text-foreground">
              {wifi?.connected ? wifi.ssid : "Not connected"}
              {wifi?.connected && wifi.signal != null && <span className="ml-2 font-mono text-[11px] text-primary/60">{bars(wifi.signal)} {wifi.signal}%</span>}
            </span>
          </div>
          <button type="button" className={btnGhost} onClick={scanWifi} disabled={scanning}>
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Scan
          </button>
        </div>
        {wifi?.connected && wifi.ip && <div className="font-mono text-[10px] text-muted-foreground">IP {wifi.ip}</div>}

        {nets && (
          <div className="space-y-1.5 rounded-md border border-primary/12 bg-primary/[0.02] p-2">
            {nets.length === 0 && <p className="px-1 py-2 text-[11px] text-muted-foreground">No networks found — try Scan again.</p>}
            {nets.map((n) => (
              <button
                key={n.ssid}
                type="button"
                onClick={() => { setChosen(n); setPw(""); setJoinMsg(null); }}
                className={"flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left transition-colors " + (chosen?.ssid === n.ssid ? "bg-primary/15" : "hover:bg-primary/[0.06]")}
              >
                <span className="flex items-center gap-2 text-sm text-foreground">
                  {n.security ? <Lock className="h-3 w-3 text-muted-foreground" /> : <span className="w-3" />}
                  {n.ssid}{n.active && <Check className="h-3 w-3 text-primary" />}
                </span>
                <span className="font-mono text-[10px] text-primary/50">{bars(n.signal)} {n.signal}%</span>
              </button>
            ))}
          </div>
        )}

        {chosen && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void joinWifi(); }}>
            <div className="text-[11px] text-muted-foreground">Join <span className="text-foreground">{chosen.ssid}</span></div>
            {chosen.security && (
              <div className="flex items-center gap-2">
                <input
                  type={showPw ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="WiFi password"
                  autoFocus
                  className="flex-1 rounded-md border border-primary/25 bg-background/60 px-3 py-1.5 text-sm text-foreground outline-none focus-visible:border-primary/60"
                />
                <button type="button" className={btnGhost} onClick={() => setShowPw((s) => !s)}>{showPw ? "Hide" : "Show"}</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button type="submit" className={btnSolid} disabled={joining}>{joining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />} Join</button>
              <button type="button" className={btnGhost} onClick={() => { setChosen(null); setPw(""); }}>Cancel</button>
            </div>
          </form>
        )}
        {joinMsg && <div className="font-mono text-[11px] text-primary/70">{joinMsg}</div>}
      </div>

      {/* BLUETOOTH */}
      <div className="space-y-3 border-t border-primary/10 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Bluetooth className={"h-4 w-4 " + (bt?.powered ? "text-primary" : "text-muted-foreground")} />
            Bluetooth {bt?.powered ? "on" : "off"}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={btnGhost} onClick={() => btPower(!bt?.powered)} disabled={btBusy === "power"}>
              {btBusy === "power" ? <Loader2 className="h-3 w-3 animate-spin" /> : bt?.powered ? "Turn off" : "Turn on"}
            </button>
            {bt?.powered && (
              btScanning
                ? <button type="button" className={btnSolid} onClick={stopBtScan}><Loader2 className="h-3 w-3 animate-spin" /> Scanning</button>
                : <button type="button" className={btnGhost} onClick={startBtScan}><RefreshCw className="h-3 w-3" /> Scan</button>
            )}
          </div>
        </div>
        {bt?.powered && (
          <div className="space-y-1.5">
            {(bt.devices ?? []).length === 0 && (
              <p className="text-[11px] text-muted-foreground">{btScanning ? "Looking for devices — put your speaker in pairing mode…" : "No devices yet. Hit Scan with your speaker in pairing mode."}</p>
            )}
            {(bt.devices ?? []).map((d) => (
              <div key={d.mac} className="flex items-center justify-between gap-2 rounded-md border border-primary/10 bg-primary/[0.03] px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  {d.name || d.mac}
                  {d.connected && <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">Linked</span>}
                </span>
                {d.connected ? (
                  <button type="button" className={btnGhost} onClick={() => btDisconnect(d)} disabled={btBusy === d.mac}>
                    {btBusy === d.mac ? <Loader2 className="h-3 w-3 animate-spin" /> : "Disconnect"}
                  </button>
                ) : (
                  <button type="button" className={btnSolid} onClick={() => btPair(d)} disabled={btBusy === d.mac}>
                    {btBusy === d.mac ? <Loader2 className="h-3 w-3 animate-spin" /> : d.paired ? "Connect" : "Pair"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

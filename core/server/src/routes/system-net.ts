import { execFile, type ChildProcess } from "node:child_process";
import { Router, type Request } from "express";
import { z } from "zod/v4";

/**
 * /api/net + /api/bt — on-screen connectivity: a person with only the robot's
 * keyboard joins WiFi and pairs a Bluetooth speaker from the face UI, no
 * terminal required. WiFi goes through nmcli (-t machine-readable parsing),
 * Bluetooth through one-shot bluetoothctl calls with hard timeouts — no
 * request hangs past ~12s. Every command runs via execFile with an args ARRAY
 * (SSIDs and passwords are attacker-controlled input; nothing ever touches a
 * shell). Mutations are loopback-only — they come from the robot's own screen
 * or not at all; GETs may serve the LAN. On machines without
 * nmcli/bluetoothctl (Windows/Mac dev) every endpoint answers
 * { available: false } with HTTP 200 and touches nothing.
 */
const router = Router();

type RunResult = { ok: boolean; stdout: string; stderr: string };

/** execFile wrapper: args array only, hard timeout, never throws. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

// Tool availability, probed once per process. Non-Linux short-circuits: nmcli,
// bluetoothctl, wpctl and pactl are all Linux-only, so desktop builds never
// spawn anything. (wpctl/pactl are the PipeWire/PulseAudio CLIs used to steer
// TTS audio onto a freshly-paired BT speaker — see routeAudioToBt below.)
const toolProbe = new Map<string, Promise<boolean>>();
function haveTool(cmd: "nmcli" | "bluetoothctl" | "wpctl" | "pactl"): Promise<boolean> {
  if (process.platform !== "linux") return Promise.resolve(false);
  let probe = toolProbe.get(cmd);
  if (!probe) {
    probe = run(cmd, ["--version"], 3000).then((r) => r.ok);
    toolProbe.set(cmd, probe);
  }
  return probe;
}

/** Mutations only ever come from the robot's own keyboard — loopback or 403. */
function isLoopback(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** Strip ANSI colour codes (bluetoothctl decorates its output when it feels like it). */
function clean(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Best human-readable line from a failed command — error-ish lines first. */
function errText(r: RunResult, fallback: string): string {
  const lines = clean(`${r.stderr}\n${r.stdout}`).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /error|fail/i.test(l)) ?? lines[0] ?? fallback;
}

/** Split one nmcli terse (-t) line on ':' honoring the '\:' / '\\' escapes. */
function splitTerse(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) cur += line[++i];
    else if (ch === ":") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// WiFi (nmcli)

type WifiSnapshot = { connected: boolean; ssid: string | null; ip: string | null; signal: number | null };

const WIFI_DOWN: WifiSnapshot = { connected: false, ssid: null, ip: null, signal: null };

async function wifiSnapshot(): Promise<WifiSnapshot> {
  const devs = await run("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "device"], 5000);
  const wifiDev = devs.ok
    ? devs.stdout
        .split("\n")
        .map((l) => splitTerse(l.trim()))
        .find((f) => f[1] === "wifi" && (f[2] ?? "").startsWith("connected"))?.[0]
    : undefined;
  if (!wifiDev) return { ...WIFI_DOWN };

  // SSID + signal from the active row of the cached scan list (no rescan — instant).
  let ssid: string | null = null;
  let signal: number | null = null;
  const list = await run("nmcli", ["-t", "-f", "ACTIVE,SSID,SIGNAL", "device", "wifi", "list", "--rescan", "no"], 6000);
  if (list.ok) {
    for (const line of list.stdout.split("\n")) {
      const [active, name, sig] = splitTerse(line.trim());
      if (active === "yes" && name) {
        ssid = name;
        signal = Number.isFinite(Number(sig)) ? Number(sig) : null;
        break;
      }
    }
  }

  let ip: string | null = null;
  const addr = await run("nmcli", ["-t", "-g", "IP4.ADDRESS", "device", "show", wifiDev], 5000);
  const first = addr.stdout.split("\n").map((l) => l.trim()).find(Boolean);
  if (addr.ok && first) ip = first.split("/")[0] || null;  // "10.0.0.35/24" -> "10.0.0.35"

  return { connected: true, ssid, ip, signal };
}

// GET /api/net/status — current WiFi link. Read-only; safe to serve the LAN.
router.get("/net/status", async (_req, res) => {
  try {
    if (!(await haveTool("nmcli"))) {
      res.json({ available: false, wifi: { ...WIFI_DOWN } });
      return;
    }
    res.json({ available: true, wifi: await wifiSnapshot() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/net/wifi/networks — visible networks, deduped by SSID (active row
// beats all, else strongest signal wins), sorted signal desc, hidden/empty
// SSIDs dropped. Read-only; safe to serve the LAN.
router.get("/net/wifi/networks", async (_req, res) => {
  try {
    if (!(await haveTool("nmcli"))) {
      res.json({ available: false, networks: [] });
      return;
    }
    const r = await run("nmcli", ["-t", "-f", "SSID,SIGNAL,SECURITY,ACTIVE", "device", "wifi", "list"], 10000);
    type Net = { ssid: string; signal: number; security: string; active: boolean };
    const bySsid = new Map<string, Net>();
    for (const line of r.stdout.split("\n")) {
      const [ssid, sig, security, active] = splitTerse(line.trim());
      if (!ssid) continue;  // hidden/empty SSID — nothing to click on
      const net: Net = {
        ssid,
        signal: Number.isFinite(Number(sig)) ? Number(sig) : 0,
        security: security ?? "",
        active: active === "yes",
      };
      const prev = bySsid.get(ssid);
      if (!prev || (net.active && !prev.active) || (!prev.active && net.signal > prev.signal)) {
        bySsid.set(ssid, net);
      }
    }
    const networks = [...bySsid.values()].sort((a, b) => b.signal - a.signal);
    res.json({ available: true, networks });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const ConnectSchema = z.object({
  ssid: z.string().min(1).max(64),
  password: z.string().min(1).max(128).optional(),
});

// POST /api/net/wifi/connect — { ssid, password? }. Loopback only. nmcli does
// the join (-w 20 caps NetworkManager's own wait) and reports why it failed.
router.post("/net/wifi/connect", async (req, res) => {
  if (!isLoopback(req)) {
    res.status(403).json({ error: "local only" });
    return;
  }
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send { ssid, password? }" });
    return;
  }
  try {
    if (!(await haveTool("nmcli"))) {
      res.json({ ok: false, available: false, error: "WiFi control is not available on this device" });
      return;
    }
    const { ssid, password } = parsed.data;
    const args = ["-w", "20", "device", "wifi", "connect", ssid];
    if (password !== undefined) args.push("password", password);
    const r = await run("nmcli", args, 25000);
    if (r.ok) {
      res.json({ ok: true });
      return;
    }
    // A failed password join leaves a broken profile behind that would block
    // the retry — clear it, but only when this attempt carried a password so
    // saved open-network profiles are never touched.
    if (password !== undefined) void run("nmcli", ["connection", "delete", "id", ssid], 5000);
    res.json({ ok: false, error: errText(r, "connect failed") });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Bluetooth (bluetoothctl one-shots)

type BtDevice = { mac: string; name: string; paired: boolean; connected: boolean };

const DEVICE_LINE = /^Device ((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}) (.+)$/;

/** Parse "Device AA:BB:CC:DD:EE:FF Name" lines into mac -> name. */
function parseDevices(out: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of clean(out).split("\n")) {
    const m = DEVICE_LINE.exec(raw.trim());
    if (m) map.set(m[1].toUpperCase(), m[2]);
  }
  return map;
}

async function btDeviceList(): Promise<BtDevice[]> {
  const all = parseDevices((await run("bluetoothctl", ["devices"], 5000)).stdout);
  let pairedR = await run("bluetoothctl", ["devices", "Paired"], 5000);
  if (!pairedR.ok) pairedR = await run("bluetoothctl", ["paired-devices"], 5000);  // pre-5.65 bluez
  const paired = parseDevices(pairedR.stdout);
  const connectedR = await run("bluetoothctl", ["devices", "Connected"], 5000);
  const connected = connectedR.ok ? parseDevices(connectedR.stdout) : new Map<string, string>();
  for (const [mac, name] of paired) if (!all.has(mac)) all.set(mac, name);
  const devices: BtDevice[] = [...all.entries()].map(([mac, name]) => ({
    mac, name, paired: paired.has(mac), connected: connected.has(mac),
  }));
  // Connected first, then paired, then by name — a stable list for the UI.
  devices.sort((a, b) =>
    Number(b.connected) - Number(a.connected) ||
    Number(b.paired) - Number(a.paired) ||
    a.name.localeCompare(b.name));
  return devices;
}

// GET /api/bt/status — adapter power/discovery + known and freshly-scanned
// devices. Read-only; safe to serve the LAN (and to poll every 2s while scanning).
router.get("/bt/status", async (_req, res) => {
  try {
    if (!(await haveTool("bluetoothctl"))) {
      res.json({ available: false, powered: false, discovering: false, devices: [] });
      return;
    }
    const show = clean((await run("bluetoothctl", ["show"], 5000)).stdout);
    const powered = /Powered:\s*yes/.test(show);
    const discovering = /Discovering:\s*yes/.test(show);
    res.json({ available: true, powered, discovering, devices: powered ? await btDeviceList() : [] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const OnSchema = z.object({ on: z.boolean() });
const MacSchema = z.object({
  mac: z.string().regex(/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
});

// POST /api/bt/power — { on }. Loopback only.
router.post("/bt/power", async (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const parsed = OnSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Send { on: boolean }" }); return; }
  try {
    if (!(await haveTool("bluetoothctl"))) { res.json({ ok: false, available: false }); return; }
    const r = await run("bluetoothctl", ["power", parsed.data.on ? "on" : "off"], 5000);
    res.json({ ok: r.ok });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// The scan child holds a bluez discovery session open for ~8s, then exits (a
// discovery session dies with its client). Repeated { on: true } calls refresh
// the window; { on: false } — or the child expiring — ends it.
let scanChild: ChildProcess | null = null;

// POST /api/bt/scan — { on }. Loopback only. Returns immediately; the UI
// polls /api/bt/status to watch devices appear.
router.post("/bt/scan", async (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const parsed = OnSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Send { on: boolean }" }); return; }
  try {
    if (!(await haveTool("bluetoothctl"))) { res.json({ ok: false, available: false }); return; }
    if (scanChild) { scanChild.kill(); scanChild = null; }
    if (parsed.data.on) {
      const child = execFile("bluetoothctl", ["--timeout", "8", "scan", "on"], { timeout: 12000 }, () => {
        if (scanChild === child) scanChild = null;
      });
      scanChild = child;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pull the node IDs out of the "Sinks:" block of `wpctl status` output. */
function sinkIdsFromWpctl(status: string): string[] {
  const ids: string[] = [];
  let inSinks = false;
  for (const raw of status.split("\n")) {
    // Drop the box-drawing tree glyphs so headers/rows are plain text.
    const trimmed = raw.replace(/[─-╿]/g, " ").trim();
    const header = /^([A-Za-z][A-Za-z ]*):$/.exec(trimmed);
    if (header) { inSinks = header[1].trim() === "Sinks"; continue; }  // "Sink endpoints:" etc. end the block
    if (!inSinks) continue;
    const m = /^\*?\s*(\d+)\.\s/.exec(trimmed);  // "*   45. Nobi Speaker  [vol: 1.00]"
    if (m) ids.push(m[1]);
  }
  return ids;
}

/**
 * Best-effort: make the just-connected BT device the DEFAULT audio sink so the
 * next spoken response (and Chromium's live stream) plays out of it. bluez
 * names the sink "bluez_output.AA_BB_CC_DD_EE_FF..." — colons become
 * underscores. Prefers WirePlumber (wpctl), falls back to PulseAudio/
 * pipewire-pulse (pactl); either being absent is fine. Never throws and never
 * blocks the pair response for long — returns whether a bluez sink was set.
 */
async function routeAudioToBt(mac: string): Promise<boolean> {
  const bluez = new RegExp(`bluez_output\\.${mac.replace(/:/g, "_")}`, "i");
  try {
    if (await haveTool("wpctl")) {
      // The a2dp sink node can take a beat to register after connect — one retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        const status = await run("wpctl", ["status"], 2000);
        for (const id of sinkIdsFromWpctl(status.stdout)) {
          const insp = await run("wpctl", ["inspect", id], 1500);
          if (bluez.test(insp.stdout) && (await run("wpctl", ["set-default", id], 1500)).ok) return true;
        }
        if (attempt === 0) await delay(700);
      }
    }
    if (await haveTool("pactl")) {
      const sinks = await run("pactl", ["list", "short", "sinks"], 2500);
      const name = sinks.stdout
        .split("\n")
        .map((l) => l.split("\t")[1] ?? "")  // "43\tbluez_output.AA_BB_..a2dp-sink\t..."
        .find((n) => bluez.test(n));
      if (name && (await run("pactl", ["set-default-sink", name], 2000)).ok) {
        // Move any already-playing streams (Chromium's TTS) onto the new sink.
        const inputs = await run("pactl", ["list", "short", "sink-inputs"], 2000);
        for (const line of inputs.stdout.split("\n")) {
          const idx = line.split("\t")[0]?.trim();
          if (idx) await run("pactl", ["move-sink-input", idx, name], 1500);
        }
        return true;
      }
    }
  } catch {
    // Audio routing is a nicety, never a reason to fail the pair — swallow it.
  }
  return false;
}

// POST /api/bt/pair — { mac }: pair + trust + connect, budgeted to stay under
// ~12s end-to-end. Loopback only. Already-paired devices skip straight to
// connect, so the same button re-links a known speaker. On a successful
// connect it also best-effort makes the speaker the default audio sink so the
// next spoken response comes out of it (audioRouted reports whether that took).
router.post("/bt/pair", async (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const parsed = MacSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Send { mac: "AA:BB:CC:DD:EE:FF" }' }); return; }
  try {
    if (!(await haveTool("bluetoothctl"))) {
      res.json({ ok: false, available: false, error: "Bluetooth control is not available on this device" });
      return;
    }
    const mac = parsed.data.mac.toUpperCase();
    const pair = await run("bluetoothctl", ["pair", mac], 6000);
    const alreadyPaired = /AlreadyExists/i.test(pair.stdout + pair.stderr);
    if (!pair.ok && !alreadyPaired) {
      res.json({ ok: false, error: errText(pair, "pair failed") });
      return;
    }
    await run("bluetoothctl", ["trust", mac], 1500);  // best-effort: lets bluez auto-reconnect later
    const conn = await run("bluetoothctl", ["connect", mac], 4500);
    if (!conn.ok) {
      res.json({ ok: false, error: errText(conn, "connect failed") });
      return;
    }
    const audioRouted = await routeAudioToBt(mac);  // best-effort; never blocks success
    res.json({ ok: true, audioRouted });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/bt/disconnect — { mac }. Loopback only.
router.post("/bt/disconnect", async (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "local only" }); return; }
  const parsed = MacSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Send { mac: "AA:BB:CC:DD:EE:FF" }' }); return; }
  try {
    if (!(await haveTool("bluetoothctl"))) { res.json({ ok: false, available: false }); return; }
    const r = await run("bluetoothctl", ["disconnect", parsed.data.mac.toUpperCase()], 6000);
    res.json({ ok: r.ok });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;

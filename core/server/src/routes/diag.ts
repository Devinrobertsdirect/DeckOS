import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, statfsSync } from "node:fs";
import { homedir, loadavg, totalmem, freemem, uptime } from "node:os";
import { join, resolve } from "node:path";
import { envProfile } from "../hal/index.js";

/**
 * /api/diag — one snapshot that tells us everything about a robot in the
 * field: uptime, RAM, disk, CPU load + temperature, brain/node versions, the
 * wifi it's on, and whether the HAL's native modules are loadable. Read-only
 * and cheap — safe to poll from anywhere on the LAN. Off-Pi (Windows/Mac dev)
 * every probe degrades to nulls instead of erroring: temp reads sysfs first
 * (no subprocess) with a vcgencmd fallback, and wifi comes from nmcli via
 * execFile with an args array (never a shell string).
 */
const router = Router();

const execFileAsync = promisify(execFile);

// GET /api/diag — full field snapshot. GETs may serve LAN; nothing here mutates.
router.get("/diag", async (_req, res) => {
  try {
    const [net, tempC, pigpio, i2cBus] = await Promise.all([
      wifiSummary(),
      cpuTempC(),
      moduleAvailable("pigpio"),
      moduleAvailable("i2c-bus"),
    ]);
    res.json({
      uptimeSec: Math.round(uptime()),
      mem: {
        totalMb: Math.round(totalmem() / (1024 * 1024)),
        freeMb: Math.round(freemem() / (1024 * 1024)),
      },
      disk: diskSummary(),
      cpu: { load1: Math.round(loadavg()[0] * 100) / 100, tempC },
      versions: { node: process.version, brain: brainVersion() },
      net,
      hal: {
        profile: envProfile()?.id ?? null,
        modules: { pigpio, i2cBus },
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Run nmcli with an args ARRAY (SSIDs are attacker-controlled — never a shell
 * string). Returns stdout, or null when nmcli is missing (Windows/Mac dev) or
 * the command fails.
 *
 * NOTE: duplicated from the tiny helper in system-net.ts (owned by another
 * track) — dedupe into a shared lib later.
 */
async function nmcli(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("nmcli", args, { timeout: 5000 });
    return stdout;
  } catch {
    return null;
  }
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

/** Wifi summary — same shape as /api/net/status wifi. All-null when off-wifi or no nmcli. */
async function wifiSummary(): Promise<{ connected: boolean; ssid: string | null; ip: string | null; signal: number | null }> {
  const offline = { connected: false, ssid: null, ip: null, signal: null };
  const list = await nmcli(["-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"]);
  if (list === null) return offline;
  let ssid: string | null = null;
  let signal: number | null = null;
  for (const line of list.split("\n")) {
    const [active, name, sig] = splitTerse(line.trim());
    if (active === "yes" && name) {
      ssid = name;
      signal = Number.isFinite(Number(sig)) ? Number(sig) : null;
      break;
    }
  }
  if (!ssid) return offline;
  // Best-effort IP of the connected wifi device — null if we can't find it.
  let ip: string | null = null;
  const devs = await nmcli(["-t", "-f", "DEVICE,TYPE,STATE", "dev"]);
  const wifiDev = devs
    ?.split("\n")
    .map((l) => splitTerse(l.trim()))
    .find((f) => f[1] === "wifi" && f[2] === "connected")?.[0];
  if (wifiDev) {
    const addr = await nmcli(["-t", "-g", "IP4.ADDRESS", "dev", "show", wifiDev]);
    const first = addr?.trim().split("\n")[0]?.trim();
    if (first) ip = first.split("/")[0] || null;  // "10.0.0.35/24" -> "10.0.0.35"
  }
  return { connected: true, ssid, ip, signal };
}

/** CPU temperature in °C — sysfs first (no subprocess), vcgencmd fallback, null off-Pi. */
async function cpuTempC(): Promise<number | null> {
  try {
    const milli = Number(readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim());
    if (Number.isFinite(milli)) return Math.round(milli / 100) / 10;
  } catch { /* not Linux, or no thermal zone — try vcgencmd */ }
  try {
    const { stdout } = await execFileAsync("vcgencmd", ["measure_temp"], { timeout: 3000 });
    const v = Number(/temp=([\d.]+)/.exec(stdout)?.[1]);
    if (Number.isFinite(v)) return v;
  } catch { /* off-Pi — no temperature source */ }
  return null;
}

/** Disk space for the data dir (ATLAS_DATA_DIR or ~/.atlas), falling back to cwd. */
function diskSummary(): { totalMb: number; freeMb: number } {
  const dataDir = process.env["ATLAS_DATA_DIR"]?.trim() || join(homedir() || ".", ".atlas");
  for (const dir of [dataDir, process.cwd()]) {
    try {
      const s = statfsSync(dir);
      return {
        totalMb: Math.round((s.blocks * s.bsize) / (1024 * 1024)),
        freeMb: Math.round((s.bavail * s.bsize) / (1024 * 1024)),
      };
    } catch { /* dir may not exist yet — try next */ }
  }
  return { totalMb: 0, freeMb: 0 };
}

/** Brain version from package.json (same "v" prefix as /api/admin/version). */
function brainVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    const v = pkg.version ?? "unknown";
    return v.startsWith("v") ? v : `v${v}`;
  } catch {
    return "unknown";
  }
}

/** Can this optional native module load here? (Non-literal import, same trick as the HAL.) */
async function moduleAvailable(name: string): Promise<boolean> {
  try { await import(name); return true; } catch { return false; }
}

export default router;

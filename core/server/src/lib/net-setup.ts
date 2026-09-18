import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { broadcast } from "./ws-server.js";
import { logger } from "./logger.js";
import { getOrCreatePairingCode } from "./pairing.js";

const run = promisify(execFile);

/**
 * net-setup.ts — how a customer gets their Nobi onto their Wi-Fi.
 *
 * A Nobi has no keyboard, so the usual answers do not apply: there is nothing
 * to type on, no screen to read a settings menu from, and asking someone to SSH
 * into their new companion is not a product. What it does have, which almost no
 * headless device has, is a FACE and a VOICE. So it simply tells you what to do.
 *
 * When he cannot find a network he knows, he becomes one: a hotspot called
 * "Nobi-Setup-####". His face shows the name and the password and he says them
 * out loud. You join it with your phone, his page opens, you pick your Wi-Fi
 * from the list he can see and type its password once. He joins, drops the
 * hotspot, and tells you which network he is on.
 *
 * This is the same shape Sonos and Nest use, and it is deliberately NOT
 * Bluetooth: Safari has no Web Bluetooth and never has, so a Bluetooth flow
 * would need a native iOS app before a single iPhone customer could set up
 * their robot. A hotspot works on every phone ever made, with no app at all.
 *
 * Safety is the whole game here, because the failure mode is a brick on
 * somebody's shelf:
 *   · a saved network is NEVER deleted, so a wrong password cannot orphan him
 *   · joining is attempted with a timeout, and failure returns to the hotspot
 *   · a watchdog keeps looking for known networks the whole time the hotspot is
 *     up, so carrying him back into range fixes him with no interaction at all
 *   · the hotspot only ever starts when nothing known is reachable
 */

const HOTSPOT_CON = "nobi-setup";
const SETUP_PASSWORD_MIN = 8;
/** How long to let NetworkManager find a known network before offering setup. */
const BOOT_GRACE_MS = 45_000;
/** How often the watchdog re-checks while the hotspot is up. */
const WATCH_MS = 20_000;
/** A join attempt that has not succeeded by now has failed. */
const JOIN_TIMEOUT_MS = 35_000;

export interface NetStatus {
  online: boolean;
  ssid: string | null;
  /** True while the setup hotspot is being served. */
  setupMode: boolean;
  hotspotName: string;
  hotspotPassword: string;
  /** Networks he can see, freshest first. */
  networks: Array<{ ssid: string; signal: number; secure: boolean }>;
  lastError?: string;
}

let setupMode = false;
let lastError: string | undefined;
let watchdog: ReturnType<typeof setInterval> | null = null;
/** The network he was on before setup mode, so a manual test can put it back. */
let previousSsid: string | null = null;
let revertTimer: ReturnType<typeof setTimeout> | null = null;

async function nmcli(args: string[], timeoutMs = 20_000): Promise<string> {
  const { stdout } = await run("nmcli", args, { timeout: timeoutMs });
  return stdout.trim();
}

/** A name a customer can read off the screen and find in their phone's list. */
export async function hotspotName(): Promise<string> {
  const code = await getOrCreatePairingCode().catch(() => "0000");
  return `Nobi-Setup-${code.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase()}`;
}

/** The hotspot's own password: derived from the pairing code he already shows. */
export async function hotspotPassword(): Promise<string> {
  const code = (await getOrCreatePairingCode().catch(() => "nobi0000")).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return (`nobi${code}`).slice(0, Math.max(SETUP_PASSWORD_MIN, 12));
}

export async function currentSsid(): Promise<string | null> {
  try {
    const out = await nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]);
    for (const line of out.split("\n")) {
      const [, type, state, con] = line.split(":");
      if (type === "wifi" && state === "connected" && con && con !== HOTSPOT_CON) return con;
    }
  } catch { /* nmcli unavailable — treat as offline */ }
  return null;
}

/** Networks in range. Never includes his own hotspot. */
export async function scanNetworks(rescan = true): Promise<NetStatus["networks"]> {
  try {
    const out = await nmcli(["-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", rescan ? "yes" : "no"], 30_000);
    const seen = new Map<string, { ssid: string; signal: number; secure: boolean }>();
    const hs = await hotspotName();
    for (const line of out.split("\n")) {
      // SSIDs can contain colons, so split from the right.
      const parts = line.split(":");
      if (parts.length < 3) continue;
      const security = parts.pop()!;
      const signal = Number(parts.pop() ?? 0);
      const ssid = parts.join(":").trim();
      if (!ssid || ssid === hs) continue;
      const prev = seen.get(ssid);
      if (!prev || signal > prev.signal) seen.set(ssid, { ssid, signal, secure: security !== "" && security !== "--" });
    }
    return [...seen.values()].sort((a, b) => b.signal - a.signal).slice(0, 20);
  } catch (err) {
    logger.warn({ err }, "net-setup: scan failed");
    return [];
  }
}

export async function status(): Promise<NetStatus> {
  const ssid = await currentSsid();
  return {
    online: !!ssid,
    ssid,
    setupMode,
    hotspotName: await hotspotName(),
    hotspotPassword: await hotspotPassword(),
    networks: setupMode ? await scanNetworks(false) : [],
    lastError,
  };
}

function announce(): void {
  void status().then((s) => {
    broadcast({ type: "net.status", source: "net-setup", payload: s, timestamp: new Date().toISOString() });
  });
}

/**
 * Bring up the setup hotspot.
 *
 * `revertAfterMs` is the reason this can be tested at all. Starting a hotspot
 * takes the robot off Wi-Fi, which takes away the SSH I would need to undo it —
 * so a manual trigger arms a timer FIRST that puts him back on the network he
 * was on. If everything I do after that fails, including the server dying, the
 * worst case is a robot that reconnects by itself a minute later.
 */
export async function startHotspot(opts: { revertAfterMs?: number } = {}): Promise<boolean> {
  if (setupMode) return true;
  try {
    previousSsid = await currentSsid();
    if (opts.revertAfterMs) armRevert(opts.revertAfterMs);
    const ssid = await hotspotName();
    const password = await hotspotPassword();
    await nmcli(["device", "wifi", "hotspot", "ifname", "wlan0", "con-name", HOTSPOT_CON, "ssid", ssid, "password", password], 30_000);
    // Never let the hotspot profile win a boot. Without this, a robot that was
    // last in setup mode and then rebooted could come back up as a hotspot
    // instead of joining the Wi-Fi it knows — offline, and unreachable.
    await nmcli(["con", "modify", HOTSPOT_CON, "connection.autoconnect", "no"], 10_000).catch(() => undefined);
    setupMode = true;
    lastError = undefined;
    logger.info({ ssid }, "net-setup: setup hotspot is up");
    announce();
    startWatchdog();
    return true;
  } catch (err) {
    logger.error({ err }, "net-setup: could not start the setup hotspot");
    lastError = "could not start setup mode";
    return false;
  }
}

export async function stopHotspot(): Promise<void> {
  if (!setupMode) return;
  try { await nmcli(["con", "down", HOTSPOT_CON], 20_000); } catch { /* already down */ }
  setupMode = false;
  announce();
}

/** Drop setup mode and go back to the network he came from. */
export async function revertToPrevious(): Promise<boolean> {
  clearRevert();
  const back = previousSsid;
  await stopHotspot();
  if (!back) { stopWatchdog(); return false; }
  try { await nmcli(["con", "up", back], JOIN_TIMEOUT_MS); } catch { /* NM may do it on its own */ }
  for (let i = 0; i < 8; i++) {
    if (await currentSsid()) { stopWatchdog(); announce(); return true; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  announce();
  return false;
}

/**
 * Arm the return trip — twice, on purpose.
 *
 * The in-process timer is the normal path. The detached shell is the one that
 * matters: it lives outside this process, so it still fires if the server
 * crashes, is killed, or is restarted by a deploy while the hotspot is up.
 * Without it, one bad minute turns into a robot that is off Wi-Fi with no way
 * in and no way to tell it anything. It is deliberately dumb — sleep, drop the
 * hotspot, bring the old network back — because the simplest thing is the thing
 * that still works when everything else has stopped.
 */
function armRevert(ms: number): void {
  clearRevert();
  revertTimer = setTimeout(() => { void revertToPrevious(); }, ms);
  if (previousSsid) {
    const seconds = Math.ceil(ms / 1000);
    const back = previousSsid.replace(/'/g, "'\\''");
    // It checks before it acts. If setup already finished, the hotspot is no
    // longer the active connection and this does nothing — otherwise it would
    // yank a customer off the network they had just successfully joined.
    const script =
      `sleep ${seconds}; ` +
      `if nmcli -t -f NAME con show --active | grep -qx ${HOTSPOT_CON}; then ` +
      `nmcli con down ${HOTSPOT_CON}; nmcli con up '${back}'; fi`;
    spawn("sh", ["-c", `( ${script} ) >/dev/null 2>&1`], { detached: true, stdio: "ignore" }).unref();
  }
  logger.info({ ms, previousSsid }, "net-setup: revert armed (in-process and detached)");
}

function clearRevert(): void {
  if (revertTimer) { clearTimeout(revertTimer); revertTimer = null; }
  // The detached copy is harmless once we are online: it drops a hotspot that
  // is already down and brings up a network that is already up. Left alone.
}

/**
 * Join a network the customer picked. The saved networks are left alone, so a
 * failure here costs nothing but a minute — he returns to setup mode and says so.
 */
export async function joinNetwork(ssid: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!ssid) return { ok: false, error: "pick a network" };
  const wasSetup = setupMode;
  try {
    if (wasSetup) await stopHotspot();
    const args = ["device", "wifi", "connect", ssid, "ifname", "wlan0"];
    if (password) args.push("password", password);
    await nmcli(args, JOIN_TIMEOUT_MS);
    // nmcli can return success before the link settles; confirm before claiming it.
    for (let i = 0; i < 10; i++) {
      const now = await currentSsid();
      if (now === ssid) {
        lastError = undefined;
        logger.info({ ssid }, "net-setup: joined");
        // He is home. Nothing should drag him back off this network.
        clearRevert();
        previousSsid = ssid;
        stopWatchdog();
        announce();
        return { ok: true };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("did not come up");
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    lastError = /Secrets|password|authentication/i.test(msg)
      ? "That password was not accepted."
      : `Could not join ${ssid}.`;
    logger.warn({ err, ssid }, "net-setup: join failed");
    // Back to setup so they can try again — never leave him unreachable.
    if (wasSetup || !(await currentSsid())) await startHotspot();
    announce();
    return { ok: false, error: lastError };
  }
}

function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    void (async () => {
      if (!setupMode) return;
      // Carried back into range of a network he knows? Take it, quietly.
      try {
        const known = await nmcli(["-t", "-f", "NAME,TYPE", "con", "show"]);
        const names = known.split("\n").map((l) => l.split(":")[0]).filter((n): n is string => !!n && n !== HOTSPOT_CON);
        const inRange = new Set((await scanNetworks(true)).map((n) => n.ssid));
        const match = names.find((n) => inRange.has(n));
        if (match) {
          logger.info({ match }, "net-setup: a known network is back — leaving setup mode");
          await stopHotspot();
          await nmcli(["con", "up", match], JOIN_TIMEOUT_MS).catch(() => undefined);
          if (await currentSsid()) { clearRevert(); stopWatchdog(); announce(); return; }
          await startHotspot();
        }
      } catch { /* try again next tick */ }
    })();
  }, WATCH_MS);
}

function stopWatchdog(): void {
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
}

/**
 * Called at boot. Gives NetworkManager a fair chance to find something it knows,
 * then offers setup. Never interrupts a working connection.
 */
export function beginNetworkWatch(): void {
  setTimeout(() => {
    void (async () => {
      if (await currentSsid()) { announce(); return; }
      logger.info("net-setup: no known network after the boot grace period — offering setup");
      await startHotspot();
    })();
  }, BOOT_GRACE_MS);
}

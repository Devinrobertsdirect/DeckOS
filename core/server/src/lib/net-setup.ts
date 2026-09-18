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
 *   · while he fell into setup on his own, a watchdog keeps looking for known
 *     networks, so carrying him back into range fixes him with no interaction
 *   · he only falls into setup on his own when nothing known is reachable; a
 *     person can ask for it at any time, and then the watchdog stands down so
 *     it cannot end their session while they are still typing
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
  /** Why he is in setup — "requested" sessions are never ended by the watchdog. */
  setupReason: "auto" | "requested";
  hotspotName: string;
  hotspotPassword: string;
  /** Networks he can see, freshest first. */
  networks: Array<{ ssid: string; signal: number; secure: boolean }>;
  lastError?: string;
}

let setupMode = false;
/**
 * WHY he is in setup mode, which decides whether he is allowed to leave it.
 *
 * "auto" means he could not find a network he knows, so falling back to one the
 * moment it appears is the kindest thing he can do — carry him into range and he
 * fixes himself with no interaction at all.
 *
 * "requested" means a person asked for setup while he was perfectly online, and
 * the old network is therefore still sitting right there in range. Auto-recovery
 * would abandon setup within one watchdog tick — measured at twenty-five seconds
 * on real hardware — which is not enough time for anyone to pick a network and
 * type a password. A person who asked keeps setup mode until they finish or the
 * armed revert fires.
 */
let setupReason: "auto" | "requested" = "auto";
let lastError: string | undefined;
let watchdog: ReturnType<typeof setInterval> | null = null;
/** The network he was on before setup mode, so a manual test can put it back. */
let previousSsid: string | null = null;
let revertTimer: ReturnType<typeof setTimeout> | null = null;

async function nmcli(args: string[], timeoutMs = 20_000): Promise<string> {
  const { stdout } = await run("nmcli", args, { timeout: timeoutMs });
  return stdout.trim();
}

/**
 * Split one line of `nmcli -t` output into fields.
 *
 * Terse mode uses ':' as the separator and escapes any ':' or '\' that appears
 * INSIDE a value as '\:' and '\\'. Splitting on ':' naively therefore corrupts
 * every network whose name contains a colon — and people really do name a
 * network "Floor 2: Guest". The old code split naively and would have shown
 * that network under a mangled name it could then never connect to.
 */
function terseFields(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === ":") { fields.push(cur); cur = ""; continue; }
    cur += c;
  }
  fields.push(cur);
  return fields;
}

/**
 * Make the setup page open BY ITSELF when a phone joins the hotspot.
 *
 * Every phone, on joining a network, fetches a known URL to decide whether it
 * is behind a sign-in page — captive.apple.com on iOS, connectivitycheck on
 * Android. If that fetch returns a redirect, the phone pops the setup page up
 * on its own with no URL to read out and nothing to type. If it fails instead,
 * the phone just says "no internet" and the customer is stuck.
 *
 * Two things have to be true, and neither is true by default:
 *
 *   1. DNS has to answer for every name, because there is no upstream resolver
 *      out here. NetworkManager runs a private dnsmasq for shared connections
 *      only, and honours drop-ins — so this affects the hotspot and nothing else.
 *   2. The probe goes to port 80, and he listens on 8080. An nftables redirect
 *      in a table of our own bridges that, and the table is torn down with the
 *      hotspot so it cannot linger on a normal network.
 *
 * This is done in CODE rather than left as a setup step because the person who
 * needs it is a customer holding a new robot. They cannot run a command.
 */
const CAPTIVE_CONF = "/etc/NetworkManager/dnsmasq-shared.d/nobi-captive.conf";
/** NetworkManager always gives a shared connection this address. */
const HOTSPOT_IP = "10.42.0.1";

async function ensureCaptiveDns(): Promise<void> {
  try {
    // Written before the hotspot starts, because dnsmasq reads it at launch.
    await run("sudo", ["-n", "sh", "-c",
      `printf 'address=/#/${HOTSPOT_IP}\\n' > ${CAPTIVE_CONF}`], { timeout: 10_000 });
  } catch (err) {
    // Not fatal: without it he simply falls back to reading the URL aloud.
    logger.warn({ err }, "net-setup: could not install captive DNS — the page will not auto-open");
  }
}

async function openCaptivePort(port: number): Promise<void> {
  try {
    await run("sudo", ["-n", "nft", "add", "table", "ip", "nobi"], { timeout: 10_000 });
    await run("sudo", ["-n", "nft", "add", "chain", "ip", "nobi", "prerouting",
      "{ type nat hook prerouting priority dstnat ; }"], { timeout: 10_000 });
    await run("sudo", ["-n", "nft", "add", "rule", "ip", "nobi", "prerouting",
      "iifname", "wlan0", "tcp", "dport", "80", "redirect", "to", `:${port}`], { timeout: 10_000 });
  } catch (err) {
    logger.warn({ err }, "net-setup: could not redirect port 80 — the page will not auto-open");
  }
}

async function closeCaptivePort(): Promise<void> {
  // The whole table is ours, so dropping it cannot disturb anyone else's rules.
  await run("sudo", ["-n", "nft", "delete", "table", "ip", "nobi"], { timeout: 10_000 })
    .catch(() => undefined);
}

/** A name a customer can read off the screen and find in their phone's list. */
export async function hotspotName(): Promise<string> {
  const code = await getOrCreatePairingCode().catch(() => "0000");
  return `Nobi-Setup-${code.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase()}`;
}

/**
 * The hotspot's own password, derived from the pairing code he already shows.
 *
 * WPA2 refuses anything shorter than 8 characters, and nmcli reports that as a
 * generic failure to start — so a short or unusual stored pairing code would
 * mean a customer's robot simply never offers setup, with nothing on screen to
 * say why. Today's codes are 7 alphanumerics so this cannot bite, which is
 * exactly the kind of assumption that stops being true quietly.
 */
export async function hotspotPassword(): Promise<string> {
  const code = (await getOrCreatePairingCode().catch(() => "nobi0000")).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const pw = `nobi${code}`.padEnd(SETUP_PASSWORD_MIN, "0");
  return pw.slice(0, 20);
}

export async function currentSsid(): Promise<string | null> {
  try {
    const out = await nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]);
    for (const line of out.split("\n")) {
      const [, type, state, con] = terseFields(line);
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
      const [rawSsid, rawSignal, security] = terseFields(line);
      if (security === undefined) continue;
      const ssid = (rawSsid ?? "").trim();
      const signal = Number(rawSignal ?? 0);
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
    setupReason,
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
export async function startHotspot(opts: { revertAfterMs?: number; reason?: "auto" | "requested" } = {}): Promise<boolean> {
  if (setupMode) return true;
  try {
    setupReason = opts.reason ?? "auto";
    previousSsid = await currentSsid();
    if (opts.revertAfterMs) armRevert(opts.revertAfterMs);
    // dnsmasq reads its config when the shared connection comes up, so this has
    // to be in place BEFORE the hotspot starts, not after.
    await ensureCaptiveDns();
    const ssid = await hotspotName();
    const password = await hotspotPassword();
    await nmcli(["device", "wifi", "hotspot", "ifname", "wlan0", "con-name", HOTSPOT_CON, "ssid", ssid, "password", password], 30_000);
    // Never let the hotspot profile win a boot. Without this, a robot that was
    // last in setup mode and then rebooted could come back up as a hotspot
    // instead of joining the Wi-Fi it knows — offline, and unreachable.
    await nmcli(["con", "modify", HOTSPOT_CON, "connection.autoconnect", "no"], 10_000).catch(() => undefined);
    setupMode = true;
    lastError = undefined;
    await openCaptivePort(Number(process.env["PORT"] ?? 8080));
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
  // Take the port-80 redirect back out with the hotspot. It must never survive
  // onto a normal network, where it would quietly capture ordinary traffic.
  await closeCaptivePort();
  setupMode = false;
  // Leaving setup clears why he entered it, so a later automatic fallback is
  // not still treated as something a person asked for. Callers that are only
  // passing THROUGH setup (a join attempt) pass their reason back explicitly.
  setupReason = "auto";
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
      `nmcli con down ${HOTSPOT_CON}; ` +
      // Drop the port-80 capture too. If the brain died while the hotspot was
      // up, this is the only thing left that will take it off a live network.
      `sudo -n nft delete table ip nobi 2>/dev/null; ` +
      `nmcli con up '${back}'; fi`;
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
  // Remember WHY he was in setup: a wrong password must put him back into the
  // same kind of setup he was in, or a person who explicitly asked for setup
  // mode gets silently downgraded to the automatic one and the watchdog then
  // ends their session out from under them on the next tick.
  const wasReason = setupReason;
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
    if (wasSetup || !(await currentSsid())) await startHotspot({ reason: wasReason });
    announce();
    return { ok: false, error: lastError };
  }
}

function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    void (async () => {
      if (!setupMode) return;
      // A person asked for setup while he was online, so the network he came
      // from is still in range and this would end setup within one tick —
      // measured at 25 seconds on real hardware, which is nowhere near enough
      // time to pick a network and type a password. Their safety net is the
      // armed revert, not this.
      if (setupReason === "requested") return;
      // Carried back into range of a network he knows? Take it, quietly.
      try {
        const known = await nmcli(["-t", "-f", "NAME,TYPE", "con", "show"]);
        const names = known.split("\n").map((l) => terseFields(l)[0]).filter((n): n is string => !!n && n !== HOTSPOT_CON);
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
      // Already serving setup — which is what currentSsid() reads as "offline",
      // because his own hotspot is not a network he joined. Seen for real: a
      // deploy restarted the brain while a setup session was live, and 45s later
      // this fired and announced "no known network" over a hotspot that was
      // working perfectly. It was harmless only because startHotspot() returns
      // early, which is far too subtle a thing to be relying on.
      if (setupMode) return;
      if (await currentSsid()) { announce(); return; }
      logger.info("net-setup: no known network after the boot grace period — offering setup");
      await startHotspot({ reason: "auto" });
    })();
  }, BOOT_GRACE_MS);
}

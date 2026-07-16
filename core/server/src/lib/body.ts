/**
 * body.ts — the process-wide Atlas body, with live plug-and-play.
 *
 * Picks the right HAL body for this machine and, crucially, watches the USB
 * ports: plug an Arduino/ESP32 in and the brain connects to it automatically
 * (SerialBridgeBody), reads its telemetry + "record" drop, and can drive it;
 * unplug it and the brain falls back to the virtual body. One accessor,
 * `getBody()`, so routes/behaviours never care what they're driving.
 */
import { createBody, detectBackend, desktopProfile, SerialBridgeBody, type AtlasBody, type DetectResult, type HardwareProfile } from "../hal/index.js";
import { SerialPortTransport, listBoardPorts } from "./serialTransport.js";
import { discoverRoles } from "./boardRoles.js";

let body: AtlasBody | null = null;
let starting: Promise<AtlasBody> | null = null;
let detection: DetectResult | null = null;
let currentPort: string | null = null;
let watcher: ReturnType<typeof setInterval> | null = null;
let swapping = false;

function serialProfile(port: string): HardwareProfile {
  return {
    id: "atlas-serial",
    name: `Serial body (${port})`,
    backend: "serial",
    target: "arduino / esp32",
    serial: { path: port, baud: 115200 },
    drive: { wheelBaseM: 0.12, wheelRadiusM: 0.025, maxSpeedMps: 0.35 },
  };
}

/**
 * Which board port the DRIVE body uses: an explicit ATLAS_SERIAL, else a USB
 * board. With a single board it's just that one (unchanged, verified path).
 * With two+ boards we probe roles and steer clear of the FACE node so the
 * motors and the eyes don't share a port.
 */
async function pickPort(): Promise<string | null> {
  const forced = process.env["ATLAS_SERIAL"]?.trim();
  if (forced) return forced;
  const facePort = process.env["ATLAS_FACE_SERIAL"]?.trim();
  let ports = (await listBoardPorts()).map((p) => p.path);
  if (facePort) ports = ports.filter((p) => p !== facePort);
  if (ports.length <= 1) return ports[0] ?? null;
  // Multiple boards → avoid the face node; take the first non-face port.
  const roles = await discoverRoles();
  return ports.find((p) => roles.get(p) !== "face") ?? ports[0] ?? null;
}

async function connectSerial(port: string): Promise<AtlasBody | null> {
  try {
    const profile = serialProfile(port);
    const b = new SerialBridgeBody(new SerialPortTransport(port, 115200), profile);
    await b.start();
    currentPort = port;
    detection = { ...detectBackend(profile), backend: "serial", reason: `board connected on ${port}` };
    return b;
  } catch {
    return null;
  }
}

async function connectVirtual(): Promise<AtlasBody> {
  const profile = desktopProfile();
  detection = detectBackend(profile);
  currentPort = null;
  const b = createBody(profile);
  await b.start();
  return b;
}

async function makeBody(): Promise<AtlasBody> {
  const port = await pickPort();
  if (port) {
    const serial = await connectSerial(port);
    if (serial) return serial;
  }
  // No board (or serial unavailable) → the always-works virtual body.
  const det = detectBackend(desktopProfile());
  try {
    const b = createBody({ ...desktopProfile(), backend: det.backend });
    await b.start();
    detection = det;
    return b;
  } catch {
    return connectVirtual();
  }
}

export async function getBody(): Promise<AtlasBody> {
  if (body) return body;
  if (starting) return starting;
  starting = (async () => {
    body = await makeBody();
    startWatcher();
    return body;
  })();
  return starting;
}

// ── Hot-plug watcher — connect on plug-in, revert on unplug ───────────────────
function startWatcher(): void {
  if (watcher) return;
  watcher = setInterval(() => { void tick(); }, 3000);
}
async function tick(): Promise<void> {
  if (swapping || !body) return;
  try {
    const port = await pickPort();
    if (port && currentPort !== port) {
      swapping = true;
      const serial = await connectSerial(port);
      if (serial) { const old = body; body = serial; try { await old?.stop(); } catch { /* ignore */ } }
      swapping = false;
    } else if (!port && currentPort) {
      swapping = true;
      const old = body;
      body = await connectVirtual();
      try { await old?.stop(); } catch { /* ignore */ }
      swapping = false;
    }
  } catch { swapping = false; }
}

export function getBodyDetection(): DetectResult | null {
  return detection;
}

export function peekBody(): AtlasBody | null {
  return body;
}

/**
 * Board presence for the client's plug-in experience: is a physical board
 * connected, on which port, and what did it drop off (its record)?
 */
export async function getPresence(): Promise<{
  present: boolean; port: string | null; connected: boolean;
  board: string | null; backend: string | null;
  record: { boot: number; lifeSec: number; sessMs: number } | null;
}> {
  const port = await pickPort().catch(() => null);
  // A board is present → make sure the brain is connecting to it (non-blocking),
  // so its record gets read and driving works.
  if (port) void getBody();
  const st = body?.getState();
  return {
    present: !!port,
    port: port ?? currentPort,
    connected: !!(st && st.connected && body?.kind === "serial"),
    board: st?.board ?? null,
    backend: detection?.backend ?? null,
    record: st?.record ?? null,
  };
}

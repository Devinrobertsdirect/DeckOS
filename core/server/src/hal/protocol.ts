/**
 * Atlas Wire Protocol (AWP) v1 — the contract between the Atlas brain and any
 * body (ESP32, Arduino Nano, a custom board, or a Pi co-processor).
 *
 * Design goals:
 *   - Parse trivially on an 8-bit Arduino Nano (no JSON library, no heap churn):
 *     plain ASCII lines, one message per line, `\n`-terminated, tokens split on
 *     spaces, payload as positional or `key=value` pairs.
 *   - Human-readable on a serial monitor for debugging.
 *   - Transport-agnostic: the exact same lines flow over USB serial, a WiFi
 *     WebSocket, BLE, or MQTT.
 *
 * Commands flow brain → body; telemetry/events flow body → brain.
 */

export const AWP_VERSION = 1;

/**
 * The canonical face-state vocabulary a face node must understand. Mirrors the
 * app's `FaceState` (interfaces/desktop/.../atlasFaceEngine.ts) so the brain,
 * the browser face, and the physical LCD face all speak the same expressions.
 * Kept as a plain list (not an enum) so the wire value stays a tolerant string.
 */
export const AWP_FACE_STATES = [
  "idle", "listening", "thinking", "talking", "happy", "confused", "excited",
  "charging", "sleeping", "angry", "suspicious", "sad", "love", "wink", "starstruck",
] as const;
export type AwpFaceState = (typeof AWP_FACE_STATES)[number];

// ── Message shapes (decoded) ─────────────────────────────────────────────────
export type DriveCmd = { t: "DRIVE"; l: number; r: number };   // l/r ∈ [-1, 1]
export type StopCmd = { t: "STOP" };
/**
 * Set the face. `state` is one of AWP_FACE_STATES; `color` is the eye colour as
 * "r,g,b" (the "seam" accent), `bright` an optional 0..100 idle-glow level.
 */
export type FaceCmd = { t: "FACE"; state: string; color?: string; bright?: number };
export type EstopCmd = { t: "ESTOP"; on: boolean };
export type ServoCmd = { t: "SERVO"; id: number; deg: number };
export type ToneCmd = { t: "TONE"; hz: number; ms: number };
export type CfgCmd = { t: "CFG"; values: Record<string, string> };
export type PingCmd = { t: "PING"; n: number };
export type HelloCmd = { t: "HELLO"; v: number; name: string };
export type SyncCmd = { t: "SYNC" };

export type Command =
  | DriveCmd | StopCmd | FaceCmd | EstopCmd | ServoCmd | ToneCmd | CfgCmd | PingCmd | HelloCmd | SyncCmd;

/**
 * A node announces itself with READY. `role` tells the brain what this node is —
 * "face" (an LCD/eyes+touch co-processor), "drive" (motors/encoders), or "body"
 * (both, the classic all-in-one) — so one Pi can run a face node and a drive
 * node on two separate links without confusing them.
 */
export type ReadyMsg = { t: "READY"; v: number; board: string; caps: string[]; role?: string };
export type TelemetryMsg = {
  t: "TEL";
  encL?: number; encR?: number;
  battMv?: number; battPct?: number;
  dock?: boolean; estop?: boolean;
  tof?: number[];        // forward ToF distances, mm
  yaw?: number;          // heading, degrees
};
export type EventMsg = { t: "EVENT"; e: string };
export type PongMsg = { t: "PONG"; n: number };
export type LogMsg = { t: "LOG"; msg: string };
/** The body's persistent logbook, dropped off on connect / SYNC. */
export type RecordMsg = { t: "RECORD"; boot: number; lifeSec: number; sessMs: number };
/**
 * User input from a face node — the CrowPanel/CYD's touch panel and rotary knob.
 * The brain turns these into buddy actions (tap → wake/listen, knob → volume,
 * press → confirm). Coordinates are in panel pixels (0..width, 0..height).
 */
export type InputMsg = {
  t: "INPUT";
  kind: "tap" | "touch" | "release" | "long" | "knob" | "press";
  x?: number; y?: number;   // tap/touch position
  dir?: number;             // knob: -1 (ccw) | +1 (cw)
  delta?: number;           // knob: accumulated steps since last report
};

export type Report = ReadyMsg | TelemetryMsg | EventMsg | PongMsg | LogMsg | RecordMsg | InputMsg;

// ── Encode (brain → body) ────────────────────────────────────────────────────
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Serialize a command to a single AWP line (no trailing newline). */
export function encodeCommand(cmd: Command): string {
  switch (cmd.t) {
    case "HELLO": return `HELLO v=${cmd.v} name=${sanitize(cmd.name)}`;
    case "DRIVE": {
      // Per-mille integers keep the wire free of floats — easy on a Nano.
      const l = Math.round(clamp(cmd.l, -1, 1) * 1000);
      const r = Math.round(clamp(cmd.r, -1, 1) * 1000);
      return `DRIVE l=${l} r=${r}`;
    }
    case "STOP": return "STOP";
    case "FACE": return `FACE state=${sanitize(cmd.state)}${cmd.color ? ` color=${sanitize(cmd.color)}` : ""}${cmd.bright !== undefined ? ` bright=${clamp(cmd.bright, 0, 100) | 0}` : ""}`;
    case "ESTOP": return `ESTOP on=${cmd.on ? 1 : 0}`;
    case "SERVO": return `SERVO id=${cmd.id | 0} deg=${clamp(cmd.deg, 0, 180) | 0}`;
    case "TONE": return `TONE hz=${cmd.hz | 0} ms=${cmd.ms | 0}`;
    case "PING": return `PING n=${cmd.n | 0}`;
    case "SYNC": return "SYNC";
    case "CFG": {
      const pairs = Object.entries(cmd.values).map(([k, v]) => `${sanitize(k)}=${sanitize(v)}`);
      return `CFG ${pairs.join(" ")}`;
    }
  }
}

// ── Decode (body → brain) ────────────────────────────────────────────────────
/** Parse one AWP line from the body into a Report, or null if unrecognized. */
export function decodeReport(line: string): Report | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const [verb, ...rest] = trimmed.split(/\s+/);
  const kv = parseKv(rest);
  switch (verb) {
    case "READY":
      return { t: "READY", v: int(kv["v"], 1), board: kv["board"] ?? "unknown", role: kv["role"], caps: (kv["caps"] ?? "").split(",").filter(Boolean) };
    case "TEL":
      return {
        t: "TEL",
        encL: numOrU(kv["encL"]), encR: numOrU(kv["encR"]),
        battMv: numOrU(kv["battmv"]), battPct: numOrU(kv["battpct"]),
        dock: boolOrU(kv["dock"]), estop: boolOrU(kv["estop"]),
        tof: kv["tof"] ? kv["tof"].split(",").map((s) => Number(s)).filter((n) => !Number.isNaN(n)) : undefined,
        yaw: numOrU(kv["yaw"]),
      };
    case "EVENT": return { t: "EVENT", e: kv["e"] ?? "" };
    case "INPUT": return {
      t: "INPUT",
      kind: (["tap", "touch", "release", "long", "knob", "press"].includes(kv["kind"] ?? "") ? kv["kind"] : "tap") as InputMsg["kind"],
      x: numOrU(kv["x"]), y: numOrU(kv["y"]), dir: numOrU(kv["dir"]), delta: numOrU(kv["delta"]),
    };
    case "RECORD": return { t: "RECORD", boot: int(kv["boot"], 0), lifeSec: int(kv["life_s"], 0), sessMs: int(kv["sess_ms"], 0) };
    case "PONG": return { t: "PONG", n: int(kv["n"], 0) };
    case "LOG": return { t: "LOG", msg: rest.join(" ").replace(/^msg=/, "") };
    default: return null;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function parseKv(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq > 0) out[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return out;
}
function int(s: string | undefined, def: number): number {
  const n = parseInt(s ?? "", 10);
  return Number.isNaN(n) ? def : n;
}
function numOrU(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}
function boolOrU(s: string | undefined): boolean | undefined {
  if (s === undefined) return undefined;
  return s === "1" || s === "true";
}
/** Wire values can't contain spaces or newlines. */
function sanitize(s: string): string {
  return String(s).replace(/[\s]+/g, "_");
}

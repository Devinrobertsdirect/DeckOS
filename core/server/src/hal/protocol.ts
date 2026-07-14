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

// ── Message shapes (decoded) ─────────────────────────────────────────────────
export type DriveCmd = { t: "DRIVE"; l: number; r: number };   // l/r ∈ [-1, 1]
export type StopCmd = { t: "STOP" };
export type FaceCmd = { t: "FACE"; state: string; color?: string };
export type EstopCmd = { t: "ESTOP"; on: boolean };
export type ServoCmd = { t: "SERVO"; id: number; deg: number };
export type ToneCmd = { t: "TONE"; hz: number; ms: number };
export type CfgCmd = { t: "CFG"; values: Record<string, string> };
export type PingCmd = { t: "PING"; n: number };
export type HelloCmd = { t: "HELLO"; v: number; name: string };

export type Command =
  | DriveCmd | StopCmd | FaceCmd | EstopCmd | ServoCmd | ToneCmd | CfgCmd | PingCmd | HelloCmd;

export type ReadyMsg = { t: "READY"; v: number; board: string; caps: string[] };
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

export type Report = ReadyMsg | TelemetryMsg | EventMsg | PongMsg | LogMsg;

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
    case "FACE": return `FACE state=${sanitize(cmd.state)}${cmd.color ? ` color=${sanitize(cmd.color)}` : ""}`;
    case "ESTOP": return `ESTOP on=${cmd.on ? 1 : 0}`;
    case "SERVO": return `SERVO id=${cmd.id | 0} deg=${clamp(cmd.deg, 0, 180) | 0}`;
    case "TONE": return `TONE hz=${cmd.hz | 0} ms=${cmd.ms | 0}`;
    case "PING": return `PING n=${cmd.n | 0}`;
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
      return { t: "READY", v: int(kv["v"], 1), board: kv["board"] ?? "unknown", caps: (kv["caps"] ?? "").split(",").filter(Boolean) };
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

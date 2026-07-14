import { EventEmitter } from "node:events";
import type { AtlasBody, BodyBackend, BodyEvent, BodyState, HardwareProfile } from "../types.js";

/**
 * SimBody — a virtual Atlas body. No hardware required, so Atlas is fully
 * functional on a laptop or a fresh install: drive commands integrate into
 * simulated odometry, a battery drains slowly, and telemetry streams at ~10 Hz
 * exactly like a real board. This is the default body on Linux/Windows desktop.
 */
export class SimBody implements AtlasBody {
  readonly kind: BodyBackend = "sim";

  private emitter = new EventEmitter();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;

  private l = 0; // normalized wheel speed [-1,1]
  private r = 0;
  private estop = false;

  private state: BodyState = {
    connected: false,
    board: "sim",
    caps: ["drive", "enc", "tof", "imu", "batt", "face"],
    odom: { x: 0, y: 0, th: 0 },
    encoders: { l: 0, r: 0 },
    battery: { mv: 16800, pct: 100 },
    dock: false,
    estop: false,
    tof: [4000, 4000, 4000, 4000, 4000],
    yaw: 0,
    updatedAt: 0,
  };

  private readonly maxSpeed: number;
  private readonly wheelBase: number;

  constructor(profile?: HardwareProfile) {
    this.maxSpeed = profile?.drive?.maxSpeedMps ?? 0.6;
    this.wheelBase = profile?.drive?.wheelBaseM ?? 0.18;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.state.connected = true;
    this.lastTick = nowMs();
    this.timer = setInterval(() => this.tick(), 100); // 10 Hz
    this.emitter.emit("ready", { board: "sim", caps: this.state.caps });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.connected = false;
    this.emitter.emit("disconnect", {});
  }

  drive(l: number, r: number): void {
    if (this.estop) { this.l = 0; this.r = 0; return; }
    this.l = clamp(l, -1, 1);
    this.r = clamp(r, -1, 1);
  }

  driveVelocity(linearMps: number, angularRps: number): void {
    // Differential kinematics → per-wheel m/s, then normalize by top speed.
    const half = this.wheelBase / 2;
    const lMps = linearMps - angularRps * half;
    const rMps = linearMps + angularRps * half;
    this.drive(lMps / this.maxSpeed, rMps / this.maxSpeed);
  }

  halt(): void { this.l = 0; this.r = 0; }

  setFace(_state: string, _color?: string): void { /* sim has no panel; the UI face is separate */ }

  setEstop(on: boolean): void {
    this.estop = on;
    this.state.estop = on;
    if (on) this.halt();
    this.emitter.emit("event", { e: on ? "estop_on" : "estop_off" });
  }

  getState(): BodyState { return { ...this.state, odom: { ...this.state.odom } }; }

  on(event: BodyEvent, cb: (payload: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  // ── simulation ──────────────────────────────────────────────────────────────
  private tick(): void {
    const t = nowMs();
    const dt = Math.min(0.25, (t - this.lastTick) / 1000);
    this.lastTick = t;

    const lMps = this.l * this.maxSpeed;
    const rMps = this.r * this.maxSpeed;
    const v = (lMps + rMps) / 2;
    const w = (rMps - lMps) / this.wheelBase;

    const s = this.state;
    s.odom.th = wrap(s.odom.th + w * dt);
    s.odom.x += v * Math.cos(s.odom.th) * dt;
    s.odom.y += v * Math.sin(s.odom.th) * dt;
    // Encoders: accumulate counts (arbitrary 1000 counts/m).
    s.encoders.l += Math.round(lMps * dt * 1000);
    s.encoders.r += Math.round(rMps * dt * 1000);
    s.yaw = (s.odom.th * 180) / Math.PI;

    // Battery: drain faster when driving.
    const drain = 0.0008 + Math.abs(v) * 0.004;
    s.battery.pct = Math.max(0, (s.battery.pct ?? 100) - drain);
    s.battery.mv = Math.round(13600 + (s.battery.pct / 100) * 3200); // 4S: ~13.6–16.8 V

    s.updatedAt = t;
    this.emitter.emit("telemetry", this.getState());
  }
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }
function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
// new Date()/Date.now() are fine in the server (only workflow scripts forbid them).
function nowMs(): number { return Date.now(); }

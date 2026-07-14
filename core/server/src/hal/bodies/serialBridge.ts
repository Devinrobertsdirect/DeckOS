import { EventEmitter } from "node:events";
import type { AtlasBody, BodyBackend, BodyEvent, BodyState, HardwareProfile, LineTransport } from "../types.js";
import { encodeCommand, decodeReport, AWP_VERSION, type Command } from "../protocol.js";

/**
 * SerialBridgeBody — drives a real microcontroller body (ESP32, Arduino Nano, or
 * a custom board) by speaking the Atlas Wire Protocol over an injected line
 * transport. The transport can be USB serial, a WiFi WebSocket, BLE, or MQTT —
 * the HAL doesn't care and has no hard dependency on any of them.
 *
 * Safety: a watchdog re-sends STOP if we haven't refreshed the drive command
 * recently, and a lost link halts motion — so a disconnected cable can't leave
 * the wheels spinning.
 */
export class SerialBridgeBody implements AtlasBody {
  readonly kind: BodyBackend = "serial";

  private emitter = new EventEmitter();
  private transport: LineTransport;
  private profile: HardwareProfile;

  private wantL = 0;
  private wantR = 0;
  private estopOn = false;
  private lastDriveSent = 0;
  private keepalive: ReturnType<typeof setInterval> | null = null;

  private state: BodyState = {
    connected: false,
    board: "unknown",
    caps: [],
    odom: { x: 0, y: 0, th: 0 },
    encoders: { l: 0, r: 0 },
    battery: {},
    dock: false,
    estop: false,
    tof: [],
    updatedAt: 0,
  };

  private readonly maxSpeed: number;
  private readonly wheelBase: number;
  private readonly invertL: boolean;
  private readonly invertR: boolean;

  constructor(transport: LineTransport, profile: HardwareProfile) {
    this.transport = transport;
    this.profile = profile;
    this.maxSpeed = profile.drive?.maxSpeedMps ?? 0.6;
    this.wheelBase = profile.drive?.wheelBaseM ?? 0.18;
    this.invertL = profile.drive?.invertL ?? false;
    this.invertR = profile.drive?.invertR ?? false;
  }

  async start(): Promise<void> {
    this.transport.onLine((line) => this.handleLine(line));
    this.transport.onStatus((up) => {
      this.state.connected = up;
      if (!up) { this.state.board = "unknown"; this.emitter.emit("disconnect", {}); }
    });
    await this.transport.open();
    // Announce ourselves and push any board config from the profile.
    this.send({ t: "HELLO", v: AWP_VERSION, name: "Atlas" });
    if (this.profile.config && Object.keys(this.profile.config).length) {
      this.send({ t: "CFG", values: this.profile.config });
    }
    // Re-assert the drive command at 20 Hz so the firmware watchdog stays fed.
    this.keepalive = setInterval(() => this.pump(), 50);
  }

  async stop(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    this.halt();
    this.send({ t: "STOP" });
    await this.transport.close();
    this.state.connected = false;
  }

  drive(l: number, r: number): void {
    if (this.estopOn) { this.wantL = 0; this.wantR = 0; return; }
    this.wantL = clamp(l, -1, 1) * (this.invertL ? -1 : 1);
    this.wantR = clamp(r, -1, 1) * (this.invertR ? -1 : 1);
    this.pump();
  }

  driveVelocity(linearMps: number, angularRps: number): void {
    const half = this.wheelBase / 2;
    const lMps = linearMps - angularRps * half;
    const rMps = linearMps + angularRps * half;
    this.drive(lMps / this.maxSpeed, rMps / this.maxSpeed);
  }

  halt(): void {
    this.wantL = 0;
    this.wantR = 0;
    this.send({ t: "STOP" });
  }

  setFace(state: string, color?: string): void {
    this.send({ t: "FACE", state, color });
  }

  setEstop(on: boolean): void {
    this.estopOn = on;
    if (on) this.halt();
    this.send({ t: "ESTOP", on });
  }

  getState(): BodyState { return { ...this.state, odom: { ...this.state.odom } }; }

  on(event: BodyEvent, cb: (payload: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  // ── internals ────────────────────────────────────────────────────────────────
  private pump(): void {
    // Only re-send when driving or periodically, to avoid flooding the link.
    const now = Date.now();
    const moving = this.wantL !== 0 || this.wantR !== 0;
    if (moving || now - this.lastDriveSent > 200) {
      this.send({ t: "DRIVE", l: this.wantL, r: this.wantR });
      this.lastDriveSent = now;
    }
  }

  private send(cmd: Command): void {
    if (!this.transport) return;
    try { this.transport.writeLine(encodeCommand(cmd)); } catch { /* link hiccup */ }
  }

  private handleLine(line: string): void {
    const report = decodeReport(line);
    if (!report) return;
    const s = this.state;
    switch (report.t) {
      case "READY":
        s.connected = true;
        s.board = report.board;
        s.caps = report.caps;
        this.emitter.emit("ready", { board: report.board, caps: report.caps });
        break;
      case "TEL":
        if (report.encL !== undefined) s.encoders.l = report.encL;
        if (report.encR !== undefined) s.encoders.r = report.encR;
        if (report.battMv !== undefined) s.battery.mv = report.battMv;
        if (report.battPct !== undefined) s.battery.pct = report.battPct;
        if (report.dock !== undefined) s.dock = report.dock;
        if (report.estop !== undefined) s.estop = report.estop;
        if (report.tof) s.tof = report.tof;
        if (report.yaw !== undefined) s.yaw = report.yaw;
        s.updatedAt = Date.now();
        this.emitter.emit("telemetry", this.getState());
        break;
      case "RECORD":
        s.record = { boot: report.boot, lifeSec: report.lifeSec, sessMs: report.sessMs };
        this.emitter.emit("event", { e: "record", record: s.record });
        break;
      case "EVENT":
        if (report.e.startsWith("estop")) s.estop = report.e === "estop_on" || report.e === "estop";
        this.emitter.emit("event", { e: report.e });
        break;
      case "LOG":
        this.emitter.emit("event", { e: "log", msg: report.msg });
        break;
      case "PONG":
        break;
    }
  }
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }

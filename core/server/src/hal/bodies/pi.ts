import { EventEmitter } from "node:events";
import type { AtlasBody, BodyBackend, BodyEvent, BodyState, HardwareProfile } from "../types.js";

/**
 * PiGpioBody — drives the robot directly from a Raspberry Pi's GPIO, per the
 * ATL-HW / ATL-PCB pin map (BCM numbering):
 *
 *   motor PWM (20 kHz)  BCM 12 / 13   (L / R speed)
 *   motor DIR           BCM 5  / 6    (TB6612 direction)
 *   e-stop sense        BCM 26        (pulled-up, RC-filtered)
 *   dock sense          BCM 27        (pogo contact)
 *   fan PWM             BCM 4
 *
 * Sensor buses (I²C sensors: BNO085 IMU, TCA9548A→ToF, INA219; I²S audio; SPI
 * face) are separate extension points — hang them off this body as they come
 * online. `pigpio` is imported dynamically so this file compiles on any OS; it
 * only actually loads on a Pi with the daemon available.
 */

// TB6612 wiring per side.
const PIN = {
  pwmL: 12, pwmR: 13,
  dirL: 5, dirR: 6,
  estop: 26, dock: 27,
  fan: 4,
} as const;

interface PiGpioPin {
  pwmWrite(v: number): void;
  digitalWrite(v: number): void;
  digitalRead(): number;
  mode(m: number): void;
  pullUpDown(p: number): void;
}
interface PiGpioModule {
  Gpio: {
    new (pin: number, opts?: Record<string, unknown>): PiGpioPin;
    OUTPUT: number; INPUT: number; PUD_UP: number;
  };
}

export class PiGpioBody implements AtlasBody {
  readonly kind: BodyBackend = "pi";

  private emitter = new EventEmitter();
  private gpio: PiGpioModule | null = null;
  private pins: Record<string, PiGpioPin> = {};
  private poll: ReturnType<typeof setInterval> | null = null;
  private estopOn = false;

  private state: BodyState = {
    connected: false, board: "pi",
    caps: ["drive", "estop", "dock", "fan"],
    odom: { x: 0, y: 0, th: 0 },
    encoders: { l: 0, r: 0 },
    battery: {}, dock: false, estop: false, tof: [], updatedAt: 0,
  };

  private readonly maxSpeed: number;
  private readonly wheelBase: number;
  private readonly invertL: boolean;
  private readonly invertR: boolean;

  constructor(profile?: HardwareProfile) {
    this.maxSpeed = profile?.drive?.maxSpeedMps ?? 0.6;
    this.wheelBase = profile?.drive?.wheelBaseM ?? 0.18;
    this.invertL = profile?.drive?.invertL ?? false;
    this.invertR = profile?.drive?.invertR ?? false;
  }

  async start(): Promise<void> {
    // Dynamic import via a NON-LITERAL specifier so TS/esbuild never try to
    // resolve/bundle pigpio off-Pi — it's a runtime-only optional dependency.
    try {
      const spec = "pigpio";
      this.gpio = (await import(spec)) as unknown as PiGpioModule;
    } catch {
      throw new Error(
        "pigpio is not available — install it on a Raspberry Pi (`sudo apt install pigpio && npm i pigpio`) " +
        "or use the 'serial' or 'sim' backend instead.",
      );
    }
    const { Gpio } = this.gpio;
    this.pins["pwmL"] = new Gpio(PIN.pwmL, { mode: Gpio.OUTPUT });
    this.pins["pwmR"] = new Gpio(PIN.pwmR, { mode: Gpio.OUTPUT });
    this.pins["dirL"] = new Gpio(PIN.dirL, { mode: Gpio.OUTPUT });
    this.pins["dirR"] = new Gpio(PIN.dirR, { mode: Gpio.OUTPUT });
    this.pins["estop"] = new Gpio(PIN.estop, { mode: Gpio.INPUT, pullUpDown: Gpio.PUD_UP });
    this.pins["dock"] = new Gpio(PIN.dock, { mode: Gpio.INPUT });
    this.pins["fan"] = new Gpio(PIN.fan, { mode: Gpio.OUTPUT });

    this.halt();
    this.state.connected = true;
    this.emitter.emit("ready", { board: "pi", caps: this.state.caps });

    // Poll safety inputs + emit telemetry at 20 Hz.
    this.poll = setInterval(() => this.tick(), 50);
  }

  async stop(): Promise<void> {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.halt();
    this.state.connected = false;
  }

  drive(l: number, r: number): void {
    if (this.estopOn || !this.gpio) { this.writeMotor("L", 0); this.writeMotor("R", 0); return; }
    this.writeMotor("L", clamp(l, -1, 1) * (this.invertL ? -1 : 1));
    this.writeMotor("R", clamp(r, -1, 1) * (this.invertR ? -1 : 1));
  }

  driveVelocity(linearMps: number, angularRps: number): void {
    const half = this.wheelBase / 2;
    this.drive((linearMps - angularRps * half) / this.maxSpeed, (linearMps + angularRps * half) / this.maxSpeed);
  }

  halt(): void { this.writeMotor("L", 0); this.writeMotor("R", 0); }

  setFace(_state: string, _color?: string): void { /* SPI face driver is a separate module */ }

  setEstop(on: boolean): void {
    this.estopOn = on;
    if (on) this.halt();
    this.state.estop = on;
    this.emitter.emit("event", { e: on ? "estop_on" : "estop_off" });
  }

  getState(): BodyState { return { ...this.state, odom: { ...this.state.odom } }; }

  on(event: BodyEvent, cb: (payload: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  // ── internals ────────────────────────────────────────────────────────────────
  private writeMotor(side: "L" | "R", speed: number): void {
    const pwm = this.pins[side === "L" ? "pwmL" : "pwmR"];
    const dir = this.pins[side === "L" ? "dirL" : "dirR"];
    if (!pwm || !dir) return;
    dir.digitalWrite(speed >= 0 ? 1 : 0);
    pwm.pwmWrite(Math.round(Math.min(1, Math.abs(speed)) * 255));
  }

  private tick(): void {
    const estopPin = this.pins["estop"];
    const dockPin = this.pins["dock"];
    // E-stop is active-low (pulled up): a read of 0 means pressed.
    if (estopPin) {
      const pressed = estopPin.digitalRead() === 0;
      if (pressed !== this.state.estop) {
        this.state.estop = pressed;
        if (pressed) this.halt();
        this.emitter.emit("event", { e: pressed ? "estop_on" : "estop_off" });
      }
    }
    if (dockPin) this.state.dock = dockPin.digitalRead() === 1;
    this.state.updatedAt = Date.now();
    this.emitter.emit("telemetry", this.getState());
  }
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }

import { EventEmitter } from "node:events";
import type { AtlasBody, BodyBackend, BodyEvent, BodyState, HardwareProfile } from "../types.js";
import { Pca9685Driver } from "../drivers/pca9685.js";

/**
 * AdeeptMotorHatBody — drives the Adeept Motor HAT V2 stacked on a Raspberry
 * Pi: two DC motors on the Pi's own GPIO H-bridge (direction pins + PWM on the
 * EN pins, via pigpio) and servos on the HAT's PCA9685 @ I²C 0x40.
 *
 * The pin map (BCM) follows Adeept's published RaspTank map and is
 * CONFIG-DRIVEN: every pin/bus number can be remapped from the profile's
 * `config` block (robotics/profiles/adeept-motorhat-v2.yaml) without touching
 * code. Failsafe: any GPIO/I²C error, stop(), or e-stop drops every motor pin
 * low and turns all PCA9685 channels off — the HAT is never left driving
 * blind. `pigpio` is imported dynamically so this file compiles on any OS; it
 * only actually loads on a Pi.
 */

// Adeept Motor HAT V2 wiring (BCM), per Adeept's RaspTank move.py:
//   Motor_A_EN=4  Motor_A_Pin1=14  Motor_A_Pin2=15   (A = left)
//   Motor_B_EN=17 Motor_B_Pin1=27  Motor_B_Pin2=18   (B = right)
const PIN = {
  enA: 4, in1A: 14, in2A: 15,
  enB: 17, in1B: 27, in2B: 18,
} as const;
const PWM_HZ = 1000;   // Adeept drives the EN pins at 1 kHz
const I2C_BUS = 1;     // /dev/i2c-1
const I2C_ADDR = 0x40; // PCA9685 (servos)

interface AdeeptGpioPin {
  pwmWrite(v: number): void;
  digitalWrite(v: number): void;
  pwmFrequency(hz: number): void;
  mode(m: number): void;
}
interface AdeeptGpioModule {
  Gpio: {
    new (pin: number, opts?: Record<string, unknown>): AdeeptGpioPin;
    OUTPUT: number; INPUT: number;
  };
}

export class AdeeptMotorHatBody implements AtlasBody {
  readonly kind: BodyBackend = "adeept";

  private emitter = new EventEmitter();
  private gpio: AdeeptGpioModule | null = null;
  private pins: Record<string, AdeeptGpioPin> = {};
  private pca: Pca9685Driver;
  private poll: ReturnType<typeof setInterval> | null = null;
  private estopOn = false;

  private state: BodyState = {
    connected: false, board: "adeept",
    caps: ["drive", "servo"],
    odom: { x: 0, y: 0, th: 0 },
    encoders: { l: 0, r: 0 },
    battery: {}, dock: false, estop: false, tof: [], updatedAt: 0,
  };

  private readonly maxSpeed: number;
  private readonly wheelBase: number;
  private readonly invertL: boolean;
  private readonly invertR: boolean;
  private readonly pinMap: { enA: number; in1A: number; in2A: number; enB: number; in1B: number; in2B: number };
  private readonly pwmHz: number;

  constructor(profile?: HardwareProfile) {
    this.maxSpeed = profile?.drive?.maxSpeedMps ?? 0.5;
    this.wheelBase = profile?.drive?.wheelBaseM ?? 0.15;
    this.invertL = profile?.drive?.invertL ?? false;
    this.invertR = profile?.drive?.invertR ?? false;
    // Pin map / bus numbers from the profile's config (string map), so the
    // yaml can remap the HAT without a code change. Defaults per Adeept.
    const cfg = profile?.config ?? {};
    const num = (key: string, fallback: number): number => {
      const n = Number(cfg[key]);
      return Number.isFinite(n) ? n : fallback;
    };
    this.pinMap = {
      enA: num("motor_a_en", PIN.enA), in1A: num("motor_a_in1", PIN.in1A), in2A: num("motor_a_in2", PIN.in2A),
      enB: num("motor_b_en", PIN.enB), in1B: num("motor_b_in1", PIN.in1B), in2B: num("motor_b_in2", PIN.in2B),
    };
    this.pwmHz = num("pwm_hz", PWM_HZ);
    this.pca = new Pca9685Driver({ bus: num("i2c_bus", I2C_BUS), address: num("i2c_addr", I2C_ADDR) });
  }

  async start(): Promise<void> {
    // Dynamic import via a NON-LITERAL specifier so TS/esbuild never try to
    // resolve/bundle pigpio off-Pi — it's a runtime-only optional dependency.
    try {
      const spec = "pigpio";
      this.gpio = (await import(spec)) as unknown as AdeeptGpioModule;
    } catch {
      throw new Error(
        "pigpio is not available — install it on a Raspberry Pi (`sudo apt install pigpio && npm i pigpio`) " +
        "or use the 'serial' or 'sim' backend instead.",
      );
    }
    const { Gpio } = this.gpio;
    const p = this.pinMap;
    try {
      this.pins["enA"] = new Gpio(p.enA, { mode: Gpio.OUTPUT });
      this.pins["in1A"] = new Gpio(p.in1A, { mode: Gpio.OUTPUT });
      this.pins["in2A"] = new Gpio(p.in2A, { mode: Gpio.OUTPUT });
      this.pins["enB"] = new Gpio(p.enB, { mode: Gpio.OUTPUT });
      this.pins["in1B"] = new Gpio(p.in1B, { mode: Gpio.OUTPUT });
      this.pins["in2B"] = new Gpio(p.in2B, { mode: Gpio.OUTPUT });
      this.pins["enA"].pwmFrequency(this.pwmHz);
      this.pins["enB"].pwmFrequency(this.pwmHz);
    } catch (e) {
      this.failsafe();
      throw e instanceof Error ? e : new Error(String(e));
    }
    // Servos are optional: drive still works if the PCA9685 (or i2c-bus) is
    // absent — `driverStatus()` reports why.
    await this.pca.open();

    this.halt();
    this.state.connected = true;
    this.emitter.emit("ready", { board: "adeept", caps: this.state.caps });

    // No sense pins on this HAT — just emit telemetry at 10 Hz.
    this.poll = setInterval(() => this.tick(), 100);
  }

  async stop(): Promise<void> {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.halt();
    await this.pca.close();  // all channels off + release the bus handle (start() reopens)
    this.state.connected = false;
  }

  drive(l: number, r: number): void {
    if (this.estopOn || !this.gpio) { this.writeMotor("A", 0); this.writeMotor("B", 0); return; }
    this.writeMotor("A", clamp(l, -1, 1) * (this.invertL ? -1 : 1));
    this.writeMotor("B", clamp(r, -1, 1) * (this.invertR ? -1 : 1));
  }

  driveVelocity(linearMps: number, angularRps: number): void {
    const half = this.wheelBase / 2;
    this.drive((linearMps - angularRps * half) / this.maxSpeed, (linearMps + angularRps * half) / this.maxSpeed);
  }

  halt(): void { this.writeMotor("A", 0); this.writeMotor("B", 0); }

  setFace(_state: string, _color?: string): void { /* SPI face driver is a separate module */ }

  setEstop(on: boolean): void {
    this.estopOn = on;
    if (on) { this.halt(); void this.pca.allOff().catch(() => { /* bus down — servos already unpowered */ }); }
    this.state.estop = on;
    this.emitter.emit("event", { e: on ? "estop_on" : "estop_off" });
  }

  getState(): BodyState { return { ...this.state, odom: { ...this.state.odom } }; }

  on(event: BodyEvent, cb: (payload: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  // ── bench-test helpers (used by /api/hal/test) ───────────────────────────────

  /** One bounded open-loop pulse on a single motor, with a guaranteed stop. */
  async pulseMotor(motor: "A" | "B", ms: number, duty: number): Promise<void> {
    if (this.estopOn) throw new Error("e-stop is engaged — clear it before pulsing motors");
    try {
      this.writeMotor(motor, clamp(duty, 0, 1));
      await sleep(ms);
    } finally {
      this.writeMotor(motor, 0);
    }
  }

  /** Position a servo on the HAT's PCA9685 (pulse width in µs @ 50 Hz). */
  async setServoPulseUs(ch: number, us: number): Promise<void> {
    if (this.estopOn) throw new Error("e-stop is engaged — clear it before moving servos");
    try {
      await this.pca.setServoPulseUs(ch, us);
    } catch (e) {
      this.failsafe();
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /** Everything off: wheels coast, every PCA9685 channel off. */
  async allOff(): Promise<void> {
    this.halt();
    await this.pca.allOff().catch(() => { /* bus down — servos already unpowered */ });
  }

  /** GPIO / PCA9685 availability, for GET /api/hal/test. */
  driverStatus(): { gpio: boolean; pca9685: { available: boolean; reason?: string } } {
    return { gpio: !!this.gpio, pca9685: this.pca.availability() };
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Hard failsafe: every motor pin low (EN + direction), all PCA9685 channels off. */
  private failsafe(): void {
    for (const key of ["enA", "enB", "in1A", "in2A", "in1B", "in2B"]) {
      try { this.pins[key]?.digitalWrite(0); } catch { /* already dead — keep going */ }
    }
    void this.pca.allOff().catch(() => { /* bus down — servos already unpowered */ });
  }

  private writeMotor(motor: "A" | "B", speed: number): void {
    const en = this.pins[motor === "A" ? "enA" : "enB"];
    const in1 = this.pins[motor === "A" ? "in1A" : "in1B"];
    const in2 = this.pins[motor === "A" ? "in2A" : "in2B"];
    if (!en || !in1 || !in2) return;
    try {
      const mag = Math.min(1, Math.abs(speed));
      if (mag === 0) {
        // Coast: direction pins low, EN low (digitalWrite also stops the PWM).
        in1.digitalWrite(0); in2.digitalWrite(0); en.digitalWrite(0);
      } else {
        // Forward = IN1 low / IN2 high per Adeept's map; flip a side with the
        // profile's drive.invertL / drive.invertR if the wiring disagrees.
        in1.digitalWrite(speed > 0 ? 0 : 1);
        in2.digitalWrite(speed > 0 ? 1 : 0);
        en.pwmWrite(Math.round(mag * 255));
      }
    } catch {
      this.failsafe();
    }
  }

  private tick(): void {
    this.state.updatedAt = Date.now();
    this.emitter.emit("telemetry", this.getState());
  }
}

/**
 * The built-in profile for this body — mirrors robotics/profiles/
 * adeept-motorhat-v2.yaml. (The runtime has no YAML loader: the yaml documents
 * these values; select them with ATLAS_PROFILE=adeept-motorhat-v2.)
 */
export function adeeptProfile(): HardwareProfile {
  return {
    id: "adeept-motorhat-v2",
    name: "Adeept Motor HAT V2 (Pi GPIO + PCA9685)",
    backend: "adeept",
    target: "Raspberry Pi · Adeept Motor HAT V2 · DC motors + servos",
    drive: { wheelBaseM: 0.15, wheelRadiusM: 0.03, maxSpeedMps: 0.5 },
    config: {
      motor_a_en: "4", motor_a_in1: "14", motor_a_in2: "15",
      motor_b_en: "17", motor_b_in1: "27", motor_b_in2: "18",
      pwm_hz: "1000", i2c_bus: "1", i2c_addr: "0x40",
    },
  };
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

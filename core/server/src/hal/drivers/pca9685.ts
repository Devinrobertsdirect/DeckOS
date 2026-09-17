/**
 * PCA9685 driver — the 16-channel I²C PWM chip on the Adeept Motor HAT V2 (and
 * countless servo HATs), spoken through the `i2c-bus` npm package. The module
 * is imported dynamically via a NON-LITERAL specifier (same trick as pigpio /
 * serialport) so esbuild never bundles it and this file compiles on any OS —
 * off-Pi the driver simply reports "unavailable" instead of throwing.
 */

const REG = {
  MODE1: 0x00, MODE2: 0x01,
  LED0_ON_L: 0x06,          // + 4 × channel → ON_L, ON_H, OFF_L, OFF_H
  ALL_LED_OFF_H: 0xfd,
  PRESCALE: 0xfe,
} as const;
const MODE1 = { RESTART: 0x80, AI: 0x20, SLEEP: 0x10, ALLCALL: 0x01 } as const;
const MODE2_OUTDRV = 0x04;  // totem-pole outputs (servos want this)
const FULL_OFF = 0x10;      // bit 4 of LEDn_OFF_H / ALL_LED_OFF_H
const OSC_HZ = 25_000_000;  // internal oscillator
const TICKS = 4096;         // 12-bit counter

interface I2cBusHandle {
  writeByte(addr: number, cmd: number, byte: number): Promise<void>;
  readByte(addr: number, cmd: number): Promise<number>;
  close(): Promise<void>;
}
interface I2cModule {
  openPromisified(busNumber: number): Promise<I2cBusHandle>;
}

export class Pca9685Driver {
  private bus: I2cBusHandle | null = null;
  private ready = false;
  private reason: string | undefined = "not opened";

  private readonly busNumber: number;
  private readonly address: number;
  private readonly freqHz: number;

  constructor(opts?: { bus?: number; address?: number; freqHz?: number }) {
    this.busNumber = opts?.bus ?? 1;
    this.address = opts?.address ?? 0x40;
    this.freqHz = opts?.freqHz ?? 50;  // the servo standard
  }

  /**
   * Open the bus and initialise the chip: everything off, totem-pole outputs,
   * wake from sleep, prescale for `freqHz` (50 Hz default). Returns false (with
   * the reason held for `availability()`) instead of throwing when the module
   * or the chip is missing — drive still works without servos.
   */
  async open(): Promise<boolean> {
    // Dynamic import via a NON-LITERAL specifier so TS/esbuild never try to
    // resolve/bundle i2c-bus off-Pi — it's a runtime-only optional dependency.
    try {
      const spec = "i2c-bus";
      const i2c = (await import(spec)) as unknown as I2cModule;
      this.bus = await i2c.openPromisified(this.busNumber);
    } catch {
      this.reason = "i2c-bus is not available — on the Pi: `npm i i2c-bus` (and enable I²C via raspi-config)";
      return false;
    }
    try {
      await this.write(REG.ALL_LED_OFF_H, FULL_OFF);  // everything off first
      await this.write(REG.MODE2, MODE2_OUTDRV);
      await this.write(REG.MODE1, MODE1.ALLCALL);
      await sleep(5);                                 // oscillator settle
      // Prescale can only change while the chip sleeps.
      const prescale = Math.round(OSC_HZ / (TICKS * this.freqHz)) - 1;  // 121 @ 50 Hz
      const mode = await this.read(REG.MODE1);
      await this.write(REG.MODE1, ((mode & ~MODE1.RESTART) & 0xff) | MODE1.SLEEP);
      await this.write(REG.PRESCALE, prescale & 0xff);
      await this.write(REG.MODE1, (mode & ~MODE1.SLEEP) & 0xff);
      await sleep(5);
      await this.write(REG.MODE1, (mode | MODE1.RESTART | MODE1.AI) & 0xff);
      this.ready = true;
      this.reason = undefined;
      return true;
    } catch {
      this.reason = `no PCA9685 answering at 0x${this.address.toString(16)} on /dev/i2c-${this.busNumber}`;
      await this.closeBus();
      return false;
    }
  }

  /** Position a servo: pulse width in microseconds (e.g. 1500 = centre). */
  async setServoPulseUs(ch: number, us: number): Promise<void> {
    if (!this.ready) return;  // graceful: no chip, no motion
    const off = (us * this.freqHz * TICKS) / 1_000_000;
    await this.setChannel(ch, 0, clampInt(off, 0, TICKS - 1));
  }

  /** Raw PWM duty on a channel, 0..1 (LED / motor-enable style loads). */
  async setPwmDuty(ch: number, duty: number): Promise<void> {
    if (!this.ready) return;
    const d = duty < 0 ? 0 : duty > 1 ? 1 : duty;
    if (d === 0) { await this.setChannel(ch, 0, 0, true); return; }  // full off
    await this.setChannel(ch, 0, clampInt(d * (TICKS - 1), 0, TICKS - 1));
  }

  /** Every channel off — the failsafe. Safe to call at any time. */
  async allOff(): Promise<void> {
    if (!this.bus) return;
    await this.write(REG.ALL_LED_OFF_H, FULL_OFF);
  }

  /** Is the chip usable, and if not, why? */
  availability(): { available: boolean; reason?: string } {
    return this.ready ? { available: true } : { available: false, reason: this.reason };
  }

  async close(): Promise<void> {
    try { await this.allOff(); } catch { /* bus already gone */ }
    await this.closeBus();
    this.ready = false;
    this.reason = "closed";
  }

  // ── internals ────────────────────────────────────────────────────────────────
  private async setChannel(ch: number, on: number, off: number, fullOff = false): Promise<void> {
    const base = REG.LED0_ON_L + 4 * clampInt(ch, 0, 15);
    await this.write(base, on & 0xff);
    await this.write(base + 1, (on >> 8) & 0x0f);
    await this.write(base + 2, off & 0xff);
    await this.write(base + 3, fullOff ? FULL_OFF : (off >> 8) & 0x0f);
  }

  private async write(reg: number, byte: number): Promise<void> {
    if (!this.bus) throw new Error("PCA9685 bus is not open");
    await this.bus.writeByte(this.address, reg, byte);
  }

  private async read(reg: number): Promise<number> {
    if (!this.bus) throw new Error("PCA9685 bus is not open");
    return this.bus.readByte(this.address, reg);
  }

  private async closeBus(): Promise<void> {
    try { await this.bus?.close(); } catch { /* ignore */ }
    this.bus = null;
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  const r = Math.round(n);
  return r < lo ? lo : r > hi ? hi : r;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

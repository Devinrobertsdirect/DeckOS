import { readFileSync } from "node:fs";
import type { AtlasBody, BodyBackend, HardwareProfile, LineTransport } from "./types.js";
import { SimBody } from "./bodies/sim.js";
import { SerialBridgeBody } from "./bodies/serialBridge.js";
import { PiGpioBody } from "./bodies/pi.js";
import { AdeeptMotorHatBody, adeeptProfile } from "./bodies/adeept.js";

export * from "./types.js";
export * from "./protocol.js";
export { SimBody, SerialBridgeBody, PiGpioBody, AdeeptMotorHatBody, adeeptProfile };
export { Pca9685Driver } from "./drivers/pca9685.js";

/**
 * Is this a Raspberry Pi? Read the device-tree model (works on Pi OS + most
 * distros). Cheap and safe off-Pi (returns false).
 */
export function isRaspberryPi(): boolean {
  if (process.platform !== "linux") return false;
  for (const p of ["/proc/device-tree/model", "/sys/firmware/devicetree/base/model"]) {
    try {
      const model = readFileSync(p, "utf8");
      if (/raspberry pi/i.test(model)) return true;
    } catch { /* try next */ }
  }
  try {
    const cpu = readFileSync("/proc/cpuinfo", "utf8");
    if (/raspberry pi|bcm2/i.test(cpu)) return true;
  } catch { /* ignore */ }
  return false;
}

export interface DetectResult {
  backend: BodyBackend;
  reason: string;
  isPi: boolean;
  platform: NodeJS.Platform;
}

/**
 * Decide which body backend fits this machine. A profile can force a backend;
 * otherwise: a configured serial link → serial, else a Pi → pi, else sim. This
 * is how "set up, run, ready to go anywhere" picks the right body on its own.
 */
export function detectBackend(profile?: HardwareProfile): DetectResult {
  const isPi = isRaspberryPi();
  const platform = process.platform;
  const forced = envProfile();
  if (forced) {
    return { backend: forced.backend, reason: `ATLAS_PROFILE forces "${forced.id}" (${forced.backend})`, isPi, platform };
  }
  if (profile?.backend) {
    return { backend: profile.backend, reason: `profile "${profile.id}" requests ${profile.backend}`, isPi, platform };
  }
  const serialPath = profile?.serial?.path || process.env["ATLAS_SERIAL"];
  if (serialPath) {
    return { backend: "serial", reason: `serial link at ${serialPath}`, isPi, platform };
  }
  if (isPi) {
    return { backend: "pi", reason: "running on Raspberry Pi GPIO", isPi, platform };
  }
  return { backend: "sim", reason: "no body hardware detected — virtual body", isPi, platform };
}

/** A no-hardware profile: the desktop / dev default. */
export function desktopProfile(): HardwareProfile {
  return { id: "desktop-sim", name: "Desktop (virtual body)", backend: "sim", target: "linux/windows/macos" };
}

/**
 * A built-in profile forced by env: ATLAS_PROFILE=<id> selects the same body
 * everywhere (e.g. ATLAS_PROFILE=adeept-motorhat-v2 on a stock Adeept HAT).
 * The runtime has no YAML loader — robotics/profiles/*.yaml document these
 * values; the shipped profiles live in code. Unknown ids fall through to
 * normal detection.
 */
export function envProfile(): HardwareProfile | null {
  const id = process.env["ATLAS_PROFILE"]?.trim();
  if (!id) return null;
  switch (id) {
    case "adeept-motorhat-v2": return adeeptProfile();
    case "desktop-sim": return desktopProfile();
    default: return null;
  }
}

/**
 * Build the body for a profile. Serial bodies need a concrete `transport`
 * (USB serial / WiFi WebSocket / BLE) supplied by the runtime, so the HAL keeps
 * zero dependency on any transport library.
 */
export function createBody(
  profile: HardwareProfile = desktopProfile(),
  opts?: { transport?: LineTransport },
): AtlasBody {
  // An ATLAS_PROFILE override replaces the caller's profile wholesale, so the
  // forced body also gets its pin map / geometry (not just the backend).
  profile = envProfile() ?? profile;
  const { backend } = detectBackend(profile);
  switch (backend) {
    case "sim":
      return new SimBody(profile);
    case "pi":
      return new PiGpioBody(profile);
    case "adeept":
      return new AdeeptMotorHatBody(profile);
    case "serial":
      if (!opts?.transport) {
        throw new Error(
          `Profile "${profile.id}" uses the serial backend but no transport was provided. ` +
          "Supply a LineTransport (USB serial, WiFi WebSocket, or BLE) to createBody().",
        );
      }
      return new SerialBridgeBody(opts.transport, profile);
  }
}

import { readFileSync } from "node:fs";
import type { AtlasBody, BodyBackend, HardwareProfile, LineTransport } from "./types.js";
import { SimBody } from "./bodies/sim.js";
import { SerialBridgeBody } from "./bodies/serialBridge.js";
import { PiGpioBody } from "./bodies/pi.js";

export * from "./types.js";
export * from "./protocol.js";
export { SimBody, SerialBridgeBody, PiGpioBody };

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
 * Build the body for a profile. Serial bodies need a concrete `transport`
 * (USB serial / WiFi WebSocket / BLE) supplied by the runtime, so the HAL keeps
 * zero dependency on any transport library.
 */
export function createBody(
  profile: HardwareProfile = desktopProfile(),
  opts?: { transport?: LineTransport },
): AtlasBody {
  const { backend } = detectBackend(profile);
  switch (backend) {
    case "sim":
      return new SimBody(profile);
    case "pi":
      return new PiGpioBody(profile);
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

/**
 * body.ts — the process-wide Atlas body.
 *
 * Lazily creates and starts the right HAL body for this machine (sim on a
 * desktop, Pi GPIO on a Pi, serial bridge when a board is wired) and hands it to
 * the rest of the brain. One accessor, `getBody()`, so routes and behaviours
 * never care what they're driving.
 */
import { createBody, detectBackend, desktopProfile, type AtlasBody, type DetectResult, type HardwareProfile } from "../hal/index.js";

let body: AtlasBody | null = null;
let starting: Promise<AtlasBody> | null = null;
let detection: DetectResult | null = null;

function activeProfile(): HardwareProfile {
  // Future: load a profile file named by ATLAS_PROFILE. Desktop default for now.
  return desktopProfile();
}

/** Get the running body, creating + starting it on first use. */
export async function getBody(): Promise<AtlasBody> {
  if (body) return body;
  if (starting) return starting;
  starting = (async () => {
    const profile = activeProfile();
    detection = detectBackend(profile);
    let b: AtlasBody;
    try {
      b = createBody(profile);
      await b.start();
    } catch {
      // Any hardware backend that can't start (e.g. pigpio missing) falls back
      // to the virtual body so the brain never hangs on a missing peripheral.
      b = createBody(desktopProfile());
      await b.start();
      detection = { ...(detection as DetectResult), backend: "sim", reason: "hardware backend unavailable — fell back to sim" };
    }
    body = b;
    return b;
  })();
  return starting;
}

/** Detection result (backend + why), for diagnostics / the CLI. */
export function getBodyDetection(): DetectResult | null {
  return detection;
}

/** Best-effort: read state without forcing a start (null if not started yet). */
export function peekBody(): AtlasBody | null {
  return body;
}

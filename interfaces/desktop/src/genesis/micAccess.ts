/**
 * Microphone acquisition, robot-aware.
 *
 * On a desktop, asking for the mic pops a browser permission prompt. On a robot
 * or kiosk build there is usually no permission barrier at all — getUserMedia
 * resolves instantly. So we always TRY to find and open a mic; the same call
 * "just works" on the robot and prompts on the desktop.
 */

const INPUT_MODE_KEY = "atlas_input_mode";
export type InputMode = "voice" | "text";

export function getInputMode(): InputMode | null {
  const v = localStorage.getItem(INPUT_MODE_KEY);
  return v === "voice" || v === "text" ? v : null;
}
export function setInputMode(mode: InputMode) {
  localStorage.setItem(INPUT_MODE_KEY, mode);
}

/** Is there an audio input device at all? Does NOT prompt for permission. */
export async function hasMicDevice(): Promise<boolean> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "audioinput");
  } catch {
    return false;
  }
}

export interface MicResult {
  granted: boolean;
  /** "no-mic" | "denied" | "unsupported" | "" (ok) */
  reason: string;
}

/**
 * Acquire the mic. Resolves granted:true if we got a stream (we immediately
 * release the tracks — the Web Speech recognizer opens its own). On a robot with
 * no permission gate this returns instantly; on desktop it triggers the prompt.
 */
export async function acquireMic(): Promise<MicResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { granted: false, reason: "unsupported" };
  }
  // Look for a device first so we can give a clear "no mic found" on a robot.
  if (!(await hasMicDevice())) {
    // enumerateDevices can hide devices until permission is granted, so don't
    // hard-fail here — still attempt getUserMedia below.
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { granted: true, reason: "" };
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (name === "NotAllowedError" || name === "SecurityError") return { granted: false, reason: "denied" };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { granted: false, reason: "no-mic" };
    return { granted: false, reason: name || "error" };
  }
}

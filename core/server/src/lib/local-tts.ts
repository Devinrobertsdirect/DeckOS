import { spawn, execFileSync } from "node:child_process";

let _available: boolean | null = null;

/**
 * Returns true if espeak-ng is present on PATH.
 * Result is cached after the first call.
 */
export function isLocalTtsAvailable(): boolean {
  if (_available !== null) return _available;
  try {
    execFileSync("espeak-ng", ["--version"], { stdio: "ignore", timeout: 3000 });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

/** Voice profile tuned per gender/presentation. */
function voiceParams(gender?: string | null): { voice: string; pitch: string; speed: string } {
  switch (gender) {
    case "female":
      // High-pitched female variant — "en-us+f3" is the clearest female US voice in espeak-ng
      return { voice: "en-us+f3", pitch: "48", speed: "155" };
    case "nonbinary":
      // Mid-range pitch — androgynous
      return { voice: "en-us", pitch: "42", speed: "150" };
    case "male":
    default:
      // Deep, authoritative JARVIS-style (original)
      return { voice: "en-us", pitch: "28", speed: "148" };
  }
}

/**
 * Synthesise text with espeak-ng via stdin → stdout (WAV).
 * Returns a Buffer containing a valid WAV file (PCM 16-bit, 22 050 Hz, mono).
 *
 * @param text   Input text (capped at 3 000 chars)
 * @param gender "male" | "female" | "nonbinary" | "neutral" — controls voice timbre
 */
export function localTts(text: string, gender?: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const { voice, pitch, speed } = voiceParams(gender);

    const proc = spawn("espeak-ng", [
      "-v", voice,
      "-s", speed,
      "-p", pitch,
      "-a", "90",
      "--stdout",
    ]);

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", () => { /* suppress espeak progress lines */ });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`espeak-ng exited with code ${code}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    proc.on("error", reject);

    const safe = text.slice(0, 3000);
    proc.stdin.write(safe, "utf8");
    proc.stdin.end();
  });
}

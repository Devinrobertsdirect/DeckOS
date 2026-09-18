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
      // The offline voice. It is not trying to be the cloud voice — it is trying
      // to be UNDERSTOOD, which is a different job. Brighter and higher than the
      // old rumble, and slowed from 160 to 148: on a small Bluetooth speaker in
      // a room with people in it, pace is what costs you the words. A synthetic
      // voice that is a shade too slow reads as deliberate; one that is a shade
      // too fast reads as broken.
      return { voice: "en-us+m3", pitch: "44", speed: "148" };
  }
}

/**
 * Give espeak-ng something it can perform.
 *
 * espeak decides its intonation from punctuation alone, so a line with no full
 * stop comes out as one flat unbroken shelf of sound — the single biggest reason
 * the offline voice is tiring. This adds the marks it needs: a terminal stop so
 * the pitch actually falls at the end, a breath after a long clause, and a real
 * pause where the text was already pausing.
 */
function shapeForEspeak(text: string): string {
  let t = text
    .replace(/\s+[—–]\s+|\s+-{2,}\s+/g, ", ")   // an em dash is a breath, not a word
    .replace(/…|\.\s*\.\s*\./g, "...")          // espeak reads "..." as a pause
    .replace(/\s{2,}/g, " ")
    .trim();
  // A clause running past roughly a dozen words gets a comma at its midpoint,
  // so he takes a breath instead of sprinting to the end of it.
  t = t.split(/(?<=[.!?])\s+/).map((sentence) => {
    const words = sentence.split(" ");
    if (words.length < 14 || /,/.test(sentence)) return sentence;
    const mid = Math.floor(words.length / 2);
    return [...words.slice(0, mid), `${words[mid]},`, ...words.slice(mid + 1)].join(" ");
  }).join(" ");
  // Without a terminal mark espeak never drops its pitch, and every line sounds
  // like it was cut off mid-thought.
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
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
      // Louder, because this voice exists for the times the good one is gone
      // and it is usually coming out of a small speaker across a room.
      "-a", "120",
      // A 30ms gap between words. It is the cheapest intelligibility you can
      // buy from espeak: consonants at the edges of words stop being eaten by
      // the word next to them.
      "-g", "3",
      // NOTE: do not add -k here. It looks like an emphasis control and is not:
      // `-k 1` plays an audible TONE on every capital letter, which means a
      // click at the start of every sentence and inside every name. Only values
      // around 20 mean "raise the pitch", and even that fires on each letter of
      // an acronym, so "NOBI" comes out as four separate emphases.
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

    const safe = shapeForEspeak(text).slice(0, 3000);
    proc.stdin.write(safe, "utf8");
    proc.stdin.end();
  });
}

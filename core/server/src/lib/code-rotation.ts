import { resetPairingCode } from "./pairing.js";
import { broadcast } from "./ws-server.js";
import { logger } from "./logger.js";
import os from "node:os";

/**
 * code-rotation.ts — the ten seconds between "confirm" and a new pairing code.
 *
 * Changing the code cuts off every phone already paired, so the last step is
 * deliberately not instant. He counts down out loud and on his face, and ANY
 * other button on the remote calls it off. That gives the moment a shape that
 * matches what is actually happening: you have started something consequential,
 * you can see it coming, and stopping it is the easiest thing in the room.
 *
 * The countdown lives here rather than in the skill because the thing that
 * cancels it (a remote button) arrives on a completely different route, and a
 * timer that two routes have to agree about needs one owner.
 */

const SECONDS = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let left = 0;

export function isRotationPending(): boolean {
  return timer !== null;
}

function paint(payload: Record<string, unknown>): void {
  broadcast({ type: "face.command", source: "code-rotation", payload, timestamp: new Date().toISOString() });
}

function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  }
  return null;
}

/**
 * Start the countdown. Returns the line he should say as he begins — spoken
 * ONCE, not per tick: ten synthesised numbers would cost credits, talk over the
 * person trying to cancel, and be far less clear than a number on his face.
 */
export function beginRotation(): string {
  cancelRotation();
  left = SECONDS;
  paint({ countdown: left, countdownLabel: "New code in" });
  timer = setInterval(() => {
    left -= 1;
    if (left > 0) { paint({ countdown: left, countdownLabel: "New code in" }); return; }
    stopTimer();
    void finish();
  }, 1000);
  return `New code in ${SECONDS} seconds. Press anything on the remote to stop me.`;
}

/**
 * Call it off. Safe to call when nothing is pending, which matters because the
 * remote calls this on EVERY button press without checking first.
 */
export function cancelRotation(): boolean {
  if (!timer) return false;
  stopTimer();
  paint({ countdown: null });
  logger.info("code-rotation: cancelled");
  return true;
}

function stopTimer(): void {
  if (timer) { clearInterval(timer); timer = null; }
  left = 0;
}

async function finish(): Promise<void> {
  try {
    const code = await resetPairingCode();
    const ip = lanIp();
    const host = ip ? `${ip}:8080` : `${os.hostname()}.local:8080`;
    const url = `http://${host}/api/remote?code=${encodeURIComponent(code)}`;
    logger.info("code-rotation: pairing code rotated");
    // He has just disconnected every paired phone, so the new code goes up
    // before anyone can ask where the remote went — and it is said out loud for
    // whoever is not looking at him.
    paint({
      countdown: null,
      say: `Your new code is ${code.split("").join(" ")}. Old phones will need it again.`,
      showLink: { title: "New remote code", url, code, hint: `Same Wi-Fi. ${host}/api/remote` },
    });
  } catch (err) {
    logger.error({ err }, "code-rotation: could not rotate the code");
    paint({ countdown: null, say: "I could not change the code. Nothing has changed." });
  }
}

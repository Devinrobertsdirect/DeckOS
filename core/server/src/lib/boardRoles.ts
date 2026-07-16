/**
 * boardRoles.ts — figure out which USB board is the FACE and which is the DRIVE.
 *
 * When a full robot has two microcontrollers on the Pi (a face panel + a drive
 * base), the brain has to tell them apart. Each node announces its role in its
 * AWP `READY` line (`role=face|drive|body`); this module briefly opens a port,
 * reads that role, caches it, and serializes probes so two consumers never open
 * the same port at once.
 *
 * SAFETY: callers only invoke this when 2+ boards are present. With a single
 * board nothing here runs, so the (verified) one-board flow is unchanged.
 */
import { SerialPortTransport, listBoardPorts } from "./serialTransport.js";

const roleCache = new Map<string, string>();   // port -> "face" | "drive" | "body" | "unknown"
let lock: Promise<unknown> = Promise.resolve();

/** Open a port briefly and read its AWP READY `role`. Always closes. */
export async function probeRole(port: string, timeoutMs = 2500): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const t = new SerialPortTransport(port, 115200);
    let done = false;
    const finish = (role: string | null) => {
      if (done) return;
      done = true;
      try { void t.close(); } catch { /* ignore */ }
      resolve(role);
    };
    t.onLine((line) => {
      if (/^READY\b/.test(line.trim())) {
        const m = line.match(/role=(\S+)/);
        finish(m ? m[1] : "unknown");
      }
    });
    // Opening toggles DTR → the board resets and re-sends READY ~1–2s later.
    t.open().catch(() => finish(null));
    setTimeout(() => finish(null), timeoutMs);
  });
}

/** Run probes one at a time so consumers never fight over a port. */
async function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

/**
 * Roles for every USB board port not in `held` (a port already owned by a live
 * connection). Cached — probing opens a port, so we only do it once per port.
 */
export async function discoverRoles(held: string[] = []): Promise<Map<string, string>> {
  const ports = (await listBoardPorts()).map((p) => p.path);
  await serialize(async () => {
    for (const p of ports) {
      if (roleCache.has(p) || held.includes(p)) continue;
      const role = await probeRole(p);
      if (role) roleCache.set(p, role);
    }
  });
  return roleCache;
}

export function knownRole(port: string): string | undefined { return roleCache.get(port); }
export function forgetRole(port: string): void { roleCache.delete(port); }

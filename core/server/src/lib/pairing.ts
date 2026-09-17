/*
 * pairing.ts — the instance phone-pairing code (shared by the pairing route AND
 * the system prompt, so the AI can always tell the user their connection code).
 */
import { getConfig, setConfig } from "./app-config.js";

export const PAIRING_CODE_KEY = "INSTANCE_PAIRING_CODE";

/** Readable 8-char code: 3 uppercase letters + dash + 4 digits (no I/O). */
export function generatePairingCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "0123456789";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return `${pick(letters)}${pick(letters)}${pick(letters)}-${pick(digits)}${pick(digits)}${pick(digits)}${pick(digits)}`;
}

/** Return the persistent instance code, creating it on first use. */
export async function getOrCreatePairingCode(): Promise<string> {
  const existing = await getConfig(PAIRING_CODE_KEY);
  if (existing) return existing;
  const code = generatePairingCode();
  await setConfig(PAIRING_CODE_KEY, code);
  return code;
}

/** Regenerate the code (invalidates existing pairings). */
export async function resetPairingCode(): Promise<string> {
  const code = generatePairingCode();
  await setConfig(PAIRING_CODE_KEY, code);
  return code;
}

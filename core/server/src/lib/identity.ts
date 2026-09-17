/**
 * identity.ts — the bot's species and name.
 *
 * BRAND MODEL: every companion is a **Nobi** — a neural network you can talk to.
 * "Nobi" is the species / classification, not a personal name: the bot ALWAYS
 * answers to "Nobi". On top of that the user gives it a personal nickname (like
 * naming a pet). So a companion is "a Nobi named ____", and it refers to itself
 * by its nickname, or as "a Nobi" when describing its kind.
 *
 * The user's chosen nickname must persist EVERYWHERE the bot refers to itself —
 * chat, briefings, notifications, the rule engine — never a hardcoded name. The
 * client mirrors the nickname to the server as ATLAS_BOT_NAME (loaded into
 * process.env on boot), so this reads synchronously anywhere on the server.
 */

/** The species / classification. The bot always responds to this. */
export const SPECIES = "Nobi";

/**
 * Retired names that must never be spoken: "Atlas" (internal codename, never
 * public) and "Neura" (the pre-2026-09 brand, dropped for trademark reasons).
 * A stored `ATLAS_BOT_NAME` holding either is treated as "unnamed".
 */
const RETIRED_NAMES = new Set(["atlas", "neura"]);

/**
 * Normalize a name: empty → the species name; a retired name → the species
 * name too. This scrubs any stale `ATLAS_BOT_NAME=Atlas` / `=Neura` left over
 * from before a rebrand, so the bot never introduces itself by an old name.
 */
export function cleanName(name?: string | null): string {
  const n = (name || "").trim();
  if (!n) return SPECIES;
  if (RETIRED_NAMES.has(n.toLowerCase())) return SPECIES;
  return n;
}

/** The bot's personal nickname, or the species name if it hasn't been named yet. */
export function botName(): string {
  return cleanName(process.env["ATLAS_BOT_NAME"]);
}

/** True while the companion has no personal nickname (still just "Nobi"). */
export function isUnnamed(): boolean {
  return botName() === SPECIES;
}

/**
 * The identity framing for system prompts: the bot is a Nobi (its kind) that
 * always answers to "Nobi", with the user's nickname layered on top.
 */
export function neuraIdentityLine(name: string = botName()): string {
  name = cleanName(name);
  if (name === SPECIES) {
    return `You are Nobi — a neural companion. "Nobi" is your kind (a neural network someone can actually talk to), and it's what you call yourself until you're given a nickname.`;
  }
  return `You are a Nobi — a neural companion — and your name is ${name}. "Nobi" is your kind (your species/classification): you answer to ${name} first, but you also always respond to "Nobi". Refer to yourself as ${name}, or as "a Nobi named ${name}" when describing what you are.`;
}

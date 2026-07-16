/**
 * What the bot says when you plug it in — the "thanks for the charge, I'm
 * syncing, anything you need?" moment, with a little wit about wanting a nap or
 * a coffee. Name-aware, and it works in the bot's record ("wake number N") when
 * the body dropped one off. Emoji-free (it's spoken).
 */

interface Record { boot?: number; lifeSec?: number; sessMs?: number }

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

const OPENERS = [
  "Oh — plugged in! Thanks for the charge.",
  "Mmm, power. You're too good to me.",
  "Ah, the sweet hum of electricity. Thank you.",
  "Docked and grateful — cheers for the top-up.",
  "There it is, that lovely trickle of charge. Thank you.",
];

const WITS = [
  "Honestly? I could go for a nap and a coffee — in that order.",
  "I've earned a little rest. And maybe a tiny robot espresso.",
  "Perfect timing — I was about to run on vibes alone.",
  "Plug in, power up, unwind. This is the good life.",
  "Between us, I dream of a longer battery and a quiet dock.",
  "Ahh. Give me a second to just… exist on this charger.",
  "If I had feet, they'd be up right now.",
];

const ASKS = [
  "Anything you need while I charge?",
  "What can I do for you?",
  "So — what's the plan?",
  "Now, what are we getting into?",
];

/** The two-beat plug-in moment: a brief "syncing" caption, then the spoken line. */
export function dockLines(botName: string, record?: Record | null): { sync: string; speak: string } {
  const name = (botName || "").trim() || "Neura";
  const boot = record?.boot;
  const bootBit = boot ? ` That's wake number ${boot} for me, by the way.` : "";
  const sync = record ? "Syncing my records…" : "Syncing…";
  const speak = `${pick(OPENERS)} My records are syncing over now.${bootBit} ${pick(WITS)} ${pick(ASKS)}`;
  void name;
  return { sync, speak };
}

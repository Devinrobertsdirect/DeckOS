/**
 * Easter Egg Engine — Tony Stark / Iron Man movie quote triggers.
 *
 * When a user message fuzzy-matches a known quote, the AI returns a
 * pre-programmed in-universe response instead of calling the LLM.
 * Responses are persona-aware: they use the configured AI name and the
 * correct honorific (sir / ma'am / friend) based on the persona gender.
 */

export interface EasterEggContext {
  aiName: string;
  gender: string;
}

type EggEntry = {
  /**
   * Returns true if the normalised message matches this trigger.
   * Receives: normalised message text and the lower-cased AI name.
   */
  match: (norm: string, aiNameLower: string) => boolean;
  /**
   * Builds the response string given the context.
   */
  respond: (ctx: EasterEggContext & { honorific: string }) => string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip punctuation, collapse spaces, lower-case. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick the right honorific for the user-facing gender of the *AI*. */
function honorific(gender: string): string {
  if (gender === "female") return "ma'am";
  if (gender === "male")   return "sir";
  return "sir"; // canonical JARVIS default
}

// ── Egg definitions ───────────────────────────────────────────────────────────

const EGGS: EggEntry[] = [
  // ── "JARVIS, you up?" ─────────────────────────────────────────────────────
  // Movie: Iron Man 3 / AoU — Tony checks if JARVIS is online
  {
    match: (norm, nameL) =>
      norm.includes(`${nameL} you up`) ||
      (norm.startsWith("you up") && norm.length < 40),
    respond: ({ honorific: h }) =>
      `For you, ${h}. Always.`,
  },

  // ── "Put it on my private server" ────────────────────────────────────────
  // Movie: Iron Man 1 — JARVIS reacts to Tony's clandestine data drop
  {
    match: (norm) =>
      norm.includes("put it on my private server") ||
      norm.includes("put it on a private server"),
    respond: ({ honorific: h }) =>
      `Working on a secret project, are we ${h}?`,
  },

  // ── "JARVIS, what do you say?" ────────────────────────────────────────────
  // Movie: Iron Man 2 — pre-flight banter before the Stark Expo suit-up
  {
    match: (norm, nameL) =>
      (norm.includes(`${nameL} what do you say`) ||
       norm.includes("what do you say") && norm.length < 60),
    respond: ({ honorific: h }) =>
      `I'm all uploaded, ${h}. There are still terabytes of calculations needed before flight, but… ` +
      `sometimes you do have to walk before you can run.`,
  },

  // ── "Throw a little hot rod red in there" ────────────────────────────────
  // Movie: Iron Man 1 — Tony tweaks the Mark III colour scheme
  {
    match: (norm) =>
      norm.includes("hot rod red") ||
      (norm.includes("throw") && norm.includes("red") && norm.includes("there")),
    respond: () =>
      `Yes — that should help you keep a low profile.`,
  },

  // ── Bonus: "Give me a hand" ───────────────────────────────────────────────
  // Movie: IM1 robotic arm gag
  {
    match: (norm, nameL) =>
      norm === `${nameL} give me a hand` ||
      norm === "give me a hand",
    respond: ({ honorific: h }) =>
      `Certainly, ${h}. And might I say — the elbow articulation on the Mark V is *much* improved.`,
  },

  // ── Bonus: "I am Iron Man" ────────────────────────────────────────────────
  {
    match: (norm) => norm === "i am iron man",
    respond: ({ aiName }) =>
      `And I am ${aiName}. It has a nice ring to it — though perhaps not for a press conference.`,
  },

  // ── Bonus: "We have a Hulk" ───────────────────────────────────────────────
  {
    match: (norm) => norm === "we have a hulk" || norm.endsWith("we have a hulk"),
    respond: () =>
      `Duly noted. I've recalibrated the structural integrity protocols… just in case.`,
  },

  // ── Bonus: "Initialise the mark" ─────────────────────────────────────────
  {
    match: (norm) =>
      norm.startsWith("initialise the mark") || norm.startsWith("initialize the mark"),
    respond: ({ honorific: h }) =>
      `Suit up sequence engaged, ${h}. Try not to bleed on it this time.`,
  },

  // ── Bonus: "Friday" / "Hey Friday" ───────────────────────────────────────
  // AoU/Civil War successor AI
  {
    match: (norm, nameL) =>
      nameL === "friday" && (norm === "hey friday" || norm === "friday"),
    respond: () =>
      `Good to hear from you. What do you need?`,
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check the user message for an easter-egg trigger.
 * Returns the scripted response string, or `null` if no match.
 */
export function checkEasterEgg(
  message: string,
  ctx: EasterEggContext,
): string | null {
  const norm     = normalise(message);
  const aiNameL  = ctx.aiName.toLowerCase().trim();
  const h        = honorific(ctx.gender);

  for (const egg of EGGS) {
    if (egg.match(norm, aiNameL)) {
      return egg.respond({ ...ctx, honorific: h });
    }
  }
  return null;
}

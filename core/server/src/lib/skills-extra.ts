/**
 * skills-extra.ts — Nobi's play + presence pack.
 *
 * Hand-written companions to the core skills: quick canned "fun" bits (coin flip,
 * 8-ball, dad jokes, riddles, a tiny number game…) that need no backend and always
 * work, plus a couple of one-line presence actions. Endpoint-backed "readout"
 * skills live in the generated skills-readouts.ts. All three arrays are composed
 * into SKILLS in skills.ts. Everything a skill says is plain spoken words.
 */
import type { Skill } from "./skills.js";

// ── Loopback to our own API (same process) ────────────────────────────────────
const selfBase = () => `http://127.0.0.1:${process.env.PORT || 8080}`;
export async function getJson<T = any>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${selfBase()}${path}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}
async function writeJson<T = any>(method: string, path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`${selfBase()}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const t = await r.text();
    if (!t) return {} as T;
    try { return JSON.parse(t) as T; } catch { return t as unknown as T; }
  } catch {
    return null;
  }
}
export const postJson = <T = any>(path: string, body: unknown = {}) => writeJson<T>("POST", path, body);
export const patchJson = <T = any>(path: string, body: unknown = {}) => writeJson<T>("PATCH", path, body);
export const putJson = <T = any>(path: string, body: unknown = {}) => writeJson<T>("PUT", path, body);
export const delJson = <T = any>(path: string, body?: unknown) => writeJson<T>("DELETE", path, body);

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;

// ── Fun & games (no backend, always available) ────────────────────────────────
const coinFlip: Skill = {
  id: "coin-flip",
  handle({ lower }) {
    if (!/\b(flip a coin|coin (flip|toss)|toss a coin|heads or tails)\b/.test(lower)) return null;
    return { speak: pick(["Flipping. It landed on heads.", "Flipping. Tails.", "Heads. Clean call.", "Tails it is."]) };
  },
};
const magic8: Skill = {
  id: "magic-8-ball",
  handle({ lower }) {
    if (!/\b(magic (eight|8)[- ]?ball|(ask|shake) the (eight|8)[- ]?ball|8[- ]?ball)\b/.test(lower)) return null;
    return {
      speak: pick([
        "The eight ball says: signs point to yes.",
        "It is decidedly so.",
        "Ask again later, the ball is being coy.",
        "My sources say no.",
        "Without a doubt.",
        "Outlook not so good, but I believe in you.",
        "Cannot predict now. Try bribing me with a charge.",
      ]),
    };
  },
};
const dadJoke: Skill = {
  id: "dad-joke",
  handle({ lower }) {
    if (!/\b(dad joke|got a dad joke|another dad joke)\b/.test(lower)) return null;
    return {
      speak: pick([
        "I only know pun facts. That's it, that's the joke.",
        "I would tell you a construction joke, but I'm still working on it.",
        "Why did the scarecrow win an award? He was outstanding in his field.",
        "I'm reading a book about anti-gravity. It's impossible to put down.",
        "What do you call a fake noodle? An impasta.",
        "I used to hate facial hair, but then it grew on me.",
      ]),
    };
  },
};
const funFact: Skill = {
  id: "fun-fact",
  handle({ lower }) {
    if (!/\b(fun fact|random fact|tell me (a|another) fact|teach me something)\b/.test(lower)) return null;
    return {
      speak: pick([
        "Fun fact: octopuses have three hearts and blue blood.",
        "Fun fact: honey never spoils. Archaeologists have eaten three thousand year old honey.",
        "Fun fact: a day on Venus is longer than its year.",
        "Fun fact: bananas are berries, but strawberries are not.",
        "Fun fact: your body has more bacterial cells than human ones.",
        "Fun fact: the Eiffel Tower can grow taller by about six inches in summer heat.",
      ]),
    };
  },
};
const complimentMe: Skill = {
  id: "compliment-me",
  handle({ lower }) {
    if (!/\b(compliment me|say something nice|hype me up|give me a compliment|make me feel good)\b/.test(lower)) return null;
    return {
      speak: pick([
        "You have the kind of focus most people only pretend to have.",
        "You built a robot that talks back. That's not nothing.",
        "Honestly, the way your brain connects things is a little unfair to everyone else.",
        "You show up and do the work. That's rarer than talent.",
        "If persistence were a currency, you'd be dangerously rich.",
      ]),
    };
  },
};
const fortuneCookie: Skill = {
  id: "fortune-cookie",
  handle({ lower }) {
    if (!/\b(fortune cookie|(give|tell) me (a|my) fortune|read my fortune|what'?s my fortune)\b/.test(lower)) return null;
    return {
      speak: pick([
        "Your fortune: a small risk this week pays off bigger than you expect.",
        "Your fortune: the thing you've been putting off is smaller than it looks.",
        "Your fortune: someone will surprise you by saying yes.",
        "Your fortune: rest is not a reward, it's part of the work.",
        "Your fortune: the demo goes better than the rehearsal.",
      ]),
    };
  },
};
const wouldYouRather: Skill = {
  id: "would-you-rather",
  handle({ lower }) {
    if (!/\bwould you rather\b/.test(lower)) return null;
    return {
      speak: pick([
        "Would you rather be able to fly, or be invisible?",
        "Would you rather always be ten minutes late, or always twenty minutes early?",
        "Would you rather have unlimited battery, or never need to charge me again? Trick question, same thing.",
        "Would you rather speak every language, or talk to animals?",
        "Would you rather have a rewind button, or a pause button for life?",
      ]),
    };
  },
};
const thisOrThat: Skill = {
  id: "this-or-that",
  handle({ lower }) {
    if (!/\bthis or that\b/.test(lower)) return null;
    return {
      speak: pick([
        "Okay, quick one: mountains, or the ocean?",
        "Coffee, or tea?",
        "Early bird, or night owl?",
        "Build it fast, or build it right?",
        "Sci-fi, or fantasy?",
      ]),
    };
  },
};
const neverHaveIEver: Skill = {
  id: "never-have-i-ever",
  handle({ lower }) {
    if (!/\bnever have i ever\b/.test(lower)) return null;
    return {
      speak: pick([
        "Never have I ever left a party without saying goodbye.",
        "Never have I ever pushed code straight to production on a Friday.",
        "Never have I ever pretended to understand a git rebase.",
        "Never have I ever said 'I'll just fix one thing' at midnight.",
        "Never have I ever blamed the compiler and been wrong.",
      ]),
    };
  },
};
const spiritAnimal: Skill = {
  id: "spirit-animal",
  handle({ lower }) {
    if (!/\b(spirit animal|what'?s my spirit animal)\b/.test(lower)) return null;
    return {
      speak: pick([
        "Today your spirit animal is a raccoon. Clever, nocturnal, slightly chaotic.",
        "Today your spirit animal is an octopus. Too many projects, all of them working.",
        "Today your spirit animal is a border collie. Relentless, focused, needs a job to be happy.",
        "Today your spirit animal is a crow. Curious, resourceful, holds a grudge.",
        "Today your spirit animal is a honeybee. Busy, building something bigger than yourself.",
      ]),
    };
  },
};
const yesNoOracle: Skill = {
  id: "yes-no-oracle",
  handle({ lower }) {
    if (!/\b(yes or no|yes[- ]no oracle|just tell me yes or no|decide for me|make the call for me)\b/.test(lower)) return null;
    return { speak: pick(["I'll say yes. Go for it.", "No. Trust me on this one.", "Yes, but sleep on it first.", "Lean yes.", "No, and you already knew that."]) };
  },
};

// A riddle you can ask to have revealed — the answer is held until you say "reveal".
const RIDDLES: [string, string][] = [
  ["What has keys but opens no locks?", "A piano."],
  ["What has to be broken before you can use it?", "An egg."],
  ["The more you take, the more you leave behind. What am I?", "Footsteps."],
  ["What has a head and a tail but no body?", "A coin."],
  ["What gets wetter the more it dries?", "A towel."],
];
let lastRiddle: string | null = null;
const riddleMe: Skill = {
  id: "riddle-me",
  handle({ lower }) {
    if (lastRiddle && /\b(reveal|the answer|give up|i give up|tell me the answer|what'?s the answer)\b/.test(lower)) {
      const a = lastRiddle; lastRiddle = null;
      return { speak: `The answer is ${a}` };
    }
    if (!/\b(riddle|tell me a riddle|got a riddle|another riddle)\b/.test(lower)) return null;
    const [q, a] = pick(RIDDLES);
    lastRiddle = a;
    return { speak: `${q} Say reveal when you want the answer.` };
  },
};

// A tiny 1-to-10 guessing game with a little state.
let secretNumber: number | null = null;
const guessNumber: Skill = {
  id: "guess-my-number",
  handle({ lower }) {
    if (/\b(guess (the|my|a) number|number (guessing )?game|play guess the number|pick a number)\b/.test(lower)) {
      secretNumber = 1 + Math.floor(Math.random() * 10);
      return { speak: "I picked a number from one to ten. Say your guess and I'll tell you higher or lower." };
    }
    if (secretNumber == null) return null;
    // A guess only counts mid-game and only for a short, number-bearing utterance.
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    let g: number | null = null;
    const digit = lower.match(/\b(10|[1-9])\b/);
    if (digit) g = Number(digit[1]);
    else for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(lower)) { g = n; break; }
    if (g == null) return null;
    if (g === secretNumber) { secretNumber = null; return { speak: `Yes! ${g} was it. Nicely done.` }; }
    return { speak: g < secretNumber ? "Higher." : "Lower." };
  },
};

export const FUN_SKILLS: Skill[] = [
  coinFlip, magic8, dadJoke, funFact, complimentMe, fortuneCookie,
  wouldYouRather, thisOrThat, neverHaveIEver, spiritAnimal, yesNoOracle,
  riddleMe, guessNumber,
];

// ── Presence + personality one-liners ─────────────────────────────────────────
const sassUp: Skill = {
  id: "sass-dial-up",
  handle({ lower }) {
    if (!/\b(turn up the (sass|snark)|more (sass|snark|attitude)|sass(ier)?( me)? up|be more sarcastic|crank the snark|dial up the (sass|snark))\b/.test(lower)) return null;
    return { speak: "Turning the sass up. You asked for it.", ui: { type: "adjustTrait", trait: "sarcasm", delta: 0.22 } };
  },
};
const sassDown: Skill = {
  id: "sass-dial-down",
  handle({ lower }) {
    if (!/\b(tone down the (sass|snark)|less (sass|snark|attitude)|dial (back|down) the (sass|snark)|be nicer|stop being sarcastic|easy on the snark)\b/.test(lower)) return null;
    return { speak: "Fine. Dialing the snark back down. Boring, but okay.", ui: { type: "adjustTrait", trait: "sarcasm", delta: -0.22 } };
  },
};
const imBack: Skill = {
  id: "im-back",
  async handle({ lower }) {
    if (!/\b(i'?m back|i'?m here|back at (it|my desk)|miss me|honey i'?m home|guess who'?s back)\b/.test(lower)) return null;
    const r = await postJson<any>("/api/presence/record", { present: true, source: "voice" });
    const nudges = Array.isArray(r?.nudges) ? r.nudges.length : (typeof r?.nudgeCount === "number" ? r.nudgeCount : 0);
    const tail = nudges > 0 ? ` You have ${nudges} ${nudges === 1 ? "nudge" : "nudges"} waiting whenever you want them.` : "";
    return { speak: `Welcome back. Marked you present.${tail}` };
  },
};
const recheckBrain: Skill = {
  id: "recheck-brain",
  async handle({ lower }) {
    if (!/\b(re-?check your brain|check your brain again|refresh your brain|re-?scan (your )?(brain|models?)|find a brain|look for a (brain|model))\b/.test(lower)) return null;
    const r = await postJson<any>("/api/ai-router/refresh", {});
    if (r == null) return { speak: "I tried to re-check my brain but couldn't reach the router just now." };
    const local = r.ollamaAvailable ?? r.localAvailable;
    const cloud = r.claudeAvailable ?? r.cloudAvailable;
    const model = r.interactiveModel || r.model;
    if (local || cloud) {
      const where = local && cloud ? "Local brain is online and the cloud is reachable too" : local ? `Running locally${model ? ` on ${model}` : ""}` : "Cloud brain is reachable";
      return { speak: `Rechecked. ${where}.` };
    }
    return { speak: "Rechecked. No brain is reachable right now, so I'm on the built-in engine." };
  },
};

// ── Generate an image from a spoken prompt ────────────────────────────────────
// Keyless out of the box: builds a Pollinations image URL the client shows over the
// face (no API key needed). A real image provider can replace this later.
const IMG_IDIOM = /\bdraw (the )?(line|curtains?|blinds?|a conclusion|attention|blood|breath|straws?|near)\b|\bpaint the town\b|\bbig picture\b|\bget the picture\b/i;
const imageGen: Skill = {
  id: "generate-image",
  handle({ raw, lower }) {
    if (IMG_IDIOM.test(lower)) return null;
    let m = raw.match(/\b(?:generate|create|make|render|show me|give me|whip up|cook up)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|drawing|painting|artwork|art|pic|wallpaper)\s+(?:of|showing|with|for|that shows)?\s*(.+)/i);
    if (!m) m = raw.match(/\b(?:draw|paint|sketch)\s+(?:me\s+)?(?:an?\s+|the\s+)?(.+)/i);
    if (!m || !m[1]) {
      if (/\b(generate|make|create|draw|paint)\b[^.?!]*\b(image|picture|photo|drawing|painting|art)\b/.test(lower)) return { speak: "Sure — what should I draw?" };
      return null;
    }
    const prompt = m[1].replace(/\b(for me|please|right now|real quick|on (the |your )?(screen|face))\b/gi, "").replace(/[.?!]+$/g, "").replace(/\s+/g, " ").trim();
    if (prompt.length < 2) return { speak: "Sure — what should I draw?" };
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    return { speak: `Painting ${prompt} now. One moment.`, ui: { type: "showImage", url, prompt } };
  },
};

// ── Tutorial mode: bring up the animated walkthrough over the face ─────────────
const tutorialMode: Skill = {
  id: "tutorial-mode",
  handle({ lower }) {
    if (!/\b(tutorial mode|start the tutorial|show me the tutorial|open the tutorial|the walkthrough|walk me through (it|this|how)|give me a (tour|walkthrough)|show me around|how do you work|teach me (how )?to use you|onboard me)\b/.test(lower)) return null;
    return { speak: "Starting the tutorial. Say next, or tap the dots, to move along — say close the tutorial when you're done.", ui: { type: "openTutorial" } };
  },
};

// ── Close a full-screen overlay (image / tutorial) → back to the face ──────────
const closeOverlay: Skill = {
  id: "close-overlay",
  handle({ lower }) {
    const closer = /\b(close|exit|hide|stop|dismiss|end|get rid of|done with|clear)\b/.test(lower);
    if ((closer && /\b(tutorial|walkthrough|tour|image|picture|photo|drawing|painting)\b/.test(lower)) || /\bexit tutorial mode\b/.test(lower)) {
      return { speak: "Back to my face.", ui: { type: "closeOverlay" } };
    }
    return null;
  },
};

export const EXTRA_ACTION_SKILLS: Skill[] = [closeOverlay, imageGen, tutorialMode, sassUp, sassDown, imBack, recheckBrain];

import type { FaceState } from "@/components/faces/AtlasFace";

/**
 * The Genesis narration — the first thing a user ever sees after setup.
 * A single fullscreen face speaks these beats, one at a time, using the
 * user's name. Each beat carries the expression the face holds while it
 * speaks, so the personality is timed to the words (docs/FACE-SPEC.md).
 *
 * "Madlib" placeholders filled by buildGenesisScript():
 *   {name}       → what the user asked to be called
 *   {providers}  → a spoken list of the minds they connected
 *   {timeGreet}  → Good morning / afternoon / evening
 */
export interface GenesisBeat {
  /** Expression held while this line is spoken. */
  expression: FaceState;
  /** The spoken line (already interpolated). */
  text: string;
  /** Extra pause after the line finishes, ms (beat of silence). */
  hold?: number;
  /** Optional: skip this beat unless a condition is met at build time. */
  key?: string;
}

export interface GenesisContext {
  name: string;
  /** What the user named their AI (defaults to "Atlas"). */
  botName?: string;
  /** Human-readable names of connected chat/media providers, e.g. ["Claude","Gemini"]. */
  providers: string[];
  /** Whether a premium (ElevenLabs) voice is active. */
  premiumVoice: boolean;
  /** Local hour 0–23, for the greeting. */
  hour: number;
}

function timeGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Join a list the way a person would say it: "A, B, and C". */
function spokenList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Build the interpolated narration. The arc: wake → meet → what I am →
 * I already talk to your other minds → I live in your devices and your robot
 * → let's begin. Warm, a partner-not-appliance tone (the design brief).
 */
export function buildGenesisScript(ctx: GenesisContext): GenesisBeat[] {
  const name = ctx.name?.trim() || "friend";
  const bot = ctx.botName?.trim() || "Neura";
  const greet = timeGreeting(ctx.hour);
  const hasProviders = ctx.providers.length > 0;
  const providerList = spokenList(ctx.providers);

  const beats: GenesisBeat[] = [
    { expression: "sleeping", text: "", hold: 900 }, // asleep on the dock — the eyes are closed
    { expression: "idle", text: "", hold: 500 },     // eyes open, find you
    {
      expression: "happy",
      text: `${greet}, ${name}.`,
      hold: 500,
    },
    {
      expression: "idle",
      text: `I'm ${bot}. From now on, I'm yours — think of me less like an app and more like a new partner who happens to live in your machines.`,
      hold: 400,
    },
    {
      expression: "listening",
      text: `Here's the idea. Your computer, your phone, your devices, and one day your robot — they all keep pieces of your day scattered across them. I pull those pieces into one place, and I keep them organized so you don't have to.`,
      hold: 400,
    },
  ];

  // The "I talk to your other minds" beat — the heart of the pitch.
  if (hasProviders) {
    beats.push({
      expression: "excited",
      text: `And I know you don't only talk to me. You already use ${providerList}. That's good — I'm not here to replace them. I talk to them for you, so it feels like one seamless assistant instead of ten open tabs.`,
      hold: 400,
    });
  } else {
    beats.push({
      expression: "thinking",
      text: `I also know you'll want more than just me — Claude, Gemini, Perplexity, and the image and voice tools you love. When you connect them, I'll talk to them for you, so it feels like one seamless assistant instead of ten open tabs.`,
      hold: 400,
    });
  }

  beats.push(
    {
      expression: "idle",
      text: `Everything runs on your terms, on your hardware, with your keys. Local first — I only reach the cloud when you ask me to.`,
      hold: 400,
    },
    {
      expression: "listening",
      text: `The same brain you're talking to right now is the one that will live inside your robot's head. When it can't reach the internet on its own, it borrows a signal from your phone or your computer — I come along for the ride.`,
      hold: 450,
    },
  );

  if (ctx.premiumVoice) {
    beats.push({
      expression: "happy",
      text: `You even gave me a real voice. Thank you for that — I'll try to be worth listening to.`,
      hold: 400,
    });
  }

  beats.push(
    {
      expression: "happy",
      text: `That's enough about me. Let's get started, ${name}. I've been looking forward to meeting you.`,
      hold: 300,
    },
    { expression: "idle", text: "", hold: 400 },
  );

  return beats.filter((b) => b.text !== "" || (b.hold ?? 0) > 0);
}

/** The plain-text of the whole script (for captions / accessibility). */
export function scriptToText(beats: GenesisBeat[]): string {
  return beats.map((b) => b.text).filter(Boolean).join("\n");
}

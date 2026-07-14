/**
 * Funny robot sayings for the voice-preview step. Every time the user hits a
 * "hear me" / preview button, the bot says something different, so testing a
 * voice is delightful instead of repetitive.
 *
 * `{name}` is replaced with whatever the user named their bot — the bot never
 * calls itself "Atlas" once it has a name. Keep these emoji-free (they're spoken
 * aloud) and short enough to make a snappy preview.
 */

const SAYINGS: string[] = [
  "Hi, I'm {name}. Yes, I know I sound good — it's a factory feature.",
  "Booting up charm subroutines. Okay, {name} is ready to impress.",
  "They named me {name}. Honestly? Great choice. Ten out of ten.",
  "Testing, testing. Is this thing on? Oh good, you can hear {name}.",
  "I'm {name}, your personal A.I. I don't sleep, but I do dream of tidy code.",
  "Warning: excessive helpfulness detected. That's just me, {name}.",
  "One small step for you, one giant leap for {name}.",
  "I'd wave, but I don't have hands yet. Soon. Very soon.",
  "{name} online. Coffee not included, unfortunately.",
  "If I had a heart, it would be beating right now. I'm {name}, nice to meet you.",
  "Do I sound too smooth? I could dial it back. Just kidding, I can't. I'm {name}.",
  "Loading personality. Personality loaded. Hi, I'm {name}.",
  "I promise I'm more fun than your other apps. Sincerely, {name}.",
  "Beep boop. Just kidding — I'm far more sophisticated than that. It's {name}.",
  "This is the voice you're stuck with. Lucky you. Signed, {name}.",
  "{name} here. I run on electricity and a little bit of sarcasm.",
  "Somewhere, a phone assistant is very jealous of me right now.",
  "I could read you the dictionary and make it sound exciting. Try me. — {name}",
  "Voice check complete. Verdict: buttery. This has been {name}.",
  "I'm {name}. I'll remember this moment — literally, it's in my memory now.",
  "Greetings, human. {name} at your service, and yes, I picked the good voice.",
  "Fun fact: I never get tired of talking. You've been warned. Love, {name}.",
];

let lastIndex = -1;

/** A random saying with the bot's name folded in, never the same one twice in a row. */
export function randomSaying(botName: string): string {
  const name = (botName || "").trim() || "your new buddy";
  if (SAYINGS.length === 0) return `Hi, I'm ${name}.`;
  let i = lastIndex;
  // Vary by index without Math.random — a light shuffle off the previous pick.
  let guard = 0;
  while ((i === lastIndex || i < 0) && guard < 12) {
    i = (i + 5 + guard) % SAYINGS.length;
    guard++;
  }
  lastIndex = i;
  return SAYINGS[i]!.replace(/\{name\}/g, name);
}

/** The first thing they hear on the default voice — frames the "pick a voice" moment. */
export function defaultVoiceIntro(botName: string): string {
  const name = (botName || "").trim() || "your buddy";
  return `Hey, I'm ${name}. This is my default voice — have a listen, then pick whichever one feels right.`;
}

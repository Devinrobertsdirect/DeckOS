/**
 * identity.ts — the bot's name, as a universal truth.
 *
 * The user names their companion once (in setup); that name must persist
 * EVERYWHERE the bot refers to itself — chat, briefings, notifications, the rule
 * engine, all of it — never a hardcoded "JARVIS" or "Atlas". The client mirrors
 * the chosen name to the server config as ATLAS_BOT_NAME (app-config loads it
 * into process.env on boot), so this reads synchronously anywhere on the server.
 */
export function botName(): string {
  return (process.env["ATLAS_BOT_NAME"] || "").trim() || "Atlas";
}

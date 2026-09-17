import { execFile } from "node:child_process";
import { callClaudeVision, getClaudeModel } from "./inference.js";

/**
 * "What's on screen?" — Nobi looks at her OWN display. On the robot the brain
 * runs as root, so it can reach the user's Wayland session (grim) with the
 * runtime dir set. grim on this Pi is PNG-only (jpeg disabled), so we capture PNG
 * and hand it to Claude vision. Returns a short spoken description, or null on any
 * failure (no compositor, no key, timeout) so the skill can fall back gracefully.
 */

function captureScreenPng(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "grim",
      ["-"],
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 6000,
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"] || "/run/user/1000",
          WAYLAND_DISPLAY: process.env["WAYLAND_DISPLAY"] || "wayland-0",
        },
      },
      (err, stdout) => {
        if (err || !stdout || (stdout as Buffer).length === 0) { resolve(null); return; }
        resolve((stdout as Buffer).toString("base64"));
      },
    );
    child.on("error", () => resolve(null));
  });
}

const SCREEN_PROMPT =
  "You are Nobi, a small desk robot, looking at your OWN screen. In ONE or two " +
  "short, casual spoken sentences, tell me what's on the screen right now. If it's " +
  "just your two glowing eyes on a dark background, say so playfully. Plain speech " +
  "only — no markdown, no lists, no preamble.";

export async function describeScreen(): Promise<string | null> {
  const b64 = await captureScreenPng();
  if (!b64) return null;
  const model = await getClaudeModel().catch(() => "claude-sonnet-5");
  try {
    const desc = await callClaudeVision(b64, "image/png", SCREEN_PROMPT, model, 220);
    return desc || null;
  } catch {
    return null;
  }
}

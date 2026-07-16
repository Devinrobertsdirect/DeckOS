/**
 * hardwareFace.ts — mirror the on-screen face onto the physical face node.
 *
 * When a real round-LCD face panel (CrowPanel / CYD / bare ST7701) is attached
 * to the brain, the app POSTs each expression change to /api/face so the
 * hardware eyes match what's on screen. Fire-and-forget and deduped, so it costs
 * nothing when there's no panel (the server's face link just runs in "sim" mode).
 */
let lastKey = "";

export function mirrorFace(state: string, color?: string | null): void {
  const key = `${state}|${color ?? ""}`;
  if (key === lastKey) return;
  lastKey = key;
  const body: Record<string, unknown> = { state };
  if (color) body.color = color;
  void fetch("/api/face", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => { /* no panel / offline — the browser face is still the display */ });
}

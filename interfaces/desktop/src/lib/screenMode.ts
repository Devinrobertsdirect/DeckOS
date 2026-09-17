/**
 * Screen-shape mode — how the app fits the physical display:
 *  - "round"   → the robot head: a 480×480 circular screen behind a bezel.
 *                The corners physically don't exist, so index.css pulls all
 *                in-flow content into the inscribed circle (full-bleed
 *                backgrounds stay full-bleed) and hides the mouse cursor.
 *  - "default" → any normal rectangular monitor. No changes at all.
 *
 * The kiosk enables it once via URL (http://localhost:8080?screen=round) and
 * it then sticks across in-app navigations/reloads through localStorage, so
 * the Pi never has to carry the query param around.
 */
export type ScreenMode = "round" | "default";

const SCREEN_KEY = "neura_screen";

export function getScreenMode(): ScreenMode {
  return localStorage.getItem(SCREEN_KEY) === "round" ? "round" : "default";
}

/**
 * Resolve the screen mode and stamp it on <html> as data-screen so index.css
 * can style against it. Call once from main.tsx, before the first render —
 * that way the very first painted frame is already circle-safe (no square
 * flash on the robot's face). `?screen=round` turns it on and persists; any
 * other explicit value (e.g. `?screen=flat`) is the escape hatch back to a
 * normal rectangular screen.
 */
export function initScreenMode(): void {
  let mode = getScreenMode();
  const param = new URLSearchParams(window.location.search).get("screen");
  if (param === "round") {
    mode = "round";
    localStorage.setItem(SCREEN_KEY, "round");
  } else if (param) {
    mode = "default";
    localStorage.removeItem(SCREEN_KEY);
  }
  if (mode === "round") {
    document.documentElement.dataset.screen = "round";
  } else {
    delete document.documentElement.dataset.screen;
  }
}

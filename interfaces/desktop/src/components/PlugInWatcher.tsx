import { useEffect, useRef } from "react";
import { setExperienceMode } from "@/lib/uiMode";

/**
 * PlugInWatcher — the "plug it in and it wakes up as a robot" magic.
 *
 * Polls the server for a physical board on a USB port. The moment one appears it
 * flips Atlas into robot (face-locked) mode and flags a dock greeting, so the
 * buddy thanks you for the charge, says it's syncing, and asks what you need.
 * Mounted app-wide so it fires no matter which screen you're on.
 */
export function PlugInWatcher() {
  const present = useRef<boolean | null>(null);
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/api/body/presence");
        if (!r.ok) return;
        const d = (await r.json()) as { present?: boolean };
        const now = !!d.present;
        if (present.current !== true && now) {
          // Just plugged in (or the app opened with a board attached) → become
          // the robot and greet.
          try { sessionStorage.setItem("atlas_dock_pending", "1"); } catch { /* ignore */ }
          setExperienceMode("robot");
          window.dispatchEvent(new CustomEvent("atlas:pluggedIn"));
        } else if (present.current === true && !now) {
          window.dispatchEvent(new CustomEvent("atlas:unplugged"));
        }
        present.current = now;
      } catch { /* server not up yet — try again next tick */ }
    };
    void poll();
    const id = window.setInterval(poll, 2500);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

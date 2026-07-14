import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { setUiMode, getBotName } from "@/lib/uiMode";

/**
 * ReturnToFace — the always-there way home.
 *
 * In "computer" mode the face is where 95% of the experience lives, so from the
 * full command center there's a persistent little Atlas face floating in the
 * corner. Click it (or the label) and you're back on the face page instantly.
 * Hidden in "robot" mode, where the face is the only screen anyway.
 */
export function ReturnToFace() {
  const bot = getBotName();
  // Neutral by default; a brief, occasional smile so it feels alive without
  // grinning nonstop.
  const [faceState, setFaceState] = useState<FaceState>("idle");
  useEffect(() => {
    const id = window.setInterval(() => {
      setFaceState("happy");
      window.setTimeout(() => setFaceState("idle"), 2500);
    }, 90_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <motion.button
      type="button"
      onClick={() => setUiMode("pet")}
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.2 }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      aria-label={`Back to ${bot}`}
      title={`Back to ${bot}`}
      className="group fixed bottom-4 left-4 z-[130] flex items-center gap-2 rounded-full border
        border-[rgba(var(--primary-rgb),0.35)] bg-background/80 py-1.5 pl-1.5 pr-3 shadow-[0_0_26px_rgba(var(--primary-rgb),0.25)]
        backdrop-blur-md transition-colors hover:border-[rgba(var(--primary-rgb),0.7)]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--primary-rgb),0.9)]"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(var(--primary-rgb),0.10)]"
        aria-hidden
      >
        <AtlasFace mode="atlas" state={faceState} size={38} />
      </span>
      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-primary/70 group-hover:text-primary">
        {bot}
      </span>
    </motion.button>
  );
}

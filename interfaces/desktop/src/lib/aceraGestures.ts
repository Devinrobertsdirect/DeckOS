/**
 * ACERA Gesture Engine
 * Classifies MediaPipe hand landmarks into named gestures and infers
 * scene-level activity from hand + pose data.
 *
 * Landmark index reference (MediaPipe Hands):
 *   0  WRIST
 *   1-4  THUMB   (1=CMC, 2=MCP, 3=IP, 4=TIP)
 *   5-8  INDEX   (5=MCP, 6=PIP, 7=DIP, 8=TIP)
 *   9-12 MIDDLE  (9=MCP, 10=PIP, 11=DIP, 12=TIP)
 *  13-16 RING    (13=MCP, 14=PIP, 15=DIP, 16=TIP)
 *  17-20 PINKY   (17=MCP, 18=PIP, 19=DIP, 20=TIP)
 *
 * Coordinate space: x/y normalised 0-1 (top-left origin), z depth.
 */

export type Gesture =
  | "OPEN_PALM"
  | "CLOSED_FIST"
  | "POINTING_UP"
  | "PEACE"
  | "THREE_FINGERS"
  | "THUMBS_UP"
  | "THUMBS_DOWN"
  | "PINCH"
  | "SWIPE_LEFT"
  | "SWIPE_RIGHT"
  | "SWIPE_UP"
  | "UNKNOWN";

export type HandednessLabel = "Left" | "Right";

export type GestureResult = {
  gesture: Gesture;
  confidence: number;
  fingers: boolean[]; // [thumb, index, middle, ring, pinky]
  handedness: HandednessLabel;
  palmPosition: { x: number; y: number };
  pinchDistance: number | null;
};

export type SceneActivity =
  | "idle"
  | "browsing"
  | "gesturing"
  | "typing"
  | "pointing"
  | "interacting";

// ── Helpers ───────────────────────────────────────────────────────────────────

type NLM = { x: number; y: number; z: number };

/** Is finger N extended? (tip is above its PIP joint in image-y = smaller y = higher) */
function isFingerExtended(lm: NLM[], tipIdx: number, pipIdx: number): boolean {
  return lm[tipIdx]!.y < lm[pipIdx]!.y - 0.02;
}

function isThumbExtended(lm: NLM[], handedness: HandednessLabel): boolean {
  // Thumb extension is horizontal; compare tip x vs MCP x
  const tip  = lm[4]!;
  const mcp  = lm[2]!;
  // Mirrored for left vs right hand
  return handedness === "Right"
    ? tip.x < mcp.x - 0.04
    : tip.x > mcp.x + 0.04;
}

function euclidean2d(a: NLM, b: NLM): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Core classifier ───────────────────────────────────────────────────────────

export function detectGesture(
  landmarks: NLM[],
  handedness: HandednessLabel,
  velocityX = 0,
  velocityY = 0,
): GestureResult {
  if (landmarks.length < 21) {
    return {
      gesture: "UNKNOWN", confidence: 0, fingers: [false, false, false, false, false],
      handedness, palmPosition: { x: 0.5, y: 0.5 }, pinchDistance: null,
    };
  }

  const lm = landmarks;

  const thumb  = isThumbExtended(lm, handedness);
  const index  = isFingerExtended(lm, 8, 6);
  const middle = isFingerExtended(lm, 12, 10);
  const ring   = isFingerExtended(lm, 16, 14);
  const pinky  = isFingerExtended(lm, 20, 18);

  const fingers: boolean[] = [thumb, index, middle, ring, pinky];
  const extended = fingers.filter(Boolean).length;

  const palmX = lm[0]!.x;
  const palmY = lm[0]!.y;
  const pinchDist = euclidean2d(lm[4]!, lm[8]!);

  // Swipe detection (velocity threshold)
  const SWIPE_V = 0.018;
  if (Math.abs(velocityX) > SWIPE_V && Math.abs(velocityX) > Math.abs(velocityY) * 1.5) {
    const gesture: Gesture = velocityX < 0 ? "SWIPE_LEFT" : "SWIPE_RIGHT";
    return { gesture, confidence: 0.85, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }
  if (velocityY < -SWIPE_V && Math.abs(velocityY) > Math.abs(velocityX) * 1.5) {
    return { gesture: "SWIPE_UP", confidence: 0.82, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Pinch: thumb + index very close, others don't matter
  if (pinchDist < 0.06 && !middle && !ring) {
    return { gesture: "PINCH", confidence: 0.9, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Open palm: all 5 fingers extended
  if (extended >= 4 && index && middle && ring && pinky) {
    return { gesture: "OPEN_PALM", confidence: 0.92, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Closed fist: no fingers extended
  if (extended === 0) {
    return { gesture: "CLOSED_FIST", confidence: 0.9, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Thumbs up: only thumb extended, wrist below palm (hand upright)
  if (thumb && !index && !middle && !ring && !pinky && lm[0]!.y > lm[4]!.y + 0.08) {
    return { gesture: "THUMBS_UP", confidence: 0.88, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Thumbs down
  if (thumb && !index && !middle && !ring && !pinky && lm[4]!.y > lm[0]!.y + 0.05) {
    return { gesture: "THUMBS_DOWN", confidence: 0.85, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Pointing up: only index extended
  if (index && !middle && !ring && !pinky) {
    return { gesture: "POINTING_UP", confidence: 0.88, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Peace sign: index + middle
  if (index && middle && !ring && !pinky) {
    return { gesture: "PEACE", confidence: 0.87, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  // Three fingers: index + middle + ring
  if (index && middle && ring && !pinky) {
    return { gesture: "THREE_FINGERS", confidence: 0.85, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
  }

  return { gesture: "UNKNOWN", confidence: 0.4, fingers, handedness, palmPosition: { x: palmX, y: palmY }, pinchDistance: pinchDist };
}

// ── Scene / activity inference ────────────────────────────────────────────────

export function inferActivity(
  handCount: number,
  dominantGesture: Gesture | null,
  fps: number,
): SceneActivity {
  if (handCount === 0) return "idle";
  if (!dominantGesture || dominantGesture === "UNKNOWN") return "browsing";
  if (dominantGesture === "POINTING_UP" || dominantGesture === "PINCH") return "pointing";
  if (dominantGesture === "OPEN_PALM" || dominantGesture === "PEACE") return "gesturing";
  if (dominantGesture === "SWIPE_LEFT" || dominantGesture === "SWIPE_RIGHT" || dominantGesture === "SWIPE_UP") return "interacting";
  if (handCount >= 2 && fps > 15) return "typing";
  return "browsing";
}

// ── Human-readable scene summary (for AI context) ────────────────────────────

export function buildSceneSummary(
  handCount: number,
  hands: GestureResult[],
  faceCount: number,
  activity: SceneActivity,
  frameCount: number,
): string {
  const parts: string[] = [];
  parts.push(`[ACERA] Frame #${frameCount}.`);
  parts.push(`User presence: ${faceCount > 0 ? `${faceCount} face(s) detected` : "no face detected"}.`);
  parts.push(`Hands: ${handCount} detected.`);

  for (const h of hands) {
    const ext = h.fingers.map((f, i) => f ? ["thumb","index","middle","ring","pinky"][i] : null).filter(Boolean).join(", ");
    parts.push(
      `  ${h.handedness} hand — gesture: ${h.gesture}, extended fingers: [${ext || "none"}], ` +
      `palm at (${h.palmPosition.x.toFixed(2)}, ${h.palmPosition.y.toFixed(2)}).`
    );
  }

  parts.push(`Inferred activity: ${activity}.`);
  return parts.join(" ");
}

// ── Gesture → dashboard action map ───────────────────────────────────────────

export type DashboardAction =
  | "nav:prev"
  | "nav:next"
  | "nav:console"
  | "nav:ai"
  | "ui:confirm"
  | "ui:dismiss"
  | "ui:fullscreen"
  | null;

/** Translates a stable gesture into a dashboard action */
export function gestureToDashboardAction(gesture: Gesture): DashboardAction {
  switch (gesture) {
    case "SWIPE_LEFT":   return "nav:prev";
    case "SWIPE_RIGHT":  return "nav:next";
    case "PEACE":        return "nav:console";
    case "THUMBS_UP":    return "nav:ai";
    case "OPEN_PALM":    return "ui:fullscreen";
    case "CLOSED_FIST":  return "ui:dismiss";
    case "THREE_FINGERS": return "ui:confirm";
    default: return null;
  }
}

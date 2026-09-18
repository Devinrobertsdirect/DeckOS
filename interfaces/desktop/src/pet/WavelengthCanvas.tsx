/**
 * WavelengthCanvas — the dial, drawn around his eyes.
 *
 * Wavelength is a game about a needle on a scale, and this screen is already a
 * circle, so the scale is an arc across the bottom of his face and the needles
 * stand up from it. Drawing it as a real dial rather than a row of percentages
 * is most of why the game is worth playing here: the argument is about where a
 * word sits on a line, and everyone can see the line.
 *
 * The target band is drawn ONLY at the reveal. Until then the arc is empty and
 * the needles are anonymous, because the whole tension is not knowing.
 */

export interface WavelengthCanvasData {
  kind: string;
  phase: "lobby" | "clue" | "guessing" | "reveal";
  left: string;
  right: string;
  /** 0..1, or null while it is still a secret. */
  target: number | null;
  bands: { bullseye: number; close: number; near: number };
  needles: Array<{ name: string; at: number; show: boolean }>;
}

const CX = 50;
const CY = 50;
/** The arc sits low, under his eyes, so it never covers them. */
const R = 40;
/** The scale spans this many degrees, centred on straight down. */
const SPAN = 150;

/** A position on the scale (0..1) to a point on the arc. */
function pt(at: number, radius: number): [number, number] {
  // 0 on the left, 1 on the right, sweeping across the bottom.
  const deg = 180 + (180 - SPAN) / 2 + at * SPAN;
  const rad = (deg * Math.PI) / 180;
  return [CX + Math.cos(rad) * radius, CY - Math.sin(rad) * radius];
}

function arc(from: number, to: number, radius: number): string {
  const [x0, y0] = pt(from, radius);
  const [x1, y1] = pt(to, radius);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const NEEDLE_COLOURS = ["#5ce0b8", "#7fb3ff", "#ffd166", "#ff8fb0", "#c08bff", "#ff7a45"];

export default function WavelengthCanvas({ data }: { data: WavelengthCanvasData }) {
  if (data.kind !== "wavelength") return null;
  const revealed = data.phase === "reveal" && data.target !== null;
  const t = data.target ?? 0.5;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {/* The scale itself. */}
      <path d={arc(0, 1, R)} fill="none" stroke="#2a3b52" strokeWidth={3} strokeLinecap="round" />

      {/* The scoring bands, only once the answer is out. Widest first so the
          bullseye sits on top of them. */}
      {revealed && (
        <>
          <path d={arc(clamp(t - data.bands.near), clamp(t + data.bands.near), R)}
            fill="none" stroke="#5ce0b8" strokeWidth={3} opacity={0.25} strokeLinecap="butt" />
          <path d={arc(clamp(t - data.bands.close), clamp(t + data.bands.close), R)}
            fill="none" stroke="#5ce0b8" strokeWidth={3} opacity={0.45} strokeLinecap="butt" />
          <path d={arc(clamp(t - data.bands.bullseye), clamp(t + data.bands.bullseye), R)}
            fill="none" stroke="#5ce0b8" strokeWidth={3.4} opacity={0.95} strokeLinecap="butt" />
        </>
      )}

      {/* Everyone's guess, standing up off the arc. Anonymous until the reveal —
          seeing whose needle is whose early would just start the argument before
          anybody has committed. */}
      {data.needles.map((n, i) => {
        const [x0, y0] = pt(clamp(n.at), R - 4);
        const [x1, y1] = pt(clamp(n.at), R + 5);
        const colour = NEEDLE_COLOURS[i % NEEDLE_COLOURS.length];
        return (
          <g key={`${n.name}-${i}`}>
            <line x1={x0} y1={y0} x2={x1} y2={y1}
              stroke={n.show ? colour : "#4a5a70"} strokeWidth={1.6} strokeLinecap="round" />
            {n.show && (
              <text x={x1} y={y1 - 2} textAnchor="middle" fontSize={3.4} fill={colour} opacity={0.9}>
                {n.name}
              </text>
            )}
          </g>
        );
      })}

      {/* The ends of the scale, named. */}
      <text x={pt(0, R)[0] - 1} y={pt(0, R)[1] + 6} textAnchor="middle" fontSize={4} fill="#8fa6c0">{data.left}</text>
      <text x={pt(1, R)[0] + 1} y={pt(1, R)[1] + 6} textAnchor="middle" fontSize={4} fill="#8fa6c0">{data.right}</text>
    </svg>
  );
}

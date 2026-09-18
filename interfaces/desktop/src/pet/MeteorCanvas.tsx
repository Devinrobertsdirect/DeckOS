/**
 * MeteorCanvas — the round playfield, drawn on top of his face.
 *
 * The server owns the game in polar coordinates because his screen is a circle:
 * an angle clockwise from the top, and a radius where 1 is the rim and 0 is his
 * eyes. This turns that into SVG and nothing else — no game logic lives here, so
 * a dropped frame costs a frame and never desynchronises anything.
 *
 * It deliberately draws AROUND the eyes rather than over them. The whole point
 * of the game is that the thing you are defending is him, which stops being true
 * the moment the playfield covers his face.
 */

export interface MeteorCanvasData {
  kind: string;
  phase: "lobby" | "playing" | "over";
  lives: number;
  flash: "block" | "hit" | "wave" | null;
  shieldArc: number;
  shieldRadius: number;
  shields: Array<{ name: string; angle: number }>;
  meteors: Array<{ id: number; angle: number; radius: number; size: 1 | 2 }>;
}

/** The rim, in viewBox units. Everything is drawn inside this. */
const RIM = 46;
const CX = 50;
const CY = 50;

/** Polar (degrees clockwise from top, radius 0..1) → SVG x/y. */
function pt(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [CX + Math.cos(rad) * RIM * radius, CY + Math.sin(rad) * RIM * radius];
}

/** An arc of the rim, centred on `angle` and `span` degrees wide. */
function arcPath(angle: number, span: number, radius: number): string {
  const [x0, y0] = pt(angle - span / 2, radius);
  const [x1, y1] = pt(angle + span / 2, radius);
  const r = RIM * radius;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SHIELD_COLORS = ["#5ce0b8", "#7fb3ff", "#ffd166", "#ff8fb0"];

export default function MeteorCanvas({ data }: { data: MeteorCanvasData }) {
  if (data.kind !== "meteor") return null;
  const playing = data.phase === "playing";

  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {/* The rim he is defending. It brightens when something is blocked and
          goes red the instant one gets through, so a glance tells the story. */}
      <circle
        cx={CX} cy={CY} r={RIM}
        fill="none"
        stroke={data.flash === "hit" ? "#ff5470" : data.flash === "block" ? "#ffd166" : "#2a3b52"}
        strokeWidth={data.flash ? 1.2 : 0.6}
        opacity={data.flash ? 0.9 : 0.5}
      />

      {playing && data.meteors.map((m) => {
        const [x, y] = pt(m.angle, m.radius);
        // A tail pointing back out to where it came from. Cheap, and it is what
        // makes a dot read as something falling rather than something sitting.
        const [tx, ty] = pt(m.angle, Math.min(1, m.radius + (m.size === 2 ? 0.14 : 0.1)));
        const r = m.size === 2 ? 2.6 : 1.7;
        return (
          <g key={m.id}>
            <line
              x1={tx} y1={ty} x2={x} y2={y}
              stroke={m.size === 2 ? "#ff7a45" : "#ffa06b"}
              strokeWidth={r * 0.7}
              strokeLinecap="round"
              opacity={0.35}
            />
            <circle cx={x} cy={y} r={r} fill={m.size === 2 ? "#ff5e2b" : "#ffa06b"} />
            <circle cx={x} cy={y} r={r * 0.45} fill="#fff3e6" opacity={0.85} />
          </g>
        );
      })}

      {playing && data.shields.map((s, i) => (
        <path
          key={`${s.name}-${i}`}
          d={arcPath(s.angle, data.shieldArc, data.shieldRadius)}
          fill="none"
          stroke={SHIELD_COLORS[i % SHIELD_COLORS.length]}
          strokeWidth={2.6}
          strokeLinecap="round"
          opacity={0.95}
        />
      ))}

      {/* Lives, as pips along the bottom of the rim — out of the way of the
          eyes, and in the one place nothing else is ever drawn. */}
      {playing && Array.from({ length: Math.max(0, data.lives) }).map((_, i) => {
        const [x, y] = pt(180 + (i - 1) * 7, 0.93);
        return <circle key={i} cx={x} cy={y} r={1.5} fill="#ff5470" opacity={0.9} />;
      })}
    </svg>
  );
}

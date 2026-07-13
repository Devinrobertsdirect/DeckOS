"""Per-state eye geometry for the Atlas face (docs/FACE-SPEC.md).

"No mouth, no eyebrows — two shapes on a dark round glass do all the acting."

Everything here is pure geometry in the 480x480 reference canvas; rasterising
belongs to face_sim.py (pygame) or a future SPI framebuffer driver. All state
changes are expressed as numeric parameter sets so face.py can tween between
them (250–400 ms — the face never "teleports").

Colour constants match the design language exactly:
  disc  #1E2A38  smoked-glass navy
  eyes  #C9DCF0  ice-blue — "THE EYES ALWAYS MATCH THE SEAM"
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from enum import Enum

# -- palette ---------------------------------------------------------------

NAVY = (0x1E, 0x2A, 0x38)      # disc
NAVY_RIM = (0x2C, 0x3B, 0x4E)  # subtle 1px lighter ring at the rim
ICE_BLUE = (0xC9, 0xDC, 0xF0)  # default eye / accent colour

CANVAS = 480                    # reference resolution (3.1" round LCD)
CX = CY = CANVAS // 2


class FaceState(Enum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    TALKING = "talking"
    HAPPY = "happy"
    CONFUSED = "confused"
    EXCITED = "excited"
    CHARGING = "charging"
    SLEEPING = "sleeping"


class EyeShape(Enum):
    PILL = "pill"        # vertical rounded pill
    ARC_UP = "arc_up"    # upward arc "∩" (happy / charging)
    DASH = "dash"        # short horizontal dash (sleeping / confused right eye)
    ZIGZAG = "zigzag"    # lightning bolt (excited)


@dataclass(slots=True)
class EyeParams:
    """Numeric description of one eye. All values in canvas pixels."""

    shape: EyeShape = EyeShape.PILL
    width: float = 44.0          # pill ~1:2.2 w:h
    height: float = 97.0
    offset_x: float = 0.0        # relative to that eye's rest position
    offset_y: float = 0.0        # negative = up
    openness: float = 1.0        # 1 open, 0 fully blinked
    glow: float = 1.0            # brightness multiplier 0..1


@dataclass(slots=True)
class FaceParams:
    """Both eyes + state extras. This is what face.py tweens."""

    left: EyeParams = field(default_factory=EyeParams)
    right: EyeParams = field(default_factory=EyeParams)
    eye_gap: float = 44.0        # gap ≈ one eye-width
    eyes_y: float = CY - 24      # slightly above midline
    dim: float = 1.0             # screen brightness (SLEEPING dims to 0.05)
    # extras toggles — rendered by face_sim when > 0
    attention_arc: float = 0.0   # LISTENING dashed arc above
    thinking_dots: float = 0.0   # THINKING trail of 3 dots lower-right
    charge_ring: float = 0.0     # CHARGING dashed % ring below
    sleep_zs: float = 0.0        # SLEEPING "z z" drift
    spark: float = 0.0           # EXCITED flicker


def base_params(state: FaceState) -> FaceParams:
    """Target parameter set for each expression state (FACE-SPEC table)."""
    p = FaceParams()

    if state is FaceState.IDLE:
        pass  # defaults are IDLE

    elif state is FaceState.LISTENING:
        for eye in (p.left, p.right):
            eye.width, eye.height = 54.0, 100.0   # widen / rounden
        p.attention_arc = 1.0

    elif state is FaceState.THINKING:
        for eye in (p.left, p.right):
            eye.width, eye.height = 34.0, 70.0    # shrink
            eye.offset_x, eye.offset_y = -18.0, -22.0  # drift up-left
            eye.glow = 0.85
        p.thinking_dots = 1.0

    elif state is FaceState.TALKING:
        pass  # idle pills; cadence bounce is animated in face.py

    elif state is FaceState.HAPPY:
        for eye in (p.left, p.right):
            eye.shape = EyeShape.ARC_UP           # "∩∩" closed happy eyes
            eye.width, eye.height = 64.0, 40.0

    elif state is FaceState.CONFUSED:
        # asymmetric squint: left pill, right short dash set higher
        p.left.width, p.left.height = 40.0, 88.0
        p.right.shape = EyeShape.DASH
        p.right.width, p.right.height = 44.0, 12.0
        p.right.offset_y = -26.0

    elif state is FaceState.EXCITED:
        for eye in (p.left, p.right):
            eye.shape = EyeShape.ZIGZAG
            eye.width, eye.height = 52.0, 90.0
        p.spark = 1.0

    elif state is FaceState.CHARGING:
        for eye in (p.left, p.right):
            eye.shape = EyeShape.ARC_UP           # half-closed shallow arcs
            eye.width, eye.height = 58.0, 22.0
            eye.glow = 0.8
        p.charge_ring = 1.0

    elif state is FaceState.SLEEPING:
        for eye in (p.left, p.right):
            eye.shape = EyeShape.DASH
            eye.width, eye.height = 46.0, 10.0
        p.dim = 0.05                              # screen dim to 5%
        p.sleep_zs = 1.0

    return p


def eye_centers(p: FaceParams) -> tuple[tuple[float, float], tuple[float, float]]:
    """Rest centres of left/right eyes on the canvas."""
    half = p.eye_gap / 2 + p.left.width / 2
    lx = CX - half + p.left.offset_x
    rx = CX + half + p.right.offset_x
    return (lx, p.eyes_y + p.left.offset_y), (rx, p.eyes_y + p.right.offset_y)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease_in_out(t: float) -> float:
    """Smoothstep-style easing so tweens feel organic, not linear."""
    return t * t * (3.0 - 2.0 * t)


def mix_eye(a: EyeParams, b: EyeParams, t: float) -> EyeParams:
    """Interpolate numerics; switch discrete shape at the midpoint."""
    return EyeParams(
        shape=b.shape if t >= 0.5 else a.shape,
        width=lerp(a.width, b.width, t),
        height=lerp(a.height, b.height, t),
        offset_x=lerp(a.offset_x, b.offset_x, t),
        offset_y=lerp(a.offset_y, b.offset_y, t),
        openness=lerp(a.openness, b.openness, t),
        glow=lerp(a.glow, b.glow, t),
    )


def mix_face(a: FaceParams, b: FaceParams, raw_t: float) -> FaceParams:
    t = ease_in_out(max(0.0, min(1.0, raw_t)))
    return FaceParams(
        left=mix_eye(a.left, b.left, t),
        right=mix_eye(a.right, b.right, t),
        eye_gap=lerp(a.eye_gap, b.eye_gap, t),
        eyes_y=lerp(a.eyes_y, b.eyes_y, t),
        dim=lerp(a.dim, b.dim, t),
        attention_arc=lerp(a.attention_arc, b.attention_arc, t),
        thinking_dots=lerp(a.thinking_dots, b.thinking_dots, t),
        charge_ring=lerp(a.charge_ring, b.charge_ring, t),
        sleep_zs=lerp(a.sleep_zs, b.sleep_zs, t),
        spark=lerp(a.spark, b.spark, t),
    )


def zigzag_points(cx: float, cy: float, w: float, h: float) -> list[tuple[float, float]]:
    """Lightning-bolt polyline for the EXCITED eyes."""
    return [
        (cx + w * 0.20, cy - h * 0.50),
        (cx - w * 0.30, cy - h * 0.05),
        (cx + w * 0.05, cy - h * 0.05),
        (cx - w * 0.20, cy + h * 0.50),
        (cx + w * 0.30, cy + h * 0.02),
        (cx - w * 0.05, cy + h * 0.02),
    ]


def apply_blink(eye: EyeParams, openness: float) -> EyeParams:
    """Return a copy of *eye* squashed by the blink envelope (1 open → 0 shut)."""
    squashed = max(0.06, openness)
    return replace(eye, height=eye.height * squashed, openness=openness)


def gaze_drift(clock: float) -> tuple[float, float]:
    """Slow Lissajous micro-drift applied in IDLE so the face feels alive."""
    return (
        4.0 * math.sin(clock * 0.7) + 2.0 * math.sin(clock * 1.9),
        3.0 * math.sin(clock * 0.9 + 1.3),
    )

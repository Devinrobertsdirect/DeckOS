"""Desktop face simulator.

Runs the 480x480 round face in a pygame window and cycles expression states
with keys 1–9. pygame is an *optional* dependency: without it the simulator
degrades to a pure-python loop that prints the active state, so the state
machine is still exercisable on a headless Pi or in CI.

    python -m robot.display.face_sim

Keys:
    1 IDLE   2 LISTENING  3 THINKING  4 TALKING  5 HAPPY
    6 CONFUSED  7 EXCITED  8 CHARGING  9 SLEEPING
    ESC / close window to quit.
"""

from __future__ import annotations

import math
import time

from .eyes import (
    CANVAS,
    CX,
    CY,
    ICE_BLUE,
    NAVY,
    NAVY_RIM,
    EyeShape,
    FaceState,
    eye_centers,
    zigzag_points,
)
from .face import Face

STATE_KEYS: dict[int, FaceState] = {
    1: FaceState.IDLE,
    2: FaceState.LISTENING,
    3: FaceState.THINKING,
    4: FaceState.TALKING,
    5: FaceState.HAPPY,
    6: FaceState.CONFUSED,
    7: FaceState.EXCITED,
    8: FaceState.CHARGING,
    9: FaceState.SLEEPING,
}

try:
    import pygame
    HAS_PYGAME = True
except ImportError:
    HAS_PYGAME = False


def _scaled(color: tuple[int, int, int], k: float) -> tuple[int, int, int]:
    k = max(0.0, min(1.0, k))
    return tuple(int(c * k) for c in color)  # type: ignore[return-value]


def _draw_eye(surface, eye, center: tuple[float, float]) -> None:  # noqa: ANN001
    cx, cy = center
    color = _scaled(ICE_BLUE, eye.glow)
    w, h = eye.width, eye.height

    if eye.shape is EyeShape.PILL:
        rect = pygame.Rect(int(cx - w / 2), int(cy - h / 2), int(w), int(h))
        pygame.draw.rect(surface, color, rect, border_radius=int(w / 2))
    elif eye.shape is EyeShape.ARC_UP:
        rect = pygame.Rect(int(cx - w / 2), int(cy - h / 2), int(w), int(h * 2))
        pygame.draw.arc(surface, color, rect, 0.0, math.pi, max(4, int(w / 6)))
    elif eye.shape is EyeShape.DASH:
        rect = pygame.Rect(int(cx - w / 2), int(cy - h / 2), int(w), max(6, int(h)))
        pygame.draw.rect(surface, color, rect, border_radius=4)
    elif eye.shape is EyeShape.ZIGZAG:
        pts = [(int(x), int(y)) for x, y in zigzag_points(cx, cy, w, h)]
        pygame.draw.lines(surface, color, False, pts, 6)


def _draw_extras(surface, params, clock: float) -> None:  # noqa: ANN001
    if params.attention_arc > 0.05:  # LISTENING dashed arc above
        color = _scaled(ICE_BLUE, params.attention_arc)
        r = 150
        for i in range(10):
            a0 = math.pi * (0.25 + i * 0.05)
            x = CX + r * math.cos(a0)
            y = CY - 60 - r * 0.55 * math.sin(a0)
            pygame.draw.circle(surface, color, (int(x), int(y)), 3)
    if params.thinking_dots > 0.05:  # THINKING trail of 3 dots lower-right
        for i in range(3):
            phase = 0.5 + 0.5 * math.sin(clock * 2.4 - i * 0.7)
            color = _scaled(ICE_BLUE, params.thinking_dots * phase)
            pygame.draw.circle(surface, color, (CX + 70 + i * 26, CY + 90 + i * 12), 7 - i)
    if params.charge_ring > 0.05:  # CHARGING dashed % ring below
        color = _scaled(ICE_BLUE, params.charge_ring * 0.9)
        for i in range(12):
            a = 2 * math.pi * i / 12
            x = CX + 70 * math.cos(a)
            y = CY + 110 + 26 * math.sin(a)
            pygame.draw.circle(surface, color, (int(x), int(y)), 3)
    if params.sleep_zs > 0.05:  # SLEEPING "z z" drifting up-right
        font = pygame.font.SysFont("consolas", 28)
        drift = (clock * 12.0) % 60.0
        for i, size in enumerate((28, 20)):
            f = pygame.font.SysFont("consolas", size)
            img = f.render("z", True, _scaled(ICE_BLUE, params.sleep_zs * (1.0 - drift / 90)))
            surface.blit(img, (CX + 90 + i * 26 + drift * 0.4, CY - 110 - i * 24 - drift))
        del font
    if params.spark > 0.3:  # EXCITED spark flicker
        import random
        for _ in range(4):
            a = random.uniform(0, 2 * math.pi)
            r = random.uniform(170, 205)
            x, y = CX + r * math.cos(a), CY + r * math.sin(a)
            pygame.draw.circle(surface, _scaled(ICE_BLUE, params.spark), (int(x), int(y)), 2)


def run_pygame() -> None:
    pygame.init()
    screen = pygame.display.set_mode((CANVAS, CANVAS))
    pygame.display.set_caption("Atlas face sim — keys 1-9 change state")
    face = Face()
    fps_clock = pygame.time.Clock()
    t0 = time.monotonic()
    running = True

    while running:
        dt = fps_clock.tick(60) / 1000.0
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif pygame.K_1 <= event.key <= pygame.K_9:
                    face.set_state(STATE_KEYS[event.key - pygame.K_0])

        face.update(dt)
        params = face.current()
        clock = time.monotonic() - t0

        screen.fill((0, 0, 0))
        # round dark disc + subtle lighter rim, brightness-scaled by params.dim
        pygame.draw.circle(screen, _scaled(NAVY_RIM, params.dim), (CX, CY), CANVAS // 2)
        pygame.draw.circle(screen, _scaled(NAVY, max(params.dim, 0.05)), (CX, CY), CANVAS // 2 - 2)

        left_c, right_c = eye_centers(params)
        left = params.left
        right = params.right
        left.glow *= params.dim if params.dim > 0.05 else 0.35  # sleeping eyes stay faintly visible
        right.glow *= params.dim if params.dim > 0.05 else 0.35
        _draw_eye(screen, left, left_c)
        _draw_eye(screen, right, right_c)
        _draw_extras(screen, params, clock)

        pygame.display.flip()

    pygame.quit()


def run_headless() -> None:
    """Pure-python fallback: cycles all states, printing transitions."""
    print("pygame not installed — headless fallback (pip install pygame for the window)")
    face = Face()
    order = list(STATE_KEYS.values())
    for state in order:
        face.set_state(state)
        for _ in range(30):           # ~0.5 s of updates per state
            face.update(1 / 60)
            face.current()
        p = face.current()
        print(f"state={state.value:<10} eyes={p.left.shape.value:<7} "
              f"size={p.left.width:.0f}x{p.left.height:.0f} dim={p.dim:.2f}")
    print("done — all 9 states tweened cleanly")


def main() -> None:
    if HAS_PYGAME:
        run_pygame()
    else:
        run_headless()


if __name__ == "__main__":
    main()

"""Face state machine + animation model (docs/FACE-SPEC.md).

Pure logic — no pygame here. ``Face.update(dt)`` advances tweens, blinks and
per-state animation clocks; ``Face.current()`` returns the fully-resolved
:class:`FaceParams` for this frame, which face_sim.py (or an SPI LCD driver)
rasterises.

Rules implemented from the spec:
  * every state change tweens 250–400 ms — the face never "teleports"
  * blink every 4–7 s (randomised) in eye-open states
  * IDLE gaze micro-drift; TALKING cadence bounce; THINKING slow pulse glow
"""

from __future__ import annotations

import logging
import math
import random
import time

from .eyes import (
    FaceParams,
    FaceState,
    apply_blink,
    base_params,
    gaze_drift,
    mix_face,
)

log = logging.getLogger("atlas.face")

TWEEN_MIN_S = 0.25
TWEEN_MAX_S = 0.40
BLINK_MIN_S = 4.0
BLINK_MAX_S = 7.0
BLINK_DURATION_S = 0.14

# states whose eyes are effectively closed — no blinking on top
NO_BLINK_STATES = {FaceState.SLEEPING, FaceState.HAPPY, FaceState.CHARGING}


class Face:
    def __init__(self, state: FaceState = FaceState.IDLE) -> None:
        self._from = base_params(state)
        self._to = base_params(state)
        self._state = state
        self._tween_t = 1.0
        self._tween_dur = TWEEN_MIN_S
        self._clock = 0.0                      # per-state animation clock
        self._next_blink_at = self._schedule_blink()
        self._blink_started: float | None = None

    # -- public API ----------------------------------------------------------

    @property
    def state(self) -> FaceState:
        return self._state

    def set_state(self, state: FaceState) -> None:
        if state is self._state:
            return
        log.debug("face: %s -> %s", self._state.value, state.value)
        self._from = self._resolved_base()
        self._to = base_params(state)
        self._state = state
        self._tween_t = 0.0
        self._tween_dur = random.uniform(TWEEN_MIN_S, TWEEN_MAX_S)

    def update(self, dt: float) -> None:
        self._clock += dt
        if self._tween_t < 1.0:
            self._tween_t = min(1.0, self._tween_t + dt / self._tween_dur)
        self._update_blink()

    def current(self) -> FaceParams:
        """Resolved params for this frame: tween + blink + idle animation."""
        p = self._resolved_base()

        # blink envelope
        openness = self._blink_openness()
        if openness < 1.0 and self._state not in NO_BLINK_STATES:
            p.left = apply_blink(p.left, openness)
            p.right = apply_blink(p.right, openness)

        # per-state life
        if self._state is FaceState.IDLE:
            dx, dy = gaze_drift(self._clock)
            p.left.offset_x += dx
            p.right.offset_x += dx
            p.left.offset_y += dy
            p.right.offset_y += dy
        elif self._state is FaceState.TALKING:
            # subtle cadence bounce; TODO: sync to real TTS amplitude via
            # bus topic audio.tts_amplitude instead of a sine stand-in
            bounce = 6.0 * abs(math.sin(self._clock * 7.0))
            p.left.offset_y -= bounce
            p.right.offset_y -= bounce
        elif self._state is FaceState.THINKING:
            pulse = 0.75 + 0.25 * math.sin(self._clock * 2.4)
            p.left.glow *= pulse
            p.right.glow *= pulse
        elif self._state is FaceState.EXCITED:
            p.spark *= 0.6 + 0.4 * random.random()   # spark flicker
        elif self._state is FaceState.CHARGING:
            breathe = 0.7 + 0.3 * math.sin(self._clock * 1.5)
            p.left.glow *= breathe
            p.right.glow *= breathe

        return p

    # -- internals -------------------------------------------------------------

    def _resolved_base(self) -> FaceParams:
        return mix_face(self._from, self._to, self._tween_t)

    def _schedule_blink(self) -> float:
        return time.monotonic() + random.uniform(BLINK_MIN_S, BLINK_MAX_S)

    def _update_blink(self) -> None:
        now = time.monotonic()
        if self._blink_started is None and now >= self._next_blink_at:
            self._blink_started = now
        if self._blink_started is not None and now - self._blink_started > BLINK_DURATION_S:
            self._blink_started = None
            self._next_blink_at = self._schedule_blink()

    def _blink_openness(self) -> float:
        if self._blink_started is None:
            return 1.0
        t = (time.monotonic() - self._blink_started) / BLINK_DURATION_S
        # down-and-up triangle envelope
        return abs(2.0 * t - 1.0)


class FaceService:
    """Bus-facing wrapper: maps ``face.set_state`` events onto the renderer.

    On real hardware the render loop pushes frames to the SPI LCD; in dev it
    is driven by face_sim.py. Emits ``face.state_changed`` so the desktop
    dashboard mirrors the physical face (the two faces are one config).
    """

    name = "face"

    def __init__(self) -> None:
        self.face = Face()
        self._unsubscribe = None
        self._bus = None

    async def start(self, bus, config) -> None:  # noqa: ANN001 — Service protocol
        self._bus = bus
        self._unsubscribe = bus.subscribe("face.set_state", self._on_set_state)

    async def stop(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None

    def _on_set_state(self, event) -> None:  # noqa: ANN001
        raw = str(event.payload.get("state", "")).lower()
        try:
            state = FaceState(raw)
        except ValueError:
            log.warning("unknown face state requested: %r", raw)
            return
        self.face.set_state(state)
        if self._bus:
            self._bus.emit("face.state_changed", {"state": state.value}, source=self.name)

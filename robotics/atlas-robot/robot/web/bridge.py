"""DesktopBridge — best-effort link to the desktop Atlas server.

Connects to ``ws://<host>:8080/api/ws`` (the same WebSocket the dashboard
uses) and republishes robot bus events upstream so the desktop sees the robot
as a live device. This is the segmentation model in action: desktop = brain,
robot = body, WebSocket = spinal cord.

Current scope (v0.1): heartbeat only, with clear TODOs for the rest.
Requires the optional ``websockets`` package; without it the bridge logs a
notice and stays dormant — the robot runs fully standalone.
"""

from __future__ import annotations

import asyncio
import json
import logging

log = logging.getLogger("atlas.bridge")

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

HEARTBEAT_INTERVAL_S = 10.0
RECONNECT_DELAY_S = 5.0


class DesktopBridge:
    name = "desktop-bridge"

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._bus = None
        self._url = ""
        self._robot_id = "atlas-robot"

    async def start(self, bus, config) -> None:  # noqa: ANN001 — Service protocol
        self._bus = bus
        host = config.get("network.desktop_host", "atlas.local")
        port = config.get("network.ports.dashboard", 8080)
        self._url = f"ws://{host}:{port}/api/ws"
        self._robot_id = config.get("network.robot_id", "atlas-robot")

        if not HAS_WEBSOCKETS:
            log.info("websockets not installed — desktop bridge dormant "
                     "(pip install websockets to enable)")
            return
        self._task = asyncio.create_task(self._run(), name="desktop-bridge")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # -- internals ------------------------------------------------------------

    async def _run(self) -> None:
        """Reconnect loop. Failure is normal (desktop off / roaming robot)."""
        while True:
            try:
                async with websockets.connect(self._url, open_timeout=5) as ws:
                    log.info("connected to desktop Atlas at %s", self._url)
                    if self._bus:
                        self._bus.emit("bridge.connected", {"url": self._url},
                                       source=self.name)
                    await self._session(ws)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — best-effort by design
                log.debug("desktop unreachable (%s) — retrying in %ss",
                          exc, RECONNECT_DELAY_S)
            await asyncio.sleep(RECONNECT_DELAY_S)

    async def _session(self, ws) -> None:  # noqa: ANN001
        # The desktop WS validates emitted events against its EventTypeSchema;
        # device.reading is in the accepted set, so heartbeats ride on it.
        #
        # TODO(bridge): subscribe to desktop events and replay onto the robot
        #   bus, e.g. {"type":"subscribe","eventTypes":["device.command"]}
        #   → bus.emit("motor.command", ...) so the dashboard can drive.
        # TODO(bridge): forward face.state_changed so the dashboard face
        #   mirrors the physical face in real time.
        # TODO(bridge): forward real telemetry (battery %, IMU, ToF ranges)
        #   once the HAL services land; today it is a static heartbeat.
        # TODO(bridge): authentication — reuse the mobile pairing-code flow.
        while True:
            heartbeat = {
                "type": "emit",
                "event": {
                    "source": self._robot_id,
                    "target": None,
                    "type": "device.reading",
                    "payload": {
                        "deviceId": self._robot_id,
                        "type": "heartbeat",
                        "value": 1,
                        "unit": None,
                    },
                },
            }
            await ws.send(json.dumps(heartbeat))
            if self._bus:
                self._bus.emit("device.heartbeat", {"upstream": True}, source=self.name)
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)

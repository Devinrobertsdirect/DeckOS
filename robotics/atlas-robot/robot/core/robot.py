"""Robot lifecycle: wires config + bus + services and runs until shutdown.

A *service* is any object with::

    async def start(bus: EventBus, config: Config) -> None
    async def stop() -> None

Services communicate only via the bus — the same segmentation as the desktop:
the brain (reasoning) can live on the desktop Atlas server while the body
(sensors, motors, face) runs here on the Pi. Swap either side independently.
"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Protocol

from .config import Config
from .event_bus import EventBus

log = logging.getLogger("atlas.robot")


class Service(Protocol):
    name: str

    async def start(self, bus: EventBus, config: Config) -> None: ...
    async def stop(self) -> None: ...


class Robot:
    """Owns the bus, the config, and an ordered list of services."""

    def __init__(self, config: Config | None = None) -> None:
        self.config = config or Config.load()
        self.bus = EventBus()
        self.services: list[Service] = []
        self._stop_event = asyncio.Event()

    def add_service(self, service: Service) -> "Robot":
        self.services.append(service)
        return self

    # -- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        name = self.config.get("personality.name", "Atlas")
        log.info("%s waking up (%d services)", name, len(self.services))
        await self.bus.start()
        for service in self.services:
            log.info("starting service: %s", getattr(service, "name", type(service).__name__))
            await service.start(self.bus, self.config)
        self.bus.emit("robot.ready", {"name": name}, source="robot")

    async def stop(self) -> None:
        log.info("shutting down")
        self.bus.emit("robot.shutdown", {}, source="robot")
        for service in reversed(self.services):
            try:
                await service.stop()
            except Exception:  # noqa: BLE001
                log.exception("error stopping %s", getattr(service, "name", service))
        await self.bus.stop()

    def request_stop(self) -> None:
        self._stop_event.set()

    async def run(self) -> None:
        """start() → wait for SIGINT/SIGTERM or request_stop() → stop()."""
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self.request_stop)
            except NotImplementedError:
                # Windows / restricted environments: Ctrl+C still raises
                # KeyboardInterrupt which asyncio.run() handles.
                pass
        await self.start()
        try:
            await self._stop_event.wait()
        finally:
            await self.stop()


def main() -> None:  # pragma: no cover — manual entry point
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    robot = Robot()

    # Wire the default service set. Each is optional and degrades gracefully.
    from robot.display.face import FaceService
    from robot.web.bridge import DesktopBridge

    robot.add_service(FaceService())
    robot.add_service(DesktopBridge())

    asyncio.run(robot.run())


if __name__ == "__main__":
    main()

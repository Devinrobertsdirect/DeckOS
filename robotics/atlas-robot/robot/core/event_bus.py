"""Minimal async pub/sub event bus.

Topic strings follow the ``"domain.action"`` convention used across DeckOS
Atlas (mirrors ``@workspace/event-bus`` on the desktop side), e.g.::

    face.state_changed
    device.heartbeat
    audio.wake_word
    motor.command

Subscriptions support exact topics, ``"domain.*"`` prefix wildcards, and the
global ``"*"`` wildcard.
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

log = logging.getLogger("atlas.bus")

Handler = Callable[["Event"], Awaitable[None] | None]


@dataclass(slots=True)
class Event:
    """A single message on the bus."""

    topic: str                      # "domain.action"
    payload: dict[str, Any] = field(default_factory=dict)
    source: str = "unknown"         # service name that emitted it
    ts: float = field(default_factory=time.time)


class EventBus:
    """In-process asyncio pub/sub.

    Handlers may be sync or async. Emission never blocks the publisher:
    events are queued and dispatched by a background pump task.
    """

    def __init__(self, max_queue: int = 1024) -> None:
        self._subs: dict[str, list[Handler]] = {}
        self._queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=max_queue)
        self._pump_task: asyncio.Task[None] | None = None

    # -- subscription -----------------------------------------------------

    def subscribe(self, pattern: str, handler: Handler) -> Callable[[], None]:
        """Register *handler* for topics matching *pattern*.

        Returns an unsubscribe callable.
        """
        self._subs.setdefault(pattern, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._subs.get(pattern, [])
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    # -- emission ---------------------------------------------------------

    def emit(self, topic: str, payload: dict[str, Any] | None = None,
             source: str = "unknown") -> None:
        """Fire-and-forget publish. Drops (with a warning) if the queue is full."""
        event = Event(topic=topic, payload=payload or {}, source=source)
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("bus queue full — dropping %s from %s", topic, source)

    async def emit_wait(self, topic: str, payload: dict[str, Any] | None = None,
                        source: str = "unknown") -> None:
        """Publish, waiting for queue space if necessary."""
        await self._queue.put(Event(topic=topic, payload=payload or {}, source=source))

    # -- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        if self._pump_task is None:
            self._pump_task = asyncio.create_task(self._pump(), name="atlas-bus-pump")

    async def stop(self) -> None:
        if self._pump_task is not None:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
            self._pump_task = None

    # -- internals ----------------------------------------------------------

    async def _pump(self) -> None:
        while True:
            event = await self._queue.get()
            for handler in self._matching_handlers(event.topic):
                try:
                    result = handler(event)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception:  # noqa: BLE001 — one bad handler must not kill the bus
                    log.exception("handler error for topic %s", event.topic)

    def _matching_handlers(self, topic: str) -> list[Handler]:
        matched: list[Handler] = []
        for pattern, handlers in self._subs.items():
            if pattern == topic or pattern == "*" or fnmatch.fnmatch(topic, pattern):
                matched.extend(handlers)
        return matched

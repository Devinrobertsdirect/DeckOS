"""Provider-agnostic completion — the robot-side mirror of the desktop
4-tier inference gateway (see intelligence/README.md). It never goes silent:

    1. APEX    — Anthropic Claude API, if ANTHROPIC_API_KEY is set (httpx)
    2. CORTEX  — Ollama on localhost:11434, if reachable
    3. AUTOPILOT — canned rule responses (always available)

Usage::

    from robot.ai.llm import complete
    text = await complete("Battery at 18%, what should I do?")
"""

from __future__ import annotations

import json
import logging
import os

log = logging.getLogger("atlas.llm")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = os.environ.get("ATLAS_APEX_MODEL", "claude-sonnet-5")
ANTHROPIC_VERSION = "2023-06-01"
OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("ATLAS_CORTEX_MODEL", "gemma3")

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False


async def complete(prompt: str, system: str | None = None,
                   max_tokens: int = 512) -> str:
    """Return a completion from the best available provider."""
    if HAS_HTTPX and os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return await _anthropic(prompt, system, max_tokens)
        except Exception as exc:  # noqa: BLE001 — degrade, never die
            log.warning("APEX (Anthropic) failed, falling to CORTEX: %s", exc)
    if HAS_HTTPX:
        try:
            return await _ollama(prompt, system)
        except Exception as exc:  # noqa: BLE001
            log.warning("CORTEX (Ollama) failed, falling to AUTOPILOT: %s", exc)
    return _rules(prompt)


async def _anthropic(prompt: str, system: str | None, max_tokens: int) -> str:
    headers = {
        "x-api-key": os.environ["ANTHROPIC_API_KEY"],
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    body: dict = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(ANTHROPIC_URL, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip()


async def _ollama(prompt: str, system: str | None) -> str:
    body = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        **({"system": system} if system else {}),
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=body)
        resp.raise_for_status()
        data = resp.json()
    return str(data.get("response", "")).strip()


def _rules(prompt: str) -> str:
    """AUTOPILOT: deterministic canned responses. Boring, but never offline."""
    p = prompt.lower()
    if any(w in p for w in ("battery", "charge", "power")):
        return "Power status noted. I will head to the dock when the battery drops below 20%."
    if any(w in p for w in ("hello", "hi ", "hey")):
        return "Hello. Atlas online — local rule engine only, no model reachable right now."
    if "status" in p or "report" in p:
        return "All monitored systems nominal. (AUTOPILOT rule engine — connect Ollama or set ANTHROPIC_API_KEY for real reasoning.)"
    if "stop" in p or "halt" in p:
        return "Stopping all motion. E-stop honoured."
    return ("I am running on the offline rule engine and cannot reason about that. "
            "Start Ollama or set ANTHROPIC_API_KEY to enable the full brain.")


if __name__ == "__main__":  # pragma: no cover — quick manual check
    import asyncio
    print(asyncio.run(complete("hello, status report please")))

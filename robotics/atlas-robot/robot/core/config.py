"""YAML config loader.

Loads every ``config/*.yaml`` file into one namespace keyed by file stem,
so ``personality.yaml`` → ``config.get("personality.humor")``.

Personas are data, not code: a desktop persona can be flashed to a physical
robot unchanged ("an edition is a config, not a fork").
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "pyyaml is required: pip install -r requirements.txt"
    ) from exc

log = logging.getLogger("atlas.config")

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


class Config:
    """Dotted-path access over the merged config tree."""

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    @classmethod
    def load(cls, config_dir: Path | str | None = None) -> "Config":
        directory = Path(config_dir) if config_dir else DEFAULT_CONFIG_DIR
        data: dict[str, Any] = {}
        if not directory.is_dir():
            log.warning("config dir %s missing — using empty config", directory)
            return cls(data)
        for path in sorted(directory.glob("*.yaml")):
            with path.open("r", encoding="utf-8") as fh:
                loaded = yaml.safe_load(fh) or {}
            if not isinstance(loaded, dict):
                log.warning("skipping %s: top level is not a mapping", path.name)
                continue
            data[path.stem] = loaded
            log.debug("loaded config/%s", path.name)
        return cls(data)

    def get(self, dotted_key: str, default: Any = None) -> Any:
        """``config.get("network.ports.rest", 8000)``"""
        node: Any = self._data
        for part in dotted_key.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def section(self, name: str) -> dict[str, Any]:
        value = self._data.get(name, {})
        return value if isinstance(value, dict) else {}

    def as_dict(self) -> dict[str, Any]:
        return dict(self._data)

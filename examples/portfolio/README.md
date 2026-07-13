# Portfolio integrations

Modules carried over from Devin's earlier projects, reorganized as Atlas building blocks.
Hardcoded API keys were removed — set `GROQ_API_KEY` / `OPENAI_API_KEY` env vars instead
(**and rotate the old keys**; they were committed in the original projects).

| Folder | Origin | What it is | Atlas destination |
|---|---|---|---|
| `acera/` | Acera Prototype | Voice → LLM → TTS agent loop with wake word ("Acera"), MediaPipe pinch-gesture mouse control, `pyautogui` OS actions | Patterns feed `core/server` autonomy + a future gesture input service |
| `holomat/` | Holomat Files | Module-oriented assistant skeleton: `main_controller.py` orchestrator + skills (`online_ops`, `os_ops`) + hand tracking | Reference for the plugin/skills architecture |
| `vision/` | ACERA security protocol | YOLO person detection + centroid tracking + occupancy logging | Basis for `intelligence/` vision service on desktop or robot |
| `realtime-sync/` | HoloSpaceBackend | Express + Socket.io multi-client workspace sync | Pattern for Atlas Cloud device sync |
| `stark-sim/` | S.T.A.R.K Files | Three.js flight-control telemetry sim with "AI Pilot Assist" | Reference for 3D telemetry views on the Robotics screen |

These are kept as-is (lightly sanitized), not wired into the build — import pieces as
needed rather than running them from here.

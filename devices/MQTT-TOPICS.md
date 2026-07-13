# Atlas MQTT topic contract

Source of truth: `core/server/src/lib/mqtt-transport.ts` (the Atlas server's
MQTT transport). This documents what the server **actually** subscribes to and
publishes today, plus proposed `atlas/*` extensions.

## Connection

| Setting | Value |
|---|---|
| Broker URL | env `MQTT_BROKER_URL` (bare `host:port` is normalised to `mqtts://`) |
| Auth | env `MQTT_BROKER_USER` / `MQTT_BROKER_PASS` (optional) |
| Client id | `jarvis-deck-os-<timestamp>` |
| QoS | 1 on all subscriptions and publishes |
| Unset broker URL | transport runs in simulation-only mode (no connection) |
| Reconnect | exponential backoff, 1 s → 30 s cap; auth errors stop retrying |

## Server subscriptions

```
jarvis/#
devices/+/telemetry
devices/+/status
```

## Inbound topics (device → server)

### `devices/{deviceId}/telemetry`

JSON payload in any of three shapes — all normalised to `DeviceReading[]`:

```jsonc
{ "sensor": "temperature", "value": 22.5, "unit": "C", "timestamp": "…" }   // single reading
{ "readings": [ { "sensor": "…", "value": 1, "unit": null, "timestamp": "…" } ] }  // batch
{ "temperature": 22.5, "humidity": 60 }   // flat map → one reading per key
```

Flat-map keys `name`, `type`, `capabilities`, `location`, `timestamp`,
`status` are metadata, not readings. Any telemetry marks the device `online`.

### `devices/{deviceId}/status`

Two accepted payloads:

1. **JSON**: `{ "status": "online" | "offline" | "error" | "standby" }`
   (unknown values default to `online`).
2. **Plain text shorthand** (for dumb firmware): a bare word, mapped as
   `online|connected|up|active` → online, `offline|disconnected|down|inactive`
   → offline, `error|fault` → error, `standby|idle|sleep` → standby.

### `jarvis/device/{deviceId}/state` (legacy scheme)

`{ "readings": [ … ] }` — same reading objects; device marked `online`.

### `jarvis/system/broadcast`

Any JSON → re-emitted on the internal bus as `system.heartbeat`.

### Anything else under a subscription

Valid JSON on other matching topics is re-emitted on the internal bus as
`device.reading` with `{ topic, data }`. Non-JSON payloads (other than the
status shorthand above) are silently dropped.

## Outbound topics (server → device)

Commands are published on **both** schemes for hardware compatibility, QoS 1:

```
devices/{deviceId}/command
jarvis/device/{deviceId}/command
```

Payload: `{ "action": "...", "parameters": { ... } }` — triggered by the
internal bus event `device.command.send`; only devices registered with
protocol `mqtt` or `simulated` receive publishes.

## Auto-registration

Unknown `deviceId`s are auto-registered on first message. Optional metadata
keys in the payload are honoured:

```jsonc
{
  "name": "workshop-thermo",        // default: "mqtt-device-<id>"
  "type": "sensor",                 // sensor | actuator | display | network | simulated
  "capabilities": ["temperature"],  // string[]
  "location": "workshop"            // string | null
}
```

## Proposed `atlas/*` extensions (not implemented yet)

Reserved namespace for the robotics/biometrics stages, aligned with the
robot's internal `domain.action` bus topics:

| Topic | Direction | Payload (proposed) |
|---|---|---|
| `atlas/robot/{id}/heartbeat` | robot → server | `{ battery, docked, uptime }` |
| `atlas/robot/{id}/pose` | robot → server | `{ x, y, theta, ts }` (odometry) |
| `atlas/robot/{id}/face` | both | `{ state: "idle" \| "thinking" \| … }` — face mirroring |
| `atlas/robot/{id}/command` | server → robot | `{ action, parameters }` (drive, dock, say) |
| `atlas/bio/{stream}` | nervelink → server | summarised `bio.*` events (focus, hr) — raw frames stay on WS :8090 |
| `atlas/announce` | any → all | birth certificates: `{ id, kind, version, ip }` |

Rules for extensions: retain the `devices/*` contract untouched, keep
payloads JSON, one concern per topic, and mirror every topic to an internal
bus event of the same name with `/` → `.`.

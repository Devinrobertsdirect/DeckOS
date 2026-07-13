# Home Assistant bridge

Atlas and Home Assistant meet at a shared MQTT broker on **:1883** (Mosquitto
is the reference broker — the HA "Mosquitto broker" add-on works out of the
box). Neither system needs to know the other exists; they just speak topics.

## Setup

1. Run a broker both sides can reach:
   - HA OS: install the **Mosquitto broker** add-on, create a HA user for Atlas.
   - Standalone: `docker run -p 1883:1883 eclipse-mosquitto` (add auth for
     anything beyond a lab bench).
2. Point Atlas at it — in the repo `.env`:
   ```env
   MQTT_BROKER_URL=mqtt://<broker-host>:1883
   MQTT_BROKER_USER=atlas
   MQTT_BROKER_PASS=<password>
   ```
   Note: a bare `host:port` value is normalised to `mqtts://` (TLS). For a
   plain local broker, include the `mqtt://` scheme explicitly.
3. Point HA at the same broker (Settings → Devices & Services → MQTT).

## Atlas → Home Assistant

Atlas devices publish telemetry on `devices/{id}/telemetry`
(see [MQTT-TOPICS.md](MQTT-TOPICS.md)). Expose one to HA with a manual MQTT
sensor:

```yaml
# configuration.yaml
mqtt:
  sensor:
    - name: "Workshop temperature (Atlas)"
      state_topic: "devices/esp32-workshop/telemetry"
      value_template: "{{ value_json.temperature }}"
      unit_of_measurement: "°C"
```

## Home Assistant → Atlas

Any HA automation can drive an Atlas device by publishing a command:

```yaml
action:
  - service: mqtt.publish
    data:
      topic: "devices/desk-lamp/command"
      payload: '{"action": "off", "parameters": {}}'
```

Conversely, HA entities can be mirrored into Atlas by an automation that
republishes state changes to `devices/{id}/telemetry` — Atlas auto-registers
unknown device ids on first message.

## MQTT Discovery (notes)

HA's [MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery)
lets devices self-describe by publishing a retained config to
`homeassistant/<component>/<object_id>/config`. Atlas does **not** emit
discovery configs yet; it's the natural next step so Atlas devices appear in
HA automatically (tracked as a proposed `atlas/*` extension — a small
translator that watches Atlas auto-registrations and publishes matching
discovery payloads).

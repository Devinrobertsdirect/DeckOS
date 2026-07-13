# ESP32 sensor node — minimal Atlas MQTT sketch

The smallest possible Atlas device: an ESP32 publishing a temperature reading
every 30 s. Atlas auto-registers it on first message (no server-side setup),
and it appears in the Devices dashboard immediately.

Topic contract: [../MQTT-TOPICS.md](../MQTT-TOPICS.md).

## Requirements

- Arduino IDE (or PlatformIO) with the ESP32 board package
- Library: **PubSubClient** (Nick O'Leary) via Library Manager
- An MQTT broker Atlas is connected to (see `.env` `MQTT_BROKER_URL`)

## Sketch

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

// ---- configure me -----------------------------------------------------
const char* WIFI_SSID   = "your-wifi";
const char* WIFI_PASS   = "your-password";
const char* MQTT_HOST   = "192.168.1.10";   // your broker (Mosquitto / HA add-on)
const int   MQTT_PORT   = 1883;
const char* MQTT_USER   = "";               // leave "" if broker is open
const char* MQTT_PASSWD = "";
const char* DEVICE_ID   = "esp32-workshop"; // becomes the Atlas device id
// -----------------------------------------------------------------------

WiFiClient   wifi;
PubSubClient mqtt(wifi);

String topicTelemetry = String("devices/") + DEVICE_ID + "/telemetry";
String topicStatus    = String("devices/") + DEVICE_ID + "/status";
String topicCommand   = String("devices/") + DEVICE_ID + "/command";

void onCommand(char* topic, byte* payload, unsigned int len) {
  // Atlas publishes {"action": "...", "parameters": {...}} here.
  Serial.printf("command on %s: %.*s\n", topic, len, (char*)payload);
  // TODO: parse with ArduinoJson and act (relay, LED, servo, ...)
}

void connectMqtt() {
  while (!mqtt.connected()) {
    // Last Will: broker tells Atlas "offline" if we drop unexpectedly.
    if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASSWD,
                     topicStatus.c_str(), 1, true, "offline")) {
      mqtt.publish(topicStatus.c_str(), "online", true);  // plain-text shorthand — Atlas maps it
      mqtt.subscribe(topicCommand.c_str(), 1);
    } else {
      delay(2000);
    }
  }
}

float readTemperatureC() {
  // Stand-in: replace with a real sensor (DS18B20, BME280, ...).
  return 21.0 + (esp_random() % 100) / 25.0;
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCommand);
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  static unsigned long last = 0;
  if (millis() - last > 30000) {
    last = millis();
    // Flat-map telemetry: every key becomes a reading in Atlas.
    // First message auto-registers the device; name/type/location are metadata.
    char payload[160];
    snprintf(payload, sizeof(payload),
      "{\"name\":\"Workshop ESP32\",\"type\":\"sensor\","
      "\"location\":\"workshop\",\"temperature\":%.2f}",
      readTemperatureC());
    mqtt.publish(topicTelemetry.c_str(), payload);
  }
}
```

## What you should see

1. Serial monitor shows the WiFi/MQTT connect.
2. Atlas server log: `MqttTransport: auto-registered new MQTT device`.
3. Dashboard → Devices: `Workshop ESP32` online with a live temperature chart.
4. Sending a command from the dashboard hits `onCommand()` on the board.

## Next steps

- Add [ArduinoJson](https://arduinojson.org) and act on `{"action": ...}`
  commands (the sketch above only logs them).
- Batch multiple sensors with the `{"readings": [...]}` payload shape.
- Deep-sleep between publishes for battery nodes — the Last Will keeps the
  Atlas status honest while the board sleeps.

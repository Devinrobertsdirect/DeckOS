# Atlas Body Firmware

Firmware that turns a microcontroller into an **Atlas body** — the "nervous
system" that drives the wheels, reads the sensors, and watches the e-stop while
the **brain** (Atlas Core, running on a phone, laptop, Pi, or the cloud) does the
thinking. Both speak the **Atlas Wire Protocol (AWP)** — the same ASCII line
protocol the brain's HAL uses (`core/server/src/hal/protocol.ts`), so the brain
doesn't care which board is in the body.

| Sketch | Board | Transport | Use for |
| --- | --- | --- | --- |
| `atlas_esp32/` | ESP32 dev module | USB serial **+ optional WiFi TCP** | Mini/desk bots, WiFi bodies |
| `atlas_nano/` | Arduino Nano / Uno (ATmega328) | USB serial only | The basic-controller tier |
| — Pi 5 (no MCU) | Raspberry Pi 5 | GPIO (`pigpio`) | The full 282 mm MK Standard |

`AtlasWireProtocol.h` is shared by both sketches — a header-only, no-JSON,
no-heap AWP parser that fits an 8-bit Nano.

## Wiring (TB6612FNG, matches ATL-HW-001)

Both sketches drive a **TB6612FNG** dual H-bridge. Edit the `PIN_*` constants at
the top of the sketch to match your board. Defaults:

- `STBY`, `AIN1/AIN2/PWMA` (motor L), `BIN1/BIN2/PWMB` (motor R)
- Encoders on interrupt-capable pins (ESP32: any; Nano: **D2/D3 only**)
- `ESTOP` — active-low, wired through the hardware e-stop, pulled up
- `VBATT` — battery voltage through a divider (`BATT_DIVIDER = (R1+R2)/R2`)

> Safety: the firmware **stops the wheels** if no command arrives within
> `CMD_TIMEOUT_MS` (500 ms) or the e-stop is pressed — a dropped link can never
> leave Atlas driving.

## Flash it

**Arduino IDE:** open the `.ino`, pick the board (ESP32 Dev Module / Arduino
Nano), select the port, Upload.

**arduino-cli:**

```bash
# ESP32
arduino-cli compile -b esp32:esp32:esp32 robotics/firmware/atlas_esp32
arduino-cli upload  -b esp32:esp32:esp32 -p /dev/ttyUSB0 robotics/firmware/atlas_esp32

# Nano (old bootloader shown; adjust fqbn for your unit)
arduino-cli compile -b arduino:avr:nano:cpu=atmega328old robotics/firmware/atlas_nano
arduino-cli upload  -b arduino:avr:nano:cpu=atmega328old -p /dev/ttyACM0 robotics/firmware/atlas_nano
```

## Connect the brain

```bash
atlas hardware                 # detects the board + prints the port
export ATLAS_SERIAL=/dev/ttyUSB0   # or COM5 on Windows
atlas start                    # the brain drives the body over AWP
```

To use WiFi on the ESP32: set `#define ATLAS_USE_WIFI 1`, fill in the SSID/pass,
re-flash, and point the brain at `ws://atlas.local:3333` (or the ESP32's IP).

## Talk to it by hand (debugging)

Open a serial monitor at **115200** and type AWP lines:

```
HELLO v=1 name=Atlas      # → READY v=1 board=esp32 caps=drive,enc,estop,batt
DRIVE l=400 r=400         # both wheels ~40% forward
STOP
ESTOP on=1
PING n=7                  # → PONG n=7
```

The board streams `TEL encL=… encR=… battmv=… estop=…` at ~10 Hz.

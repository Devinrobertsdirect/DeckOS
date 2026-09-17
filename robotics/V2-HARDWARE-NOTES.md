# Robot V2 — hardware redesign notes

Everything the V1 bring-up (2026-07-22, first live robot: Pi 4 + Adeept Motor HAT
V2 + 480x480 round screen) taught us about what the next body must fix. V1 works;
these are the friction points a person building or living with the robot hits.

## 1. Battery system — the headline fix
- **V1 problem:** the Adeept 18650 holder requires REMOVING the cells to recharge
  them. Cells locked in the robot's belly = robot you have to disassemble to feed.
- **V2 requirements:**
  - **Charge-in-place**: barrel/USB-C charge port on the shell wired to a 2S
    charger/BMS board (e.g. IP2326-class), cells never leave the robot; or
  - an **accessible battery door** with a hot-swappable pack.
  - **Brownout protection**: motors + Pi + screen on one battery sag under stall
    load → SD corruption. Separate motor rail from logic rail (shared ground),
    or a quality buck with big caps on the Pi feed.
  - Consider a **supercap/UPS stage** so a dying battery triggers a clean
    shutdown instead of a hard cut. (Software already survives hard cuts —
    supervisor + watchdog + journald-to-RAM — but the SD card ages with every
    yank.)

## 2. Pi mounting & cable clearance
- **V1 problem:** the Pi is mounted VERTICALLY purely to make room for the cable
  plugs (power/HDMI/USB stick straight out and need depth).
- **V2:** right-angle cables (right-angle USB-C power, right-angle micro-HDMI)
  or panel-mount extensions let the Pi lie flat — reclaims most of the belly
  for the battery bay. Alternatively pick an SBC/carrier with edge-exiting
  connectors.

## 3. Audio
- **Mic:** the Pi has NO audio input. The 3.5mm jack is OUTPUT-ONLY — a jack mic
  can never work. V2 must budget a **USB mic** (or I2S MEMS mic — but see GPIO
  budget below: I2S pin 18 collides with the motor HAT). Mount it outside the
  shell; a mic buried in the belly hears servos, not people.
- **Speaker:** V1 has no confirmed speaker (test pending). V2: small amp +
  speaker on the 3.5mm jack, or a USB speaker; either must be inside the shell
  with a grille. Voice output is core to the product — this is not optional.

## 4. GPIO budget & the motor HAT
- Adeept Motor HAT V2 consumes GPIO 4, 14, 15, 17, 18, 27 (H-bridge) + I2C bus 1
  (PCA9685 @0x40 for servos). Conflicts discovered:
  - **GPIO18 = I2S audio pin** → I2S mic/DAC and this HAT are mutually exclusive.
  - **GPIO4 = mk-standard profile's fan pin** → no PWM fan alongside this HAT.
- V2 option: move motion to an **ESP32 body over USB serial** (firmware +
  HAL support already exist) — frees ALL Pi GPIO, isolates motor electrical
  noise, and survives Pi reboots with the body holding safe-state.

## 5. Storage
- V1's 8GB SD was nearly full before the brain even landed (~600MB free after
  Node + bundle). **V2 minimum: 32GB A2-class SD**, better: USB3 SSD. Also bake
  the OS image with the brain preinstalled instead of installing on-device.

## 6. Screen
- 480x480 round panel: corners are dead zone (software now handles via
  ?screen=round). Cold boot to face ≈ 30-40s (Pi 4 parsing the SPA) — V2 polish:
  Plymouth boot splash with Nobi eyes so the robot never shows a naked desktop.
- If the V2 screen has TOUCH, wake-on-tap already works (useWake).
- Screen audio: if choosing an HDMI panel, pick one with a built-in speaker —
  solves §3 output for free.

## 7. Thermals
- Chromium + Node + (future) local STT on a Pi 4 in a closed shell needs airflow.
  Passive heatsink minimum; if a fan, remember GPIO4 is taken (use 5V always-on
  or the ESP32 body's pins).

## 8. Trixie/OS gotchas (bake into the V2 image)
- Debian trixie REMOVED the `pigpio` apt package — must build from source
  (github joan2937/pigpio v79: make && make install && ldconfig) then
  `npm rebuild pigpio`. install.sh needs this (task #98).
- pigpio needs root → brain service runs as root on robots. A privilege-separated
  GPIO daemon would let the brain drop back to a user account.
- Node via nodejs.org arm64 tarball into /opt/nodejs (NodeSource apt repo is
  heavier and slower on small cards).

## 9. Serviceability (keep from V1 — these saved the build)
- SSH enabled + key auth from the dev machine.
- Kiosk Chromium runs with --remote-debugging-port=9222 (localhost only): remote
  JS eval + keystroke injection into the live face (pi-ops/cdp-eval.mjs).
- Hardware watchdog on; kiosk supervisor auto-resurrects the face (~4s).
- Keep a labelled USB port free for keyboard dongle / mic / rescue.

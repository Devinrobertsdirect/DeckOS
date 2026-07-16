# Atlas Face node (ESP32 + TFT)

Turns an ESP32 display board into **Atlas's face**: it renders the two-eye
expression on a round (or square-masked) LCD and talks the **Atlas Wire Protocol
(AWP)** to the brain (the Pi / host running the Atlas app) over USB serial.

This is the hardware half of the tandem: `Pi (brain) ──USB serial──► ESP32 (face)`.
The brain forwards its emotion/FaceState here; the panel's touch (and knob, if
present) come back as input events.

## Protocol

```
brain → face:  FACE state=<expr> color=<r,g,b> [bright=0..100]
               HELLO v=1 name=NeuraBrain
               PING n=<k>
face  → brain: READY v=1 board=atlas-face role=face caps=face,touch
               INPUT kind=tap x=<px> y=<px>
               INPUT kind=knob dir=<-1|1> delta=<n>     (rotary boards)
               INPUT kind=press                          (knob click)
               PONG n=<k>
```

`<expr>` is one of the 15 Atlas states: `idle listening thinking talking happy
confused excited charging sleeping angry suspicious sad love wink starstruck`
(the same vocabulary the app uses — see `core/server/src/hal/protocol.ts`
`AWP_FACE_STATES`). The brain's face channel is `POST /api/face`; on the app side
`interfaces/desktop/src/lib/hardwareFace.ts` mirrors the on-screen face here.

## Build

1. Install the **ESP32 Arduino core** + libraries **TFT_eSPI** and (for the CYD)
   **XPT2046_Touchscreen**.
2. Configure **TFT_eSPI** for your panel in `TFT_eSPI/User_Setup.h`:
   - **Cheap Yellow Display (ESP32-2432S028R)** — ILI9341, 320×240. Use a known
     CYD `User_Setup` (SPI pins: SCLK 14, MOSI 13, MISO 12, CS 15, DC 2, BL 21).
   - **Round ST7701 480×480** — set the ST7701/RGB driver per the panel's guide.
3. In `atlas_face_esp32.ino`, set `HAS_TOUCH` and `TOUCH_CS` for your board;
   optionally set `FACE_DIAM` to force a round face Ø if you're masking a
   rectangular screen behind a round faceplate.
4. Flash from Arduino IDE (or `atlas flash --esp32`).

## Tuning notes

- **Touch calibration**: the `map()` in the touch block is approximate — adjust
  the raw XPT2046 min/max for your panel so `tap` coordinates are accurate.
- **Eye look**: every expression comes from one `EyeSpec` (`open`, `curveTop`,
  `slant`, `shape`) in `specFor()` — tweak those to restyle the whole face
  coherently rather than editing per-state draw code.
- **Round panels**: the face is drawn as a filled disc, so it already suits a
  round LCD; on a square panel the disc masks itself.

Untested on final hardware — written to be the working starting point once the
board is in hand; the display-init + touch-calibration are the only board-specific
parts to dial in.

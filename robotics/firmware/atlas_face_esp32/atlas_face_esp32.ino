/*
 * atlas_face_esp32 — the Atlas FACE node.
 *
 * Renders Atlas's two-eye face on a round (or square-masked) TFT and speaks the
 * Atlas Wire Protocol (AWP) to the brain over USB serial:
 *
 *   brain → face:  FACE state=<expr> color=<r,g,b> [bright=<0..100>]
 *                  HELLO v=1 name=AtlasBrain
 *   face  → brain: READY v=1 board=<name> role=face caps=face,touch
 *                  INPUT kind=tap x=<px> y=<px>          (touch)
 *                  INPUT kind=knob dir=<-1|1> delta=<n>  (rotary, if present)
 *                  INPUT kind=press                       (knob click)
 *
 * The 15 expressions (idle/listening/thinking/talking/happy/confused/excited/
 * charging/sleeping/angry/suspicious/sad/love/wink/starstruck) all come from ONE
 * parametric eye model, so the look stays coherent and is easy to tune.
 *
 * Display: uses TFT_eSPI. Configure it for your board in TFT_eSPI/User_Setup.h
 * (e.g. the "Cheap Yellow Display" ESP32-2432S028R = ILI9341 320x240, or a
 * round ST7701 480x480 panel). Touch (XPT2046 on the CYD) is optional — set
 * HAS_TOUCH accordingly.
 *
 * This is board-agnostic in structure; the display/touch pin setup is the only
 * board-specific part and lives in User_Setup.h + the HAS_TOUCH block below.
 */
#include <TFT_eSPI.h>

// ── Board options ────────────────────────────────────────────────────────────
#define HAS_TOUCH   1     // CYD (ESP32-2432S028R) has an XPT2046 resistive panel
#define FACE_DIAM   0     // 0 = use full min(w,h); else force a round face Ø in px

TFT_eSPI tft = TFT_eSPI();
#if HAS_TOUCH
  #include <XPT2046_Touchscreen.h>
  #include <SPI.h>
  #define TOUCH_CS 33               // CYD default; adjust for your board
  XPT2046_Touchscreen ts(TOUCH_CS);
#endif

// ── Face state ───────────────────────────────────────────────────────────────
static const char* FACE_STATES[] = {
  "idle","listening","thinking","talking","happy","confused","excited",
  "charging","sleeping","angry","suspicious","sad","love","wink","starstruck"
};
String   curState = "idle";
uint8_t  eyeR = 201, eyeG = 220, eyeB = 240;   // "seam" accent, default ice-blue
uint8_t  bright = 100;
uint16_t discColor;      // navy #1E2A38
uint16_t eyeColor;

int cx, cy, faceR;       // face centre + radius
unsigned long lastBlink = 0, blinkStart = 0;
unsigned long nextBlinkGap = 4500;
bool blinking = false;
float gaze = 0;          // -1..1 horizontal dart (suspicious)
unsigned long lastFrame = 0, lastReady = 0;

// One eye described by a few knobs — every expression is a point in this space.
struct EyeSpec {
  float open;     // 0 (shut) .. 1 (wide)
  float curveTop; // -1 sad arc .. +1 happy arc (upper lid)
  float slant;    // -1 .. +1 angry inner-down slant
  int   shape;    // 0 round, 1 heart, 2 star, 3 line
};

EyeSpec specFor(const String& s) {
  if (s == "happy")      return { 0.9, 0.9, 0.0, 0 };
  if (s == "excited")    return { 1.0, 0.7, 0.0, 0 };
  if (s == "sad")        return { 0.6, -0.8, 0.0, 0 };
  if (s == "angry")      return { 0.6, -0.2, 0.9, 0 };
  if (s == "suspicious") return { 0.45, 0.0, 0.3, 0 };
  if (s == "confused")   return { 0.8, 0.2, -0.3, 0 };  // one-brow feel via slant
  if (s == "thinking")   return { 0.7, 0.1, 0.15, 0 };
  if (s == "listening")  return { 1.0, 0.2, 0.0, 0 };
  if (s == "talking")    return { 0.85, 0.3, 0.0, 0 };
  if (s == "sleeping")   return { 0.06, 0.0, 0.0, 3 };
  if (s == "charging")   return { 0.5, 0.4, 0.0, 0 };
  if (s == "love")       return { 1.0, 0.0, 0.0, 1 };
  if (s == "starstruck") return { 1.0, 0.0, 0.0, 2 };
  if (s == "wink")       return { 1.0, 0.6, 0.0, 0 };   // right eye overridden shut
  return { 0.85, 0.15, 0.0, 0 };                        // idle
}

uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return tft.color565(r, g, b); }

void drawHeart(int x, int y, int s, uint16_t c) {
  tft.fillCircle(x - s / 2, y - s / 4, s / 2, c);
  tft.fillCircle(x + s / 2, y - s / 4, s / 2, c);
  tft.fillTriangle(x - s, y - s / 6, x + s, y - s / 6, x, y + s, c);
}
void drawStar(int x, int y, int s, uint16_t c) {
  for (int i = 0; i < 5; i++) {
    float a0 = -1.5708 + i * 1.2566, a1 = a0 + 2.5133;
    tft.fillTriangle(x, y, x + cos(a0) * s, y + sin(a0) * s, x + cos(a1) * s, y + sin(a1) * s, c);
  }
}

void drawEye(int ex, int ey, const EyeSpec& sp, bool shut) {
  int ew = faceR * 0.30;                 // eye width
  int eh = ew * (shut ? 0.10 : sp.open); // eye height
  if (sp.shape == 1) { drawHeart(ex, ey, ew * 0.9, eyeColor); return; }
  if (sp.shape == 2) { drawStar(ex, ey, ew * 0.95, eyeColor); return; }
  if (sp.shape == 3 || shut) {           // closed line
    tft.fillRoundRect(ex - ew, ey - 2, ew * 2, 5, 2, eyeColor);
    return;
  }
  // Rounded-rect eye body
  tft.fillRoundRect(ex - ew, ey - eh, ew * 2, eh * 2, ew, eyeColor);
  // Lid: overpaint a curved chunk with the disc colour to sculpt the mood.
  int lidH = ew * 0.9 * fabs(sp.curveTop);
  if (sp.curveTop > 0.02)      // happy: cut the BOTTOM into an upward arc
    tft.fillTriangle(ex - ew, ey + eh, ex + ew, ey + eh, ex, ey + eh - lidH, discColor);
  else if (sp.curveTop < -0.02) // sad: cut the TOP into a downward arc
    tft.fillTriangle(ex - ew, ey - eh, ex + ew, ey - eh, ex, ey - eh + lidH, discColor);
  // Angry inner slant: shave the inner-top corner.
  if (fabs(sp.slant) > 0.05) {
    int dir = (ex < cx) ? 1 : -1;        // inner side points toward centre
    int sx = ex + dir * ew;
    tft.fillTriangle(sx, ey - eh, sx - dir * ew, ey - eh, sx, ey - eh + ew * sp.slant * 1.4, discColor);
  }
}

void renderFace() {
  tft.fillCircle(cx, cy, faceR, discColor);            // smoked-glass navy disc
  EyeSpec sp = specFor(curState);
  bool shut = blinking;
  int dx = (int)(gaze * faceR * 0.12);
  int spread = faceR * 0.42;
  int ey = cy - faceR * 0.05;
  bool winkRight = (curState == "wink");
  drawEye(cx - spread + dx, ey, sp, shut);
  drawEye(cx + spread + dx, ey, sp, shut || winkRight);
}

// ── AWP ──────────────────────────────────────────────────────────────────────
void awpReady() {
  Serial.println("READY v=1 board=atlas-face role=face caps=face,touch");
}
String field(const String& line, const String& key) {
  int i = line.indexOf(key + "=");
  if (i < 0) return "";
  i += key.length() + 1;
  int j = line.indexOf(' ', i);
  return line.substring(i, j < 0 ? line.length() : j);
}
void applyColor(const String& csv) {
  int a = csv.indexOf(','), b = csv.indexOf(',', a + 1);
  if (a < 0 || b < 0) return;
  eyeR = csv.substring(0, a).toInt();
  eyeG = csv.substring(a + 1, b).toInt();
  eyeB = csv.substring(b + 1).toInt();
  eyeColor = rgb(eyeR, eyeG, eyeB);
}
bool knownState(const String& s) {
  for (auto* k : FACE_STATES) if (s == k) return true;
  return false;
}
void handleLine(String line) {
  line.trim();
  if (line.startsWith("FACE")) {
    String st = field(line, "state");
    if (knownState(st)) curState = st;
    String col = field(line, "color");
    if (col.length()) applyColor(col);
    String br = field(line, "bright");
    if (br.length()) bright = constrain(br.toInt(), 0, 100);
    renderFace();
  } else if (line.startsWith("HELLO")) {
    awpReady();
  } else if (line.startsWith("PING")) {
    Serial.println("PONG n=" + field(line, "n"));
  }
}

// ── Setup / loop ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  tft.init();
  tft.setRotation(0);
  int w = tft.width(), h = tft.height();
  cx = w / 2; cy = h / 2;
  faceR = (FACE_DIAM > 0 ? FACE_DIAM : min(w, h)) / 2;
  discColor = rgb(30, 42, 56);      // #1E2A38
  eyeColor  = rgb(eyeR, eyeG, eyeB);
  tft.fillScreen(TFT_BLACK);
  renderFace();
#if HAS_TOUCH
  ts.begin();
  ts.setRotation(0);
#endif
  awpReady();
}

void loop() {
  unsigned long now = millis();

  // Serial input (AWP lines)
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { handleLine(buf); buf = ""; }
    else if (c != '\r' && buf.length() < 120) buf += c;
  }

  // Blink scheduler
  if (!blinking && now - lastBlink > nextBlinkGap && curState != "sleeping") {
    blinking = true; blinkStart = now; renderFace();
  } else if (blinking && now - blinkStart > 110) {
    blinking = false; lastBlink = now;
    nextBlinkGap = 3000 + (now % 4000);   // 3–7s, pseudo-random
    renderFace();
  }

  // Suspicious gaze dart
  if (curState == "suspicious") {
    float g = sinf(now / 500.0f);
    if (fabs(g - gaze) > 0.25) { gaze = g; renderFace(); }
  } else if (gaze != 0) { gaze = 0; renderFace(); }

  // Talking mouth-flap feel via subtle blink cadence handled by state.

#if HAS_TOUCH
  static unsigned long lastTouch = 0;
  if (ts.touched() && now - lastTouch > 250) {
    lastTouch = now;
    TS_Point p = ts.getPoint();
    // XPT2046 raw → screen px (rough; calibrate per board)
    int x = map(p.x, 200, 3700, 0, tft.width());
    int y = map(p.y, 240, 3800, 0, tft.height());
    Serial.print("INPUT kind=tap x="); Serial.print(x); Serial.print(" y="); Serial.println(y);
  }
#endif

  // Heartbeat READY every 5s so a late-connecting brain re-syncs.
  if (now - lastReady > 5000) { lastReady = now; awpReady(); }

  delay(5);
}

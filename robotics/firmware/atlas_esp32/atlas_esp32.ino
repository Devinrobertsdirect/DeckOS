// atlas_esp32.ino — Atlas body firmware for ESP32.
//
// The ESP32 is the "nervous system": it drives the wheels, reads the encoders,
// watches the e-stop and battery, and talks to the Atlas brain (a phone, laptop,
// Pi, or the cloud) using the Atlas Wire Protocol (AWP) — the same ASCII line
// protocol the brain's HAL speaks. Two transports are supported:
//   - USB serial (always on)
//   - WiFi TCP  (optional: set ATLAS_USE_WIFI to 1) — streams AWP over port 3333
//
// Motor stage: TB6612FNG (matches ATL-HW/ATL-PCB). Adjust the pins below for
// your wiring. Safety: if no command arrives for CMD_TIMEOUT_MS, the wheels stop.
//
// Board: any ESP32 dev module. Tools -> Board -> ESP32 Dev Module.

#include "AtlasWireProtocol.h"

// ── Config ────────────────────────────────────────────────────────────────────
#define ATLAS_USE_WIFI 0            // set to 1 and fill creds below to enable WiFi
#if ATLAS_USE_WIFI
  #include <WiFi.h>
  const char* WIFI_SSID = "your-ssid";
  const char* WIFI_PASS = "your-pass";
  const uint16_t ATLAS_TCP_PORT = 3333;
  WiFiServer tcpServer(ATLAS_TCP_PORT);
  WiFiClient tcpClient;
#endif

// TB6612FNG pins (change to match your board).
const int PIN_STBY = 25;
const int PIN_AIN1 = 27, PIN_AIN2 = 26, PIN_PWMA = 33;  // motor L
const int PIN_BIN1 = 14, PIN_BIN2 = 12, PIN_PWMB = 32;  // motor R
// Quadrature encoders (interrupt-capable pins).
const int PIN_ENCL_A = 34, PIN_ENCL_B = 35;
const int PIN_ENCR_A = 39, PIN_ENCR_B = 36;
// Safety + power.
const int PIN_ESTOP  = 4;    // active-low, pulled up
const int PIN_VBATT  = 15;   // ADC through a divider (see BATT_DIVIDER)

// LEDC PWM (ESP32) — 20 kHz like the design spec, 8-bit.
const int PWM_FREQ = 20000, PWM_BITS = 8;
const int CH_A = 0, CH_B = 1;

const unsigned long CMD_TIMEOUT_MS = 500;   // watchdog
const unsigned long TEL_PERIOD_MS  = 100;   // 10 Hz telemetry
const float BATT_DIVIDER = 5.7f;            // (R1+R2)/R2 for a 4S pack on 3.3V ADC

// ── State ─────────────────────────────────────────────────────────────────────
volatile long encL = 0, encR = 0;
int wantL = 0, wantR = 0;          // -255..255
bool estopSw = false;              // software e-stop
unsigned long lastCmd = 0, lastTel = 0;

char lineBuf[96];
size_t lineLen = 0;

// ── Encoder ISRs ──────────────────────────────────────────────────────────────
void IRAM_ATTR isrL() { encL += (digitalRead(PIN_ENCL_B) ? 1 : -1); }
void IRAM_ATTR isrR() { encR += (digitalRead(PIN_ENCR_B) ? 1 : -1); }

// ── Motor control ─────────────────────────────────────────────────────────────
void driveMotor(int in1, int in2, int ch, int speed) {
  bool fwd = speed >= 0;
  int mag = abs(speed); if (mag > 255) mag = 255;
  digitalWrite(in1, fwd ? HIGH : LOW);
  digitalWrite(in2, fwd ? LOW : HIGH);
  ledcWrite(ch, mag);
}
void applyMotors() {
  bool stop = estopSw || estopPressed() || (millis() - lastCmd > CMD_TIMEOUT_MS);
  int l = stop ? 0 : wantL;
  int r = stop ? 0 : wantR;
  digitalWrite(PIN_STBY, (l == 0 && r == 0) ? LOW : HIGH);
  driveMotor(PIN_AIN1, PIN_AIN2, CH_A, l);
  driveMotor(PIN_BIN1, PIN_BIN2, CH_B, r);
}
bool estopPressed() { return digitalRead(PIN_ESTOP) == LOW; }

// ── AWP command handling ──────────────────────────────────────────────────────
void handleLine(Stream& out, const char* line) {
  if (awpIs(line, "DRIVE")) {
    // per-mille [-1000,1000] -> PWM [-255,255]
    long l = awpArg(line, "l", 0), r = awpArg(line, "r", 0);
    wantL = (int)(constrain(l, -1000, 1000) * 255 / 1000);
    wantR = (int)(constrain(r, -1000, 1000) * 255 / 1000);
    lastCmd = millis();
  } else if (awpIs(line, "STOP")) {
    wantL = 0; wantR = 0; lastCmd = millis();
  } else if (awpIs(line, "ESTOP")) {
    estopSw = awpArg(line, "on", 0) != 0;
    if (estopSw) { wantL = 0; wantR = 0; }
    awpSendEvent(out, estopSw ? "estop_on" : "estop_off");
  } else if (awpIs(line, "HELLO")) {
    awpSendReady(out, "esp32", "drive,enc,estop,batt");
  } else if (awpIs(line, "PING")) {
    out.print("PONG n="); out.println(awpArg(line, "n", 0));
  } else if (awpIs(line, "FACE") || awpIs(line, "CFG") || awpIs(line, "SERVO") || awpIs(line, "TONE")) {
    // Accepted; wire up your panel/servo/buzzer here.
  }
}

long readBattMv() {
  int raw = analogRead(PIN_VBATT);              // 0..4095 over ~3.3V
  float v = (raw / 4095.0f) * 3.3f * BATT_DIVIDER;
  return (long)(v * 1000.0f);
}

// ── setup / loop ──────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_STBY, OUTPUT);
  pinMode(PIN_AIN1, OUTPUT); pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT); pinMode(PIN_BIN2, OUTPUT);
  pinMode(PIN_ESTOP, INPUT_PULLUP);
  pinMode(PIN_ENCL_A, INPUT); pinMode(PIN_ENCL_B, INPUT);
  pinMode(PIN_ENCR_A, INPUT); pinMode(PIN_ENCR_B, INPUT);

  ledcSetup(CH_A, PWM_FREQ, PWM_BITS); ledcAttachPin(PIN_PWMA, CH_A);
  ledcSetup(CH_B, PWM_FREQ, PWM_BITS); ledcAttachPin(PIN_PWMB, CH_B);

  attachInterrupt(digitalPinToInterrupt(PIN_ENCL_A), isrL, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_ENCR_A), isrR, RISING);

  lastCmd = millis();
  awpSendReady(Serial, "esp32", "drive,enc,estop,batt");

#if ATLAS_USE_WIFI
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  tcpServer.begin();
#endif
}

void loop() {
  // Serial link
  if (awpReadLine(Serial, lineBuf, sizeof(lineBuf), lineLen)) handleLine(Serial, lineBuf);

#if ATLAS_USE_WIFI
  if (!tcpClient || !tcpClient.connected()) { tcpClient = tcpServer.available(); if (tcpClient) awpSendReady(tcpClient, "esp32", "drive,enc,estop,batt"); }
  static char wbuf[96]; static size_t wlen = 0;
  if (tcpClient && tcpClient.connected() && awpReadLine(tcpClient, wbuf, sizeof(wbuf), wlen)) handleLine(tcpClient, wbuf);
#endif

  applyMotors();

  unsigned long now = millis();
  if (now - lastTel >= TEL_PERIOD_MS) {
    lastTel = now;
    long mv = readBattMv();
    int es = (estopSw || estopPressed()) ? 1 : 0;
    awpSendTel(Serial, encL, encR, mv, -1, es, -1);
#if ATLAS_USE_WIFI
    if (tcpClient && tcpClient.connected()) awpSendTel(tcpClient, encL, encR, mv, -1, es, -1);
#endif
  }
}

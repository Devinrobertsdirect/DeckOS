// atlas_nano.ino — Atlas body firmware for Arduino Nano / Uno (ATmega328).
//
// The minimal "basic controller" tier: USB serial only, TB6612 differential
// drive, one encoder channel per wheel (the Nano has just two hardware
// interrupts, D2/D3), an e-stop input and a battery sense. It speaks the exact
// same Atlas Wire Protocol as the ESP32 and the Pi HAL — so the brain doesn't
// care which board is in the body.
//
// Note: analogWrite() on the Nano is ~490 Hz (not the 20 kHz of the full spec);
// fine for a small/desk build. For the 282 mm robot, prefer the ESP32 or the Pi.

#include "AtlasWireProtocol.h"
#include <EEPROM.h>

// TB6612FNG pins.
const int PIN_STBY = 8;
const int PIN_AIN1 = 7, PIN_AIN2 = 6, PIN_PWMA = 5;    // motor L
const int PIN_BIN1 = 4, PIN_BIN2 = 2 /*n/a*/, PIN_PWMB = 9; // motor R (BIN2 optional)
const int PIN_BIN2b = 12;
// Encoders: single channel each on the two interrupt pins, direction from a plain pin.
const int PIN_ENCL = 2, PIN_ENCL_DIR = 10;   // D2 = INT0
const int PIN_ENCR = 3, PIN_ENCR_DIR = 11;   // D3 = INT1
// Safety + power.
const int PIN_ESTOP = A1;   // active-low, pulled up
const int PIN_VBATT = A0;   // ADC through a divider

const unsigned long CMD_TIMEOUT_MS = 500;
const unsigned long TEL_PERIOD_MS  = 100;
const float BATT_DIVIDER = 5.7f;   // (R1+R2)/R2 for a 4S pack on 5V ADC

volatile long encL = 0, encR = 0;
int wantL = 0, wantR = 0;          // -255..255
bool estopSw = false;
unsigned long lastCmd = 0, lastTel = 0, lastPersist = 0;

char lineBuf[80];
size_t lineLen = 0;

// ── Persistent "records" (EEPROM) — the little logbook the body carries and
//    "drops off" to the brain on connect: how many times it's woken and its
//    total lifetime awake. Low-wear: boot count written once per boot, lifetime
//    seconds only every few minutes.
unsigned int bootCount = 0;        // 16-bit on AVR
unsigned long lifeBaseSec = 0;     // lifetime seconds BEFORE this session

void loadRecords() {
  EEPROM.get(0, bootCount);
  if (bootCount == 0xFFFF) bootCount = 0;            // fresh chip
  EEPROM.get(2, lifeBaseSec);
  if (lifeBaseSec == 0xFFFFFFFFUL) lifeBaseSec = 0;
}
void persistLife() { unsigned long life = lifeBaseSec + millis() / 1000UL; EEPROM.put(2, life); }
void sendRecord(Stream& out) {
  out.print(F("RECORD boot=")); out.print(bootCount);
  out.print(F(" life_s=")); out.print(lifeBaseSec + millis() / 1000UL);
  out.print(F(" sess_ms=")); out.println(millis());
}

void isrL() { encL += (digitalRead(PIN_ENCL_DIR) ? 1 : -1); }
void isrR() { encR += (digitalRead(PIN_ENCR_DIR) ? 1 : -1); }

bool estopPressed() { return digitalRead(PIN_ESTOP) == LOW; }

void driveMotor(int in1, int in2, int pwmPin, int speed) {
  bool fwd = speed >= 0;
  int mag = abs(speed); if (mag > 255) mag = 255;
  digitalWrite(in1, fwd ? HIGH : LOW);
  digitalWrite(in2, fwd ? LOW : HIGH);
  analogWrite(pwmPin, mag);
}
void applyMotors() {
  bool stop = estopSw || estopPressed() || (millis() - lastCmd > CMD_TIMEOUT_MS);
  int l = stop ? 0 : wantL;
  int r = stop ? 0 : wantR;
  digitalWrite(PIN_STBY, (l == 0 && r == 0) ? LOW : HIGH);
  driveMotor(PIN_AIN1, PIN_AIN2, PIN_PWMA, l);
  driveMotor(PIN_BIN1, PIN_BIN2b, PIN_PWMB, r);
}

void handleLine(const char* line) {
  if (awpIs(line, "DRIVE")) {
    long l = awpArg(line, "l", 0), r = awpArg(line, "r", 0);
    wantL = (int)(constrain(l, -1000, 1000) * 255L / 1000);
    wantR = (int)(constrain(r, -1000, 1000) * 255L / 1000);
    lastCmd = millis();
  } else if (awpIs(line, "STOP")) {
    wantL = 0; wantR = 0; lastCmd = millis();
  } else if (awpIs(line, "ESTOP")) {
    estopSw = awpArg(line, "on", 0) != 0;
    if (estopSw) { wantL = 0; wantR = 0; }
    awpSendEvent(Serial, estopSw ? "estop_on" : "estop_off");
  } else if (awpIs(line, "HELLO")) {
    awpSendReady(Serial, "nano", "drive,enc,estop,batt");
    sendRecord(Serial);                 // drop the logbook when the brain says hi
  } else if (awpIs(line, "SYNC")) {
    persistLife();
    sendRecord(Serial);                 // brain asked to sync → hand over the record
  } else if (awpIs(line, "PING")) {
    Serial.print(F("PONG n=")); Serial.println(awpArg(line, "n", 0));
  }
  // FACE/CFG/SERVO/TONE silently accepted — extend as needed.
}

long readBattMv() {
  int raw = analogRead(PIN_VBATT);              // 0..1023 over 5V
  float v = (raw / 1023.0f) * 5.0f * BATT_DIVIDER;
  return (long)(v * 1000.0f);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_STBY, OUTPUT);
  pinMode(PIN_AIN1, OUTPUT); pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT); pinMode(PIN_BIN2b, OUTPUT);
  pinMode(PIN_ESTOP, INPUT_PULLUP);
  pinMode(PIN_ENCL, INPUT_PULLUP); pinMode(PIN_ENCL_DIR, INPUT);
  pinMode(PIN_ENCR, INPUT_PULLUP); pinMode(PIN_ENCR_DIR, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_ENCL), isrL, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_ENCR), isrR, RISING);
  // Load + bump the persistent record (a new wake), then announce ourselves and
  // hand the brain our logbook in one drop.
  loadRecords();
  bootCount++;
  EEPROM.put(0, bootCount);
  lastCmd = millis();
  awpSendReady(Serial, "nano", "drive,enc,estop,batt");
  sendRecord(Serial);
}

void loop() {
  if (awpReadLine(Serial, lineBuf, sizeof(lineBuf), lineLen)) handleLine(lineBuf);
  applyMotors();
  unsigned long now = millis();
  if (now - lastTel >= TEL_PERIOD_MS) {
    lastTel = now;
    int es = (estopSw || estopPressed()) ? 1 : 0;
    awpSendTel(Serial, encL, encR, readBattMv(), -1, es, -1);
  }
  // Persist lifetime seconds occasionally (EEPROM-wear friendly).
  if (now - lastPersist >= 300000UL) { lastPersist = now; persistLife(); }
}

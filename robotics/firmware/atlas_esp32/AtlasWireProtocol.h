// AtlasWireProtocol.h — the Atlas Wire Protocol (AWP) v1 on the microcontroller
// side. Header-only, no JSON, no heap: parses the same ASCII line protocol the
// brain speaks (see core/server/src/hal/protocol.ts) on anything from an ESP32
// down to an 8-bit Arduino Nano.
//
// Lines are newline-terminated. First token is the verb; the rest are `key=value`
// pairs. Commands (brain -> body): HELLO DRIVE STOP FACE ESTOP SERVO TONE CFG PING.
// Reports (body -> brain): READY TEL EVENT PONG LOG.
#pragma once
#include <Arduino.h>

#define AWP_VERSION 1

// Non-blocking line reader. Feed it a Stream; returns true once a full line is
// in `buf` (NUL-terminated, newline stripped). `len` tracks the fill level and
// must persist between calls (one per link).
inline bool awpReadLine(Stream& s, char* buf, size_t cap, size_t& len) {
  while (s.available()) {
    char c = (char)s.read();
    if (c == '\n' || c == '\r') {
      if (len == 0) continue;      // swallow blank lines / CRLF
      buf[len] = '\0';
      len = 0;
      return true;
    }
    if (len < cap - 1) buf[len++] = c;
    else len = 0;                  // overflow -> drop the runaway line
  }
  return false;
}

// Copy the verb (first token) of `line` into `out`.
inline void awpVerb(const char* line, char* out, size_t cap) {
  size_t i = 0;
  while (line[i] && line[i] != ' ' && i < cap - 1) { out[i] = line[i]; i++; }
  out[i] = '\0';
}

// Return the integer value of `key=` in `line`, or `def` if the key is absent.
// Token-accurate: only matches a whole `key` sitting before its '='.
inline long awpArg(const char* line, const char* key, long def) {
  size_t klen = strlen(key);
  const char* p = line;
  while (*p) {
    // advance to a token boundary (start-of-line or just after a space)
    if (p == line || p[-1] == ' ') {
      if (strncmp(p, key, klen) == 0 && p[klen] == '=') {
        return atol(p + klen + 1);
      }
    }
    p++;
  }
  return def;
}

// True if `line`'s verb equals `verb`.
inline bool awpIs(const char* line, const char* verb) {
  size_t vlen = strlen(verb);
  return strncmp(line, verb, vlen) == 0 && (line[vlen] == ' ' || line[vlen] == '\0');
}

// ── Report builders (body -> brain) ──────────────────────────────────────────
inline void awpSendReady(Stream& s, const char* board, const char* caps) {
  s.print("READY v="); s.print(AWP_VERSION);
  s.print(" board="); s.print(board);
  s.print(" caps="); s.println(caps);
}

// Compact telemetry line. Pass -1 for any field you don't have.
inline void awpSendTel(Stream& s, long encL, long encR, long battMv,
                       int dock, int estop, int yawDeg) {
  s.print("TEL");
  if (encL != -1)   { s.print(" encL="); s.print(encL); }
  if (encR != -1)   { s.print(" encR="); s.print(encR); }
  if (battMv != -1) { s.print(" battmv="); s.print(battMv); }
  if (dock != -1)   { s.print(" dock="); s.print(dock); }
  if (estop != -1)  { s.print(" estop="); s.print(estop); }
  if (yawDeg != -1) { s.print(" yaw="); s.print(yawDeg); }
  s.println();
}

inline void awpSendEvent(Stream& s, const char* e) {
  s.print("EVENT e="); s.println(e);
}
inline void awpSendLog(Stream& s, const char* msg) {
  s.print("LOG msg="); s.println(msg);
}

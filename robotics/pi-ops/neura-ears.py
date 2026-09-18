#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# neura-ears.py — Nobi's local ears: on-device VAD, cloud-accurate transcription.
# Chromium's Web Speech has no Linux backend, so the face never hears anything;
# this closes that gap. It captures the mic, does lightweight on-device
# voice-activity detection (VAD), and sends only *real speech clips* to the brain,
# which transcribes them with ElevenLabs Scribe — far more accurate than the local
# Vosk model, which mangled whole sentences and never once heard its own name.
#
#   pw-record / arecord (raw S16LE 16k mono)
#        │  energy VAD (this file) — buffers a whole spoken phrase
#        ▼
#   POST /api/voice/transcribe {audio: wav-base64}  ──▶ ElevenLabs Scribe ──▶ text
#        │  wake gate + armed window (this file)
#        ▼
#   POST /api/voice/heard {text}  ──▶ WS "voice.heard" ──▶ the face → Claude → TTS
#
# WHY CLOUD STT: Devin's steer — "we should be using claude and eleven labs where
# possible." Scribe hears "Nobi" and full sentences the tiny Vosk model couldn't.
# CREDIT-SAFE, two gates: (1) VAD means only actual speech clips are ever uploaded
# (silence/room-tone never spends a Scribe credit); (2) the wake gate means Claude
# only fires when Nobi is addressed or already in an armed back-and-forth. While
# Nobi is talking (/api/voice/state muted=true) captures are dropped before upload
# so she never transcribes — or answers — her own voice.
#
# OFFLINE FALLBACK: if the brain has no ElevenLabs key (or the call fails), we lazily
# load the local Vosk model and transcribe on-device instead, so the robot still
# hears something with no network. Vosk is never loaded while Scribe is working, so
# it costs no CPU in the normal (online) case.
#
# Env:
#   NEURA_PW_SOURCE     PipeWire source: "bluez_input.<MAC>" or "default" (follow
#                       WirePlumber's default source)                  (default: unset)
#   NEURA_MIC_DEV       ALSA capture device if no PW source          (default: plughw:3,0)
#   NEURA_VAD_START_RMS absolute RMS floor that counts as speech      (default: 600)
#   NEURA_VAD_MULT      speech = RMS above (this × adaptive noise floor) (default: 3.0)
#   NEURA_SILENCE_MS    quiet gap that ends a phrase                  (default: 900)
#   NEURA_START_MS      speech this long trips the recorder           (default: 120)
#   NEURA_PREROLL_MS    audio kept from just before speech started    (default: 300)
#   NEURA_MIN_UTTER_MS  ignore blips shorter than this                (default: 350)
#   NEURA_MAX_PHRASE_S  hard cap on one phrase                        (default: 15)
#   NEURA_WAKE_WORDS    comma list of activation words               (default: nobi + variants)
#   NEURA_REQUIRE_WAKE  "0" = respond to everything                   (default: "1")
#   NEURA_ARM_SECONDS   keep-listening window after a wake            (default: 12)
#   NEURA_STT_FALLBACK  "0" = never fall back to local Vosk           (default: "1")
#   NEURA_VOSK_MODEL    flattened Vosk model dir (fallback only)      (default: ~/.atlas/vosk-model)
#
# Resilient (it runs on a robot that gets power-yanked): the capture process
# respawns if it dies; HTTP failures are swallowed; SIGTERM shuts down cleanly.
# Python 3.13 dropped `audioop`, so RMS is computed by hand over the sample array.
# ─────────────────────────────────────────────────────────────────────────────
import array
import base64
import io
import difflib
import json
import os
import re
import signal
import subprocess
import sys
import time
import wave
from collections import deque

import requests

# ── Capture source ───────────────────────────────────────────────────────────
MIC_DEV = os.environ.get("NEURA_MIC_DEV", "plughw:3,0")
PW_SOURCE = os.environ.get("NEURA_PW_SOURCE", "").strip()
SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000       # 320 samples
FRAME_BYTES = FRAME_SAMPLES * 2                      # 640 bytes (s16 mono)

# ── Brain endpoints ──────────────────────────────────────────────────────────
BASE = os.environ.get("NEURA_BRAIN", "http://127.0.0.1:8080")
TRANSCRIBE_URL = BASE + "/api/voice/transcribe"
INTERRUPT_URL = BASE + "/api/voice/interrupt"
# Barge-in (Devin: "if I interrupt him he needs to stop"). While Nobi speaks we
# still watch for a LOUD utterance and, if it contains one of these, cut him off.
# "nobi" alone is not enough — he says his own name constantly.
BARGE_IN = os.environ.get("NEURA_BARGE_IN", "1") != "0"
BARGE_MULT = float(os.environ.get("NEURA_BARGE_MULT", "1.8"))
# Anything this far above the level of his OWN voice in the mic counts as a
# person cutting in, whatever they say. Keywords are no longer required: being
# talked over is itself the signal to stop. (Keywords still stop him instantly,
# without waiting for the phrase to finish.)
BARGE_ANY = os.environ.get("NEURA_BARGE_ANY", "1") != "0"
BARGE_MIN_MS = int(os.environ.get("NEURA_BARGE_MIN_MS", "420"))
LISTENING_URL = BASE + "/api/voice/listening"
EARS_URL = BASE + "/api/voice/ears"
EARS_BEAT_S = float(os.environ.get("NEURA_EARS_BEAT_S", "10"))
# The noise floor must not run away in a loud hall: it rises slowly, falls
# quickly, and the margin it can add to the threshold is capped, so a room full
# of chatter can never raise the bar past a person speaking to him at arm-length.
FLOOR_RISE = float(os.environ.get("NEURA_FLOOR_RISE", "0.0015"))
FLOOR_FALL = float(os.environ.get("NEURA_FLOOR_FALL", "0.08"))
FLOOR_MARGIN_MAX = float(os.environ.get("NEURA_FLOOR_MARGIN_MAX", "1400"))

# ── Who is he talking to? ────────────────────────────────────────────────────
# After he answers, the mic opens briefly so you can reply without saying his
# name again. In a quiet room that is lovely; in a hall it invites every nearby
# conversation in. So the open window belongs to ONE person: the one who woke
# him. We remember how loud that person reads in this microphone, and while the
# window is open only speech at a comparable level is taken as a reply. Someone
# across the room is quieter and is ignored — and two ignored utterances in a
# row mean the conversation is over, so the window shuts early rather than
# waiting out its clock. This is the behaviour people expect from a speaker:
# it answers you, waits a beat for you, and then goes back to sleep.
SPEAKER_RATIO = float(os.environ.get("NEURA_SPEAKER_RATIO", "0.55"))
SPEAKER_MARGIN = float(os.environ.get("NEURA_SPEAKER_MARGIN", "1.3"))
STRANGERS_BEFORE_CLOSE = int(os.environ.get("NEURA_STRANGERS_CLOSE", "2"))
INTERRUPT_RE = re.compile(r"\b(stop|wait|hold on|hang on|hold up|pause|quiet|shut up|enough|okay okay|ok ok|hey (nobi|nobee|noby|nobby|noble|nova|novi|no bee|robot)|nobi stop|shush|excuse me)\b")
HEARD_URL = BASE + "/api/voice/heard"
STATE_URL = BASE + "/api/voice/state"

# ── VAD tuning ───────────────────────────────────────────────────────────────
START_RMS = float(os.environ.get("NEURA_VAD_START_RMS", "600"))
VAD_MULT = float(os.environ.get("NEURA_VAD_MULT", "2.2"))
SILENCE_MS = int(os.environ.get("NEURA_SILENCE_MS", "800"))
START_MS = int(os.environ.get("NEURA_START_MS", "120"))
PREROLL_MS = int(os.environ.get("NEURA_PREROLL_MS", "300"))
MIN_UTTER_MS = int(os.environ.get("NEURA_MIN_UTTER_MS", "350"))
MAX_PHRASE_S = float(os.environ.get("NEURA_MAX_PHRASE_S", "15"))

START_FRAMES = max(1, START_MS // FRAME_MS)
SILENCE_FRAMES = max(1, SILENCE_MS // FRAME_MS)
PREROLL_FRAMES = max(1, PREROLL_MS // FRAME_MS)

# ── Wake gate ────────────────────────────────────────────────────────────────
REQUIRE_WAKE = os.environ.get("NEURA_REQUIRE_WAKE", "1") != "0"
ARM_SECONDS = float(os.environ.get("NEURA_ARM_SECONDS", "20"))
# The moment Nobi FINISHES speaking, keep listening this long for a reply so the
# user can answer without saying her name again (Devin's steer: 7s after speech).
ARM_AFTER_REPLY = float(os.environ.get("NEURA_ARM_AFTER_S", "10"))
MUTE_POLL_MS = int(os.environ.get("NEURA_MUTE_POLL_MS", "200"))
# ── His name ─────────────────────────────────────────────────────────────────
# Spelled NOBI. Said "NO-bee". Nobody's speech-to-text agrees on how to write
# that, so the name is an ARRAY, not a string — every spelling a transcriber
# reaches for when it hears /ˈnoʊbi/ and has no such word in its vocabulary.
# Devin's rule: he answers to the SOUND. Add to this list freely; the cost of a
# rare false wake is nothing next to a robot that ignores its own name.
NAME_VARIANTS = [
    # the name itself, and the ways it gets spelled
    "nobi", "nobee", "nobey", "nobie", "noby", "nobby", "nobe", "nobi's",
    # heard as two words
    "no bee", "no be", "no bi", "know be", "know bee", "gnome be",
    # real words a transcriber substitutes for the unfamiliar one
    "noble", "nova", "novi", "novee", "novy", "noobie", "newbie", "knobby",
    "no v", "now be", "snow be", "note be",
    # what it calls itself if all else fails
    "robot",
]
# Said to get his attention. The prefix is optional — "nobi, what time is it"
# and "hey nobi what time is it" both work, so we never enumerate the prefixes.
WAKE_WORDS = [w.strip().lower() for w in
              os.environ.get("NEURA_WAKE_WORDS", ",".join(NAME_VARIANTS)).split(",") if w.strip()]
WAKE_WORDS.sort(key=len, reverse=True)   # longest first so "no bee" beats "no be"
_WAKE_RE = [re.compile(r"\b" + re.escape(w) + r"\b") for w in WAKE_WORDS]

# A few renderings are too close to ordinary speech to trust on their own
# ("no we", "no me"), so they only count when the offline model produced the
# transcript — it mangles the name, and it is only listening because the good
# transcriber is down.
_LOOSE_WAKE = "know we,no we,no me,no fee,now we,no baby,nobody home"
LOOSE_WORDS = [w.strip().lower() for w in
               os.environ.get("NEURA_LOOSE_WAKE", _LOOSE_WAKE).split(",") if w.strip()]
LOOSE_WORDS.sort(key=len, reverse=True)
_LOOSE_RE = [re.compile(r"\b" + re.escape(w) + r"\b") for w in LOOSE_WORDS]
# "hey/ok <something>" at the very start is almost always an attempt at his name
_ADDRESS_RE = re.compile(r"^\s*(?:hey|hay|ok|okay|yo|hi|hello)\s+(?:there\s+)?([a-z]+(?:\s+[a-z]+)?)\b")
_NAME_SHAPES = ("nobi", "nobee", "noby", "nobby", "nobie")

# ── Offline fallback (lazy Vosk) ─────────────────────────────────────────────
FALLBACK = os.environ.get("NEURA_STT_FALLBACK", "1") != "0"
MODEL_DIR = os.path.expanduser(os.environ.get("NEURA_VOSK_MODEL", "~/.atlas/vosk-model"))
_vosk_model = None   # loaded on first offline transcription only

_running = True


def _stop(_signum, _frame):
    global _running
    _running = False


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


def log(msg: str) -> None:
    print(f"[neura-ears] {msg}", file=sys.stderr, flush=True)


def capture_sources() -> list:
    """Names of REAL microphones (PipeWire nodes of class Audio/Source) — never a
    sink's monitor. `pw-record --target <absent>` quietly falls back to the
    default source, and with no mic attached that default is the output's
    monitor: Nobi would be listening to his own voice."""
    try:
        out = subprocess.run(["pw-cli", "ls", "Node"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    names, cur = [], {}
    def flush():
        if cur.get("media.class") == "Audio/Source" and cur.get("node.name"):
            names.append(cur["node.name"])
    for raw in out.splitlines():
        line = raw.strip()
        if line.startswith("id "):
            flush(); cur = {}
            continue
        m = re.match(r'([\w.\-]+) = "(.*)"$', line)
        if m:
            cur[m.group(1)] = m.group(2)
    flush()
    return names


_last_no_mic_log = 0.0
_capture_target = ""          # the mic node we are recording (checked periodically)

def spawn_capture():
    """Start the capture process, or return None when there is no microphone.
    PipeWire: the pinned source if present, else ANY real mic (a different
    headset the reconnect loop paired), else nothing — the caller waits."""
    global _last_no_mic_log, _capture_target
    _capture_target = ""
    if PW_SOURCE:
        if PW_SOURCE.lower() == "default":
            target = []
        else:
            mics = capture_sources()
            if PW_SOURCE in mics:
                target = ["--target", PW_SOURCE]
            elif mics:
                target = ["--target", mics[0]]
                log(f"pinned mic {PW_SOURCE} absent — using {mics[0]}")
            else:
                if time.monotonic() - _last_no_mic_log > 60:
                    log("no microphone attached (only output monitors) — waiting; never capturing my own voice")
                    _last_no_mic_log = time.monotonic()
                return None
            _capture_target = target[1]
        return subprocess.Popen(
            ["pw-record", *target, "--rate", str(SAMPLE_RATE),
             "--channels", "1", "--format", "s16", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    # USB / ALSA mic: capture with arecord.
    return subprocess.Popen(
        ["arecord", "-D", MIC_DEV, "-f", "S16_LE", "-r", str(SAMPLE_RATE),
         "-c", "1", "-t", "raw"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )


def read_exact(stream, n: int):
    """Read exactly n bytes from a pipe, or None if the stream ended."""
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def frame_rms(buf: bytes) -> float:
    """Root-mean-square level of one 16-bit-mono frame (audioop is gone in 3.13)."""
    samples = array.array("h")
    samples.frombytes(buf)
    if not samples:
        return 0.0
    total = 0
    for v in samples:
        total += v * v
    return (total / len(samples)) ** 0.5


def pcm_to_wav(pcm: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return out.getvalue()


def state_arm_after_reply() -> bool:
    """Did the brain ask us to open the mic after this utterance? An attract
    line says no: he spoke to the room, not to a person, so nobody is replying."""
    try:
        return bool(requests.get(STATE_URL, timeout=2).json().get("armAfterReply", True))
    except requests.RequestException:
        return True


def is_muted() -> bool:
    """True while Nobi is speaking — don't upload (or transcribe) her own voice."""
    try:
        return bool(requests.get(STATE_URL, timeout=2).json().get("muted"))
    except requests.RequestException:
        return False


def transcribe_remote(pcm: bytes):
    """(text, error). error='no-key' → brain has no cloud STT, use local fallback."""
    wav_b64 = base64.b64encode(pcm_to_wav(pcm)).decode("ascii")
    try:
        r = requests.post(TRANSCRIBE_URL, json={"audio": wav_b64, "format": "wav"}, timeout=25)
    except requests.RequestException as e:
        return None, f"post-failed: {e}"
    if r.status_code == 503:
        return None, "no-key"
    if not r.ok:
        detail = ""
        try:
            body = r.json()
            raw = str(body.get("error") or body)
            if "invalid_api_key" in raw or "api_key_id_used_as_api_key" in raw:
                detail = " [the ELEVENLABS_API_KEY is not a key — real ones start with sk_. " \
                         "Paste the key itself on the account page and sync.]"
            elif "quota" in raw.lower() or "insufficient" in raw.lower():
                detail = " [ElevenLabs quota exhausted]"
        except ValueError:
            pass
        if detail and not getattr(transcribe_remote, "_warned", False):
            log(f"scribe unusable{detail}")
            transcribe_remote._warned = True
        return None, f"http-{r.status_code}"
    try:
        return (r.json().get("transcript") or "").strip(), None
    except ValueError:
        return None, "bad-json"


def transcribe_local(pcm: bytes) -> str:
    """Offline fallback: transcribe on-device with Vosk. Loaded lazily, once."""
    global _vosk_model
    if not FALLBACK or not os.path.isdir(MODEL_DIR):
        return ""
    try:
        from vosk import Model, KaldiRecognizer, SetLogLevel
    except Exception as e:
        log(f"vosk unavailable for fallback: {e}")
        return ""
    if _vosk_model is None:
        SetLogLevel(-1)
        log(f"loading local Vosk fallback model {MODEL_DIR} …")
        _vosk_model = Model(MODEL_DIR)
    rec = KaldiRecognizer(_vosk_model, SAMPLE_RATE)
    rec.AcceptWaveform(pcm)
    try:
        return (json.loads(rec.FinalResult()).get("text") or "").strip()
    except ValueError:
        return ""


def _similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def match_wake(text: str, loose: bool = False):
    """(matched, remainder, how). Strips up to & including the wake word so
    'nobi what's the time' → (True, "what's the time"); bare 'nobi' → (True, "").

    `loose` widens the net for transcripts that came from the offline model,
    which mangles the name; Scribe transcripts stay strict so ordinary
    conversation never wakes him by accident.
    """
    low = text.lower()
    best = None
    for rx in _WAKE_RE:
        m = rx.search(low)
        if m and (best is None or m.start() < best.start()):
            best = m
    if best is not None:
        return True, text[best.end():].strip(" ,.!?-"), "wake"
    if not loose:
        return False, text.strip(), None

    for rx in _LOOSE_RE:
        m = rx.search(low)
        if m and (best is None or m.start() < best.start()):
            best = m
    if best is not None:
        return True, text[best.end():].strip(" ,.!?-"), "loose"

    # "Hey <something that sounds like Nobi>" — catches a mishearing we have
    # never seen before, without opening the door to every stray sentence.
    m = _ADDRESS_RE.match(low)
    if m:
        heard = m.group(1)
        squashed = heard.replace(" ", "")
        if any(_similar(squashed, shape) >= 0.62 or _similar(heard.split()[0], shape) >= 0.7
               for shape in _NAME_SHAPES):
            return True, text[m.end():].strip(" ,.!?-"), "sounds-like"
    return False, text.strip(), None


def report_ears(capturing: bool, mic: str, floor: float, threshold: float) -> None:
    """Tell the brain whether a microphone is actually open. Without this the
    only mic signal the brain had was the TTS echo latch, so asking "can you
    hear me" — which necessarily happens while he is about to speak — always
    answered "my mic is muted"."""
    try:
        requests.post(EARS_URL, json={"capturing": capturing, "mic": mic,
                                      "floor": round(floor), "threshold": round(threshold)}, timeout=2)
    except requests.RequestException:
        pass


def forward(text: str) -> None:
    try:
        requests.post(HEARD_URL, json={"text": text}, timeout=3)
    except requests.RequestException:
        pass


def main() -> int:
    src = ("pw:" + PW_SOURCE) if PW_SOURCE else ("alsa:" + MIC_DEV)
    log(f"up — mic={src} STT=elevenlabs-scribe (fallback={'vosk' if FALLBACK else 'off'}) "
        f"vad(start_rms={START_RMS:.0f} ×{VAD_MULT} silence={SILENCE_MS}ms) "
        f"wake={WAKE_WORDS if REQUIRE_WAKE else 'OPEN'} arm={ARM_SECONDS:.0f}s")

    proc = None
    preroll = deque(maxlen=PREROLL_FRAMES)
    speaking = False
    utter = bytearray()
    speech_run = 0
    silence_run = 0
    utter_start = 0.0
    floor = START_RMS            # adaptive ambient-noise floor
    armed_until = 0.0
    muted = False                # is Nobi speaking right now?
    barge_run, barge_silence, barge_buf = 0, 0, bytearray()
    talk_floor = START_RMS       # how loud his own voice reads in this mic
    last_beat = 0.0
    speaker_level = 0.0          # how loud the person he is talking to reads
    strangers = 0                # consecutive utterances that were not them
    last_mute_poll = 0.0
    last_target_check = 0.0

    while _running:
        if proc is None or proc.poll() is not None:
            if proc is not None:
                log("capture exited — respawning in 2s")
                time.sleep(2)
                if not _running:
                    break
            proc = spawn_capture()
            if proc is None:             # no mic yet (headset off) — poll for one
                report_ears(False, src, floor, max(START_RMS, floor * VAD_MULT))
                time.sleep(3)
                continue
            preroll.clear()
            speaking, utter, speech_run, silence_run = False, bytearray(), 0, 0
            log(f"capturing ({src})")

        data = read_exact(proc.stdout, FRAME_BYTES)
        if data is None:
            proc = None
            report_ears(False, src, floor, max(START_RMS, floor * VAD_MULT))
            continue

        now = time.monotonic()
        if now - last_beat >= EARS_BEAT_S:
            last_beat = now
            report_ears(True, src, floor, max(START_RMS, min(floor * VAD_MULT, floor + FLOOR_MARGIN_MAX)))

        # If the mic we were recording vanished (headset switched off), stop —
        # WirePlumber would otherwise re-link the stream to the default source,
        # which with no mic present is the speaker's monitor (his own voice).
        if _capture_target and now - last_target_check > 10:
            last_target_check = now
            if _capture_target not in capture_sources():
                log(f"mic {_capture_target} vanished — stopping capture")
                proc.kill(); proc = None
                continue

        # Throttled: is Nobi speaking? When she stops, re-arm so the user can
        # answer without repeating the wake word for ARM_AFTER_REPLY seconds.
        if (now - last_mute_poll) * 1000.0 >= MUTE_POLL_MS:
            last_mute_poll = now
            m = is_muted()
            if muted and not m:          # falling edge — Nobi just finished
                if state_arm_after_reply():
                    armed_until = now + ARM_AFTER_REPLY
                    log(f"reply finished — listening {ARM_AFTER_REPLY:.0f}s for a response")
                else:
                    log("spoke unprompted — mic stays closed")
            muted = m

        if muted:
            # Nobi is talking. Keep ONE ear open, for interruptions only: a much
            # higher energy bar (his own playback bleeds into the mic quietly; a
            # person cutting in is loud), transcribed on-device so his own voice
            # never spends a Scribe credit, and only a short list of words count.
            if not BARGE_IN:
                speaking, utter, speech_run, silence_run = False, bytearray(), 0, 0
                preroll.clear()
                continue
            rms = frame_rms(data)
            # His own voice leaks into the mic; learn how loud that leak is while
            # he talks, and treat only something clearly above it as a person.
            talk_floor = (1 - 0.02) * talk_floor + 0.02 * rms if rms < talk_floor * 2.5 else talk_floor
            bar = max(START_RMS * BARGE_MULT, talk_floor * BARGE_MULT, floor * VAD_MULT)
            if rms >= bar:
                barge_run += 1
                barge_buf += data
            elif barge_run:
                barge_silence += 1
                barge_buf += data
            # Talked over for long enough? Stop immediately — do not wait for the
            # sentence to end, and do not require a magic word.
            if BARGE_ANY and barge_run * FRAME_MS >= BARGE_MIN_MS:
                log(f"barge-in: talked over ({barge_run * FRAME_MS}ms) — stopping")
                try: requests.post(INTERRUPT_URL, json={"text": ""}, timeout=2)
                except requests.RequestException: pass
                muted = False
                armed_until = now + ARM_SECONDS
                # keep what they have said so far; the phrase continues below as
                # a normal utterance now that he is quiet
                utter = bytearray(barge_buf); speaking = True; utter_start = now
                speech_run, silence_run = START_FRAMES, 0
                barge_run, barge_silence, barge_buf = 0, 0, bytearray()
                continue
            if barge_run >= 4 and barge_silence >= 12:          # a word or two, then a beat of quiet
                clip = bytes(barge_buf)
                barge_run, barge_silence, barge_buf = 0, 0, bytearray()
                heard = transcribe_local(clip).lower()
                if heard and INTERRUPT_RE.search(heard):
                    log(f"barge-in: {heard!r} — interrupting")
                    try: requests.post(INTERRUPT_URL, json={"text": heard}, timeout=2)
                    except requests.RequestException: pass
                    muted = False
                    armed_until = now + ARM_SECONDS
                elif heard:
                    log(f"(while talking, ignored) {heard!r}")
            elif barge_silence > 30:
                barge_run, barge_silence, barge_buf = 0, 0, bytearray()
            speaking, utter, speech_run, silence_run = False, bytearray(), 0, 0
            preroll.clear()
            continue

        rms = frame_rms(data)
        threshold = max(START_RMS, min(floor * VAD_MULT, floor + FLOOR_MARGIN_MAX))
        is_speech = rms >= threshold

        if not speaking:
            preroll.append(data)
            if is_speech:
                speech_run += 1
                if speech_run >= START_FRAMES:
                    speaking = True
                    # The face should react NOW, not when the transcript lands —
                    # a person needs to see they have been heard while they talk.
                    if armed_until > now or not REQUIRE_WAKE:
                        try: requests.post(LISTENING_URL, json={"on": True}, timeout=1)
                        except requests.RequestException: pass
                    utter = bytearray(b"".join(preroll))   # keep the pre-roll
                    preroll.clear()
                    silence_run = 0
                    utter_start = now
            else:
                speech_run = 0
                # Track the ambient level while quiet. Asymmetric on purpose: it
                # eases UP slowly (a burst of applause must not deafen him) and
                # drops quickly (so he gets sensitive again the moment it calms).
                a = FLOOR_RISE if rms > floor else FLOOR_FALL
                floor = (1 - a) * floor + a * rms
            continue

        # ── speaking: accumulate until a long-enough pause (or the hard cap) ──
        utter.extend(data)
        silence_run = 0 if is_speech else silence_run + 1
        ended = silence_run >= SILENCE_FRAMES or (now - utter_start) >= MAX_PHRASE_S
        if not ended:
            continue

        pcm = bytes(utter)
        utter_level = frame_rms(pcm)          # how loud this speaker is, in this mic
        speaking, utter, speech_run, silence_run = False, bytearray(), 0, 0
        dur_ms = len(pcm) / 2 / SAMPLE_RATE * 1000.0
        if dur_ms < MIN_UTTER_MS:
            continue   # a cough / click — not worth an upload

        # (We never capture while muted, so this buffer is always the user's voice.)
        text, err = transcribe_remote(pcm)
        from_local = False
        if err:
            local = transcribe_local(pcm)
            if local:
                log(f"(scribe {err}) local→ {local!r}")
                text = local
                from_local = True
            else:
                log(f"(scribe {err}; no local transcript) dropped {dur_ms:.0f}ms clip")
                continue
        if not text:
            continue

        armed = now < armed_until
        matched, remainder, how = match_wake(text, loose=from_local)
        if REQUIRE_WAKE and not matched and not armed:
            log(f"(ignored, no wake): {text!r}")
            continue
        if matched and how != "wake":
            log(f"({how} wake) {text!r}")

        # Inside the open window with no wake word: is this the person he is
        # talking to, or the room? Compare against how loud they were.
        if armed and not matched and speaker_level > 0:
            near = utter_level >= speaker_level * SPEAKER_RATIO
            over_room = utter_level >= max(START_RMS, floor * VAD_MULT) * SPEAKER_MARGIN
            if not (near and over_room):
                strangers += 1
                log(f"(not the speaker, {utter_level:.0f} vs {speaker_level:.0f}): {text!r}")
                if strangers >= STRANGERS_BEFORE_CLOSE:
                    armed_until = 0.0
                    speaker_level = 0.0
                    strangers = 0
                    log("conversation over — mic closed, say my name to start again")
                continue
        strangers = 0

        if matched:
            # A new wake word means a new main speaker: learn their level.
            speaker_level = utter_level
        elif speaker_level:
            # Ease toward them, so leaning in or back does not lose the thread.
            speaker_level = 0.7 * speaker_level + 0.3 * utter_level

        if matched:
            armed_until = now + ARM_SECONDS
            to_send = remainder or ""
            if not to_send:
                log("armed (heard my name) — listening…")
                continue
        else:
            to_send = text
            armed_until = now + ARM_SECONDS   # keep the conversation alive

        log(f"heard: {to_send!r}")
        forward(to_send)

    if proc is not None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())

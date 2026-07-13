// Shared Web Audio API amplitude analyzer — one singleton per tab.
//
// Usage:
//   attachAmplitudeAnalyser(audioElement)  — call before .play()
//   readAmplitude()                        — returns 0-1 from any RAF callback

let _audioCtx: AudioContext | null = null;
let _analyser: AnalyserNode | null = null;
let _dataArr: Uint8Array<ArrayBuffer> | null = null;

const _attached = new WeakSet<HTMLAudioElement>();
const _sources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

function ensureAnalyser(): boolean {
  try {
    if (_audioCtx) return true;
    _audioCtx = new AudioContext();
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 256;
    _analyser.smoothingTimeConstant = 0.82;
    _analyser.connect(_audioCtx.destination);
    _dataArr = new Uint8Array(_analyser.frequencyBinCount);
    return true;
  } catch {
    return false;
  }
}

export function attachAmplitudeAnalyser(audio: HTMLAudioElement): void {
  try {
    if (_attached.has(audio)) {
      if (_audioCtx?.state === "suspended") void _audioCtx.resume();
      return;
    }
    if (!ensureAnalyser()) return;
    if (_audioCtx!.state === "suspended") void _audioCtx!.resume();
    const src = _audioCtx!.createMediaElementSource(audio);
    src.connect(_analyser!);
    _attached.add(audio);
    _sources.set(audio, src);
    const cleanup = () => {
      try { src.disconnect(); } catch { /* already disconnected */ }
      audio.removeEventListener("ended", cleanup);
      audio.removeEventListener("error", cleanup);
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
  } catch {
  }
}

export function readAmplitude(): number {
  if (!_analyser || !_dataArr) return 0;
  _analyser.getByteFrequencyData(_dataArr);
  let sum = 0;
  for (let i = 0; i < _dataArr.length; i++) sum += _dataArr[i]!;
  return sum / (_dataArr.length * 255);
}

// Tiny WebAudio sound kit — no asset files, everything synthesized.

const KEY = 'ftn-muted';
let muted = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
let ctx: AudioContext | null = null;

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function ding(c: AudioContext, freq: number, start: number, dur: number, gain: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur);
}

/** Bright two-tone bell slap. */
export function playBell() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  ding(c, 1318.5, t, 0.5, 0.35); // E6
  ding(c, 1976.0, t, 0.4, 0.18); // B6 shimmer
}

/** Soft pencil-scratch tick — played for each box scribbled in while holding. */
export function playScribble() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const dur = 0.07;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = 1 - i / data.length; // quick decay
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1700;
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.value = 0.22;
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

/** Win = rising arpeggio, loss = falling. */
export function playEnd(win: boolean) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 523.25, 392.0, 329.63];
  notes.forEach((f, i) => ding(c, f, t + i * 0.12, 0.25, 0.3));
}

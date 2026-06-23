// Generate a license-free chiptune loop as a 16-bit PCM WAV — no asset files,
// no external libraries. On-brand with the app's synthesized WebAudio kit
// (client/src/audio.ts): square-wave lead + bass over an upbeat I–V–vi–IV
// progression, with a soft noise hat. Output is meant to be looped under the
// trailer by ffmpeg (which handles trim + fades to the exact video length).
//
//   node tools/make-chiptune.mjs [outPath]
//
// Default out: tools/.trailer-build/chiptune.wav

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SR = 44100; // sample rate
const BPM = 132;
const beat = 60 / BPM; // seconds per beat
const bar = beat * 4;

// Equal-tempered note frequencies. n = semitones from A4 (440).
const f = (n) => 440 * Math.pow(2, n / 12);
// Named notes we use (semitones relative to A4).
const N = {
  C3: -21, E3: -17, G3: -14, A2: -24, F3: -16, D3: -19,
  C4: -9, D4: -7, E4: -5, F4: -4, G4: -2, A4: 0, B4: 2,
  C5: 3, D5: 5, E5: 7, G5: 10,
};

// I–V–vi–IV in C: C major, G major, A minor, F major. One chord per bar.
const chords = [
  { bass: N.C3, arp: [N.C4, N.E4, N.G4, N.C5] },
  { bass: N.G3, arp: [N.D4, N.G4, N.B4, N.D5] },
  { bass: N.A2, arp: [N.C4, N.E4, N.A4, N.E4] },
  { bass: N.F3, arp: [N.C4, N.F4, N.A4, N.C5] },
];

// A bright lead melody (8 bars), scale-degree hops over the progression.
// Each entry: [semitone, beats]. null = rest.
const melody = [
  [N.G4, 1], [N.E4, 0.5], [N.G4, 0.5], [N.C5, 1], [N.B4, 1],
  [N.D5, 1], [N.B4, 0.5], [N.G4, 0.5], [N.A4, 2],
  [N.A4, 1], [N.C5, 0.5], [N.E5, 0.5], [N.D5, 1], [N.C5, 1],
  [N.G4, 1], [N.A4, 0.5], [N.G4, 0.5], [N.F4, 2],
  [N.G4, 1], [N.E4, 0.5], [N.G4, 0.5], [N.C5, 1], [N.B4, 1],
  [N.D5, 1], [N.G5, 0.5], [N.E5, 0.5], [N.D5, 2],
  [N.C5, 1], [N.A4, 0.5], [N.C5, 0.5], [N.G4, 1], [N.E4, 1],
  [N.F4, 1.5], [N.G4, 0.5], [N.C5, 2],
];

const LOOP_BARS = 8;
const totalSec = bar * LOOP_BARS;
const totalSamples = Math.ceil(totalSec * SR);
const buf = new Float32Array(totalSamples);

// --- simple synth voices ---------------------------------------------------
function square(t, freq, duty = 0.5) {
  const phase = (t * freq) % 1;
  return phase < duty ? 1 : -1;
}
function triangle(t, freq) {
  const phase = (t * freq) % 1;
  return 4 * Math.abs(phase - 0.5) - 1;
}
// Short percussive envelope (fast attack, exp decay).
function env(tIn, dur, attack = 0.005, release = 0.06) {
  if (tIn < 0 || tIn > dur) return 0;
  const a = Math.min(1, tIn / attack);
  const rStart = dur - release;
  const r = tIn > rStart ? Math.max(0, 1 - (tIn - rStart) / release) : 1;
  return a * r;
}

function addVoice(startSec, durSec, freq, gain, kind) {
  const s0 = Math.floor(startSec * SR);
  const s1 = Math.min(totalSamples, Math.ceil((startSec + durSec) * SR));
  for (let i = s0; i < s1; i++) {
    const t = i / SR;
    const tIn = t - startSec;
    const e = env(tIn, durSec);
    if (e <= 0) continue;
    let v;
    if (kind === 'lead') v = square(t, freq, 0.5);
    else if (kind === 'bass') v = triangle(t, freq);
    else v = square(t, freq, 0.25);
    buf[i] += v * gain * e;
  }
}

function addHat(startSec, durSec, gain) {
  const s0 = Math.floor(startSec * SR);
  const s1 = Math.min(totalSamples, Math.ceil((startSec + durSec) * SR));
  for (let i = s0; i < s1; i++) {
    const tIn = i / SR - startSec;
    const e = env(tIn, durSec, 0.001, durSec * 0.9);
    buf[i] += (Math.random() * 2 - 1) * gain * e;
  }
}

// --- arrange ---------------------------------------------------------------
for (let b = 0; b < LOOP_BARS; b++) {
  const chord = chords[b % chords.length];
  const barStart = b * bar;
  // bass: root on each beat, octave-bounce feel
  for (let q = 0; q < 4; q++) {
    addVoice(barStart + q * beat, beat * 0.9, f(chord.bass), 0.22, 'bass');
  }
  // arp: sixteenth-ish pulses cycling the chord tones
  const arpStep = beat / 2;
  for (let s = 0; s < 8; s++) {
    const note = chord.arp[s % chord.arp.length];
    addVoice(barStart + s * arpStep, arpStep * 0.8, f(note), 0.07, 'arp');
  }
  // hat: offbeat eighths
  for (let h = 0; h < 8; h++) {
    if (h % 2 === 1) addHat(barStart + h * (beat / 2), 0.04, 0.05);
  }
}

// lead melody on top
let cursor = 0;
for (const [note, beats] of melody) {
  const dur = beats * beat;
  if (note !== null) addVoice(cursor, dur * 0.92, f(note), 0.16, 'lead');
  cursor += dur;
}

// --- soft-clip + normalize -------------------------------------------------
let peak = 0;
for (let i = 0; i < totalSamples; i++) {
  buf[i] = Math.tanh(buf[i] * 1.1); // gentle saturation, glues the chiptune
  if (Math.abs(buf[i]) > peak) peak = Math.abs(buf[i]);
}
const norm = peak > 0 ? 0.89 / peak : 1;

// --- write 16-bit mono WAV -------------------------------------------------
const bytesPerSample = 2;
const dataSize = totalSamples * bytesPerSample;
const out = Buffer.alloc(44 + dataSize);
out.write('RIFF', 0);
out.writeUInt32LE(36 + dataSize, 4);
out.write('WAVE', 8);
out.write('fmt ', 12);
out.writeUInt32LE(16, 16); // PCM chunk size
out.writeUInt16LE(1, 20); // PCM
out.writeUInt16LE(1, 22); // mono
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * bytesPerSample, 28); // byte rate
out.writeUInt16LE(bytesPerSample, 32); // block align
out.writeUInt16LE(16, 34); // bits per sample
out.write('data', 36);
out.writeUInt32LE(dataSize, 40);
for (let i = 0; i < totalSamples; i++) {
  const v = Math.max(-1, Math.min(1, buf[i] * norm));
  out.writeInt16LE((v * 32767) | 0, 44 + i * bytesPerSample);
}

const outPath = resolve(process.argv[2] || 'tools/.trailer-build/chiptune.wav');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log(`chiptune: ${outPath} (${totalSec.toFixed(1)}s loop, ${(out.length / 1024).toFixed(0)} KB)`);

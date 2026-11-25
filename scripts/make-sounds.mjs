// Synthesises Interval's timer sounds into public/sounds/*.wav.
// Original sounds, generated from scratch by this script (no samples): soft mallet and bell tones,
// quiet by design (peak about -18 dBFS). Run: node scripts/make-sounds.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const RATE = 24000;
const PEAK = 0.125; // ~ -18 dBFS

// Partials: [frequency ratio, amplitude, decay time constant in seconds]
const BELL = [
  [1, 1, 1.1],
  [2.0, 0.32, 0.7],
  [2.76, 0.16, 0.45],
  [5.4, 0.05, 0.22],
];
const MALLET = [
  [1, 1, 0.42],
  [3.93, 0.18, 0.12],
  [9.2, 0.04, 0.05],
];
const SOFT = [
  [1, 1, 0.9],
  [2, 0.12, 0.5],
  [3, 0.04, 0.3],
];

const hz = (note) => 440 * 2 ** ((note - 69) / 12); // MIDI note -> Hz

function render(seconds, notes) {
  const n = Math.round(seconds * RATE);
  const out = new Float64Array(n);
  for (const { midi, at, gain = 1, voice } of notes) {
    const f0 = hz(midi);
    const start = Math.round(at * RATE);
    for (const [ratio, amp, tau] of voice) {
      const f = f0 * ratio;
      if (f > RATE / 2.2) continue;
      for (let i = start; i < n; i++) {
        const t = (i - start) / RATE;
        const attack = Math.min(1, t / 0.006); // 6 ms: soft, no click
        const env = attack * Math.exp(-t / (tau * (seconds > 2 ? 1.4 : 1)));
        if (env < 1e-5 && t > 0.05) break;
        out[i] += gain * amp * env * Math.sin(2 * Math.PI * f * t);
      }
    }
  }
  // Gentle one-pole low-pass for warmth, then a short fade-out and normalisation.
  let y = 0;
  const a = Math.exp((-2 * Math.PI * 5200) / RATE);
  for (let i = 0; i < n; i++) out[i] = y = (1 - a) * out[i] + a * y;
  const fade = Math.round(0.08 * RATE);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  const max = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return out.map((v) => (v / max) * PEAK);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const SOUNDS = {
  // Two soft mallet taps, rising a fifth: "let's go", quietly.
  "focus-start": render(1.1, [
    { midi: 74, at: 0, voice: MALLET, gain: 0.8 },
    { midi: 81, at: 0.11, voice: MALLET },
  ]),
  // A warm major-third bell pair: done, well spent.
  "focus-end": render(2.6, [
    { midi: 69, at: 0, voice: BELL },
    { midi: 73, at: 0.16, voice: BELL, gain: 0.8 },
    { midi: 76, at: 0.32, voice: BELL, gain: 0.55 },
  ]),
  // One low, round tone: step away.
  "break-start": render(1.8, [{ midi: 64, at: 0, voice: SOFT }]),
  // Two brighter mallet notes, rising: back to it.
  "break-end": render(1.6, [
    { midi: 76, at: 0, voice: MALLET, gain: 0.8 },
    { midi: 83, at: 0.13, voice: MALLET },
    { midi: 88, at: 0.26, voice: SOFT, gain: 0.25 },
  ]),
  // Unhurried arpeggio for a finished cycle.
  "cycle-end": render(3.4, [
    { midi: 69, at: 0, voice: BELL },
    { midi: 73, at: 0.18, voice: BELL, gain: 0.85 },
    { midi: 76, at: 0.36, voice: BELL, gain: 0.7 },
    { midi: 81, at: 0.6, voice: BELL, gain: 0.6 },
  ]),
};

const dir = new URL("../public/sounds/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, samples] of Object.entries(SOUNDS)) {
  writeFileSync(new URL(`${name}.wav`, dir), wav(samples));
  console.log(`${name}.wav  ${(samples.length / RATE).toFixed(1)} s`);
}

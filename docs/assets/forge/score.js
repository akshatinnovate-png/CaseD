// The generative soundtrack, in the browser.
//
// A direct port of cased/score.py, drawing from the same Python-compatible
// RNG, so a given seed produces the same track on the web as it does from the
// CLI. That matters because the scorer is the clock of the whole pipeline: it
// picks the tempo and hands back a beat map, and the composer cuts the picture
// to that map. If the web preview scored differently, the film you previewed
// would not be the film the CLI renders.
//
// Verified sample-against-sample with scripts/check_score.mjs.

import { PyRandom } from './random.js';

export const SR = 44100;
const TWO_PI = Math.PI * 2;

export const SCALES = {
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  major:      [0, 2, 4, 5, 7, 9, 11],
};

// mood -> [[bpm lo, hi], scale, chord degrees, brightness, drive]
export const MOODS = {
  cinematic:  [[88, 100],  'minor',      [0, 5, 3, 4], 0.55, 0.30],
  hype:       [[124, 136], 'phrygian',   [0, 6, 5, 4], 0.85, 0.60],
  retro:      [[112, 120], 'mixolydian', [0, 3, 4, 3], 0.70, 0.45],
  brutalist:  [[128, 140], 'minor',      [0, 0, 5, 5], 0.95, 0.75],
  warm:       [[92, 104],  'dorian',     [0, 3, 5, 4], 0.45, 0.20],
  triumphant: [[104, 116], 'lydian',     [0, 4, 5, 3], 0.75, 0.40],
};

const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);
const buf = n => new Float64Array(n);

/** Mix src into dst at a sample offset, stopping at the end of dst. */
function add(dst, src, at) {
  const n = dst.length;
  const end = Math.min(src.length, n - at);
  for (let i = Math.max(0, -at); i < end; i++) dst[at + i] += src[i];
}

// ------------------------------------------------------------------ voices

function vKick(dur, gain = 1) {
  const n = (dur * SR) | 0, out = buf(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 48 + 92 * Math.exp(-t * 34);
    phase += TWO_PI * f / SR;
    const env = Math.exp(-t * 7.2);
    const click = Math.exp(-t * 420) * 0.45;
    out[i] = Math.tanh((Math.sin(phase) * env + click) * 2.1) * 0.62 * gain;
  }
  return out;
}

function vSnare(dur, rng, gain = 1) {
  const n = (dur * SR) | 0, out = buf(n);
  let lp = 0, phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const noise = rng.uniform(-1, 1);
    lp += (noise - lp) * 0.55;             // tame the very top
    const body = noise - lp;               // high-passed hiss
    phase += TWO_PI * 185 / SR;
    const tone = Math.sin(phase) * Math.exp(-t * 36) * 0.5;
    const env = Math.exp(-t * 19);
    out[i] = (body * env * 0.85 + tone) * 0.5 * gain;
  }
  return out;
}

function vHat(dur, rng, gain = 1, open = false) {
  const n = (dur * SR) | 0, out = buf(n);
  let prev = 0;
  const decay = open ? 9 : 34;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const noise = rng.uniform(-1, 1);
    const hp = noise - prev;               // 1-pole high pass
    prev = noise;
    out[i] = hp * Math.exp(-t * decay) * 0.17 * gain;
  }
  return out;
}

function vBass(freq, dur, gain = 1, drive = 0.4) {
  const n = (dur * SR) | 0, out = buf(n);
  let phase = 0, lp = 0;
  const inc = freq / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase = (phase + inc) % 1;
    const saw = 2 * phase - 1;
    const sub = Math.sin(TWO_PI * phase) * 0.8;
    const cutoff = 0.035 + 0.16 * Math.exp(-t * 9);
    lp += ((saw * 0.55 + sub) - lp) * cutoff;
    const env = Math.min(1, t * 220) * Math.exp(-t * 3.1);
    out[i] = Math.tanh(lp * (1 + drive * 2.4)) * env * 0.4 * gain;
  }
  return out;
}

/** Karplus-Strong. Cheap, and it sounds like a real string. */
function vPluck(freq, dur, rng, gain = 1, bright = 0.6) {
  const n = (dur * SR) | 0, out = buf(n);
  const L = Math.max(2, (SR / Math.max(freq, 20)) | 0);
  const ring = new Float64Array(L);
  for (let i = 0; i < L; i++) ring[i] = rng.uniform(-1, 1);
  const damp = 0.492 + 0.0075 * bright;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % L];
    ring[idx] = (cur + nxt) * damp;
    idx = (idx + 1) % L;
    out[i] = cur * Math.exp(-i / SR * 2.6) * 0.3 * gain;
  }
  return out;
}

/** Detuned saw stack, slow attack, gentle low pass. The emotional bed. */
function vPad(freqs, dur, gain = 1, bright = 0.5) {
  const n = (dur * SR) | 0, out = buf(n);
  const inc = [], ph = [];
  for (const f of freqs) {
    for (const det of [-0.09, 0, 0.11]) { inc.push((f * (1 + det / 100)) / SR); ph.push(0); }
  }
  let lp = 0;
  const cutoff = 0.020 + 0.055 * bright;
  const atk = dur * 0.30, rel = dur * 0.42;
  const invV = 1 / inc.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let acc = 0;
    for (let v = 0; v < inc.length; v++) {
      ph[v] = (ph[v] + inc[v]) % 1;
      acc += 2 * ph[v] - 1;
    }
    lp += (acc * invV - lp) * cutoff;
    let env;
    if (t < atk) env = t / atk;
    else if (t > dur - rel) env = Math.max(0, (dur - t) / rel);
    else env = 1;
    out[i] = lp * Math.pow(env, 1.7) * 0.2 * gain;
  }
  return out;
}

function vRiser(dur, rng, gain = 1) {
  const n = (dur * SR) | 0, out = buf(n);
  let phase = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, p = t / dur;
    const f = 180 * Math.pow(2, p * 4.2);
    phase += TWO_PI * f / SR;
    const noise = rng.uniform(-1, 1);
    const hp = noise - prev;
    prev = noise;
    out[i] = (Math.sin(phase) * 0.35 + hp * 0.5) * Math.pow(p, 2.4) * 0.26 * gain;
  }
  return out;
}

function vImpact(dur, rng, gain = 1) {
  const n = (dur * SR) | 0, out = buf(n);
  let phase = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 68 * Math.exp(-t * 2.4) + 26;
    phase += TWO_PI * f / SR;
    const noise = rng.uniform(-1, 1);
    lp += (noise - lp) * 0.09;
    const env = Math.exp(-t * 3.4);
    out[i] = (Math.sin(phase) * 0.9 + lp * 0.7) * env * 0.5 * gain;
  }
  return out;
}

// --------------------------------------------------------- bus processing

/** Schroeder-style: four parallel combs, two series all-passes. */
function reverb(b, mix = 0.22, decay = 0.76) {
  const n = b.length;
  const combs = [[1557, decay], [1617, decay - 0.014], [1491, decay - 0.028], [1422, decay - 0.042]];
  const wet = buf(n);
  for (const [delay, fb] of combs) {
    const state = new Float64Array(delay);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const y = state[idx];
      state[idx] = b[i] + y * fb;
      idx = idx + 1 < delay ? idx + 1 : 0;
      wet[i] += y * 0.25;
    }
  }
  for (const [delay, g] of [[225, 0.5], [556, 0.5]]) {
    const state = new Float64Array(delay);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const y = state[idx], x = wet[i];
      state[idx] = x + y * g;
      idx = idx + 1 < delay ? idx + 1 : 0;
      wet[i] = y - g * x;
    }
  }
  for (let i = 0; i < n; i++) b[i] = b[i] * (1 - mix * 0.45) + wet[i] * mix;
}

/** Duck the bus under every kick -- the pump that makes it feel modern. */
function sidechain(b, hits, amount = 0.55, release = 0.26) {
  const n = b.length;
  const env = new Float64Array(n).fill(1);
  const relN = Math.max(1, (release * SR) | 0);
  for (const h of hits) {
    const start = (h * SR) | 0;
    if (start >= n) continue;
    const lim = Math.min(relN, n - start);
    for (let k = 0; k < lim; k++) {
      const g = 1 - amount * Math.pow(1 - k / relN, 1.6);
      if (g < env[start + k]) env[start + k] = g;
    }
  }
  for (let i = 0; i < n; i++) b[i] *= env[i];
}

function limit(b, ceiling = 0.94) {
  let peak = 0;
  for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > peak) peak = a; }
  if (peak <= 1e-9) return;
  // Normalise up to the ceiling first, then soft-clip the transients that poke
  // through. Without the normalise step a sparse arrangement renders several
  // dB quiet and the film sounds timid next to anything else.
  const pre = ceiling / peak;
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * pre * 1.18) * ceiling;
}

function fade(b, inS = 0.04, outS = 1.3) {
  const n = b.length;
  const a = (inS * SR) | 0, c = (outS * SR) | 0;
  for (let i = 0; i < Math.min(a, n); i++) b[i] *= i / a;
  for (let i = 0; i < Math.min(c, n); i++) b[n - 1 - i] *= Math.pow(i / c, 0.8);
}

// ------------------------------------------------------------ arrangement

const round4 = v => Math.round(v * 1e4) / 1e4;

function split(total) {
  if (total <= 6) return [['peak', 0, total]];
  // Python's round() is banker's rounding, and these products land on .5
  // often enough that a naive round shifts a section by a whole bar.
  const rnd = v => {
    const f = Math.floor(v), d = v - f;
    if (Math.abs(d - 0.5) > 1e-9) return Math.round(v);
    return f % 2 === 0 ? f : f + 1;
  };
  const a = Math.max(1, rnd(total * 0.18));
  const b = Math.max(1, rnd(total * 0.26));
  const d = Math.max(1, rnd(total * 0.18));
  const c = Math.max(1, total - a - b - d);
  return [['intro', 0, a], ['build', a, b], ['peak', a + b, c], ['resolve', a + b + c, d]];
}

/**
 * Render the track. Returns { bus, beatmap } — the mono bus as Float64 and the
 * map the composer snaps every cut to.
 */
export function composeScore(duration, mood = 'cinematic', seed = 0, intensity = 1) {
  const rng = new PyRandom(seed || 1);
  const [[bpmLo, bpmHi], scaleName, chordDegs, bright, drive] = MOODS[mood] || MOODS.cinematic;

  const bpm = rng.randint(bpmLo, bpmHi);
  const spb = 60 / bpm;
  const bar = spb * 4;
  const scale = SCALES[scaleName];
  const root = rng.choice([45, 47, 48, 50, 52]);

  const totalBars = Math.max(4, Math.ceil(duration / bar));
  const n = ((totalBars * bar + 2) * SR) | 0;

  const sections = split(totalBars);
  const bus = buf(n);
  const kickTimes = [];
  const accents = [];
  const barsT = Array.from({ length: totalBars + 1 }, (_, i) => i * bar);
  const beatsT = Array.from({ length: totalBars * 4 + 1 }, (_, i) => i * spb);

  const WEIGHT = { intro: 0.5, build: 0.7, peak: 1.0, resolve: 0.6 };
  const ENERGY = { intro: 0.35, build: 0.62, peak: 1.0, resolve: 0.5 };

  for (const [name, startBar, length] of sections) {
    const secT = startBar * bar;
    accents.push({ time: round4(secT), kind: name, weight: WEIGHT[name] });
    const energy = ENERGY[name] * intensity;
    let chordI = 0;

    for (let b = 0; b < length; b++) {
      const bt = secT + b * bar;
      const deg = chordDegs[chordI % chordDegs.length];
      chordI++;
      const chordRoot = root + scale[deg % scale.length] + 12 * Math.floor(deg / scale.length);

      // --- pad: one chord per bar
      const triad = [chordRoot,
                     chordRoot + scale[(deg + 2) % scale.length] - scale[deg % scale.length],
                     chordRoot + 7];
      add(bus, vPad(triad.map(m => midiHz(m + 12)), bar * 1.02,
                    0.9 * (0.5 + energy * 0.7), bright * energy), (bt * SR) | 0);

      // --- bass: root on 1, plus a push on the "and" of 3
      if (name !== 'intro' || b > 0) {
        add(bus, vBass(midiHz(chordRoot - 12), spb * 1.9, 0.9 * energy, drive), (bt * SR) | 0);
        if (energy > 0.55) {
          add(bus, vBass(midiHz(chordRoot - 12), spb * 0.85, 0.7 * energy, drive),
              ((bt + spb * 2.5) * SR) | 0);
        }
      }

      // --- drums
      let pattern;
      if (name === 'intro') pattern = [0, 2];
      else if (name === 'build') pattern = b % 2 ? [0, 1.5, 2, 3.5] : [0, 2, 3];
      else if (name === 'peak') pattern = b % 4 !== 3 ? [0, 1, 2, 3] : [0, 1, 2, 2.75, 3.5];
      else pattern = [0, 2];

      for (const off of pattern) {
        const kt = bt + off * spb;
        if (kt < duration + bar) {
          add(bus, vKick(0.42, 0.95 * (0.6 + energy * 0.5)), (kt * SR) | 0);
          kickTimes.push(kt);
        }
      }

      if (name === 'build' || name === 'peak' || name === 'resolve') {
        for (const off of [1, 3]) {
          add(bus, vSnare(0.30, rng, 0.8 * energy), ((bt + off * spb) * SR) | 0);
        }
      }

      if (name === 'build' || name === 'peak') {
        const step = name === 'peak' ? 0.5 : 1.0;
        for (let k = 0; k < 4.0; k += step) {
          const openish = name === 'peak' && Math.abs(k - 3.5) < 1e-6;
          add(bus, vHat(openish ? 0.34 : 0.14, rng,
                        (k % 1 === 0 ? 0.85 : 0.5) * energy, openish),
              ((bt + k * spb) * SR) | 0);
        }
      }

      // --- melody: a plucked arpeggio over the chord
      if (name === 'build' || name === 'peak' || name === 'resolve') {
        const steps = name === 'peak' ? [0, 2, 4, 2, 5, 4, 2, 0] : [0, 4, 2, 4];
        const per = 4.0 / steps.length;
        for (let si = 0; si < steps.length; si++) {
          if (name !== 'peak' && rng.random() < 0.25) continue;
          const m = chordRoot + 12 + scale[(deg + steps[si]) % scale.length]
                  - scale[deg % scale.length];
          add(bus, vPluck(midiHz(m + 12), per * spb * 1.6, rng, 0.75 * energy, bright),
              ((bt + si * per * spb) * SR) | 0);
        }
      }
    }

    // --- transition FX into the next section
    const nxt = startBar + length;
    if (nxt < totalBars) {
      add(bus, vRiser(bar * 1.5, rng, 0.8 * intensity),
          (Math.max(0, nxt * bar - bar * 1.5) * SR) | 0);
      add(bus, vImpact(1.6, rng, 0.9 * intensity), ((nxt * bar) * SR) | 0);
      accents.push({ time: round4(nxt * bar), kind: 'impact', weight: 1.0 });
    }
  }

  sidechain(bus, kickTimes, 0.42 + 0.18 * intensity);
  reverb(bus, (mood === 'cinematic' || mood === 'warm') ? 0.26 : 0.17);
  fade(bus, 0.05, Math.min(1.6, duration * 0.14));
  limit(bus);

  const beatmap = {
    bpm, spb: Math.round(spb * 1e6) / 1e6, bar: Math.round(bar * 1e6) / 1e6,
    scale: scaleName, root_midi: root, duration: round4(n / SR),
    bars: barsT.map(round4), beats: beatsT.map(round4),
    kicks: [...new Set(kickTimes)].sort((a, b) => a - b).map(round4),
    accents: accents.slice().sort((a, b) => a.time - b.time),
    sections: sections.map(s => ({ name: s[0], start: round4(s[1] * bar), bars: s[2] })),
  };
  return { bus, beatmap };
}

// ----------------------------------------------------------------- output

/** Mono bus -> lightly widened stereo, as interleaved 16-bit PCM. */
export function toStereo16(bus, width = 0.35) {
  const n = bus.length;
  const out = new Int16Array(n * 2);
  const delay = (0.011 * SR) | 0;
  for (let i = 0; i < n; i++) {
    const m = bus[i];
    const s = i >= delay ? bus[i - delay] : 0;
    const l = Math.max(-1, Math.min(1, m * (1 - width * 0.3) + s * width));
    const r = Math.max(-1, Math.min(1, m * (1 - width * 0.3) - s * width * 0.82));
    // Python packs with int(), which truncates toward zero rather than rounding.
    out[i * 2] = Math.trunc(l * 32000);
    out[i * 2 + 1] = Math.trunc(r * 32000);
  }
  return out;
}

/** A complete 16-bit stereo WAV, ready for a Blob or for muxing. */
export function wavBytes(bus, width = 0.35) {
  const pcm = toStereo16(bus, width);
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(bytes.buffer);
  const tag = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true);
  dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  tag(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(bytes.buffer, 44).set(pcm);
  return bytes;
}

/** The same track as an AudioBuffer, for preview and for MediaRecorder. */
export function toAudioBuffer(ctx, bus, width = 0.35) {
  const n = bus.length;
  const ab = ctx.createBuffer(2, n, SR);
  const L = ab.getChannelData(0), R = ab.getChannelData(1);
  const delay = (0.011 * SR) | 0;
  for (let i = 0; i < n; i++) {
    const m = bus[i];
    const s = i >= delay ? bus[i - delay] : 0;
    L[i] = Math.max(-1, Math.min(1, m * (1 - width * 0.3) + s * width));
    R[i] = Math.max(-1, Math.min(1, m * (1 - width * 0.3) - s * width * 0.82));
  }
  return ab;
}

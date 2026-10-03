"""
cased2.0 / score
================

A generative soundtrack, written from first principles in the standard
library. No bundled music, no licences to chase, no two films alike.

The scorer is the *clock* of the whole pipeline: it decides the tempo and
the arrangement, then hands back a beat map. The composer cuts the picture
to that map, so every shot change lands on a musical event.

Signal chain per track:
    voices -> bus -> sidechain duck -> feedback-delay reverb -> soft limiter
"""

from __future__ import annotations

import array
import json
import math
import random
import struct
import wave
from pathlib import Path

SR = 44100
TWO_PI = math.pi * 2.0

# ---------------------------------------------------------------------------
# Musical material
# ---------------------------------------------------------------------------

SCALES = {
    "minor":      [0, 2, 3, 5, 7, 8, 10],
    "dorian":     [0, 2, 3, 5, 7, 9, 10],
    "lydian":     [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "phrygian":   [0, 1, 3, 5, 7, 8, 10],
    "major":      [0, 2, 4, 5, 7, 9, 11],
}

# mood -> (bpm range, scale, chord degrees, brightness, drive)
MOODS = {
    "cinematic":  ((88, 100),  "minor",      [0, 5, 3, 4], 0.55, 0.30),
    "hype":       ((124, 136), "phrygian",   [0, 6, 5, 4], 0.85, 0.60),
    "retro":      ((112, 120), "mixolydian", [0, 3, 4, 3], 0.70, 0.45),
    "brutalist":  ((128, 140), "minor",      [0, 0, 5, 5], 0.95, 0.75),
    "warm":       ((92, 104),  "dorian",     [0, 3, 5, 4], 0.45, 0.20),
    "triumphant": ((104, 116), "lydian",     [0, 4, 5, 3], 0.75, 0.40),
}


def midi_hz(n: float) -> float:
    return 440.0 * (2.0 ** ((n - 69.0) / 12.0))


# ---------------------------------------------------------------------------
# Buffer helpers
# ---------------------------------------------------------------------------


def _buf(n: int) -> array.array:
    return array.array("d", bytes(8 * n))


def _add(dst: array.array, src, at: int) -> None:
    n = len(dst)
    for i, v in enumerate(src):
        j = at + i
        if 0 <= j < n:
            dst[j] += v
        elif j >= n:
            break


# ---------------------------------------------------------------------------
# Voices
# ---------------------------------------------------------------------------


def v_kick(dur: float, gain: float = 1.0) -> array.array:
    """Pitch-swept sine with a click transient, soft-saturated."""
    n = int(dur * SR)
    out = _buf(n)
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = 48.0 + 92.0 * math.exp(-t * 34.0)
        phase += TWO_PI * f / SR
        env = math.exp(-t * 7.2)
        click = math.exp(-t * 420.0) * 0.45
        s = math.sin(phase) * env + click
        out[i] = math.tanh(s * 2.1) * 0.62 * gain
    return out


def v_snare(dur: float, rng: random.Random, gain: float = 1.0) -> array.array:
    n = int(dur * SR)
    out = _buf(n)
    lp = 0.0
    phase = 0.0
    for i in range(n):
        t = i / SR
        noise = rng.uniform(-1.0, 1.0)
        lp += (noise - lp) * 0.55                     # tame the very top
        body = noise - lp                             # high-passed hiss
        phase += TWO_PI * 185.0 / SR
        tone = math.sin(phase) * math.exp(-t * 36.0) * 0.5
        env = math.exp(-t * 19.0)
        out[i] = (body * env * 0.85 + tone) * 0.5 * gain
    return out


def v_hat(dur: float, rng: random.Random, gain: float = 1.0, open_: bool = False) -> array.array:
    n = int(dur * SR)
    out = _buf(n)
    prev = 0.0
    decay = 34.0 if not open_ else 9.0
    for i in range(n):
        t = i / SR
        noise = rng.uniform(-1.0, 1.0)
        hp = noise - prev                             # 1-pole high pass
        prev = noise
        out[i] = hp * math.exp(-t * decay) * 0.17 * gain
    return out


def v_bass(freq: float, dur: float, gain: float = 1.0, drive: float = 0.4) -> array.array:
    """Saw through an enveloped one-pole low pass -- the classic sub-growl."""
    n = int(dur * SR)
    out = _buf(n)
    phase = 0.0
    lp = 0.0
    inc = freq / SR
    for i in range(n):
        t = i / SR
        phase = (phase + inc) % 1.0
        saw = 2.0 * phase - 1.0
        sub = math.sin(TWO_PI * phase) * 0.8
        cutoff = 0.035 + 0.16 * math.exp(-t * 9.0)
        lp += ((saw * 0.55 + sub) - lp) * cutoff
        env = min(1.0, t * 220.0) * math.exp(-t * 3.1)
        out[i] = math.tanh(lp * (1.0 + drive * 2.4)) * env * 0.4 * gain
    return out


def v_pluck(freq: float, dur: float, rng: random.Random, gain: float = 1.0,
            bright: float = 0.6) -> array.array:
    """Karplus-Strong. Cheap, and it sounds like a real string."""
    n = int(dur * SR)
    out = _buf(n)
    L = max(2, int(SR / max(freq, 20.0)))
    buf = [rng.uniform(-1.0, 1.0) for _ in range(L)]
    damp = 0.492 + 0.0075 * bright
    idx = 0
    for i in range(n):
        cur = buf[idx]
        nxt = buf[(idx + 1) % L]
        val = (cur + nxt) * damp
        buf[idx] = val
        idx = (idx + 1) % L
        out[i] = cur * math.exp(-i / SR * 2.6) * 0.3 * gain
    return out


def v_pad(freqs: list, dur: float, gain: float = 1.0, bright: float = 0.5) -> array.array:
    """Detuned saw stack, slow attack, gentle low pass. The emotional bed."""
    n = int(dur * SR)
    out = _buf(n)
    voices = []
    for f in freqs:
        for det in (-0.09, 0.0, 0.11):
            voices.append([(f * (1.0 + det / 100.0)) / SR, 0.0])
    lp = 0.0
    cutoff = 0.020 + 0.055 * bright
    atk, rel = dur * 0.30, dur * 0.42
    inv_v = 1.0 / len(voices)
    for i in range(n):
        t = i / SR
        acc = 0.0
        for v in voices:
            v[1] = (v[1] + v[0]) % 1.0
            acc += 2.0 * v[1] - 1.0
        lp += (acc * inv_v - lp) * cutoff
        if t < atk:
            env = t / atk
        elif t > dur - rel:
            env = max(0.0, (dur - t) / rel)
        else:
            env = 1.0
        out[i] = lp * (env ** 1.7) * 0.2 * gain
    return out


def v_riser(dur: float, rng: random.Random, gain: float = 1.0) -> array.array:
    """Noise + sweeping sine that climbs into a section change."""
    n = int(dur * SR)
    out = _buf(n)
    phase = 0.0
    prev = 0.0
    for i in range(n):
        t = i / SR
        p = t / dur
        f = 180.0 * (2.0 ** (p * 4.2))
        phase += TWO_PI * f / SR
        noise = rng.uniform(-1.0, 1.0)
        hp = noise - prev
        prev = noise
        env = p ** 2.4
        out[i] = (math.sin(phase) * 0.35 + hp * 0.5) * env * 0.26 * gain
    return out


def v_impact(dur: float, rng: random.Random, gain: float = 1.0) -> array.array:
    """The hit on the downbeat of a new section."""
    n = int(dur * SR)
    out = _buf(n)
    phase = 0.0
    lp = 0.0
    for i in range(n):
        t = i / SR
        f = 68.0 * math.exp(-t * 2.4) + 26.0
        phase += TWO_PI * f / SR
        noise = rng.uniform(-1.0, 1.0)
        lp += (noise - lp) * 0.09
        env = math.exp(-t * 3.4)
        out[i] = (math.sin(phase) * 0.9 + lp * 0.7) * env * 0.5 * gain
    return out


# ---------------------------------------------------------------------------
# Bus processing
# ---------------------------------------------------------------------------


def reverb(buf: array.array, mix: float = 0.22, decay: float = 0.76) -> None:
    """Schroeder-style: four parallel combs, two series all-passes."""
    n = len(buf)
    combs = [(1557, decay), (1617, decay - 0.014), (1491, decay - 0.028), (1422, decay - 0.042)]
    wet = _buf(n)
    for delay, fb in combs:
        state = [0.0] * delay
        idx = 0
        for i in range(n):
            y = state[idx]
            state[idx] = buf[i] + y * fb
            idx = idx + 1 if idx + 1 < delay else 0
            wet[i] += y * 0.25
    for delay, g in ((225, 0.5), (556, 0.5)):
        state = [0.0] * delay
        idx = 0
        for i in range(n):
            y = state[idx]
            x = wet[i]
            state[idx] = x + y * g
            idx = idx + 1 if idx + 1 < delay else 0
            wet[i] = y - g * x
    for i in range(n):
        buf[i] = buf[i] * (1.0 - mix * 0.45) + wet[i] * mix


def sidechain(buf: array.array, hits: list, amount: float = 0.55,
              release: float = 0.26) -> None:
    """Duck the bus under every kick -- the pump that makes it feel modern."""
    n = len(buf)
    env = [1.0] * n
    rel_n = max(1, int(release * SR))
    for h in hits:
        start = int(h * SR)
        if start >= n:
            continue
        for k in range(min(rel_n, n - start)):
            g = 1.0 - amount * (1.0 - k / rel_n) ** 1.6
            if g < env[start + k]:
                env[start + k] = g
    for i in range(n):
        buf[i] *= env[i]


def limit(buf: array.array, ceiling: float = 0.94) -> None:
    peak = max((abs(v) for v in buf), default=0.0)
    if peak <= 1e-9:
        return
    # Normalise up to the ceiling first, then soft-clip the transients that
    # poke through. Without the normalise step a sparse arrangement renders
    # several dB quiet and the film sounds timid next to anything else.
    pre = ceiling / peak
    for i in range(len(buf)):
        buf[i] = math.tanh(buf[i] * pre * 1.18) * ceiling


def fade(buf: array.array, in_s: float = 0.04, out_s: float = 1.3) -> None:
    n = len(buf)
    a, b = int(in_s * SR), int(out_s * SR)
    for i in range(min(a, n)):
        buf[i] *= i / a
    for i in range(min(b, n)):
        buf[n - 1 - i] *= (i / b) ** 0.8


# ---------------------------------------------------------------------------
# Arrangement
# ---------------------------------------------------------------------------


def compose_score(duration: float, mood: str = "cinematic", seed: int = 0,
                  intensity: float = 1.0) -> tuple:
    """Render the track. Returns (mono_buffer, beatmap_dict)."""
    rng = random.Random(seed or 1)
    (bpm_lo, bpm_hi), scale_name, chord_degs, bright, drive = MOODS.get(
        mood, MOODS["cinematic"])

    bpm = rng.randint(bpm_lo, bpm_hi)
    spb = 60.0 / bpm                      # seconds per beat
    bar = spb * 4.0
    scale = SCALES[scale_name]
    root = rng.choice([45, 47, 48, 50, 52])   # A2..E3

    total_bars = max(4, int(math.ceil(duration / bar)))
    n = int((total_bars * bar + 2.0) * SR)

    # --- sections ----------------------------------------------------------
    # intro | build | peak | resolve, scaled to the available bars
    def split(total):
        if total <= 6:
            return [("peak", 0, total)]
        a = max(1, round(total * 0.18))
        b = max(1, round(total * 0.26))
        d = max(1, round(total * 0.18))
        c = max(1, total - a - b - d)
        return [("intro", 0, a), ("build", a, b), ("peak", a + b, c),
                ("resolve", a + b + c, d)]

    sections = split(total_bars)

    bus = _buf(n)
    kick_times: list = []
    accents: list = []
    bars_t = [i * bar for i in range(total_bars + 1)]
    beats_t = [i * spb for i in range(total_bars * 4 + 1)]

    for name, start_bar, length in sections:
        sec_t = start_bar * bar
        accents.append({"time": round(sec_t, 4), "kind": name,
                        "weight": {"intro": 0.5, "build": 0.7,
                                   "peak": 1.0, "resolve": 0.6}[name]})

        energy = {"intro": 0.35, "build": 0.62, "peak": 1.0, "resolve": 0.5}[name] * intensity
        chord_i = 0

        for b in range(length):
            bt = sec_t + b * bar
            deg = chord_degs[chord_i % len(chord_degs)]
            chord_i += 1
            chord_root = root + scale[deg % len(scale)] + 12 * (deg // len(scale))

            # --- pad: one chord per bar
            triad = [chord_root, chord_root + scale[(deg + 2) % len(scale)] - scale[deg % len(scale)],
                     chord_root + 7]
            _add(bus, v_pad([midi_hz(m + 12) for m in triad], bar * 1.02,
                            gain=0.9 * (0.5 + energy * 0.7), bright=bright * energy),
                 int(bt * SR))

            # --- bass: root on 1, plus a push on the "and" of 3
            if name != "intro" or b > 0:
                _add(bus, v_bass(midi_hz(chord_root - 12), spb * 1.9,
                                 gain=0.9 * energy, drive=drive),
                     int(bt * SR))
                if energy > 0.55:
                    _add(bus, v_bass(midi_hz(chord_root - 12), spb * 0.85,
                                     gain=0.7 * energy, drive=drive),
                         int((bt + spb * 2.5) * SR))

            # --- drums
            if name == "intro":
                pattern = [0.0, 2.0]
            elif name == "build":
                pattern = [0.0, 1.5, 2.0, 3.5] if b % 2 else [0.0, 2.0, 3.0]
            elif name == "peak":
                pattern = [0.0, 1.0, 2.0, 3.0] if b % 4 != 3 else [0.0, 1.0, 2.0, 2.75, 3.5]
            else:
                pattern = [0.0, 2.0]

            for off in pattern:
                kt = bt + off * spb
                if kt < duration + bar:
                    _add(bus, v_kick(0.42, gain=0.95 * (0.6 + energy * 0.5)), int(kt * SR))
                    kick_times.append(kt)

            if name in ("build", "peak", "resolve"):
                for off in (1.0, 3.0):
                    _add(bus, v_snare(0.30, rng, gain=0.8 * energy),
                         int((bt + off * spb) * SR))

            if name in ("build", "peak"):
                step = 0.5 if name == "peak" else 1.0
                k = 0.0
                while k < 4.0:
                    openish = (name == "peak" and abs(k - 3.5) < 1e-6)
                    _add(bus, v_hat(0.14 if not openish else 0.34, rng,
                                    gain=(0.85 if k % 1.0 == 0 else 0.5) * energy,
                                    open_=openish),
                         int((bt + k * spb) * SR))
                    k += step

            # --- melody: a plucked arpeggio over the chord
            if name in ("build", "peak", "resolve"):
                steps = [0, 2, 4, 2, 5, 4, 2, 0] if name == "peak" else [0, 4, 2, 4]
                per = 4.0 / len(steps)
                for si, sd in enumerate(steps):
                    if name != "peak" and rng.random() < 0.25:
                        continue
                    m = chord_root + 12 + scale[(deg + sd) % len(scale)] - scale[deg % len(scale)]
                    _add(bus, v_pluck(midi_hz(m + 12), per * spb * 1.6, rng,
                                      gain=0.75 * energy, bright=bright),
                         int((bt + si * per * spb) * SR))

        # --- transition FX into the next section
        nxt = start_bar + length
        if nxt < total_bars:
            _add(bus, v_riser(bar * 1.5, rng, gain=0.8 * intensity),
                 int(max(0.0, (nxt * bar - bar * 1.5)) * SR))
            _add(bus, v_impact(1.6, rng, gain=0.9 * intensity), int(nxt * bar * SR))
            accents.append({"time": round(nxt * bar, 4), "kind": "impact", "weight": 1.0})

    # --- bus chain ---------------------------------------------------------
    sidechain(bus, kick_times, amount=0.42 + 0.18 * intensity)
    reverb(bus, mix=0.26 if mood in ("cinematic", "warm") else 0.17)
    fade(bus, 0.05, min(1.6, duration * 0.14))
    limit(bus)

    beatmap = {
        "bpm": bpm,
        "spb": round(spb, 6),
        "bar": round(bar, 6),
        "scale": scale_name,
        "root_midi": root,
        "duration": round(n / SR, 4),
        "bars": [round(t, 4) for t in bars_t],
        "beats": [round(t, 4) for t in beats_t],
        "kicks": [round(t, 4) for t in sorted(set(kick_times))],
        "accents": sorted(accents, key=lambda a: a["time"]),
        "sections": [{"name": s[0], "start": round(s[1] * bar, 4),
                      "bars": s[2]} for s in sections],
    }
    return bus, beatmap


def write_wav(buf: array.array, path: Path, width: float = 0.35) -> None:
    """Mono bus -> lightly widened stereo 16-bit WAV."""
    n = len(buf)
    frames = bytearray(n * 4)
    delay = int(0.011 * SR)
    for i in range(n):
        m = buf[i]
        s = buf[i - delay] if i >= delay else 0.0
        l = max(-1.0, min(1.0, m * (1.0 - width * 0.3) + s * width))
        r = max(-1.0, min(1.0, m * (1.0 - width * 0.3) - s * width * 0.82))
        struct.pack_into("<hh", frames, i * 4, int(l * 32000), int(r * 32000))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def render(duration: float, out_wav: Path, mood: str = "cinematic",
           seed: int = 0, intensity: float = 1.0) -> dict:
    buf, beatmap = compose_score(duration, mood, seed, intensity)
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    write_wav(buf, out_wav)
    beatmap["file"] = out_wav.name
    return beatmap


if __name__ == "__main__":
    import sys
    dur = float(sys.argv[1]) if len(sys.argv) > 1 else 24.0
    mood = sys.argv[2] if len(sys.argv) > 2 else "cinematic"
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("score.wav")
    bm = render(dur, out, mood, seed=7)
    print(json.dumps({k: v for k, v in bm.items() if k not in ("beats", "bars", "kicks")}, indent=2))

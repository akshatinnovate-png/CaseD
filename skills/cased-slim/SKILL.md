---
name: cased-slim
description: Direct a launch film shot by shot without the analyzer or composer — you read the repo, you write the shot list, the engine renders it. Use when the user wants full control over the edit, when the automatic pipeline picked the wrong story, or when the project is unusual enough that heuristics will not serve it. Triggers on "/cased-slim", "direct it myself", "hand-write the shot list".
---

# cased-slim

Same renderer. No analyzer, no composer, no director presets.

You read the repository, you decide the story, and you write `spec.json`
yourself. Then one command renders it.

Use this when the full `/cased` pipeline mis-reads the project — an unusual
repo layout, a monorepo, a project whose real story is not in its file tree —
or when the user simply wants to direct.

## The shape of the job

1. **Read the repo.** README, entry point, the two or three files that carry
   the idea. Look for the hook, the proof and the surprise.
2. **Write a score.** The engine needs a beat map to cut against, and a WAV to
   mux. One command:

   ```bash
   python3 -m cased.score 24 cinematic cased-output/score.wav
   ```

   Moods: `cinematic` `hype` `retro` `brutalist` `warm` `triumphant`. It prints
   the beat map — note the BPM and the section times.

3. **Write `spec.json` by hand.** Full schema below.
4. **Render.**

   ```bash
   node cased/engine/render.mjs \
     --spec cased-output/spec.json \
     --out cased-output/cased.mp4 \
     --audio cased-output/score.wav \
     --quality high --poster cased-output/poster.png
   ```

## The spec

```json
{
  "version": "2.0",
  "project": "name on the end card",
  "seed": 1234,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "duration": 24.0,
  "theme": {
    "bg": "#06070C", "fg": "#FFFFFF",
    "accent": "#7C5CFF", "accent2": "#39D0FF",
    "grain": 0.055, "scanlines": false, "vignette": 1.0,
    "letterbox": true, "bg_mode": "aurora"
  },
  "shots": [
    { "type": "title", "start": 0.0, "dur": 3.1, "in": "cut",
      "bg": "aurora", "cam": "push", "energy": 0.5, "fx": ["motes"],
      "data": { "kicker": "owner/repo", "text": "The headline", "rule": true } }
  ]
}
```

Shot types and their `data`: see `../cased/references/shots.md`. Everything
there applies unchanged — this skill differs only in who writes the list.

## Rules that are not optional

- **`start + dur` must tile the runtime with no gaps and no overlaps.** The
  engine picks the first shot whose window contains `t`; a gap renders the
  previous shot frozen, an overlap silently drops one.
- **Land cuts on the beat.** Take `spb` (seconds per beat) from the scorer's
  output and make every `start` a multiple of it. This is the single thing that
  makes the film feel edited. Put the biggest cuts on the section times the
  scorer reports.
- **Keep shots between 1.2s and 4.6s.** Shorter reads as a flicker; longer and
  the eye wanders.
- **Ramp `energy` across the film.** Roughly 0.4 at the open to 1.0 at the
  peak, easing back for the end card.
- **Never invent a statistic.** If you put a number in a `stat` shot you must
  be able to point at where in the repo it came from.

## A shape that works

For a 24-second film at ~92 BPM (`spb` ≈ 0.652, bar ≈ 2.61s):

| # | Type | Start | Dur | Carries |
|---|---|---|---|---|
| 1 | `title` | 0.00 | 2.61 | the hook |
| 2 | `title` | 2.61 | 3.26 | what it is |
| 3 | `stat` | 5.87 | 1.96 | the strongest number |
| 4 | `stat` | 7.83 | 1.96 | the second number |
| 5 | `code` | 9.78 | 3.91 | real source |
| 6 | `bullets` | 13.70 | 3.26 | what it does |
| 7 | `langs` | 16.96 | 2.61 | the stack |
| 8 | `globe` | 19.57 | 2.61 | it ships |
| 9 | `endcard` | 22.17 | 1.83 | name and link |

Vary it. A repo with no interesting history should drop the timeline; a repo
with a beautiful API should give `code` twice the time.

## When to use the full pipeline instead

If the repo is conventional — one language, a clear entry point, a real README —
`/cased` will get there faster and its numbers are measured rather than typed.
Reach for slim when you have a reason.

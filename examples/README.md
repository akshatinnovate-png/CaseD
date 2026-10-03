# Examples

## `cased2.0/` — the film cased2.0 made about itself

Rendered by running the tool on this repository, with nothing hand-edited:

```bash
python3 -m cased . --duration 24 --quality good --director cinematic --gif
```

| File | What it is |
|---|---|
| `cased.mp4` | the film — 24s, 1920×1080, 30fps, AAC audio |
| `cased.gif` | the same cut, 640px, 15fps, for READMEs |
| `poster.png` | the midpoint frame — doubles as an OG image |
| `PLAN.md` | the shot list as a table, with timings |
| `SHARE.md` | post-ready copy for X, LinkedIn, HN, Product Hunt |
| `story.json` | everything the analyzer measured |
| `spec.json` | the full edit — re-renderable as-is |

The soundtrack is not committed because it is 4.9 MB and regenerates exactly
from the seed recorded in `spec.json`:

```bash
python3 -m cased.score 24 cinematic examples/cased2.0/score.wav
```

### Reproducing it

`spec.json` carries the seed, so this returns the identical file:

```bash
node cased/engine/render.mjs \
  --spec examples/cased2.0/spec.json \
  --out /tmp/reproduced.mp4 \
  --audio examples/cased2.0/score.wav \
  --quality good
```

### Trying the other directors

Each one is a different film from the same repository:

```bash
for d in cinematic brutalist terminal hype orbit warm; do
  python3 -m cased . --director "$d" --quality draft --out "/tmp/cased-$d"
done
```

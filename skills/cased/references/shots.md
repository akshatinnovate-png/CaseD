# Shot types

Every shot in `spec.json` is `{ type, start, dur, in, bg, cam, energy, fx, data }`.
`start` and `dur` are seconds and are written by the composer; the rest are the
director's, and all of them are safe to hand-edit before a re-render.

Implemented in `BUILD` in `cased/engine/stage.html`.

---

## `title`

The hero statement. Used for the hook and for "what it is".

```json
{ "kicker": "owner/repo", "text": "The headline",
  "sub": "optional supporting line", "caps": false, "rule": true }
```

Type auto-fits to the length of `text`: under 22 characters it is enormous,
over 100 it steps down to stay on screen. Words rise out of clipped lines in
sequence. Pass `size` to override the fit, `perLine` to control the break.

## `stat`

One measured number, very large, counting up from zero.

```json
{ "value": "3.1K", "label": "lines of source" }
```

The numeric part animates; any suffix (`K`, `M`, `×`) appears once the count
starts. `label` is singularised automatically when the value is exactly 1.

**Only ever fed from `story.highlights`.** Do not hand-write a value you
cannot point at in the repository.

## `code`

Real source, typed into a terminal window, syntax-highlighted.

```json
{ "path": "cased/score.py", "code": ["line", "line"],
  "caption": "the engine room", "dur": 3.4 }
```

Lines are trimmed to 76 characters and de-indented as a block by the analyzer.
Up to 16 lines. The typing rate is derived from `dur` so the snippet always
finishes before the cut. The caption fades in late.

## `bullets`

What it does — a numbered list on rules, staggered in from the right.

```json
{ "title": "what it does", "items": ["...", "...", "..."] }
```

Maximum five; each item should be under ~66 characters or it wraps badly.

## `langs`

The language mix as a single stacked meter with a legend.

```json
{ "title": "built with",
  "items": [{ "name": "Python", "share": 79.7, "color": "#3572A5" }] }
```

Segments scale out from the left in sequence. Colours come from the language
table in `analyze.py`, so they match what people expect from GitHub.

## `timeline`

How it got here — milestones on a vertical spine, oldest first.

```json
{ "title": "how it got here", "items": [{ "kind": "feature", "text": "..." }] }
```

Built from commit subjects, filtered to conventional-commit prefixes and
de-duplicated. Maximum five.

## `globe`

The scale beat: a rotating dotted globe with animated great-circle arcs.

```json
{ "kicker": "available now", "text": "Ship it anywhere", "sub": "Open source · MIT" }
```

The globe is drawn on the 2D effects canvas, not the DOM — points are a
Fibonacci sphere masked by a noise field so they read as continents. Arcs are
slerped between random surface points and lifted into the sky. On vertical
formats the globe moves below the text instead of beside it.

## `retro`

The brutalist signature: stacked System-7 dialog windows that pop in sequence.

```json
{ "windows": [{ "title": "README", "body": "> ready" }] }
```

Maximum three. Monospace body, hard black border, offset drop shadow.

## `endcard`

The frame people screenshot. Characters land one at a time on a spring.

```json
{ "name": "cased2.0", "sub": "https://github.com/...", "cta": "made with cased2.0" }
```

---

## Shared fields

| Field | Values | Notes |
|---|---|---|
| `in` | `cut` `fade` `rise` `push` `zoom` `flash` `glitch` | entrance; exit is always a short fade |
| `bg` | `aurora` `grid` `stars` `plasma` `rings` | the WebGL bed |
| `cam` | `push` `pull` `left` `right` `up` `none` | slow move across the whole shot |
| `energy` | `0`–`1` | drives bed intensity; ramps up across the film |
| `fx` | `motes` `grid` `wave` | 2D overlays |

## Writing a new shot type

Add a builder to `BUILD` in `stage.html` returning
`{ node, update(localTime, progress) }`. Build once, and in `update` touch
**only style properties** — the renderer calls `seek(t)` out of order, so any
state that accumulates between frames will produce a film that does not match
its own seed.

---

# Creative-mode shots

Added by `--creative`. These show *structure* rather than assertions, which is
what lets a sixty-second film hold attention: past about twenty seconds the eye
has learned the format and starts reading the runtime instead of the work.

All of them are **conditional on evidence**. The composer only schedules a shot
when the insight pass found enough to fill it — a repo with no import graph gets
no `arch` shot rather than an empty one.

## `arch`

The import graph, drawn as a graph.

```json
{ "title": "architecture",
  "nodes": [{ "label": "analyze", "hub": true }],
  "edges": [[0, 3]],
  "note": "11 modules, 10 imports between them" }
```

Hub at the centre, everything else on a ring, edges stroking in after the nodes
land. A force simulation would not be deterministic across runs and the ring
reads more clearly anyway. Nodes with no edges are dropped by the composer.

## `tree`

Top-level directories by line count, with proportional bars.

```json
{ "title": "what is in here",
  "items": [{ "path": "cased", "loc": 4169, "bar": 1.0, "is_dir": true }] }
```

`bar` is 0–1, normalised to the largest entry. Maximum nine rows.

## `flow`

The pipeline, with a pulse travelling through it so it reads as a process
rather than a row of boxes.

```json
{ "title": "how it runs",
  "items": [{ "name": "analyze", "note": "story.json" }] }
```

Notes are truncated hard — they are secondary, and a wrapped four-line note in
a small box is unreadable. Maximum five stages.

## `callout`

**The centrepiece.** Real source with one line called out and the rest dimmed.

```json
{ "path": "cased/insight.py — build_graph()",
  "code": ["def build_graph(...):", "..."],
  "highlight": 6,
  "label": "the idea",
  "note": "Import graph over first-party modules." }
```

`highlight` is an index into `code`. The shot renders at most **13 rows**
(`CALLOUT_LINES` in `compose.py`) — a focus index past that points at a line
nobody ever sees, so slice the code first and choose the focus from the slice.

## `heatmap`

Six months of commit activity.

```json
{ "title": "the last six months", "days": [0, 3, 1, ...], "note": "6 commits on 2026-10-03" }
```

Seven rows, one column per week, filling left to right like a calendar being
written. The composer requires **at least 12 active days** — a heatmap of one
busy afternoon is an empty grid with a dot in it.

## `constellation`

Techniques found in the source, as drifting pills.

```json
{ "title": "techniques in the source", "items": [{ "name": "Karplus-Strong synthesis" }] }
```

Laid out on alternating radius bands at even angles, then relaxed with a
push-apart pass using measured widths so labels never collide. The relaxation
is iterative rather than physical, which keeps it deterministic.

## `compare`

"This, not that" — pulled from a README sentence of that shape.

```json
{ "left": "The synthesised score is a score", "right": "a song",
  "leftLabel": "cased2.0", "rightLabel": "not" }
```

The right column renders struck through at reduced opacity.

## `bigquote`

One claim, full-bleed, word by word.

```json
{ "text": "The numbers on screen are measured from your code, never invented",
  "source": "from the README" }
```

Type auto-fits the length. Claims are ranked so none ends on a dangling word —
a quote ending in "behind" or "and" reads as a fragment at this size.

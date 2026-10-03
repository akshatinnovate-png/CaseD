---
name: cased
description: Turn the project in the current repository into a cinematic launch film — scored, beat-cut and rendered to MP4, with share copy for X, LinkedIn, HN and Product Hunt. Use when the user wants a launch video, a demo reel, a trailer, a "brag" video, a Product Hunt or Show HN asset, a README demo GIF, or social clips for something they just built. Triggers on "/cased", "make a trailer", "launch video", "demo video", "brag about this repo".
---

# cased2.0

You are directing a 24-second launch film for the user's project.

The pipeline does the rendering. Your job is the part a program cannot do:
**decide what this project's story actually is**, pick the director that
flatters it, and make the copy on screen land.

## The one rule

**Never invent a number, a benchmark or a claim.** Every statistic on screen
comes from `story.json`, which is measured from the repository. If you want to
say something is fast, you need a measurement in the repo to point at. A film
that overclaims embarrasses the person who posts it.

---

## Step 1 — Look before you direct

Run the analyzer alone first. It is fast and it costs no render time.

```bash
python3 -m cased . --plan-only --out cased-output
```

Read `cased-output/story.json` and `cased-output/PLAN.md`. Then read the
project's README yourself, and skim the entry point the analyzer picked.

You are looking for three things:

1. **The hook.** What is the one sentence that makes someone stop scrolling?
   It is almost never the repo description. It is the thing the author would
   say out loud if a friend asked what they'd been working on.
2. **The proof.** Which measured numbers are actually impressive *for this
   kind of project*? 400 commits is a lot for a weekend tool and unremarkable
   for a framework. Drop weak stats rather than pad the film with them.
3. **The surprise.** The detail a reader would not expect — a synthesiser in
   the standard library, zero dependencies, a format nobody else supports.

If the analyzer's `tagline` is weak or truncated, write a better one and pass
it with `--tagline`. This is the single highest-leverage thing you can do.

## Step 2 — Cast the director

| Director | Use it when |
|---|---|
| `cinematic` | The default. Serious work, infrastructure, anything you want read as credible. |
| `brutalist` | The project has attitude. Developer tools with a point of view, opinionated libraries. |
| `terminal` | It has a prompt. CLIs, REPLs, shells, anything where the terminal *is* the product. |
| `hype` | It is going on social and needs to win the first 0.8 seconds. |
| `orbit` | Scale is the story — distributed systems, APIs, anything that ships worldwide. |
| `warm` | It is a kindness. Libraries, docs tools, accessibility work, anything gentle. |

Leave `--director` off and the pipeline picks from the project kind. Override
it when you know better — you usually do, because you have read the README and
the analyzer has only read the file tree.

## Step 3 — Render

```bash
python3 -m cased . \
  --director cinematic \
  --duration 24 \
  --tagline "the better line you wrote in step 1" \
  --quality high \
  --gif
```

Rendering is CPU-bound and takes **3–6 minutes** for 24 seconds at 1080p. Say
so before you start, so the wait is expected rather than alarming.

While it renders, draft the user's post using `cased-output/SHARE.md` as the
starting point — but rewrite it in their voice if you have seen how they write.

### Options worth knowing

```
--format 9:16          vertical, for Reels/Shorts/TikTok
--format all           every aspect ratio in one run
--duration 15          tighter; the composer drops the weaker beats
--quality draft        half resolution, ~4x faster — use while iterating
--seed 1234            same seed, same film
--plan-only            plan without rendering
```

## Step 4 — Deliver

Tell the user, in this order:

1. Where the file is and how long it is.
2. The one-line pitch of the edit: *"Cinematic, 24 seconds, nine shots, cut to
   a 92 BPM score. Opens on the tagline, proves it with the line count, then
   shows the scorer's own source."*
3. The share copy, ready to paste.
4. One honest note on what you would change — a stat that is weak, a feature
   list that reads thin. Offer the specific re-run.

Never present the film as finished-and-perfect. Offer the next cut.

---

## Iterating

Re-running costs minutes, so change one thing at a time:

- **Headline is wrong** → `--tagline "..."` (no re-analysis needed).
- **Wrong mood** → `--director ...`.
- **Feels rushed or baggy** → `--duration`. Under 18s the composer drops the
  globe and timeline beats; over 28s it starts to drag.
- **Same film, different roll** → change `--seed`.

You can also hand-edit `cased-output/spec.json` and re-render it directly:

```bash
node cased/engine/render.mjs --spec cased-output/spec.json \
  --out cased-output/cased.mp4 --audio cased-output/score.wav --quality high
```

That is the escape hatch for anything the composer gets wrong: shot order,
durations, which code appears, the exact words.

## When the repo is thin

A repo with three files and one commit has no proof beats. Don't fake them.
Do this instead:

- Use `--duration 15` so the film does not have to stretch.
- Lead with what it *does*, not what it *is* — the feature list carries it.
- Pick `warm` or `terminal`; both read well with little material.
- Tell the user plainly that the film will get better as the project does.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Playwright not found` | Not installed, or ESM cannot see a global install | `npm i -g playwright && npx playwright install chromium` |
| `missing prerequisites: ffmpeg` | FFmpeg not on PATH | Install FFmpeg |
| Render is very slow | No GPU; WebGL falls back to SwiftShader | Expected. Use `--quality draft` while iterating |
| Film has no stats | Not a git repo, or shallow clone | `git fetch --unshallow`, or accept it |
| Code shot shows a boring file | Analyzer's heuristic missed | Edit `code_moments` in `story.json`, or `spec.json`, then re-render |

## Reference

- `references/directors.md` — what each director does, shot by shot.
- `references/shots.md` — every shot type and the data it takes.
- `references/copy.md` — how to write the headline and the share post.

# Directors, shot by shot

A director is a complete point of view. It sets the palette, the background
bed, the camera behaviour, the transition vocabulary, the pacing multiplier
and the musical mood the scorer writes in. Changing it changes the whole film;
the story underneath is untouched.

Defined in `cased/directors.py`. Add one by adding a dict entry — nothing else
needs to change.

---

## cinematic — *the default*

> Deep blacks, slow pushes, letterbox. Takes the work seriously.

- **Palette** `#06070C` ground, violet `#7C5CFF`, cyan `#39D0FF`
- **Beds** aurora → stars → aurora → rings
- **Camera** slow push and pull; nothing snaps
- **Transitions** fade, rise, zoom — no glitch, no flash
- **Score** ~88–100 BPM, natural minor, generous reverb
- **Letterbox** yes

Use for infrastructure, developer platforms, AI tooling, anything that needs to
read as credible. It is the safest choice and it flatters almost any repo.

## brutalist

> Hot pink, hard cuts, dialog boxes, type the size of a bus.

- **Palette** `#F2719E` ground, black ink, white
- **Beds** dithered plasma throughout
- **Camera** locked off — the type does the moving
- **Transitions** hard cuts and one glitch
- **Score** ~128–140 BPM, phrygian, heavy drive
- **Signature** the `retro` shot: stacked System-7 dialog windows

Use when the project has an attitude and the author wants it known. Reads as
confident; reads as obnoxious if the project is earnest. Choose deliberately.

## terminal

> Phosphor green, scanlines, code first. For things with a prompt.

- **Palette** `#04080A` ground, phosphor `#38F58C`, amber `#FFC24D`
- **Beds** perspective grid tunnel, rings at the close
- **Camera** push and a slow tilt
- **Transitions** cut, rise, glitch
- **Score** ~112–120 BPM, mixolydian
- **Signature** scanlines on, heavier grain

Use when the terminal *is* the product: CLIs, REPLs, shells, TUI apps.

## hype

> Flash cuts, glitch, neon. Built to stop a thumb mid-scroll.

- **Palette** `#08030F` ground, `#FF2D71`, `#00F0FF`
- **Beds** rings → plasma → grid → rings
- **Camera** fast pushes and lateral moves
- **Transitions** flash, glitch, zoom
- **Score** ~124–136 BPM, phrygian, maximum intensity
- **Pacing** shortest shots of any director

Use for the social cut — paired with `--format 9:16`. It wins the first
0.8 seconds and does not pretend to be subtle.

## orbit

> Starfield, a turning globe, long arcs. For things that ship wide.

- **Palette** `#01030A` ground, orange `#FF7A1A`, blue `#2E7BFF`
- **Beds** starfield throughout, one aurora
- **Camera** long pulls
- **Transitions** fade, rise, zoom
- **Score** ~104–116 BPM, lydian — the most optimistic of the six
- **Signature** the globe shot gets the most screen time

Use when reach is the story: APIs, CDNs, distributed systems, SDKs.

## warm

> Soft light, unhurried, generous margins. Quietly confident.

- **Palette** `#0C0A09` ground, `#FF9E5E`, `#8FD4C1`
- **Beds** aurora, rings at the close
- **Camera** the slowest of the six
- **Transitions** fade and rise only
- **Score** ~92–104 BPM, dorian, lowest intensity
- **Pacing** longest shots — 1.18× the base

Use for libraries, documentation tooling, accessibility work. Good for a thin
repo, because long shots need less material to fill them.

---

## Automatic selection

With no `--director`, the project kind picks one:

| Project kind | Director |
|---|---|
| `tool` (a CLI) | `terminal` |
| `service` (API, backend) | `orbit` |
| `visual` (graphics, games) | `hype` |
| `ai` | `cinematic` |
| `app` | `cinematic` |
| `library` | `warm` |
| anything else | `cinematic` |

Kind comes from `classify()` in `cased/analyze.py`, which reads the name,
description, stack and feature list. It is a heuristic. Override it when you
have read the README and know better.

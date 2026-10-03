"""
cased2.0 / compose
==================

The edit. Takes a story, a director, and the scorer's beat map, and returns
a frame-exact shot list.

The one idea worth knowing: shot boundaries are *snapped to the music*.
The scorer decides the tempo first, so every cut lands on a beat and the
section changes land on the impacts. That single constraint is most of the
difference between a slideshow and something that feels edited.
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

from .directors import pick

MIN_SHOT = 1.15          # below this a shot reads as a flicker
MAX_SHOT = 4.60          # above this the eye wanders


# ---------------------------------------------------------------------------
# Copy
# ---------------------------------------------------------------------------

def _hook_line(story: dict, rng: random.Random) -> str:
    """The first words on screen. Short, declarative, never a sentence."""
    name = story["name"]
    tag = (story.get("tagline") or "").strip().rstrip(".")
    if tag and len(tag) <= 72:
        return tag
    kind = story.get("kind", "project")
    by_kind = {
        "tool": f"{name} is a command.",
        "service": f"{name} runs the hard part.",
        "visual": f"{name} draws it.",
        "ai": f"{name} thinks it through.",
        "app": f"{name}, in the browser.",
        "library": f"import {name.lower().replace(' ', '_')}",
    }
    return by_kind.get(kind, f"This is {name}.")


def share_copy(story: dict, director: str) -> dict:
    """Post-ready copy. Written to be used verbatim, not edited."""
    name = story["name"]
    tag = (story.get("tagline") or story.get("description") or "").strip()
    url = story.get("url") or ""
    stats = story.get("stats", {})
    loc = stats.get("loc")
    commits = stats.get("commits")
    langs = ", ".join(l["name"] for l in story.get("languages", [])[:3])

    proof = []
    if loc:
        proof.append(f"{loc:,} lines")
    if commits:
        proof.append(f"{commits:,} commits")
    proof_s = " · ".join(proof)

    x = f"{name}\n\n{tag}"
    if proof_s:
        x += f"\n\n{proof_s}"
    if url:
        x += f"\n\n{url}"

    linkedin = (
        f"I built {name}.\n\n{tag}\n\n"
        + (f"Under the hood: {langs}.\n" if langs else "")
        + (f"{proof_s}.\n" if proof_s else "")
        + (f"\nIt's here: {url}" if url else "")
    )

    return {
        "x": x.strip(),
        "linkedin": linkedin.strip(),
        "hn": f"Show HN: {name} – {tag[:70].rstrip('.')}" if tag else f"Show HN: {name}",
        "product_hunt": tag[:60] if tag else f"{name}, now public",
        "alt_text": (
            f"A {director} launch film for {name}: "
            f"{tag[:110]}"
        ).strip(),
    }


# ---------------------------------------------------------------------------
# Beat snapping
# ---------------------------------------------------------------------------


def _grid(points: list, step: float, duration: float) -> list:
    """Beat times covering [0, duration).

    A beat map scored for a shorter runtime than the film leaves the back half
    with nothing to snap to, and the cuts there drift off the music silently.
    The tempo is constant, so extend the grid arithmetically rather than
    letting it run out.
    """
    out = sorted(t for t in points if 0.0 < t < duration)
    if step and step > 1e-6:
        last = out[-1] if out else 0.0
        t = last + step
        while t < duration:
            out.append(round(t, 4))
            t += step
    return out


def _nearest(t: float, grid: list, lo: float, hi: float) -> float | None:
    """Closest grid point to `t` inside [lo, hi], or None if the window is empty."""
    inside = [g for g in grid if lo - 1e-9 <= g <= hi + 1e-9]
    return min(inside, key=lambda g: abs(g - t)) if inside else None


def _fit_to_runtime(plan: list, duration: float) -> list:
    """Drop the weakest beats when the runtime cannot hold the whole plan.

    A short `--duration` asks for more shots than there are seconds; without
    this the arithmetic hands the last shots zero or negative length. Keep the
    hook and the end card -- a film needs an open and a close -- and shed the
    lowest-weight middles until the rest fit.
    """
    room = max(2, int(duration // MIN_SHOT))
    if len(plan) <= room:
        return plan
    keep = {0, len(plan) - 1}
    middles = sorted(range(1, len(plan) - 1),
                     key=lambda i: (-plan[i]["weight"], i))
    keep |= set(middles[:max(0, room - 2)])
    return [p for i, p in enumerate(plan) if i in keep]


def _lay_out(plan: list, duration: float, beatmap: dict) -> list:
    """Distribute shots across the runtime, then snap the cuts to the music.

    Snapping has to respect two hard constraints -- shots may not fall below
    MIN_SHOT, and the boundaries must stay monotonic -- without ever landing
    off-grid. The trick is to apply those constraints *to the search window*
    rather than to the result: pick the nearest grid point that is already
    legal, instead of snapping and then clamping the answer away from the beat.
    """
    beats = _grid(beatmap.get("beats", []), beatmap.get("spb", 0.0), duration)
    accents = sorted(a["time"] for a in beatmap.get("accents", [])
                     if 0.0 < a["time"] < duration)

    plan = _fit_to_runtime(plan, duration)

    total_w = sum(s["weight"] for s in plan) or 1.0
    raw = [max(MIN_SHOT, min(MAX_SHOT, duration * (s["weight"] / total_w))) for s in plan]
    scale = duration / sum(raw)
    raw = [d * scale for d in raw]

    n = len(plan)
    bounds = [0.0]
    for i in range(n - 1):
        ideal = bounds[-1] + raw[i]
        lo = bounds[-1] + MIN_SHOT
        hi = duration - MIN_SHOT * (n - 1 - i)     # leave room for what follows
        if hi < lo:                                # too many shots for the runtime
            bounds.append(min(max(ideal, lo), duration))
            continue
        # A shot flagged `hard` opens a section, so it wants a musical impact.
        # If no impact is reachable, any beat is still better than an arbitrary
        # time -- so always fall through to the beat grid.
        pick = None
        if plan[i + 1].get("hard") and accents:
            cand = _nearest(ideal, accents, lo, hi)
            if cand is not None and abs(cand - ideal) <= 0.85:
                pick = cand
        if pick is None:
            pick = _nearest(ideal, beats, lo, hi)
        if pick is None:
            pick = min(max(ideal, lo), hi)
        bounds.append(pick)
    bounds.append(duration)

    out = []
    for i, s in enumerate(plan):
        shot = {k: v for k, v in s.items() if k not in ("weight", "hard")}
        shot["start"] = round(bounds[i], 4)
        shot["dur"] = round(bounds[i + 1] - bounds[i], 4)
        out.append(shot)
    return out


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------


def build_plan(story: dict, dname: str, d: dict, rng: random.Random,
               duration: float) -> list:
    """Choose which beats this particular repo has earned."""
    name = story["name"]
    stats = story.get("stats", {})
    plan = []

    def add(type_, data, weight, hard=False, **kw):
        plan.append({"type": type_, "data": data, "weight": weight, "hard": hard, **kw})

    # 1 — the hook
    add("title", {
        "kicker": story.get("repo") or "introducing",
        "text": _hook_line(story, rng),
        "caps": dname in ("brutalist", "hype", "orbit"),
        "sub": "",
        "rule": True,
    }, 1.05)

    # 2 — what it actually is
    desc = story.get("description") or story.get("tagline") or ""
    if desc and len(desc) > 24:
        add("title", {
            "kicker": "what it is",
            "text": desc if len(desc) < 110 else desc[:108].rsplit(" ", 1)[0] + "...",
            "size": 92 if len(desc) > 60 else 118,
            "perLine": 4,
            "rule": False,
        }, 1.25)

    # 3 — the brutalist director gets its dialog boxes early
    if dname == "brutalist":
        wins = [{"title": f"{name} 2.0", "body": f"> {desc[:76] or 'ready'}"}]
        if stats.get("commits"):
            wins.append({"title": "LOG", "body": f"{stats['commits']} commits\n{stats.get('loc', 0)} lines"})
        add("retro", {"windows": wins}, 1.15, hard=True)

    # 4 — proof: the two strongest measured numbers
    for h in story.get("highlights", [])[:2]:
        add("stat", {"value": h["value"], "label": h["label"]}, 0.72, hard=True)

    # 5 — real source on screen
    moments = story.get("code_moments", [])
    if moments:
        m = moments[0]
        add("code", {"path": m["path"], "code": m["code"],
                     "caption": m.get("caption", ""), "dur": 3.4}, 1.45)

    # 6 — what it does
    feats = story.get("features", [])
    if len(feats) >= 2:
        add("bullets", {"title": "what it does", "items": feats[:5]}, 1.35)

    # 7 — the stack
    langs = story.get("languages", [])
    if len(langs) >= 2:
        add("langs", {"title": "built with",
                      "items": [{"name": l["name"], "share": l["share"], "color": l["color"]}
                                for l in langs[:5]]}, 1.0, hard=True)

    # 8 — a second code beat, if the repo has range
    if len(moments) > 1 and duration >= 22:
        m = moments[1]
        add("code", {"path": m["path"], "code": m["code"],
                     "caption": m.get("caption", ""), "dur": 3.0}, 1.25)

    # 9 — history
    tl = story.get("timeline", [])
    if len(tl) >= 3 and duration >= 20:
        add("timeline", {"title": "how it got here", "items": tl[-4:]}, 1.2)

    # 10 — the scale beat
    if duration >= 18:
        add("globe", {
            "kicker": "available now",
            "text": "Ship it anywhere",
            "sub": (f"Open source · {story['license']}" if story.get("license")
                    else "Clone it and run it."),
        }, 1.15, hard=True)

    # 11 — the card people screenshot
    add("endcard", {
        "name": name,
        "sub": story.get("url") or story.get("repo") or "",
        "cta": "made with cased2.0",
    }, 1.0, hard=True)

    return plan


def decorate(plan: list, d: dict, rng: random.Random) -> None:
    """Attach the director's look to each shot: bed, camera, entrance, fx."""
    beds, cams, ins = d["beds"], d["cams"], d["ins"]
    for i, s in enumerate(plan):
        s["bg"] = beds[i % len(beds)]
        s["cam"] = cams[i % len(cams)]
        s["in"] = "cut" if i == 0 else ins[i % len(ins)]
        s["energy"] = round(min(1.0, d["energy"] * (0.72 + 0.5 * (i / max(len(plan) - 1, 1)))), 3)
        s["fx"] = list(d["fx"])
        # Shot-type overrides: some beats want a specific bed.
        if s["type"] == "globe":
            s["bg"] = "stars"
            s["cam"] = "none"
        if s["type"] == "code":
            s["cam"] = "none"
            s["fx"] = [f for f in s["fx"] if f != "wave"]
        if s["type"] == "endcard":
            s["bg"] = "rings" if d["theme"]["bg_mode"] != "plasma" else "plasma"
            s["cam"] = "pull"
            s["energy"] = round(d["energy"] * 0.55, 3)
        if s["type"] == "retro":
            s["bg"] = "plasma"
            s["cam"] = "none"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def compose(story: dict, beatmap: dict, duration: float = 24.0,
            director: str | None = None, width: int = 1920,
            height: int = 1080, seed: int = 0) -> dict:
    dname, d = pick(director, story.get("kind", "project"))
    rng = random.Random(seed or story.get("seed") or 1)

    plan = build_plan(story, dname, d, rng, duration)
    decorate(plan, d, rng)
    shots = _lay_out(plan, duration, beatmap)

    theme = dict(d["theme"])
    # Let a strong hero language tint the accent, unless the director is
    # opinionated about colour (brutalist and terminal are).
    if dname in ("cinematic", "orbit", "warm") and story.get("hero_color"):
        theme["accent2"] = story["hero_color"]

    return {
        "version": "2.0",
        "project": story["name"],
        "director": dname,
        "director_label": d["label"],
        "seed": seed or story.get("seed") or 1,
        "fps": 30,
        "width": width,
        "height": height,
        "duration": round(duration, 4),
        "theme": theme,
        "shots": shots,
        "beatmap": {k: v for k, v in beatmap.items() if k != "beats"},
        "share": share_copy(story, d["label"]),
    }


def main(argv):
    from .analyze import analyze
    from . import score as score_mod
    import tempfile

    root = Path(argv[1]) if len(argv) > 1 else Path.cwd()
    story = json.loads(analyze(root).to_json())
    dname, d = pick(argv[2] if len(argv) > 2 else None, story.get("kind"))
    with tempfile.TemporaryDirectory() as td:
        bm = score_mod.render(24.0, Path(td) / "s.wav", d["mood"], story["seed"], d["intensity"])
    spec = compose(story, bm, 24.0, dname)
    print(json.dumps(spec, indent=2)[:4000])


if __name__ == "__main__":
    import sys
    main(sys.argv)

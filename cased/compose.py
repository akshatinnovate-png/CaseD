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

from .analyze import plural
from .directors import pick
from . import themes as themes_mod

#: Rows the `callout` shot draws. Must match the slice in stage.html.
CALLOUT_LINES = 13

#: Longest "what it is" card that still fits the engine's four-line box.
CARD_CHARS = 76

#: Words that read badly as the last one before an ellipsis.
_TRAIL = {"the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with",
          "by", "from", "into", "as", "that", "which", "its", "it", "this"}


def _ellipsis(text: str, limit: int) -> str:
    """Trim to `limit`, on a word boundary, not ending on a dangling word."""
    if len(text) <= limit:
        return text
    words = text[:limit].rsplit(" ", 1)[0].split()
    while len(words) > 3 and words[-1].strip(",;:").lower() in _TRAIL:
        words.pop()
    return " ".join(words).rstrip(",;:") + "..."

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
        proof.append(plural(loc, "line"))
    if commits:
        proof.append(plural(commits, "commit"))
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
        # Alt text describes the film for someone who cannot watch it, so it
        # leads with what the film shows rather than repeating the sales line.
        "alt_text": (
            f"A {director.lower()} launch film for {name}"
            + (f", described as: {tag[:110].rstrip('.')}" if tag else "")
            + ". Title cards, measured statistics, real source code and an "
              "end card, cut to a synthesised soundtrack."
        ),
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

    # 2 — what it actually is.
    # The hook is normally the head of the description, so playing the
    # description next repeats the opening card word for word. Show whatever
    # the hook left behind; if it left nothing, skip the beat.
    hook = plan[0]["data"]["text"]
    desc = story.get("description") or story.get("tagline") or ""
    second = desc
    if desc.lower().startswith(hook.lower()[:40]):
        second = desc[len(hook):].lstrip(" \u2014\u2013-:,.").strip()
        if second:
            second = second[0].upper() + second[1:]
    if second and len(second) > 24:
        # A title card is read in two seconds, so this stays a line and not a
        # paragraph. The budget used to be 108 characters at a pinned 92px,
        # which overran the four-line box and clipped the sentence mid-phrase;
        # the engine already sizes type to its length, so let it.
        add("title", {
            "kicker": "what it is",
            "text": _ellipsis(second, CARD_CHARS),
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


#: Opening delimiters of a docstring, built rather than written literally so
#: this file stays easy to patch.
_DOCQ = ('"' * 3, "'" * 3)


def _focus_line(code: list) -> int:
    """Which line of the signature function the callout should point at.

    Not the `def`, not the docstring, not a bare `return x` -- the line doing
    the actual work, which is usually the densest expression in the body.
    """
    best, best_i = -1.0, 0
    for i, raw in enumerate(code):
        line = raw.strip()
        if not line or i == 0:
            continue
        if line.startswith("#") or line.startswith("@") or line[:3] in _DOCQ:
            continue
        if line in ("else:", "try:", "pass"):
            continue
        score = len(line) * 0.35
        score += sum(line.count(op) for op in "=+-*/<>[](){}") * 2.2
        score += 9 if re.search(r"\b(for|while|if|return|yield)\b", line) else 0
        score -= 14 if line.startswith("def ") or line.startswith("class ") else 0
        if score > best:
            best, best_i = score, i
    return best_i


def build_creative_plan(story: dict, ins: dict, dname: str, d: dict,
                        rng: random.Random, duration: float) -> list:
    """The long-form arc.

    A minute of title cards and counters is a minute of nothing: by about
    twenty seconds the viewer has learned the format and starts reading the
    clock instead of the work. So this plan spends its middle on *structure*
    -- what the repo is made of, how it fits together, which line is the
    clever one -- and only returns to numbers once it has earned them.

    Every beat is conditional on evidence. A repo with no import graph gets
    no architecture shot rather than an empty one.
    """
    name = story["name"]
    plan = []

    def add(type_, data, weight, hard=False):
        plan.append({"type": type_, "data": data, "weight": weight, "hard": hard})

    # 1 -- cold open
    add("title", {
        "kicker": story.get("repo") or "introducing",
        "text": _hook_line(story, rng),
        "caps": False, "rule": True,
    }, 1.0)

    # 2 -- the thesis, in the author's own words
    claims = ins.get("claims") or []
    if claims:
        add("bigquote", {"text": claims[0], "source": "from the README"}, 1.25, hard=True)

    # 3 -- one number, to ground it
    hl = story.get("highlights") or []
    if hl:
        add("stat", {"value": hl[0]["value"], "label": hl[0]["label"]}, 0.7, hard=True)

    # 4 -- what is actually in here
    if len(ins.get("tree") or []) >= 3:
        add("tree", {"title": "what is in here", "items": ins["tree"][:8]}, 1.4)

    # 5 -- how it is put together
    mods = ins.get("modules") or []
    if len(mods) >= 4:
        hub = ins.get("hub")
        # A node with no edges tells the viewer nothing and crowds the ring.
        # Keep the connected graph; only fall back to isolated modules if the
        # project genuinely has too few connections to fill a shot.
        linked = [m for m in mods if m["deg_in"] or m["deg_out"]]
        pool = linked if len(linked) >= 4 else mods
        nodes = sorted(pool, key=lambda m: -(m["deg_in"] * 3 + m["deg_out"] + m["loc"] / 400))[:12]
        idx = {m["id"]: i for i, m in enumerate(nodes)}
        edges = []
        for a, b in ins.get("edges", []):
            ia, ib = mods[a]["id"], mods[b]["id"]
            if ia in idx and ib in idx:
                edges.append([idx[ia], idx[ib]])
        note = f"{len(mods)} modules, {len(ins.get('edges', []))} imports between them"
        if hub:
            note += f" \u2014 everything leans on {hub.rsplit('/', 1)[-1]}"
        add("arch", {
            "title": "architecture",
            "nodes": [{"label": m["label"], "hub": m["id"] == hub} for m in nodes],
            "edges": edges[:22],
            "note": note,
        }, 1.5)

    # 6 -- the process
    if len(ins.get("pipeline") or []) >= 3:
        add("flow", {"title": "how it runs", "items": ins["pipeline"][:5]}, 1.35, hard=True)

    # 7 -- THE CENTREPIECE: the function the project is actually about
    sig = ins.get("signature") or {}
    if sig.get("code"):
        # The shot renders at most CALLOUT_LINES rows, so the focus index has
        # to be chosen against what will actually be on screen -- picking it
        # from the full function silently points at a line nobody sees.
        shown = sig["code"][:CALLOUT_LINES]
        add("callout", {
            "path": f"{sig['module']} \u2014 {sig['name']}()",
            "code": shown,
            "highlight": _focus_line(shown),
            "label": "the idea",
            "note": sig.get("doc") or f"{sig['lines']} lines, {sig.get('branches', 0)} branches",
        }, 1.75)

    # 8 -- a second look at real source, elsewhere in the tree
    moments = story.get("code_moments") or []
    if moments:
        m = moments[0]
        add("code", {"path": m["path"], "code": m["code"],
                     "caption": m.get("caption", ""), "dur": 3.2}, 1.3)

    # 9 -- what it knows how to do
    techs = ins.get("techniques") or []
    if len(techs) >= 3:
        add("constellation", {"title": "techniques in the source",
                              "items": [{"name": t["name"]} for t in techs[:8]]}, 1.3, hard=True)

    # 10 -- the second number
    if len(hl) > 1:
        add("stat", {"value": hl[1]["value"], "label": hl[1]["label"]}, 0.7)

    # 11 -- the shape of the work
    cad = ins.get("cadence") or []
    # A heatmap of one busy afternoon is an empty grid with a dot in it. Only
    # earn the shot when there is a spread of activity to actually show.
    active_days = sum(1 for v in cad if v)
    if len(cad) >= 60 and active_days >= 12:
        add("heatmap", {"title": "the last six months",
                        "days": cad, "note": ins.get("peak_day", "")}, 1.25)

    # 12 -- milestones
    tl = story.get("timeline") or []
    if len(tl) >= 3:
        add("timeline", {"title": "how it got here", "items": tl[-4:]}, 1.2)

    # 13 -- the stack
    langs = story.get("languages") or []
    if len(langs) >= 2:
        add("langs", {"title": "built with",
                      "items": [{"name": l["name"], "share": l["share"], "color": l["color"]}
                                for l in langs[:5]]}, 1.0, hard=True)

    # 14 -- what it does for you
    feats = story.get("features") or []
    if len(feats) >= 2:
        add("bullets", {"title": "what it does", "items": feats[:5]}, 1.35)

    # 15 -- this, not that
    contrasts = ins.get("contrasts") or []
    if contrasts:
        add("compare", {
            "left": contrasts[0]["left"], "right": contrasts[0]["right"],
            "leftLabel": name, "rightLabel": "not",
        }, 1.2, hard=True)

    # 16 -- a closing claim
    if len(claims) > 1:
        add("bigquote", {"text": claims[1], "source": ""}, 1.15)

    # 17 -- it ships
    add("globe", {
        "kicker": "available now",
        "text": "Ship it anywhere",
        "sub": (f"Open source \u00b7 {story['license']}" if story.get("license")
                else "Clone it and run it."),
    }, 1.1, hard=True)

    # 18 -- the card people screenshot
    add("endcard", {
        "name": name,
        "sub": story.get("url") or story.get("repo") or "",
        "cta": "made with cased2.0",
    }, 1.0, hard=True)

    return plan



def build_atlas_plan(story: dict, ins: dict | None, d: dict,
                     duration: float) -> list:
    """A product film.

    The other plans draw data about the repository. This one draws the
    repository as a product: the files scattered as windows, the top-level
    directories in orbit, recent work on a board, real source in an editor,
    the language split on a dashboard.

    Nothing here is invented. Every window, card, pill and figure comes out of
    the analyzer, so the frame stamp reads MEASURED throughout. The shots can
    draw fabricated screens -- that is what `sample` is for -- but a film about
    a real repository has no reason to.
    """
    name = story["name"]
    stats = story.get("stats", {})
    langs = story.get("languages", [])
    plan: list = []
    chapter = [0]

    def add(type_, data, weight, section="", caption="", hard=False, chap=None):
        chapter[0] += 1
        shot = {"type": type_, "data": data, "weight": weight, "hard": hard}
        if section:
            shot["section"] = section
        if caption:
            shot["caption"] = caption
        if chap:
            shot["chapter"] = f"{chapter[0]:02d} \u00b7 {chap}"
        plan.append(shot)

    files = stats.get("files") or 0
    commits = stats.get("commits") or stats.get("commits_seen") or 0

    # 1 -- the scatter, then the name for it
    add("appwindows", {
        "text": (plural(files, "file") + ". One *repository*.") if files
                else f"{name}, *in one place*.",
        "count": max(6, min(files or 9, 13)), "seed": story.get("seed") or 7,
    }, 1.15, "the shape", story.get("tagline", "")[:72], chap="what it is")

    # 2 -- the top-level directories, in orbit.
    # The CLI's Story carries no file tree -- only the deep read and the
    # browser's analyzer do -- so fall back to the directories the code
    # moments came out of rather than drawing an empty ring.
    tree = (ins or {}).get("tree") or story.get("tree") or []
    mods = [t["path"] for t in tree if t.get("path") and t["path"] != "(root)"][:8]
    if len(mods) < 3:
        seen: list = []
        for m in story.get("code_moments") or []:
            top = m["path"].split("/")[0] if "/" in m["path"] else "(root)"
            if top not in seen:
                seen.append(top)
        mods = seen[:8]
    if len(mods) >= 3:
        add("apporbit", {
            "title": "Everything it is made of.",
            "mark": name[:2].upper(),
            "items": [{"name": m} for m in mods],
        }, 1.45, "orbit view", plural(len(mods), "top-level directory").replace(
            "directorys", "directories"), chap="layout")

    # 3 -- recent work, as a board
    tl = story.get("timeline") or []
    if len(tl) >= 3:
        cards = [{"text": _ellipsis(t["text"], 46)} for t in tl[-6:]]
        third = max(1, len(cards) // 3)
        add("appboard", {
            "app": story.get("repo") or name,
            "title": "The work, *on one board*.",
            "sprint": plural(commits, "commit") if commits else "recent work",
            "columns": [
                {"name": "earlier", "cards": cards[:third]},
                {"name": "then", "cards": cards[third:third * 2]},
                {"name": "latest", "cards": cards[third * 2:]},
            ],
        }, 1.4, "history", "Every card is a real commit.", hard=True, chap="history")

    # 4 -- real source, in an editor
    moments = story.get("code_moments") or []
    if moments:
        m = moments[0]
        # Siblings come from the other code moments, which are real paths the
        # analyzer picked; there is no full tree on the Story to read.
        tree_files = []
        for other in moments:
            if other["path"] not in tree_files:
                tree_files.append(other["path"])
        for extra in (stats.get("hottest_file"),):
            if extra and extra not in tree_files:
                tree_files.append(extra)
        tree_files = tree_files[:7]
        add("appcode", {
            "app": story.get("repo") or name,
            "title": "Written *here*.",
            "root": m["path"].split("/")[0],
            "branch": stats.get("branch") or "main",
            "action": "Run",
            "tab": m["path"].rsplit("/", 1)[-1],
            "files": [{"name": f.rsplit("/", 1)[-1], "depth": f.count("/"),
                       "active": f == m["path"]} for f in tree_files],
            "code": m["code"][:9],
        }, 1.6, "source", m.get("caption", "Real source, not a mockup."),
            chap="the code")

    # 5 -- the stack, on a dashboard
    if len(langs) >= 2:
        hero = langs[0]
        add("appdash", {
            "app": story.get("repo") or name,
            "title": "The stack, *measured*.",
            "value": f"{hero['share']}%", "delta": hero["name"],
            "label": "share of the codebase",
            # The share ladder is the series: real proportions, in order.
            "series": [l["share"] for l in langs[:8]][::-1] or [1],
            "cards": [{"label": l["name"], "value": f"{l['share']}%"}
                      for l in langs[1:4]],
        }, 1.35, "stack", f"{len(langs)} languages, measured from the tree.",
            hard=True, chap="stack")

    # 6 -- what it does, in the author's words
    feats = story.get("features") or []
    if len(feats) >= 2:
        add("bullets", {"title": "what it does", "items": feats[:5]}, 1.3,
            "capability", "Straight from the README.", chap="what it does")

    # 7 -- the two audiences, if the insight found a contrast
    if duration >= 45 and (ins or {}).get("techniques"):
        techs = [t["name"] for t in ins["techniques"][:6]]
        add("appsplit", {
            "left": {"kicker": "in the source", "text": "What it *actually does*.",
                     "items": techs[:3]},
            "right": {"kicker": "in the repo", "text": "What it is *made of*.",
                      "items": [f"{l['name']} {l['share']}%" for l in langs[:3]]},
        }, 1.25, "two sides", "Found by reading the code.", hard=True,
            chap="technique")

    # 8 -- the card people screenshot
    add("endcard", {
        "name": name,
        "sub": story.get("url") or story.get("repo") or "",
        "cta": "made with cased2.0",
    }, 1.0, "end", "", hard=True)

    return plan


def decorate(plan: list, d: dict, rng: random.Random,
             theme_spec: dict) -> None:
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
            s["bg"] = "rings" if theme_spec.get("bg_mode") != "halftone" else "halftone"
            s["cam"] = "pull"
            s["energy"] = round(d["energy"] * 0.55, 3)
        if s["type"] == "retro":
            s["bg"] = "halftone"
            s["cam"] = "none"
        # Structural shots carry their own geometry, so the bed stays quiet and
        # the camera stays still -- a drifting frame fights a diagram.
        if s["type"] in ("arch", "tree", "flow", "callout", "heatmap",
                         "constellation", "compare"):
            s["cam"] = "none"
            s["energy"] = round(min(s["energy"], 0.5), 3)
        if s["type"] in ("arch", "constellation"):
            s["bg"] = "stars"
        if s["type"] in ("tree", "flow", "compare"):
            s["bg"] = "aurora"
        if s["type"] == "heatmap":
            # The grid bed is a perspective tunnel; behind a data grid it
            # reads as interference rather than atmosphere.
            s["bg"] = "aurora"
            s["energy"] = 0.25
        if s["type"] == "bigquote":
            s["cam"] = "push"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def compose(story: dict, beatmap: dict, duration: float = 24.0,
            director: str | None = None, width: int = 1920,
            height: int = 1080, seed: int = 0,
            insight: dict | None = None, theme: str | None = None) -> dict:
    dname, d = pick(director, story.get("kind", "project"))
    rng = random.Random(seed or story.get("seed") or 1)

    # The atlas director draws the repository as a product; passing an insight
    # report switches any other director to the long-form arc.
    if d.get("hud"):
        plan = build_atlas_plan(story, insight, d, duration)
    elif insight:
        plan = build_creative_plan(story, insight, dname, d, rng, duration)
    else:
        plan = build_plan(story, dname, d, rng, duration)

    # The director names a default theme; --theme overrides it. Look and
    # pacing are independent axes, so any theme composes with any director.
    theme_name = theme or d["theme"]
    theme_spec = themes_mod.to_spec(theme_name)
    # Let a strong hero language tint the second accent, but only when the
    # theme was not explicitly chosen -- if someone asked for `ember`, they
    # asked for ember, not ember-with-a-Python-blue.
    if not theme and dname in ("cinematic", "orbit", "warm") and story.get("hero_color"):
        theme_spec["accent2"] = story["hero_color"]

    decorate(plan, d, rng, theme_spec)
    shots = _lay_out(plan, duration, beatmap)

    return {
        "version": "2.0",
        "project": story["name"],
        "director": dname,
        "director_label": d["label"],
        "mode": "creative" if insight else "standard",
        "seed": seed or story.get("seed") or 1,
        "fps": 30,
        "width": width,
        "height": height,
        "duration": round(duration, 4),
        "theme": theme_spec,
        "theme_name": theme_name,
        # The frame furniture rides on the director, not the theme: it is
        # pacing and grammar, not palette.
        "hud": bool(d.get("hud")),
        "hud_label": str(story["name"]).upper()[:18],
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

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

#: Which extensions belong to which language name, for the editor status bar.
#: Only used to label a file the analyzer already measured -- never to guess
#: at a language the languages table does not already list.
_EXT_OF = {
    "Python": ("py",), "JavaScript": ("js", "mjs", "cjs", "jsx"),
    "TypeScript": ("ts", "tsx"), "HTML": ("html", "htm"), "CSS": ("css",),
    "SCSS": ("scss",), "Markdown": ("md",), "Rust": ("rs",), "Go": ("go",),
    "Ruby": ("rb",), "Java": ("java",), "C": ("c", "h"), "C++": ("cpp", "cc", "hpp"),
    "C#": ("cs",), "Shell": ("sh", "bash"), "Swift": ("swift",), "Kotlin": ("kt",),
    "PHP": ("php",), "SQL": ("sql",), "Vue": ("vue",), "Svelte": ("svelte",),
}

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


def _pct(v) -> str:
    """A share as a person would write it.

    Python renders 51.0 as "51.0" and JavaScript renders the same JSON value as
    "51", so a share that lands on a whole number made the two composers
    disagree about the text on screen. Drop the empty decimal in both.
    """
    f = float(v)
    return (f"{f:.0f}" if f == int(f) else f"{f:g}") + "%"


def build_plan(story: dict, ins: dict | None, d: dict,
               duration: float) -> list:
    """The film. One grammar, whichever director draws it.

    This used to be one of three plans. The other two -- a short arc of title
    cards and counters, and a long one of diagrams -- drew *data about* the
    repository: a number on a shader, a ring of module names, a globe. They
    were the same slideshow every time, and no amount of theming fixed that,
    because the problem was never the colour.

    So there is one plan now and it draws the repository *as a product*: the
    files scattered as windows, the top-level directories in orbit, recent
    work on a board, real source in an editor, the language split on a
    dashboard. Past about forty seconds it keeps going into the same
    register -- a second file, the README answered in a panel, the two sides
    of the project split across a screen.

    Every beat is conditional on evidence, so a repository with no import
    graph gets no architecture shot rather than an empty one.

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
    feats = story.get("features") or []
    commits = stats.get("commits") or stats.get("commits_seen") or 0

    # 1 -- the scatter, then the name for it
    sample = (story.get("files_sample") or [])[:13]
    add("appwindows", {
        "text": (plural(files, "file") + ". One *repository*.") if files
                else f"{name}, *in one place*.",
        "count": max(6, min(files or 9, 13)), "seed": story.get("seed") or 7,
        # Real paths, with the line count the analyzer counted.
        "files": [{"path": f["path"], "loc": f.get("loc"),
                   "bytes": f.get("bytes"), "lang": f.get("lang")}
                  for f in sample],
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
        counts = {t["path"]: t.get("files") for t in tree if t.get("path")}
        add("apporbit", {
            "title": "Everything it is made of.",
            "mark": name[:2].upper(),
            # The file count beside each name, where the analyzer counted one.
            "items": [{"name": m, "meta": plural(counts[m], "file")}
                      if counts.get(m) else {"name": m} for m in mods],
        }, 1.45, "orbit view", plural(len(mods), "top-level directory").replace(
            "directorys", "directories"), chap="layout")

    # 3 -- recent work, as a board
    tl = story.get("timeline") or []
    if len(tl) >= 3:
        # A card carries what the commit actually was: the subject, the kind
        # of change its prefix declares, and its position in the history.
        def _kind(text):
            head = text.split(":")[0].lower() if ":" in text[:16] else text.lower()
            for key, tag in (("feat", "feature"), ("add", "feature"), ("fix", "fix"),
                             ("perf", "speed"), ("refactor", "refactor"),
                             ("doc", "docs"), ("test", "tests")):
                if head.startswith(key):
                    return tag
            return "change"
        recent = tl[-9:]
        cards = [{"text": _ellipsis(t["text"], 44), "tag": _kind(t["text"]),
                  "meta": f"#{len(tl) - len(recent) + i + 1}"}
                 for i, t in enumerate(recent)]
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

    def _editor_files(active: str) -> list:
        """The sidebar, filled from the real tree rather than three names.

        Four entries in a pane built for a project is the same emptiness the
        rest of these screens had. The file sample is real paths the analyzer
        walked, so the tree can be as deep as a tree.
        """
        paths: list = []
        for f in (story.get("files_sample") or []):
            if f["path"] not in paths:
                paths.append(f["path"])
        for other in moments:
            if other["path"] not in paths:
                paths.append(other["path"])
        hot = stats.get("hottest_file")
        if hot and hot not in paths:
            paths.append(hot)
        if active in paths:
            paths.remove(active)
        paths = [active] + sorted(paths)[:13]
        # Three rows reading README.md is a tree that has lost the plot, so a
        # repeated basename keeps the directory that tells them apart, and a
        # label that is still ambiguous after that drops out rather than
        # appearing twice.
        counts: dict = {}
        for p in paths:
            base = p.rsplit("/", 1)[-1]
            counts[base] = counts.get(base, 0) + 1
        out, used = [], set()
        for p in paths:
            base = p.rsplit("/", 1)[-1]
            label = "/".join(p.split("/")[-2:]) if counts[base] > 1 and "/" in p else base
            if label in used:
                continue
            used.add(label)
            out.append({"name": label, "depth": min(p.count("/"), 3),
                        "active": p == active})
        return out

    def _status(path: str, code: list) -> list:
        """The status bar cells -- each one measured, none of them filler."""
        lang = next((l["name"] for l in langs
                     if path.rsplit(".", 1)[-1].lower() in _EXT_OF.get(l["name"], ())), "")
        cells = [stats.get("branch") or "main"]
        if lang:
            cells.append(lang)
        cells.append(plural(len(code), "line") + " shown")
        cells.append(path)
        return cells

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
            "files": _editor_files(m["path"]),
            "code": m["code"][:14],
            "status": _status(m["path"], m["code"][:14]),
        }, 1.6, "source", m.get("caption", "Real source, not a mockup."),
            chap="the code")

    # 5 -- the stack, on a dashboard
    if len(langs) >= 2:
        hero = langs[0]
        add("appdash", {
            "app": story.get("repo") or name,
            "title": "The stack, *measured*.",
            "value": _pct(hero["share"]), "delta": hero["name"],
            "label": "share of the codebase",
            # The share ladder is the series: real proportions, in order.
            "series": [l["share"] for l in langs[:8]][::-1] or [1],
            # The figures a stack screen carries besides the hero share.
            "topline": [
                {"label": "files", "value": stats.get("files", 0)},
                {"label": "lines", "value": f"{stats.get('loc', 0):,}"},
                {"label": "languages", "value": len(langs)},
                {"label": "directories", "value": stats.get("directories", 0)},
            ],
            # Every language, as a measured row rather than three loose labels.
            "rows": [{"label": l["name"], "value": _pct(l["share"]),
                      "frac": l["share"] / max(langs[0]["share"], 1),
                      "color": l.get("color")}
                     for l in langs[:5]],
        }, 1.35, "stack", f"{len(langs)} languages, measured from the tree.",
            hard=True, chap="stack")

    # 6 -- what it does, in the author's words
    if len(feats) >= 2:
        add("bullets", {"title": "what it does", "items": feats[:5]}, 1.3,
            "capability", "Straight from the README.", chap="what it does")

    # 7 -- the two audiences, if the deep read found a contrast
    if duration >= 45 and (ins or {}).get("techniques"):
        # Each side carries what was counted for it: how many places in the
        # source a technique turned up, and how many files a language is in.
        add("appsplit", {
            "left": {"kicker": "in the source", "text": "What it *actually does*.",
                     "items": [{"name": t["name"],
                                "meta": plural(t["hits"], "place")}
                               for t in ins["techniques"][:6]]},
            "right": {"kicker": "in the repo", "text": "What it is *made of*.",
                      "items": [{"name": f"{l['name']} {_pct(l['share'])}",
                                 "meta": plural(l.get("files") or 0, "file")}
                                for l in langs[:6]]},
        }, 1.25, "two sides", "Found by reading the code.", hard=True,
            chap="technique")

    # 8 -- a long film keeps going in the same register rather than falling
    # back to diagrams. Each of these is gated on the evidence it needs.
    if duration >= 40:
        # The README's own claim, answered in a panel. The words are the
        # author's and the panel says so -- nothing here is generated.
        claims = (ins or {}).get("claims") or story.get("claims") or []
        if claims:
            add("appchat", {
                "app": story.get("repo") or name,
                "title": "In their *own words*.",
                "agent": "README",
                "messages": [
                    {"from": "you", "text": f"What is {name}?"},
                    {"text": _ellipsis(claims[0], 150)},
                ] + ([
                    {"from": "you", "text": "What does it do?"},
                    {"text": _ellipsis(feats[0], 150)},
                ] if feats else []),
                "prompt": "Straight from the repository",
            }, 1.2, "the claim", "Quoted, not generated.", chap="the claim")

        # The work rate, on the screen a product would show it on. Every
        # figure is a count of real commits in a real window of days.
        cad = (ins or {}).get("cadence") or []
        active = sum(1 for v in cad if v)
        if len(cad) >= 60 and active >= 12:
            weeks = [sum(cad[i:i + 7]) for i in range(0, len(cad) - 6, 7)]
            busiest = max(weeks) if weeks else 0
            add("appdash", {
                "app": story.get("repo") or name,
                "title": "The work *rate*.",
                "value": str(active), "delta": "days with a commit",
                "label": f"of the last {len(cad)} days",
                "series": weeks[-16:] or [0, 0],
                "railActive": 5,
                "topline": [
                    {"label": "commits", "value": sum(cad)},
                    {"label": "active days", "value": active},
                    {"label": "weeks", "value": len(weeks)},
                    {"label": "busiest week", "value": busiest},
                ],
                "rows": [{"label": f"week {len(weeks) - i}", "value": str(w),
                          "frac": (w / busiest) if busiest else 0.0, "color": None}
                         for i, w in enumerate(reversed(weeks[-5:]))],
            }, 1.3, "cadence", (ins or {}).get("peak_day", "") or
                "Counted from the commit dates.", hard=True, chap="cadence")

        # What the source turned out to know how to do, in the same ring the
        # directories were drawn in.
        techs = [t["name"] for t in ((ins or {}).get("techniques") or [])][:8]
        if len(techs) >= 4:
            add("apporbit", {
                "title": "What the code *knows how to do*.",
                "mark": name[:2].upper(),
                "items": [{"name": t} for t in techs],
            }, 1.3, "technique", "Found by reading the source, not the README.",
                chap="technique")

        # The project's own documented commands, actually running. The lines
        # are the README's, not a script somebody imagined.
        cmds = [c for c in (story.get("commands") or []) if c][:3]
        if cmds:
            add("terminalrun", {
                "title": stats.get("branch") or "bash",
                "dur": 3.4,
                "lines": [{"kind": "cmd", "text": f"$ {_ellipsis(c, 64)}"} for c in cmds],
            }, 1.2, "run it", "The commands the README documents.", chap="running it")

        # A second file, further into the tree than the first.
        if len(moments) > 1:
            m2 = moments[1]
            add("appcode", {
                "app": story.get("repo") or name,
                "title": "And *here*.",
                "root": m2["path"].split("/")[0],
                "branch": stats.get("branch") or "main",
                "action": "Test",
                "tab": m2["path"].rsplit("/", 1)[-1],
                "files": _editor_files(m2["path"]),
                "code": m2["code"][:14],
                "status": _status(m2["path"], m2["code"][:14]),
                "railActive": 3,
            }, 1.5, "source", m2.get("caption", "Real source, not a mockup."),
                chap="deeper in")

    # 9 -- the card people screenshot
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

    # One grammar, whichever director was picked. The director sets pacing,
    # bed and transition vocabulary; it no longer decides whether the film is
    # a product film, because the slideshow alternative is gone.
    plan = build_plan(story, insight, d, duration)

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

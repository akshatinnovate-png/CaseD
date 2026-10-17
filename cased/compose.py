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


#: Docstring openers, so the callout does not point at one.
#:
#: This lived next to the long-form plan that was deleted, which left
#: `_focus_line` referring to a name that no longer existed. Nothing
#: noticed because nothing called `_focus_line` any more -- it does
#: again now.
_DOCQ = (chr(34) * 3, chr(39) * 3)


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


def _arch_note(ins: dict | None) -> str:
    """One measured sentence about the import graph, or nothing."""
    mods = (ins or {}).get("modules") or []
    edges = (ins or {}).get("edges") or []
    if len(mods) < 4:
        return ""
    note = f"{plural(len(mods), 'module')}, {plural(len(edges), 'import')} between them"
    hub = (ins or {}).get("hub")
    if hub:
        note += f" — everything leans on {hub.rsplit('/', 1)[-1]}"
    return note


def _arch_columns(ins: dict | None) -> dict | None:
    """The import graph as columns, left depending on right.

    The ring the old `arch` shot drew put every module the same distance from
    the middle, which says nothing about direction. Grouping by directory and
    ordering the columns by how much each one is depended upon says it at a
    glance -- and the directory names are real, so the headings are measured
    too rather than invented layer names.
    """
    mods = (ins or {}).get("modules") or []
    edges = (ins or {}).get("edges") or []
    if len(mods) < 4:
        return None

    by_dir: dict = {}
    for i, m in enumerate(mods):
        by_dir.setdefault(m.get("dir") or "(root)", []).append((i, m))

    # A column earns its place by weight, not by alphabet: the directories
    # with the most code and the most connections come first.
    def weight(group):
        return sum(m["loc"] + 90 * (m["deg_in"] + m["deg_out"]) for _, m in group)
    dirs = sorted(by_dir.items(), key=lambda kv: -weight(kv[1]))[:4]
    if len(dirs) < 2:
        return None
    # Left to right: the most depended-upon directory sits on the right, the
    # way a call graph reads.
    dirs.sort(key=lambda kv: sum(m["deg_in"] for _, m in kv[1]))

    nodes, index = [], {}
    hub = (ins or {}).get("hub")
    for ci, (dname, group) in enumerate(dirs):
        pick = sorted(group, key=lambda im: -(im[1]["deg_in"] * 3 + im[1]["deg_out"]
                                              + im[1]["loc"] / 400))[:4]
        for mi, m in pick:
            index[mi] = len(nodes)
            nodes.append({"label": m["label"], "col": ci,
                          "note": str(m["loc"]),
                          "hub": m["id"] == hub})
    if len(nodes) < 4:
        return None

    seen, out = set(), []
    for a, b in edges:
        if a in index and b in index and index[a] != index[b]:
            pair = (index[a], index[b])
            if pair in seen:
                continue
            seen.add(pair)
            out.append([pair[0], pair[1]])
    heads, used = [], set()
    for dname, _ in dirs:
        leaf = dname.rsplit("/", 1)[-1] or dname
        # Keep more of the path only when the leaf alone would repeat.
        heads.append(dname if leaf in used else leaf)
        used.add(leaf)
    return {"columns": heads, "nodes": nodes, "edges": out[:26]}


def _lay_acts(acts: list, cards: bool) -> list:
    """Flatten the acts into a shot list, numbering the ones that survived.

    An act whose evidence never turned up contributes nothing and takes no
    number, so a film that could not read an import graph says `04 / 05`
    rather than leaving a gap where the chapter would have been. The frame
    marker carries the act's name for every shot inside it, which is what
    stops a run of dense screens reading as one long undifferentiated take.
    """
    live = [a for a in acts if a["beats"]]
    numbered = [a for a in live if a["card"] and a["title"]]
    total = len(numbered)
    plan, n = [], 0
    for a in live:
        titled = a["card"] and a["title"]
        if titled:
            n += 1
            mark = f"{n:02d} · {a['title'].lower()}"
            if cards:
                plan.append({
                    "type": "chaptercard",
                    "data": {"number": f"{n:02d}", "total": f"{total:02d}",
                             "text": a["title"], "sub": a["sub"],
                             "invert": n % 2 == 1},
                    # Light: a card is a breath between two dense screens,
                    # not a scene in its own right.
                    "weight": 0.55, "hard": True, "section": "chapter",
                    "chapter": mark,
                })
        else:
            mark = ""
        for b in a["beats"]:
            if mark:
                b["chapter"] = mark
            plan.append(b)
    return plan


def build_plan(story: dict, ins: dict | None, d: dict,
               duration: float) -> list:
    """The film, in chapters.

    This used to be one of three plans. The other two -- a short arc of title
    cards and counters, and a long one of diagrams -- drew *data about* the
    repository: a number on a shader, a ring of module names, a globe. They
    were the same slideshow every time, and no amount of theming fixed that,
    because the problem was never the colour.

    What replaced them drew the repository as a product, which was better and
    still not enough: a dashboard, then an editor, then a board, with nothing
    saying what any of it was for. Dense screens in no order are still a
    jumble -- the viewer has to assemble the argument themselves, and mostly
    does not bother.

    So the film is built as acts now, and each one is announced:

        what it is -> what it does -> how it works -> the code ->
        what it is made of -> the work

    Every act opens on a chapter card carrying its number out of the total,
    and the frame marker names that act for as long as it runs. An act with
    no evidence behind it does not appear and does not take a number, so the
    count on screen is always the count of chapters the film really has.

    Nothing here is invented. Every window, card, pill, tile and figure comes
    out of the analyzer, so the frame stamp reads MEASURED throughout.
    """
    name = story["name"]
    stats = story.get("stats", {})
    langs = story.get("languages", [])

    #: Below this runtime the chapter cards would outnumber the screens, so
    #: the acts still order the film but announce themselves only in the
    #: frame marker. Named `use_cards` because the board beat further down
    #: builds a list called `cards`, and a flag a later line can quietly
    #: overwrite is a flag that will be.
    use_cards = duration >= 30

    acts: list = []

    def act(title: str, sub: str = "", card: bool = True):
        acts.append({"title": title, "sub": sub, "card": card, "beats": []})

    def add(type_, data, weight, section="", caption="", hard=False):
        shot = {"type": type_, "data": data, "weight": weight, "hard": hard}
        if section:
            shot["section"] = section
        if caption:
            shot["caption"] = caption
        acts[-1]["beats"].append(shot)

    files = stats.get("files") or 0
    feats = story.get("features") or []
    commits = stats.get("commits") or stats.get("commits_seen") or 0
    moments = story.get("code_moments") or []

    # ---- the cold open: no card, just the repository ---------------------
    act("", card=False)
    # the scatter, then the name for it
    sample = (story.get("files_sample") or [])[:13]
    add("appwindows", {
        "text": (plural(files, "file") + ". One *repository*.") if files
                else f"{name}, *in one place*.",
        "count": max(6, min(files or 9, 13)), "seed": story.get("seed") or 7,
        # Real paths, with the line count the analyzer counted.
        "files": [{"path": f["path"], "loc": f.get("loc"),
                   "bytes": f.get("bytes"), "lang": f.get("lang")}
                  for f in sample],
    }, 1.15, "the shape", story.get("tagline", "")[:72])

    # ---- what it is ------------------------------------------------------
    act("What it is", story.get("tagline", "")[:96])
    # the top-level directories, in orbit.
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
            "directorys", "directories"))
    # The README's own claim, answered in a panel. The words are the
    # author's and the panel says so -- nothing here is generated.
    claims = (ins or {}).get("claims") or story.get("claims") or []
    if claims and duration >= 34:
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
        }, 1.2, "the claim", "Quoted, not generated.")

    # ---- what it does ----------------------------------------------------
    act("What it does", "Straight from the README.")
    # what it does, in the author's words
    if len(feats) >= 2:
        add("bullets", {"title": "what it does", "items": feats[:5]}, 1.3,
            "capability", "Straight from the README.")
    # The project's own documented commands, actually running. The lines
    # are the README's, not a script somebody imagined.
    cmds = [c for c in (story.get("commands") or []) if c][:3]
    if cmds and duration >= 40:
        add("terminalrun", {
            "title": stats.get("branch") or "bash",
            "dur": 3.4,
            "lines": [{"kind": "cmd", "text": f"$ {_ellipsis(c, 64)}"} for c in cmds],
        }, 1.2, "run it", "The commands the README documents.")

    # What the source turned out to know how to do, in the same ring the
    # directories were drawn in.
    techs = [t["name"] for t in ((ins or {}).get("techniques") or [])][:8]
    if len(techs) >= 4 and duration >= 40:
        add("apporbit", {
            "title": "What the code *knows how to do*.",
            "mark": name[:2].upper(),
            "items": [{"name": t} for t in techs],
        }, 1.3, "technique", "Found by reading the source, not the README.")

    # ---- how it works ----------------------------------------------------
    act("How it works", _arch_note(ins))
    # How the modules actually depend on each other, in columns rather than
    # a ring: left calls right, and the headings name the layers.
    if duration >= 34:
        amap = _arch_columns(ins)
        if amap:
            add("archmap", {
                "title": "How it *fits together*.",
                "columns": amap["columns"],
                "nodes": amap["nodes"],
                "edges": amap["edges"],
                "note": _arch_note(ins),
            }, 1.5, "architecture")
    # the two audiences, if the deep read found a contrast
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
        }, 1.25, "two sides", "Found by reading the code.", hard=True)

    # ---- the code --------------------------------------------------------
    act("The code", moments[0].get("caption", "") if moments else "")

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
        }, 1.6, "source", m.get("caption", "Real source, not a mockup."))
    # The function the project is actually about, with the working line
    # called out. A second editor pane would be the same picture twice; this
    # is the one shot from the old vocabulary worth keeping, because it says
    # something an editor screenshot cannot -- which line matters.
    sig = (ins or {}).get("signature") or {}
    if sig.get("code") and duration >= 40:
        shown = sig["code"][:CALLOUT_LINES]
        add("callout", {
            "path": f"{sig['module']} \u2014 {sig['name']}()",
            "code": shown,
            "highlight": _focus_line(shown),
            "label": "the idea",
            "note": sig.get("doc") or
                    f"{plural(sig['lines'], 'line')}, "
                    f"{plural(sig.get('branches', 0), 'branch')}",
        }, 1.6, "the idea", "The line the rest of it is built around.")

    # A second file, further into the tree than the first.
    if len(moments) > 1 and duration >= 50:
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
        }, 1.5, "source", m2.get("caption", "Real source, not a mockup."))

    # ---- what it is made of ----------------------------------------------
    act("What it is made of", plural(len(langs), "language") if langs else "")
    # the stack, on a dashboard
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
            hard=True)
    # The tools the repository carries, each over the file that proves it.
    if duration >= 34:
        tiles = list(story.get("toolchain") or [])
        # Languages fill the row out with their own measured file counts --
        # the same evidence rule, counted rather than named.
        for l in langs[:4]:
            if len(tiles) >= 6:
                break
            if l.get("files"):
                tiles.append({"name": l["name"],
                              "note": plural(l["files"], "file"),
                              "icon": "bolt"})
        if len(tiles) >= 3:
            add("surfaces", {
                "title": "Built with *what it says it is*.",
                "items": tiles[:6],
            }, 1.25, "toolchain",
                "Every tile names the file that proves it.", hard=True)

    # ---- the work --------------------------------------------------------
    act("The work", plural(commits, "commit") if commits else "")
    # recent work, as a board
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
        }, 1.4, "history", "Every card is a real commit.", hard=True)
    # The work rate, on the screen a product would show it on. Every
    # figure is a count of real commits in a real window of days.
    cad = (ins or {}).get("cadence") or []
    active = sum(1 for v in cad if v)
    if len(cad) >= 60 and active >= 12 and duration >= 40:
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
            "Counted from the commit dates.", hard=True)
    # ---- the close: no card ----------------------------------------------
    act("", card=False)
    # the card people screenshot
    add("endcard", {
        "name": name,
        "sub": story.get("url") or story.get("repo") or "",
        "cta": "made with cased2.0",
    }, 1.0, "end", "", hard=True)


    return _lay_acts(acts, use_cards)


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

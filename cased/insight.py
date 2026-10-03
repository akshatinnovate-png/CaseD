"""
cased2.0 / insight
==================

The deep read.

`analyze` answers "what is this project?" with facts anyone could count --
lines, files, commits. That is enough for a 24-second trailer, and it is
exactly why those trailers feel interchangeable: every repo has lines.

`insight` answers the harder question: **what is interesting about THIS one?**
It builds the import graph to find the architectural centre, locates the
function the project is actually about, recognises the techniques in play,
and reads the shape of the history. That is the material a one-minute film
needs, because a minute of line-counts is a minute of nothing.

Pure standard library. No network.
"""

from __future__ import annotations

import ast
import json
import math
import re
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path

from .analyze import LANGS, SKIP_DIRS, SKIP_FILE_RE, TEST_RE, walk_sources, _read

# ---------------------------------------------------------------------------
# Techniques worth naming on screen.
#
# Keyed by a regex over source text. These are deliberately specific: "uses
# async" is not interesting, "implements Karplus-Strong synthesis" is. If a
# probe is too loose it will fire on every repo and the film goes generic
# again, which is the whole thing we are trying to avoid.
# ---------------------------------------------------------------------------

TECHNIQUES = [
    (r"\bkarplus|plucked.?string", "Karplus-Strong synthesis", "audio"),
    (r"\bfft\b|fourier|spectrogram", "Fourier analysis", "signal"),
    (r"\bwebgl|gl_FragColor|fragment shader|vertexshader", "GPU shaders", "graphics"),
    (r"navigator\.gpu|requestAdapter|@group\(\d", "WebGPU", "graphics"),
    (r"raymarch|signed distance|\bsdf\b", "Ray marching", "graphics"),
    (r"\bfbm\b|perlin|simplex noise|value noise", "Procedural noise", "graphics"),
    (r"quaternion|slerp\b", "Quaternion maths", "3d"),
    (r"\bbezier|catmull|spline", "Spline interpolation", "geometry"),
    (r"reverb|convolution|lowpass|highpass|biquad", "DSP filtering", "audio"),
    (r"sidechain|compressor|limiter", "Dynamics processing", "audio"),
    (r"WebAssembly\.(instantiate|compile)|\.wasm['\"]|wasm-bindgen", "WebAssembly", "systems"),
    (r"\bsimd\b|vectoris|vectoriz", "SIMD", "systems"),
    (r"\bmutex|rwlock|atomic|lock-free", "Concurrency primitives", "systems"),
    (r"\basyncio|async def|tokio|goroutine|coroutine", "Async concurrency", "systems"),
    (r"\bthreadpool|worker_threads|multiprocessing", "Parallel execution", "systems"),
    (r"\blru_cache|memoi[sz]|\bcache\b.*\bhit\b", "Memoisation", "perf"),
    (r"\bzero-copy|mmap\b|memoryview", "Zero-copy IO", "perf"),
    (r"\bb-?tree|trie\b|bloom filter|skip ?list", "Specialised data structures", "algorithms"),
    (r"dijkstra|a\*\s|bfs\b|dfs\b|topological sort", "Graph algorithms", "algorithms"),
    (r"dynamic programming|memo\[|\bdp\[", "Dynamic programming", "algorithms"),
    (r"levenshtein|edit distance|fuzzy match", "Fuzzy matching", "algorithms"),
    (r"\btokeni[sz]er|lexer|parser|\bast\b|grammar", "Parsing", "languages"),
    (r"\btype ?checker|inference|unification", "Type inference", "languages"),
    (r"\bjit\b|bytecode|codegen|compiler", "Code generation", "languages"),
    (r"\btransformer\b|self.?attention|embedding (layer|matrix)", "Neural networks", "ml"),
    (r"(import|require|from)\s+['\"]?(anthropic|openai|@anthropic-ai)|messages\.create|chat\.completions", "LLM integration", "ml"),
    (r"\bffmpeg|libx264|h\.?264|codec", "Video encoding", "media"),
    (r"\bplaywright|puppeteer|headless", "Headless browser automation", "tooling"),
    (r"\bseed\b.*\brandom|deterministic|reproducib", "Deterministic generation", "rigor"),
    (r"property.?based|hypothesis|quickcheck|fuzz", "Property-based testing", "rigor"),
    (r"\bmigration|schema version", "Schema migrations", "data"),
    (r"\bwebsocket|server-sent|\bsse\b", "Realtime transport", "network"),
    (r"\boauth|\bjwt\b|bcrypt|argon2", "Auth and crypto", "security"),
    (r"\bgraphql|\btrpc\b", "Typed API layer", "network"),
]

#: Import statements we can resolve to a module path, per language.
IMPORT_RE = {
    "py": re.compile(r"^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))", re.M),
    "js": re.compile(r"""(?:^\s*import\s+[^'"]*from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"])""", re.M),
}


@dataclass
class Insight:
    modules: list = field(default_factory=list)      # [{id, label, loc, deg_in, deg_out, kind}]
    edges: list = field(default_factory=list)        # [[src_idx, dst_idx]]
    hub: str = ""                                    # the architectural centre
    layers: list = field(default_factory=list)       # top-level dirs, ordered
    tree: list = field(default_factory=list)         # [{path, depth, loc, is_dir}]
    signature: dict = field(default_factory=dict)    # the function the repo is about
    techniques: list = field(default_factory=list)   # [{name, domain, where}]
    pipeline: list = field(default_factory=list)     # [{name, note}] inferred stages
    cadence: list = field(default_factory=list)      # 7x N commit heatmap
    cadence_weeks: int = 0
    peak_day: str = ""
    claims: list = field(default_factory=list)       # strong sentences from the README
    contrasts: list = field(default_factory=list)    # [{left, right}] us-vs-them
    density: dict = field(default_factory=dict)      # complexity profile
    verdict: str = ""                                # one line: what makes this notable

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Module graph
# ---------------------------------------------------------------------------


def _module_id(rel: str) -> str:
    p = rel.rsplit(".", 1)[0]
    p = p.replace("/__init__", "")
    return p


def build_graph(root: Path, ins: Insight) -> dict:
    """Import graph over first-party modules. Third-party edges are dropped --
    they describe the ecosystem, not this codebase's shape."""
    files: dict = {}
    for path, rel in walk_sources(root):
        ext = path.suffix.lower()
        if ext not in (".py", ".js", ".mjs", ".ts", ".tsx", ".jsx"):
            continue
        if TEST_RE.search(rel):
            continue
        text = _read(path)
        if not text:
            continue
        loc = sum(1 for l in text.splitlines() if l.strip())
        if loc < 12:
            continue
        files[_module_id(rel)] = {"rel": rel, "text": text, "loc": loc,
                                  "lang": "py" if ext == ".py" else "js"}

    if not files:
        return files

    ids = list(files)
    index = {m: i for i, m in enumerate(ids)}
    # Last path segment -> module ids, for resolving relative imports.
    by_tail: dict = defaultdict(list)
    for m in ids:
        by_tail[m.rsplit("/", 1)[-1]].append(m)

    edges = set()
    for m, info in files.items():
        rx = IMPORT_RE[info["lang"]]
        for match in rx.finditer(info["text"]):
            target = (match.group(1) or match.group(2) or "").strip()
            if not target:
                continue
            tail = re.split(r"[./\\]", target.rstrip("./"))[-1]
            if not tail:
                continue
            for cand in by_tail.get(tail, []):
                if cand != m:
                    edges.add((index[m], index[cand]))
                    break

    deg_in = Counter(d for _, d in edges)
    deg_out = Counter(s for s, _ in edges)

    ins.modules = [{
        "id": m,
        "label": m.rsplit("/", 1)[-1],
        "dir": m.rsplit("/", 1)[0] if "/" in m else "",
        "loc": files[m]["loc"],
        "deg_in": deg_in.get(i, 0),
        "deg_out": deg_out.get(i, 0),
    } for i, m in enumerate(ids)]
    ins.edges = [[s, d] for s, d in sorted(edges)]

    if ins.modules:
        # The hub is what most things depend on, size breaking the tie.
        hub = max(ins.modules, key=lambda m: (m["deg_in"] * 3 + m["deg_out"], m["loc"]))
        ins.hub = hub["id"]
    return files


# ---------------------------------------------------------------------------
# The signature function
# ---------------------------------------------------------------------------


def find_signature(files: dict, ins: Insight) -> None:
    """The one function the project is really about.

    Scored on size, a name that says something, a real docstring, and
    density of branching. A 400-line `main()` loses to a 60-line
    `compose_score()` -- the point is to show intent, not bulk.
    """
    best = None
    for m, info in files.items():
        if info["lang"] != "py":
            continue
        try:
            tree = ast.parse(info["text"])
        except SyntaxError:
            continue
        lines = info["text"].splitlines()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            end = getattr(node, "end_lineno", node.lineno + 10)
            span = end - node.lineno
            if not (8 <= span <= 90):
                continue
            name = node.name
            if name.startswith("__") or name in {"main", "setup", "run"}:
                continue
            doc = ast.get_docstring(node) or ""
            branches = sum(1 for n in ast.walk(node)
                           if isinstance(n, (ast.If, ast.For, ast.While, ast.Try)))
            score = 0.0
            score += min(span, 50) * 0.5
            score += len(name) * 0.6 if "_" in name else 0
            score += 22 if doc else 0
            score += min(len(doc), 220) * 0.08
            score += branches * 2.4
            score += 14 if not name.startswith("_") else 0
            if re.search(r"(compose|render|analy|score|build|solve|parse|optimi|"
                         r"resolve|plan|infer|pack|schedule|match|transform)", name):
                score += 20
            if best is None or score > best[0]:
                body = [l.rstrip()[:74] for l in lines[node.lineno - 1:min(end, node.lineno + 13)]]
                pad = min((len(l) - len(l.lstrip()) for l in body if l.strip()), default=0)
                best = (score, {
                    "name": name,
                    "module": info["rel"],
                    "lines": span,
                    "doc": re.sub(r"\s+", " ", doc).strip()[:190],
                    "branches": branches,
                    "code": [l[pad:] for l in body],
                })
    if best:
        ins.signature = best[1]


# ---------------------------------------------------------------------------
# Techniques, pipeline, density
# ---------------------------------------------------------------------------


#: This module lists every probe as a literal, so scanning it finds all of
#: them and the film confidently announces techniques the project has never
#: heard of. Any file carrying the table is evidence of nothing.
_SELF = Path(__file__).name


def detect_techniques(files: dict, root: Path, ins: Insight) -> None:
    blobs = []
    for m, info in files.items():
        rel = info["rel"]
        if Path(rel).name == _SELF:
            continue
        blobs.append((rel, info["text"].lower()))
    for extra in ("README.md", "readme.md"):
        p = root / extra
        if p.exists():
            blobs.append((extra, _read(p).lower()))

    found: dict = {}
    for rx, name, domain in TECHNIQUES:
        pat = re.compile(rx, re.I)
        hits = [rel for rel, text in blobs if pat.search(text)]
        if not hits:
            continue
        # A single mention in prose is a passing reference; a mention in real
        # source, or in two places, is the project actually doing the thing.
        code_hits = [h for h in hits if not h.lower().endswith(".md")]
        # Two independent sightings, at least one in real source. A lone match
        # is as likely to be a file-extension table or a commit trailer as it
        # is to be the project doing the thing.
        if len(hits) < 2 or not code_hits:
            continue
        found[name] = {"name": name, "domain": domain,
                       "where": (code_hits or hits)[0], "hits": len(hits)}
    ranked = sorted(found.values(), key=lambda t: -t["hits"])
    ins.techniques = ranked[:8]


def infer_pipeline(root: Path, files: dict, ins: Insight) -> None:
    """Stage names, if the project describes itself as a pipeline.

    Looks for an arrow chain in the README (`a -> b -> c`), then falls back
    to top-level modules ordered by how much they are depended upon.
    """
    for cand in ("README.md", "readme.md"):
        p = root / cand
        if not p.exists():
            continue
        text = _read(p)
        for line_group in re.findall(r"```[^\n]*\n(.*?)```", text, re.S):
            rows = [r for r in line_group.splitlines() if re.search(r"(->|→|=>)", r)]
            if len(rows) >= 3:
                stages = []
                for r in rows[:6]:
                    # A pipeline row reads "name   input -> output   prose".
                    # The useful note is the output: the first segment after
                    # the arrow. Joining every column produces mush like
                    # "repo story.json what this project actually is".
                    parts = re.split(r"(?:->|→|=>)", r.strip(), 1)
                    nm = re.split(r"\s{2,}", parts[0].strip(" `|*-"))[0].strip()
                    note = ""
                    if len(parts) > 1:
                        note = re.split(r"\s{2,}", parts[1].strip(" `|*-"))[0].strip()
                    if nm and len(nm) < 24:
                        stages.append({"name": nm, "note": note[:30]})
                if len(stages) >= 3:
                    ins.pipeline = stages
                    return

    tops = [m for m in ins.modules if "/" in m["id"]]
    tops.sort(key=lambda m: -(m["deg_in"] * 2 + m["loc"] / 100))
    ins.pipeline = [{"name": m["label"], "note": f"{m['loc']} lines"} for m in tops[:5]]


def profile_density(files: dict, ins: Insight) -> None:
    locs = sorted((i["loc"] for i in files.values()), reverse=True)
    if not locs:
        return
    total = sum(locs)
    ins.density = {
        "files": len(locs),
        "total": total,
        "median": locs[len(locs) // 2],
        "largest": locs[0],
        # What share of the code lives in the top 20% of files.
        "top20_share": round(sum(locs[:max(1, len(locs) // 5)]) / total * 100, 1),
    }


# ---------------------------------------------------------------------------
# History shape
# ---------------------------------------------------------------------------


def commit_cadence(root: Path, ins: Insight, weeks: int = 26) -> None:
    if not (root / ".git").exists():
        return
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%aI", f"--since={weeks} weeks ago"],
            capture_output=True, text=True, timeout=25)
    except Exception:
        return
    if out.returncode != 0:
        return
    days: Counter = Counter()
    for line in out.stdout.splitlines():
        try:
            d = datetime.fromisoformat(line.strip()).date()
        except ValueError:
            continue
        days[d] += 1
    if not days:
        return
    last = max(days)
    # Align the grid so each column is a week ending on `last`.
    start = last - timedelta(days=weeks * 7 - 1)
    grid = []
    cur = start
    while cur <= last:
        grid.append(days.get(cur, 0))
        cur += timedelta(days=1)
    ins.cadence = grid
    ins.cadence_weeks = max(1, len(grid) // 7)
    busiest = max(days.items(), key=lambda kv: kv[1])
    ins.peak_day = f"{busiest[1]} commits on {busiest[0].isoformat()}"


def build_tree(root: Path, ins: Insight, limit: int = 14) -> None:
    """A small, honest directory listing -- the shape of the repo at a glance."""
    entries: dict = defaultdict(lambda: {"loc": 0, "files": 0})
    for path, rel in walk_sources(root):
        if path.suffix.lower() not in LANGS:
            continue
        top = rel.split("/")[0] if "/" in rel else "."
        text = _read(path)
        entries[top]["loc"] += sum(1 for l in text.splitlines() if l.strip())
        entries[top]["files"] += 1
    rows = sorted(entries.items(), key=lambda kv: -kv[1]["loc"])[:limit]
    biggest = rows[0][1]["loc"] if rows else 1
    ins.tree = [{
        "path": name if name != "." else "(root)",
        "loc": v["loc"],
        "files": v["files"],
        "bar": round(v["loc"] / max(biggest, 1), 3),
        "is_dir": name != ".",
    } for name, v in rows]
    ins.layers = [r["path"] for r in ins.tree[:6]]


# ---------------------------------------------------------------------------
# Language from the README
# ---------------------------------------------------------------------------


def extract_claims(root: Path, ins: Insight) -> None:
    """Sentences the author wrote that actually assert something.

    A claim is a short declarative line making a promise. Headings, install
    steps and table rows are not claims.
    """
    for cand in ("README.md", "readme.md"):
        p = root / cand
        if not p.exists():
            continue
        md = _read(p)
        md = re.sub(r"```.*?```", "", md, flags=re.S)

        # Markdown hard-wraps, so reading line by line slices sentences in
        # half and yields fragments like "screen are measured from your code".
        # Rebuild paragraphs first, then cut on sentence boundaries.
        paras, cur = [], []
        for raw in md.splitlines():
            line = raw.strip()
            if not line or line.startswith(("#", "|", ">", "<", "!", "[", "```")):
                if cur:
                    paras.append(" ".join(cur))
                    cur = []
                continue
            line = re.sub(r"^[-*+]\s+", "", line)
            cur.append(line)
        if cur:
            paras.append(" ".join(cur))

        claims = []
        for para in paras:
            text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", para)   # links
            text = re.sub(r"https?://\S+", "", text)
            text = re.sub(r"[`*]|(?<!\w)_|_(?!\w)", "", text)        # md, keep snake_case
            for sent in re.split(r"(?<=[.!?])\s+", text):
                sent = sent.strip().rstrip(".")
                if not (26 <= len(sent) <= 92):
                    continue
                if re.search(r"(install|npm |pip |git clone|requires?|see the|license)",
                             sent, re.I):
                    continue
                if not re.search(r"\b(is|are|was|does|can|will|has|have|never|no |every|"
                                 r"only|turns|reads|renders|makes|gives|keeps|runs|works)\b",
                                 sent, re.I):
                    continue
                claims.append(sent)
        seen = set()
        uniq = [c for c in claims if not (c.lower() in seen or seen.add(c.lower()))]

        # A claim goes on screen alone, at size, so it has to stand up without
        # the sentence around it. One ending on "behind" or "and" reads as a
        # fragment no matter how good the first half was.
        DANGLING = {"the", "a", "an", "and", "or", "but", "of", "to", "in", "for",
                    "on", "with", "by", "from", "behind", "into", "about", "as",
                    "that", "which", "than", "so", "it", "its", "your", "this"}

        def quality(c: str) -> float:
            words = c.split()
            score = 100.0 - abs(len(c) - 54) * 0.9
            if words and words[-1].lower().strip(",;:") in DANGLING:
                score -= 60                      # dangles -- almost never usable
            if words and words[0].lower() in DANGLING:
                score -= 8
            if re.search(r"\b(never|every|no |only|without|instead|not)\b", c, re.I):
                score += 14                      # a real assertion, not a description
            if re.search(r"\b(you|your)\b", c, re.I):
                score += 8
            if c.count(",") > 2:
                score -= 10
            return -score

        uniq.sort(key=quality)
        ins.claims = uniq[:6]
        break

    # Contrasts: "X, not Y" reads as a built-in comparison shot.
    ins.contrasts = []
    for c in ins.claims:
        m = re.search(r"^(.{8,46}?),\s*not\s+(.{4,42})$", c, re.I)
        if m:
            ins.contrasts.append({"left": m.group(1).strip(), "right": m.group(2).strip()})


def write_verdict(ins: Insight, story: dict) -> None:
    """One line naming what is actually notable here. Used as the film's thesis."""
    bits = []
    if ins.techniques:
        names = [t["name"] for t in ins.techniques[:2]]
        bits.append(" and ".join(names).lower())
    if ins.density.get("top20_share", 0) > 70:
        bits.append("a small core doing most of the work")
    if ins.hub:
        bits.append(f"built around {ins.hub.rsplit('/', 1)[-1]}")
    ins.verdict = ("; ".join(bits))[:150] if bits else ""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def inspect(root: Path, story: dict | None = None) -> Insight:
    root = Path(root).resolve()
    ins = Insight()
    files = build_graph(root, ins)
    find_signature(files, ins)
    detect_techniques(files, root, ins)
    infer_pipeline(root, files, ins)
    profile_density(files, ins)
    commit_cadence(root, ins)
    build_tree(root, ins)
    extract_claims(root, ins)
    write_verdict(ins, story or {})
    return ins


if __name__ == "__main__":
    import sys
    i = inspect(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd())
    d = json.loads(i.to_json())
    d["cadence"] = f"<{len(d['cadence'])} days>"
    print(json.dumps(d, indent=2)[:5000])

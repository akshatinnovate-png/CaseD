"""
cased2.0 / analyze
==================

Reads a project the way a director reads a script: looking for the story.

Unlike a link-scraper, this walks the actual repository -- git history,
language mix, architecture, tests, dependencies -- and distils it into a
`story.json` that every later stage (composer, scorer, renderer) consumes.

Pure standard library. No network. No dependencies.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Language table
# ---------------------------------------------------------------------------

LANGS = {
    ".py": ("Python", "#3572A5"), ".ts": ("TypeScript", "#3178C6"),
    ".tsx": ("TypeScript", "#3178C6"), ".js": ("JavaScript", "#F1E05A"),
    ".jsx": ("JavaScript", "#F1E05A"), ".mjs": ("JavaScript", "#F1E05A"),
    ".cjs": ("JavaScript", "#F1E05A"), ".rs": ("Rust", "#DEA584"),
    ".go": ("Go", "#00ADD8"), ".rb": ("Ruby", "#701516"),
    ".java": ("Java", "#B07219"), ".kt": ("Kotlin", "#A97BFF"),
    ".swift": ("Swift", "#F05138"), ".c": ("C", "#555555"),
    ".h": ("C", "#555555"), ".cc": ("C++", "#F34B7D"),
    ".cpp": ("C++", "#F34B7D"), ".hpp": ("C++", "#F34B7D"),
    ".cs": ("C#", "#178600"), ".php": ("PHP", "#4F5D95"),
    ".ex": ("Elixir", "#6E4A7E"), ".exs": ("Elixir", "#6E4A7E"),
    ".scala": ("Scala", "#C22D40"), ".clj": ("Clojure", "#DB5855"),
    ".hs": ("Haskell", "#5E5086"), ".lua": ("Lua", "#000080"),
    ".sh": ("Shell", "#89E051"), ".zig": ("Zig", "#EC915C"),
    ".dart": ("Dart", "#00B4AB"), ".sql": ("SQL", "#E38C00"),
    ".html": ("HTML", "#E34C26"), ".css": ("CSS", "#563D7C"),
    ".scss": ("CSS", "#563D7C"), ".vue": ("Vue", "#41B883"),
    ".svelte": ("Svelte", "#FF3E00"), ".md": ("Markdown", "#9AA0A6"),
    ".glsl": ("GLSL", "#5686A5"), ".wgsl": ("WGSL", "#5686A5"),
}

# Languages that count as "prose/config", never the hero language.
SOFT_LANGS = {"Markdown", "JSON", "YAML"}

SKIP_DIRS = {
    ".git", "node_modules", "venv", ".venv", "env", "__pycache__", "dist",
    "build", "out", "target", ".next", ".nuxt", "vendor", "coverage",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", "site-packages",
    ".idea", ".vscode", ".cache", ".turbo", ".parcel-cache", "Pods",
    "DerivedData", ".gradle", "bin", "obj", ".terraform", "htmlcov",
    "brag-output", "cased-output", ".svelte-kit", ".astro",
}

SKIP_FILE_RE = re.compile(
    r"(\.min\.(js|css)$|\.lock$|-lock\.json$|\.map$|\.snap$|"
    r"\.(png|jpe?g|gif|webp|svg|ico|mp4|mov|webm|wav|mp3|woff2?|ttf|otf|eot|pdf|zip|gz)$)",
    re.I,
)

TEST_RE = re.compile(r"(^|/)(tests?|spec|__tests__|e2e)(/|$)|(_test\.|\.test\.|\.spec\.|^test_)", re.I)

#: Short words that are acronyms, not words. Capitalising by length alone
#: turns "my-cool-tool" into "MY Cool Tool".
ACRONYMS = {w: w.upper() for w in (
    "api cli sdk ui ux db io ai ml os js ts css html http https json xml yaml "
    "sql gpu cpu tui ssh ssl tls dns cdn orm rpc grpc jwt csv pdf svg wasm"
).split()}

ENTRY_HINTS = [
    "main", "index", "app", "cli", "server", "core", "engine", "run",
    "__main__", "mod", "lib", "root",
]

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Story:
    name: str = "untitled"
    tagline: str = ""
    description: str = ""
    url: str = ""
    repo: str = ""
    license: str = ""
    hero_language: str = ""
    hero_color: str = "#8B5CF6"
    stack: list = field(default_factory=list)
    languages: list = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    highlights: list = field(default_factory=list)
    code_moments: list = field(default_factory=list)
    features: list = field(default_factory=list)
    commands: list = field(default_factory=list)
    timeline: list = field(default_factory=list)
    kind: str = "project"
    mood: str = "cinematic"
    seed: int = 0

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _git(root: Path, *args: str) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True, text=True, timeout=25,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _read(p: Path, limit: int = 400_000) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")[:limit]
    except Exception:
        return ""


def _load_json(p: Path) -> dict:
    try:
        v = json.loads(_read(p))
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _toml_scalar(text: str, key: str, section: str | None = None) -> str:
    """Minimal TOML scalar lookup -- enough for pyproject/Cargo basics."""
    cur = None
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1]
            continue
        if section is not None and cur != section:
            continue
        m = re.match(rf'^{re.escape(key)}\s*=\s*(.+)$', line)
        if m:
            val = m.group(1).strip()
            if val and val[0] in "\"'":
                return val[1:-1] if len(val) > 1 and val[-1] == val[0] else val.strip("\"'")
            return val
    return ""


def _humanise(slug: str) -> str:
    """Title-case a plain slug, but never touch a name that already is one.

    `my-cool-tool` wants to become "My Cool Tool". `cased2.0`, `k8s-sync` and
    `CaseD` do not -- a version suffix or deliberate casing means the author
    already chose how it is spelled, and rewriting it produces "Cased2 0".
    """
    s = slug.strip()
    if not s:
        return slug
    if "." in s or any(ch.isdigit() for ch in s) or not s.islower():
        return s
    return " ".join(ACRONYMS.get(w, w.capitalize())
                    for w in re.sub(r"[-_]+", " ", s).split())


def _sentence(text: str, max_len: int = 150) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text
    cut = text[:max_len]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 40 else cut).rstrip(" ,;:-") + "..."


def _strip_md(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)          # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)      # links
    text = re.sub(r"<[^>]+>", "", text)                        # html
    text = re.sub(r"[`*_#>]+", "", text)                       # md syntax
    return text


# ---------------------------------------------------------------------------
# Walk
# ---------------------------------------------------------------------------


def walk_sources(root: Path, max_files: int = 12_000):
    """Yield (path, relative_posix) for every interesting source file."""
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS and not (d.startswith(".") and d not in {".github"})
        ]
        for fn in filenames:
            if SKIP_FILE_RE.search(fn):
                continue
            p = Path(dirpath) / fn
            try:
                if p.stat().st_size > 1_500_000:
                    continue
            except OSError:
                continue
            yield p, p.relative_to(root).as_posix()
            count += 1
            if count >= max_files:
                return


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


def detect_identity(root: Path, story: Story) -> None:
    name = desc = url = ""

    pkg = _load_json(root / "package.json")
    if pkg:
        name = name or str(pkg.get("name", "")).split("/")[-1]
        desc = desc or str(pkg.get("description", ""))
        hp = pkg.get("homepage")
        url = url or (hp if isinstance(hp, str) else "")
        story.license = story.license or str(pkg.get("license", "") or "")
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        story.stats["dependencies"] = len(deps)
        story.stack.extend(_stack_from_deps(deps.keys()))
        story.commands.extend(
            f"npm run {k}" for k in list(pkg.get("scripts", {}))[:4]
            if k not in {"prepare", "postinstall"}
        )

    pyproject = root / "pyproject.toml"
    if pyproject.exists():
        t = _read(pyproject)
        name = name or _toml_scalar(t, "name", "project") or _toml_scalar(t, "name", "tool.poetry")
        desc = desc or _toml_scalar(t, "description", "project") or _toml_scalar(t, "description", "tool.poetry")
        story.stack.append("Python")

    cargo = root / "Cargo.toml"
    if cargo.exists():
        t = _read(cargo)
        name = name or _toml_scalar(t, "name", "package")
        desc = desc or _toml_scalar(t, "description", "package")
        story.stack.append("Rust")

    gomod = root / "go.mod"
    if gomod.exists():
        m = re.search(r"^module\s+(\S+)", _read(gomod), re.M)
        if m:
            name = name or m.group(1).split("/")[-1]
        story.stack.append("Go")

    # Git remote -> canonical repo slug
    remote = _git(root, "config", "--get", "remote.origin.url")
    if remote:
        m = re.search(r"[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?$", remote.strip())
        if m:
            owner, rname = m.group(1), m.group(2)
            story.repo = f"{owner}/{rname}"
            name = name or rname
            url = url or f"https://github.com/{owner}/{rname}"

    name = name or root.resolve().name
    story.name = _humanise(name)
    story.url = url

    if not story.license:
        lic = root / "LICENSE"
        if lic.exists():
            head = _read(lic, 2000)
            for known in ("MIT", "Apache", "BSD", "GPL", "MPL", "ISC", "Unlicense"):
                if known.lower() in head.lower():
                    story.license = known
                    break

    readme = next(
        (root / c for c in ("README.md", "readme.md", "README.rst", "README.txt", "README")
         if (root / c).exists()),
        None,
    )
    if readme:
        desc = desc or _readme_pitch(_read(readme))
        story.features = _readme_features(_read(readme))

    story.description = _sentence(_strip_md(desc), 190)
    story.tagline = _tagline_from(story.description) or f"{story.name}, shipped."


def _stack_from_deps(names) -> list:
    table = {
        "react": "React", "next": "Next.js", "vue": "Vue", "svelte": "Svelte",
        "solid-js": "Solid", "astro": "Astro", "three": "Three.js",
        "tailwindcss": "Tailwind", "express": "Express", "fastify": "Fastify",
        "typescript": "TypeScript", "vite": "Vite", "playwright": "Playwright",
        "prisma": "Prisma", "drizzle-orm": "Drizzle", "trpc": "tRPC",
        "@anthropic-ai/sdk": "Claude API", "openai": "OpenAI",
        "electron": "Electron", "vitest": "Vitest", "jest": "Jest",
    }
    found = []
    for n in names:
        key = n.lower()
        for probe, label in table.items():
            if key == probe or key.endswith("/" + probe):
                found.append(label)
    return found


def _tagline_from(description: str) -> str:
    """A headline-length line, cut on punctuation rather than mid-word.

    Descriptions are usually one long sentence with the real headline sitting
    in front of the first dash or comma. Take that clause when it stands up on
    its own; only fall back to truncation when nothing clean presents itself.
    """
    text = (description or "").strip().rstrip(".")
    if not text:
        return ""
    if len(text) <= 72:
        return text
    for sep in (" \u2014 ", " \u2013 ", " - ", ": ", ", "):
        head = text.split(sep, 1)[0].strip()
        if 24 <= len(head) <= 72:
            return head
    cut = text[:72].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:\u2014\u2013-")


def _readme_pitch(md: str) -> str:
    """The elevator pitch: first prose paragraph after the title, first sentence.

    Markdown hard-wraps, so a single sentence is routinely spread over three
    lines. Reading one line gives you a fragment ending in a dangling dash --
    gather the whole paragraph first, then cut on a sentence boundary.
    """
    lines = md.splitlines()
    para: list = []
    for raw in lines:
        line = raw.strip()
        skip = (not line or line.startswith("#")
                or line.startswith(("![", "[!", "<", "|", "---", "===", "```", "> [!", "- ", "* ")))
        if skip:
            if para:
                break          # paragraph ended
            continue
        clean = _strip_md(line).strip()
        if not clean:
            continue
        if not para and (len(clean) < 12
                         or clean.lower().startswith(("install", "npm ", "pip ", "git clone"))):
            continue
        para.append(clean)
        if len(" ".join(para)) > 260:
            break
    if not para:
        return ""
    text = re.sub(r"\s+", " ", " ".join(para)).strip()
    # First sentence, if there is a clean one of reasonable length.
    m = re.match(r"^(.{24,200}?[.!?])(\s|$)", text)
    if m:
        return m.group(1).strip()
    return text.rstrip(" -\u2014\u2013,;:")


def _readme_features(md: str) -> list:
    """Bullet lists under a features-ish heading, else the first strong list."""
    feats, in_section, generic = [], False, []
    for raw in md.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            in_section = bool(re.search(
                r"(feature|what(?:'s| is)|why|highlight|capabilit|how it works)", line, re.I))
            continue
        m = re.match(r"^[-*+]\s+(.+)$", line)
        if m:
            body = m.group(1).strip()
            # A bullet written as "**Lead-in.** Supporting detail..." is a
            # headline plus its footnote; on screen we only want the headline.
            lead = re.match(r"^\*\*(.+?)\*\*", body)
            txt = _strip_md(lead.group(1) if lead else body).strip()
            txt = re.split(r"(?<=[.!?])\s", txt)[0].strip().rstrip(".")
            if 10 < len(txt) <= 66:
                (feats if in_section else generic).append(txt)
    out = feats or generic
    return out[:6]


# ---------------------------------------------------------------------------
# Source survey
# ---------------------------------------------------------------------------


def survey_sources(root: Path, story: Story) -> list:
    loc_by_lang: Counter = Counter()
    files_by_lang: Counter = Counter()
    candidates = []
    total_files = total_loc = test_files = 0
    dirs: Counter = Counter()

    for path, rel in walk_sources(root):
        ext = path.suffix.lower()
        lang_info = LANGS.get(ext)
        total_files += 1
        top = rel.split("/")[0] if "/" in rel else "."
        dirs[top] += 1

        if not lang_info:
            continue
        lang, color = lang_info
        text = _read(path)
        if not text:
            continue
        lines = text.splitlines()
        loc = sum(1 for ln in lines if ln.strip())
        loc_by_lang[lang] += loc
        files_by_lang[lang] += 1
        total_loc += loc

        if TEST_RE.search(rel):
            test_files += 1
            continue
        if lang not in SOFT_LANGS and 25 <= len(lines) <= 2500:
            candidates.append((path, rel, lang, color, lines))

    story.stats.update(
        files=total_files,
        loc=total_loc,
        test_files=test_files,
        directories=len([d for d in dirs if d != "."]),
    )

    ranked = [
        {"name": lang, "loc": loc, "files": files_by_lang[lang],
         "color": LANGS[next(e for e, v in LANGS.items() if v[0] == lang)][1],
         "share": round(loc / total_loc * 100, 1) if total_loc else 0.0}
        for lang, loc in loc_by_lang.most_common(8)
    ]
    story.languages = ranked

    hero = next((l for l in ranked if l["name"] not in SOFT_LANGS), None)
    if hero:
        story.hero_language = hero["name"]
        story.hero_color = hero["color"]
        if hero["name"] not in story.stack:
            story.stack.insert(0, hero["name"])

    story.stack = list(dict.fromkeys(story.stack))[:7]
    return candidates


# ---------------------------------------------------------------------------
# Code moments -- the shots where real source appears on screen
# ---------------------------------------------------------------------------


def pick_code_moments(candidates: list, story: Story, want: int = 3) -> None:
    """Score every file for on-screen appeal, then pick a photogenic slice."""
    scored = []
    for path, rel, lang, color, lines in candidates:
        stem = path.stem.lower()
        score = 0.0
        if any(h == stem for h in ENTRY_HINTS):
            score += 46
        elif any(h in stem for h in ENTRY_HINTS):
            score += 20
        if story.hero_language and lang == story.hero_language:
            score += 30
        depth = rel.count("/")
        score += max(0, 16 - depth * 5)
        score += min(len(lines) / 28.0, 22)
        # Dense, declarative code reads best on screen.
        body = "\n".join(lines)
        score += min(body.count("def ") + body.count("function ") +
                     body.count("class ") + body.count("fn ") +
                     body.count("export "), 14) * 1.7
        if re.search(r"(TODO|FIXME|XXX)", body):
            score -= 8
        scored.append((score, rel, lang, color, lines))

    scored.sort(key=lambda t: -t[0])
    seen_dirs: set = set()
    seen_captions: set = set()
    picked = 0

    for score, rel, lang, color, lines in scored:
        if picked >= want:
            break
        d = rel.rsplit("/", 1)[0] if "/" in rel else "."
        if d in seen_dirs and picked:        # spread shots across the codebase
            continue
        snippet = _best_slice(lines, span=14)
        if not snippet:
            continue
        seen_dirs.add(d)
        picked += 1
        story.code_moments.append({
            "path": rel,
            "lang": lang,
            "color": color,
            "start_line": snippet[0],
            "code": snippet[1],
            "caption": _caption_for(rel, lang, seen_captions),
        })


def _best_slice(lines: list, span: int = 14) -> tuple | None:
    """Slide a window over the file; keep the densest, least-blank region."""
    n = len(lines)
    if n == 0:
        return None
    span = min(span, n)
    best_i, best_score = 0, -1e9
    for i in range(0, max(1, n - span + 1)):
        win = lines[i:i + span]
        filled = sum(1 for l in win if l.strip())
        if filled < span * 0.65:
            continue
        # Prefer modest indentation and reasonable line length.
        indent = sum(len(l) - len(l.lstrip()) for l in win if l.strip()) / max(filled, 1)
        avg_len = sum(len(l) for l in win) / span
        over = sum(1 for l in win if len(l) > 74)
        score = filled * 3 - indent * 1.2 - abs(avg_len - 46) * 0.35 - over * 6
        if any(l.strip().startswith(("def ", "class ", "export ", "function ", "fn ", "pub ", "async "))
               for l in win[:5]):
            score += 14
        if score > best_score:
            best_score, best_i = score, i
    win = lines[best_i:best_i + span]
    while win and not win[-1].strip():
        win.pop()
    if not win:
        return None
    # De-indent as a block so it sits flush on screen.
    pad = min((len(l) - len(l.lstrip()) for l in win if l.strip()), default=0)
    return best_i + 1, [l[pad:].rstrip()[:76] for l in win]


def _caption_for(rel: str, lang: str, used: set | None = None) -> str:
    """A short caption for a code shot, never repeated across the film.

    Two files can both look like an entry point -- `cli.py` and `index.html`
    both match -- and captioning both "the entry point" reads as a bug on
    screen. Fall back to the directory when the first choice is taken.
    """
    stem = Path(rel).stem.lower()
    pick = None
    if stem in {"main", "__main__", "index", "app", "cli"}:
        pick = "the entry point"
    elif "engine" in stem or "core" in stem:
        pick = "the engine room"
    elif "render" in stem or "draw" in stem:
        pick = "where pixels happen"
    elif "server" in stem or "api" in stem or "route" in rel:
        pick = "the wire protocol"
    elif "model" in stem or "schema" in stem:
        pick = "the shape of the data"
    elif "parse" in stem or "lex" in stem or "token" in stem:
        pick = "reading the input"
    elif "score" in stem or "audio" in stem or "sound" in stem:
        pick = "where the music comes from"
    elif "compose" in stem or "edit" in stem:
        pick = "cutting it together"
    elif "analy" in stem or "scan" in stem:
        pick = "reading the work"

    if used is not None and pick in used:
        pick = None
    if pick is None:
        parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
        cands = [f"inside {parent}" if parent else "", f"{lang}, where it counts",
                 rel]
        pick = next((c for c in cands if c and (used is None or c not in used)), rel)
    if used is not None:
        used.add(pick)
    return pick


# ---------------------------------------------------------------------------
# Git narrative
# ---------------------------------------------------------------------------


def survey_git(root: Path, story: Story) -> None:
    if not (root / ".git").exists():
        return

    count = _git(root, "rev-list", "--count", "HEAD")
    if count.isdigit():
        story.stats["commits"] = int(count)

    authors = _git(root, "shortlog", "-sne", "HEAD")
    if authors:
        story.stats["contributors"] = len([l for l in authors.splitlines() if l.strip()])

    first = _git(root, "log", "--reverse", "--format=%aI", "--max-count=1")
    last = _git(root, "log", "-1", "--format=%aI")
    if first and last:
        try:
            f = datetime.fromisoformat(first)
            l = datetime.fromisoformat(last)
            story.stats["age_days"] = max((l - f).days, 0)
            story.stats["first_commit"] = f.date().isoformat()
            story.stats["last_commit"] = l.date().isoformat()
        except ValueError:
            pass

    branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if branch:
        story.stats["branch"] = branch

    subjects = _git(root, "log", "--format=%s", "--max-count=400").splitlines()
    if subjects:
        story.timeline = _timeline_from(subjects)
        story.stats["themes"] = _themes_from(subjects)

    # Busiest file -- a nice "this is where the work went" beat.
    churn = _git(root, "log", "--name-only", "--format=", "--max-count=400").splitlines()
    hot = Counter(p for p in churn if p.strip() and not SKIP_FILE_RE.search(p))
    if hot:
        p, c = hot.most_common(1)[0]
        if c > 1:
            story.stats["hottest_file"] = p
            story.stats["hottest_file_touches"] = c


def _timeline_from(subjects: list) -> list:
    """Turn commit subjects into a few human milestones, newest last."""
    picks, seen = [], set()
    priority = [
        (re.compile(r"^(feat|add|introduc|implement|new)\b", re.I), "feature"),
        (re.compile(r"^(perf|optimi|speed|fast)\b", re.I), "speed"),
        (re.compile(r"^(fix|bug|patch|repair)\b", re.I), "fix"),
        (re.compile(r"^(refactor|rework|rewrite|clean)\b", re.I), "refactor"),
        (re.compile(r"(release|v\d+\.\d+|ship|launch)", re.I), "release"),
    ]
    for subj in subjects:
        s = re.sub(r"^\w+(\([^)]*\))?!?:\s*", "", subj).strip()
        if len(s) < 8 or len(s) > 64:
            continue
        key = s.lower()[:28]
        if key in seen:
            continue
        kind = next((k for rx, k in priority if rx.search(subj)), None)
        if not kind:
            continue
        seen.add(key)
        picks.append({"kind": kind, "text": s[0].upper() + s[1:]})
        if len(picks) >= 6:
            break
    return list(reversed(picks))


def _themes_from(subjects: list) -> list:
    stop = set("""the a an and or of to in for on with by from at is are be was this that
        it its as not but if then else when fix fixes fixed add adds added update updates
        updated make makes use used using new now also into via can will more just only
        we you our your""".split())
    words = Counter()
    for s in subjects:
        for w in re.findall(r"[a-zA-Z][a-zA-Z-]{3,}", s.lower()):
            if w not in stop:
                words[w] += 1
    return [w for w, c in words.most_common(6) if c >= 2]


# ---------------------------------------------------------------------------
# Highlights -- the numbers that go on screen. Every one is measured.
# ---------------------------------------------------------------------------


def build_highlights(story: Story) -> None:
    s = story.stats
    out = []

    def add(value, label, unit=""):
        """`label` is given plural; singularise it when the count is exactly 1."""
        if not value:
            return
        try:
            one = int(value) == 1
        except (TypeError, ValueError):
            one = False
        if one and label.endswith("s"):
            label = label[:-1]
        out.append({"value": _fmt(value), "label": label, "unit": unit})

    add(s.get("loc"), "lines of source")
    add(s.get("commits"), "commits")
    add(s.get("files"), "files")
    if s.get("contributors", 0) > 1:
        add(s["contributors"], "contributors")
    if s.get("age_days", 0) > 1:
        add(s["age_days"], "days in the making")
    if s.get("test_files"):
        add(s["test_files"], "test files")
    if s.get("dependencies") is not None and s.get("dependencies", 0) >= 0:
        add(s.get("dependencies"), "dependencies")
    if story.languages:
        add(len(story.languages), "languages")

    story.highlights = out[:5]


def plural(n, word: str) -> str:
    """`3 commits` / `1 commit`. Used anywhere a count reaches a human."""
    try:
        n = int(n)
    except (TypeError, ValueError):
        return f"{n} {word}"
    return f"{n:,} {word}" + ("" if n == 1 else "s")


def _fmt(n) -> str:
    try:
        n = int(n)
    except (TypeError, ValueError):
        return str(n)
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M".replace(".0M", "M")
    if n >= 10_000:
        return f"{n/1000:.0f}K"
    if n >= 1000:
        return f"{n/1000:.1f}K".replace(".0K", "K")
    return str(n)


def classify(story: Story) -> None:
    """What kind of thing is this? Drives the director's shot grammar."""
    blob = " ".join([story.name, story.description, " ".join(story.stack),
                     " ".join(story.features)]).lower()
    if any(k in blob for k in ("cli", "command line", "terminal", "shell")) or story.commands:
        story.kind = "tool"
    if any(k in blob for k in ("api", "server", "backend", "service", "daemon")):
        story.kind = "service"
    if any(k in blob for k in ("game", "engine", "render", "shader", "graphics", "webgl")):
        story.kind = "visual"
    if any(k in blob for k in ("ai", "llm", "model", "agent", "ml", "neural", "claude")):
        story.kind = "ai"
    if any(k in blob for k in ("site", "web app", "dashboard", "ui", "component", "react")):
        story.kind = "app"
    if any(k in blob for k in ("library", "sdk", "framework", "package", "toolkit")):
        story.kind = "library"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def analyze(root: Path, seed: int = 0, url: str = "") -> Story:
    root = Path(root).resolve()
    story = Story(seed=seed)
    detect_identity(root, story)
    if url:
        story.url = url
    candidates = survey_sources(root, story)
    survey_git(root, story)
    pick_code_moments(candidates, story)
    build_highlights(story)
    classify(story)
    if not story.seed:
        story.seed = abs(hash((story.name, story.stats.get("loc", 0)))) % 2**31
    return story


def main(argv: list) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path.cwd()
    story = analyze(root)
    sys.stdout.write(story.to_json() + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

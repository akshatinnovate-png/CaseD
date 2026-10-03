#!/usr/bin/env python3
"""
cased2.0 smoke test.

Exercises every stage of the pipeline end to end, including a real two-second
render, and asserts the invariants that are easy to break by accident -- shot
tiling, beat snapping, audio level, determinism.

    python3 scripts/selftest.py          # full, renders a 2s film
    python3 scripts/selftest.py --fast   # skip the render stage
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cased.analyze import analyze                      # noqa: E402
from cased.compose import compose, MIN_SHOT            # noqa: E402
from cased.directors import DIRECTORS, pick            # noqa: E402
from cased import score as score_mod                   # noqa: E402
from cased.insight import inspect                      # noqa: E402

PASS, FAIL = "\033[92m  ok \033[0m", "\033[91mFAIL \033[0m"
failures: list = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"{PASS if cond else FAIL} {name}" + (f"  — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def main(argv) -> int:
    fast = "--fast" in argv
    tmp = Path(tempfile.mkdtemp(prefix="cased-selftest-"))
    print(f"\ncased2.0 self-test  ({'fast' if fast else 'full'})\n")

    # ---- analyze ----------------------------------------------------------
    print("analyze")
    story_obj = analyze(ROOT, seed=4242)
    story = json.loads(story_obj.to_json())
    check("finds a project name", bool(story["name"]))
    check("finds a hero language", bool(story["hero_language"]), story["hero_language"])
    check("measures lines of source", story["stats"].get("loc", 0) > 100)
    check("finds code moments", len(story["code_moments"]) >= 1)
    check("code lines are trimmed",
          all(len(l) <= 76 for m in story["code_moments"] for l in m["code"]))
    check("highlights are singularised",
          all(not (h["value"] == "1" and h["label"].endswith("s")) for h in story["highlights"]))
    check("is deterministic",
          json.loads(analyze(ROOT, seed=4242).to_json()) == story)

    # ---- score ------------------------------------------------------------
    print("\nscore")
    wav = tmp / "s.wav"
    bm = score_mod.render(24.0, wav, "cinematic", 4242, 0.9)
    check("writes a wav", wav.exists() and wav.stat().st_size > 40_000)
    check("reports a tempo", 60 <= bm["bpm"] <= 200, str(bm["bpm"]))
    check("emits a beat grid", len(bm["beats"]) > 8)
    check("emits section accents", len(bm["accents"]) >= 1)

    with wave.open(str(wav)) as w:
        n = w.getnframes()
        vals = struct.unpack(f"<{n*2}h", w.readframes(n))
    peak = max(abs(v) for v in vals)
    sub = vals[::29]
    rms = math.sqrt(sum(v * v for v in sub) / len(sub))
    check("is stereo 44.1k", (w.getnchannels(), w.getframerate()) == (2, 44100))
    check("peaks near full scale", peak > 24_000, f"peak {20*math.log10(peak/32768):.1f} dBFS")
    check("is not clipped flat", peak < 32_767)
    check("has usable loudness", rms > 1500, f"rms {20*math.log10(rms/32768):.1f} dBFS")

    # same seed, same audio
    wav2 = tmp / "s2.wav"
    score_mod.render(24.0, wav2, "cinematic", 4242, 0.9)
    check("is deterministic", wav.read_bytes() == wav2.read_bytes())

    # ---- compose ----------------------------------------------------------
    print("\ncompose")
    for dname in DIRECTORS:
        spec = compose(story, bm, 24.0, dname, 1920, 1080, 4242)
        shots = spec["shots"]
        gaps = [round(shots[i + 1]["start"] - (shots[i]["start"] + shots[i]["dur"]), 3)
                for i in range(len(shots) - 1)]
        covers = abs(shots[-1]["start"] + shots[-1]["dur"] - spec["duration"]) < 0.02
        short = [s for s in shots if s["dur"] < MIN_SHOT * 0.8]
        check(f"{dname}: shots tile with no gaps", all(abs(g) < 0.002 for g in gaps),
              f"gaps {gaps}")
        check(f"{dname}: fills the runtime", covers)
        check(f"{dname}: no flicker shots", not short)
        check(f"{dname}: starts at zero", shots[0]["start"] == 0.0)
        check(f"{dname}: every shot has a builder",
              all(s["type"] in {"title","stat","code","bullets","langs","timeline",
                                "globe","retro","endcard"} for s in shots))

    spec = compose(story, bm, 24.0, "cinematic", 1920, 1080, 4242)
    beats = set(bm["beats"]) | {a["time"] for a in bm["accents"]}
    cuts = len(spec["shots"]) - 1
    snapped = sum(1 for s in spec["shots"][1:]
                  if min(abs(b - s["start"]) for b in beats) < 0.06)
    check("every cut lands on the beat", snapped == cuts, f"{snapped}/{cuts}")
    check("share copy is written", all(spec["share"].get(k) for k in
                                       ("x", "linkedin", "hn", "alt_text")))

    # A short runtime cannot hold the full plan; the composer must shed beats
    # rather than hand the last shots zero or negative length.
    for dur in (6.0, 8.0, 12.0, 40.0):
        sp = compose(story, bm, dur, "cinematic", 1920, 1080, 4242)
        sh = sp["shots"]
        ends = abs(sh[-1]["start"] + sh[-1]["dur"] - dur) < 0.02
        gaps = all(abs(sh[i + 1]["start"] - (sh[i]["start"] + sh[i]["dur"])) < 0.002
                   for i in range(len(sh) - 1))
        check(f"{dur:g}s: every shot has positive length",
              all(x["dur"] > 0.5 for x in sh),
              f"min {min(x['dur'] for x in sh):.2f}s")
        check(f"{dur:g}s: tiles the runtime", ends and gaps)
        check(f"{dur:g}s: keeps an open and a close",
              sh[0]["type"] == "title" and sh[-1]["type"] == "endcard")
    check("compose is deterministic",
          compose(story, bm, 24.0, "cinematic", 1920, 1080, 4242) == spec)

    # ---- creative mode ----------------------------------------------------
    print("\ncreative")
    ins_obj = inspect(ROOT, story)
    ins = json.loads(ins_obj.to_json())
    check("builds an import graph", len(ins["modules"]) >= 3)
    check("finds the hub", bool(ins["hub"]), ins["hub"])
    check("finds a signature function", bool(ins["signature"].get("code")),
          ins["signature"].get("name", "-"))

    # Every technique must be corroborated in real source. A detector that
    # fires on its own pattern table turns the film into confident fiction.
    bad = [t["name"] for t in ins["techniques"]
           if t["hits"] < 2 or t["where"].lower().endswith(".md")]
    check("techniques are evidence-backed", not bad, str(bad))
    check("techniques exclude the detector itself",
          not any(t["where"].endswith("insight.py") for t in ins["techniques"]))

    # Claims go on screen alone, so none may end on a dangling word.
    dangle = [c for c in ins["claims"]
              if c.split()[-1].lower().strip(",;:") in
              {"the", "a", "an", "and", "or", "of", "to", "behind", "with", "for"}]
    check("claims do not dangle", not dangle, str(dangle[:2]))

    cspec = compose(story, bm, 60.0, "creative", 1920, 1080, 4242, insight=ins)
    cs = cspec["shots"]
    check("creative mode is long-form", len(cs) >= 12, f"{len(cs)} shots")
    check("creative uses structural shots",
          len({s["type"] for s in cs} & {"arch", "tree", "flow", "callout",
                                         "constellation", "compare", "bigquote"}) >= 4)
    check("no two adjacent shots repeat a type",
          all(cs[i]["type"] != cs[i + 1]["type"] for i in range(len(cs) - 1)))
    check("creative tiles 60s",
          abs(cs[-1]["start"] + cs[-1]["dur"] - 60.0) < 0.02 and
          all(abs(cs[i + 1]["start"] - (cs[i]["start"] + cs[i]["dur"])) < 0.002
              for i in range(len(cs) - 1)))
    # The callout renders a fixed number of rows; a focus index past that
    # points at a line the viewer never sees.
    for sh in cs:
        if sh["type"] == "callout":
            d2 = sh["data"]
            check("callout focus is on a rendered line",
                  0 <= d2["highlight"] < len(d2["code"]),
                  f"{d2['highlight']} of {len(d2['code'])}")
    for sh in cs:
        if sh["type"] == "arch":
            deg = set()
            for a, b in sh["data"]["edges"]:
                deg.add(a); deg.add(b)
            check("arch graph has no orphan nodes",
                  all(i in deg for i in range(len(sh["data"]["nodes"]))))

    # ---- generated assets stay in sync ------------------------------------
    print("\nrepo")
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "sync_bed.py"), "--check"],
                       capture_output=True, text=True)
    check("docs/assets/bed.js matches the engine shader", r.returncode == 0,
          r.stderr.strip())
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "sync_data.py"), "--check"],
                       capture_output=True, text=True)
    check("themes.json and directors.json match their modules", r.returncode == 0,
          (r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr) else "")

    # ---- the browser port agrees with the Python pipeline ------------------
    # The web Make flow re-implements the RNG, the scorer and the composer so
    # the site needs no backend. If the two drift, the film someone previews on
    # the web stops being the film the CLI renders from the same seed.
    if not fast:
        print("\nbrowser port")
        for script, label in (("check_random.mjs", "browser RNG matches CPython's"),
                              ("check_score.mjs", "browser scorer matches cased/score.py"),
                              ("check_compose.mjs", "browser composer matches cased/compose.py"),
                              ("check_guard.mjs", "the guard rejects numbers nobody measured")):
            r = subprocess.run(["node", str(ROOT / "scripts" / script)],
                               capture_output=True, text=True, cwd=ROOT)
            tail = (r.stdout or r.stderr).strip().splitlines()
            check(label, r.returncode == 0, tail[-1] if tail else "")
    for p in ("skills/cased/SKILL.md", "skills/cased-slim/SKILL.md",
              ".claude/skills/cased/SKILL.md", ".agents/skills/cased/SKILL.md",
              ".opencode/skills/cased/SKILL.md"):
        check(f"{p} resolves", (ROOT / p).is_file())

    # ---- the graphics library ---------------------------------------------
    print("\ngraphics")
    import re as _re
    stage = (ROOT / "cased" / "engine" / "stage.html").read_text(encoding="utf-8")
    shots = set(_re.findall(r"^BUILD\.([a-zA-Z_][\w]*) =", stage, _re.M))
    beds = set(_re.findall(r"^([a-z_][a-z0-9_]*):\s*`", stage, _re.M))
    fxl = set(_re.findall(r"^([a-z][a-zA-Z0-9_]*)\(c, t, p, th, W, H\)", stage, _re.M))

    from cased import themes as themes_mod
    check("60+ themes", len(themes_mod.names()) >= 60, str(len(themes_mod.names())))
    # A repeated key in the THEMES literal overwrites the earlier theme in
    # silence, so the count stays plausible while a look disappears. Compare
    # the declarations in the source against the dict that survived them.
    tsrc = (ROOT / "cased" / "themes.py").read_text(encoding="utf-8")
    declared = _re.findall(r'^    "([a-z0-9_]+)":', tsrc, _re.M)
    dupes = sorted({k for k in declared if declared.count(k) > 1})
    check("no theme name is declared twice", not dupes, str(dupes))
    check("every declared theme survives into THEMES",
          len(declared) == len(themes_mod.THEMES),
          f"declared {len(declared)}, loaded {len(themes_mod.THEMES)}")

    # A light frontend needs a light theme in its own hue family to match, and
    # for a while every light theme here was warm red/orange.
    def _lum(hexs):
        c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        c = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    light = [n for n, t in themes_mod.THEMES.items() if _lum(t["bg"]) >= 0.45]
    check("10+ light themes", len(light) >= 10, str(len(light)))
    check("every theme is well formed",
          all(_re.fullmatch(r"#[0-9A-Fa-f]{6}", t[k])
              for t in themes_mod.THEMES.values()
              for k in ("bg", "fg", "accent", "accent2")))
    # A theme naming a bed the engine cannot draw silently falls back to
    # aurora, so the chosen look just quietly does not happen.
    missing = sorted({t["bed"] for t in themes_mod.THEMES.values()} - beds)
    check("every theme's bed exists in the engine", not missing, str(missing))
    for dname, d in DIRECTORS.items():
        check(f"director {dname} names a real theme",
              d["theme"] in themes_mod.THEMES, str(d.get("theme")))
    check("60+ shot types", len(shots) >= 60, str(len(shots)))
    check("80+ background beds", len(beds) >= 80, str(len(beds)))
    check("40+ overlay layers", len(fxl) >= 40, str(len(fxl)))

    # ---- render -----------------------------------------------------------
    if not fast:
        print("\nrender")
        if not (shutil.which("ffmpeg") and shutil.which("node")):
            check("toolchain present", False, "needs ffmpeg + node")
        else:
            short_spec = compose(story, bm, 2.5, "cinematic", 640, 360, 4242)
            sp = tmp / "spec.json"
            sp.write_text(json.dumps(short_spec))
            out = tmp / "t.mp4"
            r = subprocess.run(
                ["node", str(ROOT / "cased" / "engine" / "render.mjs"),
                 "--spec", str(sp), "--out", str(out), "--audio", str(wav),
                 "--quality", "draft", "--quiet"],
                capture_output=True, text=True, timeout=600)
            check("render exits clean", r.returncode == 0, r.stderr.strip()[-400:])
            check("produces a playable file", out.exists() and out.stat().st_size > 8000)
            if out.exists():
                probe = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries",
                     "format=duration:stream=codec_name", "-of", "json", str(out)],
                    capture_output=True, text=True)
                info = json.loads(probe.stdout or "{}")
                codecs = {s.get("codec_name") for s in info.get("streams", [])}
                dur = float(info.get("format", {}).get("duration", 0))
                check("has video and audio", {"h264", "aac"} <= codecs, str(codecs))
                check("duration matches the spec", abs(dur - 2.5) < 0.35, f"{dur:.2f}s")

        # The gallery renders every primitive the engine knows. A shot that
        # throws, or silently paints an empty frame, looks exactly like one
        # that was never scheduled -- this is what catches that.
        print("\ngallery")
        g = subprocess.run(["node", str(ROOT / "scripts" / "gallery.mjs")],
                           capture_output=True, text=True, timeout=2400)
        tail = (g.stderr or "").strip().splitlines()
        check("every graphic primitive renders", g.returncode == 0,
              " / ".join(tail[-4:]) if tail else "")
        for line in tail[-7:]:
            if line.strip():
                print(f"       {line.strip()}")

    shutil.rmtree(tmp, ignore_errors=True)
    print()
    if failures:
        print(f"\033[91m{len(failures)} check(s) failed:\033[0m " + ", ".join(failures))
        return 1
    print("\033[92mall checks passed\033[0m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

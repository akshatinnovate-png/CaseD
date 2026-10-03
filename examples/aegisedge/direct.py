#!/usr/bin/env python3
"""
AegisEdge — a hand-directed launch film.

A worked example of the `cased-slim` workflow: there is no repository to
analyse here, only a pitch document, so the shot list is written by hand and
handed straight to the engine. The scorer still sets the tempo and the
composer still snaps every cut to the beat.

Every number and every quoted line below is taken verbatim from the author's
own pitch document. Nothing is invented -- which is the whole point of a film
that opens by promising falsifiability.

    python3 examples/aegisedge/direct.py --quality good --gif
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from cased import score as score_mod          # noqa: E402
from cased.compose import _lay_out            # noqa: E402

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Look: black and orange, as asked. Deep near-black ground so the orange reads
# as heat rather than decoration, and a starfield bed because the project is
# about nodes surviving alone in the dark.
# ---------------------------------------------------------------------------

THEME = {
    "bg": "#07060A", "fg": "#FFFFFF",
    "accent": "#FF6B1A", "accent2": "#FFAE42",
    "grain": 0.052, "scanlines": False, "vignette": 1.0,
    "letterbox": True, "bg_mode": "stars",
}

REPO = "github.com/akshatinnovate-png/AegisEdge"

# ---------------------------------------------------------------------------
# The edit.
#
# Structure follows the document's own thesis: three pillars -- it survives,
# it decides, it proves -- and each pillar is immediately cashed out with the
# measurement that backs it. Claim, then proof. Claim, then proof.
# ---------------------------------------------------------------------------

PLAN = [
    # --- cold open ---------------------------------------------------------
    ("title", 1.00, {
        "kicker": "code cubicle 6.0 · problem statement 03",
        "text": "AegisEdge",
        "sub": "An offline-first edge brain that survives, decides and proves.",
        "caps": False, "rule": True,
    }),
    ("bigquote", 1.30, {
        "text": "Disconnection is the normal state. Connectivity is the exception.",
        "source": "the thesis",
    }),

    # --- pillar one: it survives ------------------------------------------
    ("title", 0.80, {"kicker": "pillar one", "text": "It survives.",
                     "caps": True, "rule": False}),
    ("stat", 0.78, {"value": "0", "label": "writes lost after SIGKILL"}),
    ("compare", 1.15, {
        "left": "60 acknowledged, 60 recovered",
        "right": "any write silently dropped",
        "leftLabel": "crash durability", "rightLabel": "never",
    }),

    # --- pillar two: it decides -------------------------------------------
    ("title", 0.80, {"kicker": "pillar two", "text": "It decides.",
                     "caps": True, "rule": False}),
    ("compare", 1.25, {
        "left": "7 of 7 deletions delivered",
        "right": "0 of 7 on the same 16 KB",
        "leftLabel": "value-first egress", "rightLabel": "write-order",
    }),
    ("bigquote", 1.20, {
        "text": "Deletions are obligations. The right to be forgotten survives a bad connection.",
        "source": "",
    }),

    # --- pillar three: it proves ------------------------------------------
    ("title", 0.80, {"kicker": "pillar three", "text": "It proves.",
                     "caps": True, "rule": False}),
    ("stat", 0.78, {"value": "3000", "label": "simulated executions, zero invariant failures"}),
    ("compare", 1.15, {
        "left": "0 failures in 1.73M operations",
        "right": "435 of 500 for the unsigned control",
        "leftLabel": "aegisedge", "rightLabel": "same attacks",
    }),

    # --- the line ----------------------------------------------------------
    ("bigquote", 1.40, {
        "text": "Most teams will tell you their system works. We hand you the crowbar.",
        "source": "every claim ships with the button that would disprove it",
    }),

    # --- how it is built ---------------------------------------------------
    ("flow", 1.35, {
        "title": "the life of one memory",
        "items": [
            {"name": "quota", "note": "gate"},
            {"name": "classify", "note": "sensitivity"},
            {"name": "policy", "note": "redaction vault"},
            {"name": "embed", "note": "ONNX, on-device"},
            {"name": "store", "note": "Qdrant"},
        ],
    }),
    ("arch", 1.45, {
        "title": "four planes",
        "nodes": [
            {"label": "storage", "hub": True},
            {"label": "control", "hub": False},
            {"label": "ingest", "hub": False},
            {"label": "query", "hub": False},
            {"label": "sync", "hub": False},
        ],
        "edges": [[2, 0], [0, 3], [0, 4], [4, 0], [1, 2], [1, 3], [1, 4]],
        "note": "never lose an acknowledged write — everything leans on storage",
    }),
    ("constellation", 1.25, {
        "title": "running on the device",
        "items": [
            {"name": "Qdrant"}, {"name": "ONNX Runtime"}, {"name": "FastAPI"},
            {"name": "wordllama"}, {"name": "NumPy"}, {"name": "asyncio"},
            {"name": "NVIDIA Triton"}, {"name": "safetensors"},
        ],
    }),

    # --- what that buys you ------------------------------------------------
    ("stat", 0.78, {"value": "40191", "label": "answers per 1% of a 50 Wh battery"}),
    ("bullets", 1.40, {
        "title": "why it is different",
        "items": [
            "Falsifiable by design — PROVE IT mode hands over the crowbar",
            "It decides what a dying link should carry first",
            "The fleet is a pure function of a seed",
            "Zero trust between devices",
            "Measurement over opinion",
        ],
    }),
    ("stat", 0.78, {"value": "1599", "label": "queries per second on four cores, no GPU"}),

    # --- close -------------------------------------------------------------
    ("globe", 1.15, {
        "kicker": "offline first",
        "text": "No network required",
        "sub": "A node that remembers locally and answers in milliseconds.",
    }),
    ("endcard", 1.10, {
        "name": "AegisEdge",
        "sub": REPO,
        "cta": "aegisedge.netlify.app",
    }),
]

# Per-shot look. Structural shots sit still on a quiet bed; statements push in.
BEDS = {"title": "stars", "bigquote": "aurora", "stat": "rings",
        "compare": "aurora", "flow": "grid", "arch": "stars",
        "constellation": "stars", "bullets": "aurora", "globe": "stars",
        "endcard": "rings"}
CAMS = {"title": "push", "bigquote": "push", "stat": "pull",
        "endcard": "pull", "globe": "none"}
INS = ["cut", "rise", "fade", "zoom", "rise", "fade"]


def build_spec(duration: float, width: int, height: int, seed: int,
               beatmap: dict) -> dict:
    plan = []
    for i, (kind, weight, data) in enumerate(PLAN):
        plan.append({
            "type": kind,
            "data": data,
            "weight": weight,
            # Pillar headings and the closing line open sections, so they want
            # a musical impact rather than just the next beat.
            "hard": kind in ("title", "bigquote", "endcard") and i > 0,
            "bg": BEDS.get(kind, "stars"),
            "cam": CAMS.get(kind, "none"),
            "in": "cut" if i == 0 else INS[i % len(INS)],
            "energy": round(min(1.0, 0.45 + 0.5 * (i / max(len(PLAN) - 1, 1))), 3),
            "fx": ["motes"],
        })

    shots = _lay_out(plan, duration, beatmap)
    return {
        "version": "2.0",
        "project": "AegisEdge",
        "director": "creative",
        "director_label": "Creative (hand-directed)",
        "mode": "slim",
        "seed": seed,
        "fps": 30,
        "width": width,
        "height": height,
        "duration": round(duration, 4),
        "theme": THEME,
        "shots": shots,
        "beatmap": {k: v for k, v in beatmap.items() if k != "beats"},
        "share": {
            "x": "AegisEdge\n\nAn offline-first edge brain that survives, decides "
                 "and proves.\n\n0 writes lost after SIGKILL · 0 invariant failures "
                 f"in 1.73M operations\n\nhttps://{REPO}",
            "linkedin": "I built AegisEdge, an edge memory and intelligence platform "
                        "for Code Cubicle 6.0 (PS03).\n\nIt keeps answering through "
                        "crash, partition, overload and hostile input — and every "
                        "claim ships with the button that would disprove it.\n\n"
                        f"https://{REPO}",
            "hn": "Show HN: AegisEdge – an offline-first edge brain that survives, "
                  "decides and proves",
            "product_hunt": "An offline-first edge brain that survives, decides and proves",
            "alt_text": "A launch film for AegisEdge, an offline-first edge memory "
                        "platform. Three pillars — it survives, it decides, it proves "
                        "— each followed by the measurement backing it, then the "
                        "architecture, the stack and the results.",
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Render the AegisEdge film.")
    ap.add_argument("--duration", type=float, default=62.0)
    ap.add_argument("--quality", default="good", choices=["draft", "good", "high"])
    ap.add_argument("--seed", type=int, default=3103)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--plan-only", action="store_true")
    a = ap.parse_args()

    wav = HERE / "score.wav"
    beatmap = score_mod.render(a.duration, wav, "cinematic", a.seed, 1.0)
    spec = build_spec(a.duration, a.width, a.height, a.seed, beatmap)
    (HERE / "spec.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")

    print(f"  {len(spec['shots'])} shots · {a.duration:g}s · "
          f"{beatmap['bpm']} BPM {beatmap['scale']}")
    for s in spec["shots"]:
        d = s["data"]
        label = str(d.get("text") or d.get("label") or d.get("title")
                    or d.get("name") or d.get("left") or "")[:52]
        print(f"    {s['start']:6.2f}s  {s['dur']:5.2f}s  {s['type']:<14} {label}")
    if a.plan_only:
        return 0

    cmd = ["node", str(ROOT / "cased" / "engine" / "render.mjs"),
           "--spec", str(HERE / "spec.json"),
           "--out", str(HERE / "aegisedge.mp4"),
           "--audio", str(wav),
           "--quality", a.quality,
           "--poster", str(HERE / "poster.png")]
    if a.gif:
        cmd += ["--gif", str(HERE / "aegisedge.gif")]
    return subprocess.run(cmd).returncode


if __name__ == "__main__":
    raise SystemExit(main())

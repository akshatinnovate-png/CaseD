"""
cased2.0 / directors
====================

A director is pacing, bed vocabulary and transition vocabulary. It names a
default theme, but the look is a separate axis -- see `themes.py`. Any of the
82 themes composes with any of the directors:

    python3 -m cased . --director terminal --theme ember

Swapping the director changes the edit; swapping the theme changes the look.
The story underneath stays the same.

What a director no longer changes is the shot grammar. Every film is a
product film now -- windows, a board, an editor, a dashboard -- because a
launch film for software should show the software. The old grammar of title
cards, counters and a spinning globe over a shader was the same slideshow
whichever director drew it.

The transition vocabulary went the same way. `glitch`, `flash` and `zoom`,
the drifting cameras and the motes-and-grid overlays all read as 2016 motion
graphics sitting on top of the work rather than showing it. Films cut, fade,
rise and wipe; the camera holds or pushes gently. The engine still
implements the rest for hand-written shot lists (see the cased-slim skill),
but no director will ask for them.
"""

from __future__ import annotations

DIRECTORS = {
    # The default. Product UI on paper, serif headlines, chapter marks and
    # captions -- the register the rest of these are now tuned against.
    "atlas": {
        "label": "Atlas",
        "blurb": "Product UI on paper, serif headlines, chapter marks and captions.",
        "mood": "cinematic",
        "theme": "atlas",
        "beds": ["contours", "topo", "contours", "paper"],
        "cams": ["none", "push", "none", "none"],
        "ins": ["fade", "rise", "fade", "wipe", "fade"],
        "pace": 1.05, "energy": 0.22, "intensity": 0.8,
        "fx": [],
        "hud": True,
    },

    # Deep, filmic, restrained. Flatters almost any repo.
    "cinematic": {
        "label": "Cinematic",
        "blurb": "Deep blacks, slow pushes, letterbox. Takes the work seriously.",
        "mood": "cinematic",
        "theme": "midnight",
        "beds": ["aurora", "stars", "aurora", "rings"],
        "cams": ["push", "none", "push", "none"],
        "ins": ["fade", "rise", "fade", "wipe", "fade"],
        "pace": 1.0, "energy": 0.3, "intensity": 0.85,
        "fx": [],
        "hud": True,
    },

    # Hot pink and type the size of a bus -- but the cuts are clean.
    "brutalist": {
        "label": "Brutalist",
        "blurb": "Hot pink, hard cuts, type the size of a bus.",
        "mood": "brutalist",
        "theme": "hotpink",
        "beds": ["plasma", "plasma", "plasma"],
        "cams": ["none", "none", "none", "none"],
        "ins": ["cut", "cut", "wipe", "cut", "rise"],
        "pace": 0.86, "energy": 0.4, "intensity": 1.0,
        "fx": [],
        "hud": True,
    },

    # Phosphor and scanlines. Built for CLIs and anything with a prompt.
    "terminal": {
        "label": "Terminal",
        "blurb": "Phosphor green, scanlines, code first. For things with a prompt.",
        "mood": "retro",
        "theme": "phosphor",
        "beds": ["grid", "grid", "rings"],
        "cams": ["push", "none", "none"],
        "ins": ["cut", "rise", "fade", "cut"],
        "pace": 0.92, "energy": 0.35, "intensity": 0.9,
        "fx": [],
        "hud": True,
    },

    # Quick. Still clean -- the pace carries it, not the effects.
    "hype": {
        "label": "Hype",
        "blurb": "Short takes, fast board, neon. Built to stop a thumb mid-scroll.",
        "mood": "hype",
        "theme": "neon",
        "beds": ["rings", "plasma", "grid", "rings"],
        "cams": ["push", "none", "pull", "push"],
        "ins": ["cut", "rise", "cut", "wipe", "cut"],
        "pace": 0.72, "energy": 0.42, "intensity": 1.15,
        "fx": [],
        "hud": True,
    },

    # Space, long arcs, room to breathe. For things that ship wide.
    "orbit": {
        "label": "Orbit",
        "blurb": "Starfield, long arcs, unhurried. For things that ship wide.",
        "mood": "triumphant",
        "theme": "orbit",
        "beds": ["stars", "stars", "aurora", "stars"],
        "cams": ["pull", "push", "none", "push"],
        "ins": ["fade", "rise", "fade", "wipe"],
        "pace": 1.08, "energy": 0.3, "intensity": 0.95,
        "fx": [],
        "hud": True,
    },

    # Long-form. Built for --creative: enough register to hold a full minute.
    "creative": {
        "label": "Creative",
        "blurb": "Long-form. Shows the architecture, the history and the clever bit.",
        "mood": "cinematic",
        "theme": "signal",
        "beds": ["aurora", "stars", "grid", "aurora", "rings", "stars"],
        "cams": ["push", "none", "pull", "none", "none", "none"],
        "ins": ["fade", "rise", "fade", "wipe", "rise", "fade"],
        "pace": 1.0, "energy": 0.3, "intensity": 0.9,
        "fx": [],
        "hud": True,
    },

    # Soft, warm, human. For libraries and tools that are a kindness.
    "warm": {
        "label": "Warm",
        "blurb": "Soft light, unhurried, generous margins. Quietly confident.",
        "mood": "warm",
        "theme": "hearth",
        "beds": ["aurora", "aurora", "rings"],
        "cams": ["push", "pull", "none"],
        "ins": ["fade", "rise", "fade"],
        "pace": 1.18, "energy": 0.25, "intensity": 0.7,
        "fx": [],
        "hud": True,
    },
}

#: Which director suits which kind of project, when none is given.
KIND_DEFAULT = {
    "tool": "terminal",
    "service": "orbit",
    "visual": "hype",
    "ai": "cinematic",
    "app": "cinematic",
    "library": "warm",
    "project": "atlas",
}


def pick(name: str | None, kind: str = "project") -> tuple:
    """Resolve a director name (or auto-select from the project kind)."""
    if name and name in DIRECTORS:
        return name, DIRECTORS[name]
    chosen = KIND_DEFAULT.get(kind, "cinematic")
    return chosen, DIRECTORS[chosen]


def names() -> list:
    return list(DIRECTORS)

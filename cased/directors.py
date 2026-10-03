"""
cased2.0 / directors
====================

A director is pacing, shot grammar and transition vocabulary. It names a
default theme, but the look is a separate axis -- see `themes.py`. Any of the
54 themes composes with any of the directors:

    python3 -m cased . --director terminal --theme ember

Swapping the director changes the edit; swapping the theme changes the look.
The story underneath stays the same.
"""

from __future__ import annotations

DIRECTORS = {
    # Deep, filmic, restrained. The default -- it flatters almost any repo.
    "cinematic": {
        "label": "Cinematic",
        "blurb": "Deep blacks, slow pushes, letterbox. Takes the work seriously.",
        "mood": "cinematic",
        "theme": "midnight",
        "beds": ["aurora", "stars", "aurora", "rings"],
        "cams": ["push", "pull", "push", "left"],
        "ins": ["fade", "rise", "fade", "zoom", "fade"],
        "pace": 1.0, "energy": 0.55, "intensity": 0.85,
        "fx": ["motes"],
    },

    # The TypeSafe reference: hot pink, dialog boxes, type that shouts.
    "brutalist": {
        "label": "Brutalist",
        "blurb": "Hot pink, hard cuts, dialog boxes, type the size of a bus.",
        "mood": "brutalist",
        "theme": "hotpink",
        "beds": ["plasma", "plasma", "plasma"],
        "cams": ["none", "none", "left", "none"],
        "ins": ["cut", "cut", "push", "cut", "glitch"],
        "pace": 0.86, "energy": 0.85, "intensity": 1.0,
        "fx": ["grid"],
    },

    # Phosphor and scanlines. Built for CLIs and anything with a prompt.
    "terminal": {
        "label": "Terminal",
        "blurb": "Phosphor green, scanlines, code first. For things with a prompt.",
        "mood": "retro",
        "theme": "phosphor",
        "beds": ["grid", "grid", "rings"],
        "cams": ["push", "none", "up"],
        "ins": ["cut", "rise", "glitch", "cut"],
        "pace": 0.92, "energy": 0.65, "intensity": 0.9,
        "fx": ["grid", "motes"],
    },

    # Maximum energy. Flash cuts, glitch, neon. For a launch that wants noise.
    "hype": {
        "label": "Hype",
        "blurb": "Flash cuts, glitch, neon. Built to stop a thumb mid-scroll.",
        "mood": "hype",
        "theme": "neon",
        "beds": ["rings", "plasma", "grid", "rings"],
        "cams": ["push", "right", "pull", "push"],
        "ins": ["flash", "glitch", "zoom", "flash", "cut"],
        "pace": 0.72, "energy": 0.95, "intensity": 1.15,
        "fx": ["motes", "wave"],
    },

    # The United Carriers reference: space, a globe, long orange arcs.
    "orbit": {
        "label": "Orbit",
        "blurb": "Starfield, a turning globe, long arcs. For things that ship wide.",
        "mood": "triumphant",
        "theme": "orbit",
        "beds": ["stars", "stars", "aurora", "stars"],
        "cams": ["pull", "push", "left", "push"],
        "ins": ["fade", "rise", "fade", "zoom"],
        "pace": 1.08, "energy": 0.6, "intensity": 0.95,
        "fx": ["motes"],
    },

    # Long-form. Built for --creative: structure over slogans, and enough
    # visual register to hold a full minute without repeating itself.
    "creative": {
        "label": "Creative",
        "blurb": "Long-form. Shows the architecture, the history and the clever bit.",
        "mood": "cinematic",
        "theme": "signal",
        "beds": ["aurora", "stars", "grid", "aurora", "rings", "stars"],
        "cams": ["push", "none", "pull", "none", "left", "none"],
        "ins": ["fade", "rise", "fade", "zoom", "rise", "fade"],
        "pace": 1.0, "energy": 0.6, "intensity": 0.9,
        "fx": ["motes"],
    },

    # Soft, warm, human. For libraries and tools that are a kindness.
    "warm": {
        "label": "Warm",
        "blurb": "Soft light, unhurried, generous margins. Quietly confident.",
        "mood": "warm",
        "theme": "hearth",
        "beds": ["aurora", "aurora", "rings"],
        "cams": ["push", "pull", "up"],
        "ins": ["fade", "rise", "fade"],
        "pace": 1.18, "energy": 0.45, "intensity": 0.7,
        "fx": ["motes"],
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
    "project": "cinematic",
}


def pick(name: str | None, kind: str = "project") -> tuple:
    """Resolve a director name (or auto-select from the project kind)."""
    if name and name in DIRECTORS:
        return name, DIRECTORS[name]
    chosen = KIND_DEFAULT.get(kind, "cinematic")
    return chosen, DIRECTORS[chosen]


def names() -> list:
    return list(DIRECTORS)

"""
cased2.0 / directors
====================

A director is a complete point of view: palette, background bed, pacing,
transition vocabulary, and the musical mood it wants underneath.

Swapping the director swaps the whole film. The story stays the same.
"""

from __future__ import annotations

DIRECTORS = {
    # Deep, filmic, restrained. The default -- it flatters almost any repo.
    "cinematic": {
        "label": "Cinematic",
        "blurb": "Deep blacks, slow pushes, letterbox. Takes the work seriously.",
        "mood": "cinematic",
        "theme": {
            "bg": "#06070C", "fg": "#FFFFFF",
            "accent": "#7C5CFF", "accent2": "#39D0FF",
            "grain": 0.055, "scanlines": False, "vignette": 1.0,
            "letterbox": True, "bg_mode": "aurora",
        },
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
        "theme": {
            "bg": "#F2719E", "fg": "#141414",
            "accent": "#141414", "accent2": "#FFFFFF",
            "grain": 0.040, "scanlines": False, "vignette": 0.25,
            "letterbox": False, "bg_mode": "plasma",
        },
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
        "theme": {
            "bg": "#04080A", "fg": "#D6FFE4",
            "accent": "#38F58C", "accent2": "#FFC24D",
            "grain": 0.085, "scanlines": True, "vignette": 1.0,
            "letterbox": False, "bg_mode": "grid",
        },
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
        "theme": {
            "bg": "#08030F", "fg": "#FFFFFF",
            "accent": "#FF2D71", "accent2": "#00F0FF",
            "grain": 0.065, "scanlines": False, "vignette": 0.9,
            "letterbox": False, "bg_mode": "rings",
        },
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
        "theme": {
            "bg": "#01030A", "fg": "#FFFFFF",
            "accent": "#FF7A1A", "accent2": "#2E7BFF",
            "grain": 0.050, "scanlines": False, "vignette": 1.0,
            "letterbox": True, "bg_mode": "stars",
        },
        "beds": ["stars", "stars", "aurora", "stars"],
        "cams": ["pull", "push", "left", "push"],
        "ins": ["fade", "rise", "fade", "zoom"],
        "pace": 1.08, "energy": 0.6, "intensity": 0.95,
        "fx": ["motes"],
    },

    # Soft, warm, human. For libraries and tools that are a kindness.
    "warm": {
        "label": "Warm",
        "blurb": "Soft light, unhurried, generous margins. Quietly confident.",
        "mood": "warm",
        "theme": {
            "bg": "#0C0A09", "fg": "#FFF7ED",
            "accent": "#FF9E5E", "accent2": "#8FD4C1",
            "grain": 0.045, "scanlines": False, "vignette": 0.85,
            "letterbox": True, "bg_mode": "aurora",
        },
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

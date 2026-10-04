"""
cased2.0 / themes
=================

Eighty-two looks.

A **theme** is the palette and surface treatment: ground colour, foreground,
two accents, film grain, scanlines, vignette, letterbox and a default
background bed. A **director** is pacing, shot grammar and transition
vocabulary. They used to be the same object, which meant wanting the
brutalist palette forced the brutalist edit.

They are separate now, so any of the 82 themes composes with any of the
directors:

    python3 -m cased . --theme ember --director terminal

Each theme carries a `mood`, which the scorer uses when the director does not
override it, so the music follows the look rather than fighting it.

Fields
------
bg / fg          ground and foreground
accent           the colour that carries meaning: rules, hubs, highlights
accent2          the secondary, used for atmosphere and second series
grain            0.0-0.12, film grain opacity
scanlines        CRT line overlay
vignette         0.0-1.0, corner falloff
letterbox        cinema bars
bed              default background shader
mood             scorer mood when the director does not pin one
family           grouping, for `--list-themes`
"""

from __future__ import annotations

#: Sensible defaults so a theme only states what makes it different.
_D = dict(grain=0.05, scanlines=False, vignette=1.0, letterbox=False,
          bed="aurora", mood="cinematic", family="dark", face="sans")


def _t(**kw) -> dict:
    out = dict(_D)
    out.update(kw)
    return out


THEMES: dict = {

    # -- deep / cinematic ---------------------------------------------------
    "midnight": _t(bg="#06070C", fg="#FFFFFF", accent="#7C5CFF", accent2="#39D0FF",
                   letterbox=True, bed="aurora", family="deep"),
    "obsidian": _t(bg="#040405", fg="#F4F4F6", accent="#9BA3B4", accent2="#E8EAF0",
                   letterbox=True, bed="smoke", mood="cinematic", family="deep"),
    "abyss": _t(bg="#01060F", fg="#EAF4FF", accent="#1E6FFF", accent2="#00D2C7",
                letterbox=True, bed="caustics", family="deep"),
    "voidline": _t(bg="#000000", fg="#FFFFFF", accent="#FFFFFF", accent2="#8A8A8A",
                   grain=0.03, letterbox=True, bed="grid", mood="cinematic",
                   family="deep"),
    "graphite": _t(bg="#0B0C0E", fg="#F2F3F5", accent="#FF5B35", accent2="#6E7681",
                   letterbox=True, bed="smoke", family="deep"),
    "eclipse": _t(bg="#060509", fg="#FFF3E6", accent="#FFB020", accent2="#5A3BFF",
                  letterbox=True, bed="corona", mood="triumphant", family="deep"),
    "ironclad": _t(bg="#0A0B0D", fg="#E6E9EE", accent="#4D7CFF", accent2="#A8B2C1",
                   bed="plates", mood="cinematic", family="deep"),
    "slate": _t(bg="#10131A", fg="#E8EDF5", accent="#5E9BFF", accent2="#8FA3BF",
                bed="aurora", family="deep"),

    # -- ember / warm -------------------------------------------------------
    "ember": _t(bg="#07060A", fg="#FFFFFF", accent="#FF6B1A", accent2="#FFAE42",
                letterbox=True, bed="stars", mood="triumphant", family="warm"),
    "furnace": _t(bg="#0B0503", fg="#FFF1E6", accent="#FF3D00", accent2="#FFC247",
                  bed="magma", mood="hype", family="warm"),
    "amber": _t(bg="#0D0A05", fg="#FFF8EC", accent="#FFB300", accent2="#FF7043",
                bed="dunes", mood="warm", family="warm"),
    "terracotta": _t(bg="#120A07", fg="#FFEDE2", accent="#E2703A", accent2="#C44536",
                     bed="contours", mood="warm", family="warm"),
    "sunset": _t(bg="#140717", fg="#FFF0F5", accent="#FF5E7E", accent2="#FFB45C",
                 bed="gradientfield", mood="warm", family="warm"),
    "campfire": _t(bg="#0A0806", fg="#FFF4E0", accent="#FF8A3D", accent2="#FFD089",
                   grain=0.07, bed="embers", mood="warm", family="warm"),
    "rust": _t(bg="#0E0906", fg="#F6E7DA", accent="#B7410E", accent2="#D9A066",
               grain=0.08, bed="noisefield", mood="warm", family="warm"),
    "goldleaf": _t(bg="#08070A", fg="#FFFDF5", accent="#D4AF37", accent2="#8C6A1F",
                   letterbox=True, bed="rays", mood="triumphant", family="warm"),

    # -- neon / cyber -------------------------------------------------------
    "neon": _t(bg="#08030F", fg="#FFFFFF", accent="#FF2D71", accent2="#00F0FF",
               bed="rings", mood="hype", family="neon"),
    "synthwave": _t(bg="#120627", fg="#FFE9FF", accent="#FF2E97", accent2="#00E0FF",
                    bed="sungrid", mood="retro", family="neon"),
    "vaporwave": _t(bg="#17082B", fg="#F6E9FF", accent="#FF71CE", accent2="#01CDFE",
                    bed="checkerhorizon", mood="retro", family="neon"),
    "cyberlime": _t(bg="#04070A", fg="#EFFFF4", accent="#C6FF00", accent2="#00E5FF",
                    bed="circuit", mood="hype", family="neon"),
    "hologram": _t(bg="#03080C", fg="#EAFBFF", accent="#38E8FF", accent2="#A66BFF",
                   bed="interference", mood="hype", family="neon"),
    "magenta": _t(bg="#0A0310", fg="#FFEAFB", accent="#FF00A0", accent2="#7B2CFF",
                  bed="plasma", mood="hype", family="neon"),
    "acid": _t(bg="#060A04", fg="#F2FFE8", accent="#9EFF00", accent2="#FF007A",
               bed="warp", mood="hype", family="neon"),
    "outrun": _t(bg="#0B0320", fg="#FFF0FA", accent="#FF1F6D", accent2="#FFB800",
                 bed="sungrid", mood="hype", family="neon"),

    # -- terminal / phosphor ------------------------------------------------
    "phosphor": _t(bg="#04080A", fg="#D6FFE4", accent="#38F58C", accent2="#FFC24D",
                   grain=0.085, scanlines=True, bed="grid", mood="retro",
                   family="terminal"),
    "amber_crt": _t(bg="#0A0600", fg="#FFD79A", accent="#FFA000", accent2="#FFE0A3",
                    grain=0.09, scanlines=True, bed="scanfield", mood="retro",
                    family="terminal"),
    "ibm": _t(bg="#000814", fg="#CFE8FF", accent="#2D9BFF", accent2="#8ECDFF",
              grain=0.07, scanlines=True, bed="dotmatrix", mood="retro",
              family="terminal"),
    "mono": _t(bg="#0A0A0A", fg="#E8E8E8", accent="#FFFFFF", accent2="#9A9A9A",
               grain=0.06, scanlines=True, bed="static", mood="retro",
               family="terminal"),
    "hacker": _t(bg="#000000", fg="#00FF41", accent="#00FF41", accent2="#008F11",
                 grain=0.10, scanlines=True, bed="rain", mood="retro",
                 family="terminal"),
    "oscilloscope": _t(bg="#020806", fg="#B9FFE3", accent="#00FFB2", accent2="#00A3FF",
                       grain=0.07, scanlines=True, bed="lissajous", mood="retro",
                       family="terminal"),

    # -- brutalist / print --------------------------------------------------
    "hotpink": _t(bg="#F2719E", fg="#141414", accent="#141414", accent2="#FFFFFF",
                  grain=0.04, vignette=0.25, bed="halftone", mood="brutalist",
                  family="bright"),
    "newsprint": _t(bg="#EFEAE0", fg="#16150F", accent="#C8102E", accent2="#1A1A1A",
                    grain=0.07, vignette=0.2, bed="halftone", mood="brutalist",
                    family="bright"),
    "blueprint": _t(bg="#0C2340", fg="#E8F1FF", accent="#FFFFFF", accent2="#7FB2FF",
                    grain=0.045, vignette=0.4, bed="draft", mood="cinematic",
                    family="bright"),
    "riso": _t(bg="#F4F1E8", fg="#1C1B19", accent="#FF4D00", accent2="#0055FF",
               grain=0.09, vignette=0.15, bed="risograin", mood="brutalist",
               family="bright"),
    "chalk": _t(bg="#1B2220", fg="#F2F5F0", accent="#F7D154", accent2="#8FD6B0",
                grain=0.085, vignette=0.5, bed="chalkdust", mood="warm",
                family="bright"),
    "swiss": _t(bg="#FFFFFF", fg="#111111", accent="#E2001A", accent2="#111111",
                grain=0.03, vignette=0.12, bed="rulegrid", mood="brutalist",
                family="bright"),
    "cyanotype": _t(bg="#0A2433", fg="#DCEEF5", accent="#7FD4E8", accent2="#FFFFFF",
                    grain=0.08, vignette=0.45, bed="washes", mood="cinematic",
                    family="bright"),

    # -- nature / organic ---------------------------------------------------
    "forest": _t(bg="#060C08", fg="#EAF6EC", accent="#3FBF7F", accent2="#A8E063",
                 bed="canopy", mood="warm", family="nature"),
    "ocean": _t(bg="#03101C", fg="#E6F6FF", accent="#17A2C6", accent2="#5FE3C0",
                letterbox=True, bed="waves", mood="cinematic", family="nature"),
    "glacier": _t(bg="#071219", fg="#F0FBFF", accent="#7FE5F0", accent2="#C9F2FF",
                  letterbox=True, bed="crystal", mood="cinematic", family="nature"),
    "desert": _t(bg="#140F08", fg="#FFF6E3", accent="#E0A458", accent2="#C45D3A",
                 bed="dunes", mood="warm", family="nature"),
    "aurora_borealis": _t(bg="#020A12", fg="#EFFFFA", accent="#45F0A8", accent2="#7A5CFF",
                          letterbox=True, bed="curtains", mood="cinematic",
                          family="nature"),
    "nebula": _t(bg="#05030D", fg="#F3EDFF", accent="#B46BFF", accent2="#FF6BA8",
                 letterbox=True, bed="nebula", mood="cinematic", family="nature"),
    "moss": _t(bg="#0A0D08", fg="#EEF3E6", accent="#8AB83D", accent2="#4F7942",
               grain=0.065, bed="noisefield", mood="warm", family="nature"),
    "storm": _t(bg="#0A0C10", fg="#E9EDF2", accent="#5B7FA8", accent2="#C9D6E3",
                grain=0.07, letterbox=True, bed="rainfall", mood="cinematic",
                family="nature"),

    # -- jewel / saturated --------------------------------------------------
    "royal": _t(bg="#070516", fg="#F2EFFF", accent="#5B4BFF", accent2="#FFC53D",
                letterbox=True, bed="silk", mood="triumphant", family="jewel"),
    "emerald": _t(bg="#04120D", fg="#EAFFF6", accent="#00C98D", accent2="#B8F2D8",
                  letterbox=True, bed="facets", mood="triumphant", family="jewel"),
    "ruby": _t(bg="#12040A", fg="#FFEAF0", accent="#E0115F", accent2="#FF8FA8",
               letterbox=True, bed="velvet", mood="cinematic", family="jewel"),
    "sapphire": _t(bg="#030B1A", fg="#E8F0FF", accent="#0F52BA", accent2="#6FA8FF",
                   letterbox=True, bed="facets", mood="cinematic", family="jewel"),
    "copper": _t(bg="#0C0705", fg="#FFEFE2", accent="#C87533", accent2="#E8B88A",
                 bed="brushed", mood="warm", family="jewel"),
    "ultraviolet": _t(bg="#06021A", fg="#F0E8FF", accent="#8B5CF6", accent2="#22D3EE",
                      bed="bloom", mood="hype", family="jewel"),

    # -- the director defaults, as themes in their own right ----------------
    "orbit": _t(bg="#01030A", fg="#FFFFFF", accent="#FF7A1A", accent2="#2E7BFF",
                letterbox=True, bed="stars", mood="triumphant", family="deep"),
    "signal": _t(bg="#05060B", fg="#FFFFFF", accent="#5B8CFF", accent2="#FF5CA8",
                 grain=0.048, letterbox=True, bed="aurora", mood="cinematic",
                 family="deep"),
    "hearth": _t(bg="#0C0A09", fg="#FFF7ED", accent="#FF9E5E", accent2="#8FD4C1",
                 grain=0.045, vignette=0.85, letterbox=True, bed="aurora",
                 mood="warm", family="warm"),

    # --- daylight -----------------------------------------------------------
    # Light grounds across the hue wheel. Most docs sites, dashboards and SaaS
    # frontends are light with a cool brand colour, and the four "bright"
    # themes were all warm red/orange, so a blue or green product had nothing
    # to match against. Beds here are the ones that read on a pale ground:
    # ink-on-paper textures rather than glows.
    "daylight": _t(bg="#FFFFFF", fg="#0B1220", accent="#2563EB", accent2="#0EA5E9",
                   grain=0.03, vignette=0.12, bed="rulegrid", mood="cinematic",
                   family="daylight"),
    "porcelain": _t(bg="#F7F8FA", fg="#111827", accent="#4F46E5", accent2="#7C3AED",
                    grain=0.035, vignette=0.14, bed="paper", mood="cinematic",
                    family="daylight"),
    "linen": _t(bg="#FAF7F2", fg="#1A1714", accent="#0F766E", accent2="#C2410C",
                grain=0.055, vignette=0.16, bed="crosshatch", mood="warm",
                family="daylight"),
    "meadow": _t(bg="#F4F9F3", fg="#10231A", accent="#15803D", accent2="#65A30D",
                 grain=0.04, vignette=0.15, bed="canopy", mood="warm",
                 family="daylight"),
    "lagoon": _t(bg="#F2FAFC", fg="#07252E", accent="#0891B2", accent2="#0D9488",
                 grain=0.035, vignette=0.14, bed="ripples", mood="cinematic",
                 family="daylight"),
    "lilac": _t(bg="#F8F6FD", fg="#1B1333", accent="#7C3AED", accent2="#C026D3",
                grain=0.04, vignette=0.15, bed="washes", mood="cinematic",
                family="daylight"),
    "blush": _t(bg="#FFF5F7", fg="#2A0E17", accent="#DB2777", accent2="#F97316",
                grain=0.045, vignette=0.15, bed="stipple", mood="hype",
                family="daylight"),
    "pewter": _t(bg="#EEF1F5", fg="#0F172A", accent="#334155", accent2="#2563EB",
                grain=0.035, vignette=0.14, bed="concrete", mood="brutalist",
                family="daylight"),
    "honey": _t(bg="#FFFBF0", fg="#241A05", accent="#B45309", accent2="#CA8A04",
                grain=0.055, vignette=0.17, bed="dunes", mood="warm",
                family="daylight"),
    "mint": _t(bg="#F3FBF7", fg="#06231A", accent="#059669", accent2="#14B8A6",
               grain=0.035, vignette=0.14, bed="scales", mood="cinematic",
               family="daylight"),
    "ivory": _t(bg="#FDFBF6", fg="#14110C", accent="#1E3A8A", accent2="#9A3412",
                grain=0.05, vignette=0.16, bed="engraving", mood="triumphant",
                family="daylight"),
    "cement": _t(bg="#E9EAEC", fg="#121315", accent="#111827", accent2="#DC2626",
                   grain=0.04, vignette=0.15, bed="brushed", mood="brutalist",
                   family="daylight"),
    "sky": _t(bg="#F0F7FF", fg="#06203A", accent="#0369A1", accent2="#38BDF8",
              grain=0.03, vignette=0.13, bed="clouds", mood="triumphant",
              family="daylight"),
    "coral": _t(bg="#FFF6F2", fg="#2B1107", accent="#EA580C", accent2="#E11D48",
                grain=0.045, vignette=0.15, bed="risograin", mood="hype",
                family="daylight"),

    # --- editorial ----------------------------------------------------------
    # The register a launch film for a *product* wants: paper ground, a
    # high-contrast serif carrying the idea, one warm accent for the phrase
    # that matters. Beds are ink-on-paper textures, never a glow.
    "atlas": _t(bg="#F2EDE4", fg="#16130F", accent="#E2561F", accent2="#8C7A66",
                grain=0.04, vignette=0.1, bed="contours", mood="cinematic",
                family="editorial", face="serif"),
    "broadsheet": _t(bg="#FBF8F2", fg="#121212", accent="#B3301C", accent2="#55514A",
                     grain=0.045, vignette=0.1, bed="paper", mood="cinematic",
                     family="editorial", face="serif"),
    "manuscript": _t(bg="#F6F1E3", fg="#1B1710", accent="#7A5C2E", accent2="#3F6B52",
                     grain=0.05, vignette=0.12, bed="crosshatch", mood="warm",
                     family="editorial", face="serif"),
    "inkwell": _t(bg="#12110F", fg="#F4EFE6", accent="#E2561F", accent2="#A89880",
                  grain=0.045, vignette=0.5, bed="topo", mood="cinematic",
                  family="editorial", face="serif"),
    "quarto": _t(bg="#0E0F12", fg="#F2F0EC", accent="#D9B26A", accent2="#8FA2B8",
                 grain=0.04, vignette=0.45, bed="engraving", mood="triumphant",
                 family="editorial", face="serif"),
    "gazette": _t(bg="#EFEBE1", fg="#17151A", accent="#1F4FD8", accent2="#6B6560",
                  grain=0.05, vignette=0.1, bed="rulegrid", mood="cinematic",
                  family="editorial", face="serif"),

    "letterpress": _t(bg="#EDE6D8", fg="#1A1713", accent="#9C2B1F", accent2="#4A5D4E",
                      grain=0.065, vignette=0.14, bed="stipple", mood="brutalist",
                      family="editorial", face="serif"),
    "foulard": _t(bg="#F7F3EC", fg="#14171C", accent="#0B5D51", accent2="#C06014",
                  grain=0.04, vignette=0.1, bed="tartan", mood="warm",
                  family="editorial", face="serif"),
    "vellum": _t(bg="#FAF4E6", fg="#231C12", accent="#8A5B10", accent2="#46607A",
                 grain=0.055, vignette=0.13, bed="marble", mood="cinematic",
                 family="editorial", face="serif"),
    "oxblood": _t(bg="#140C0D", fg="#F3E9E4", accent="#B4341F", accent2="#C9A227",
                  grain=0.045, vignette=0.5, bed="velvet", mood="cinematic",
                  family="editorial", face="serif"),
    "slateprint": _t(bg="#1A1D21", fg="#EDEFF2", accent="#E07A3F", accent2="#7FA6C9",
                     grain=0.04, vignette=0.42, bed="concrete", mood="cinematic",
                     family="editorial", face="serif"),
    "almanac": _t(bg="#F1ECDF", fg="#191713", accent="#2F5E3E", accent2="#A6471C",
                  grain=0.05, vignette=0.12, bed="topo", mood="warm",
                  family="editorial", face="serif"),
    "folio": _t(bg="#FFFDF8", fg="#0F0F10", accent="#1D3FBF", accent2="#8A8070",
                grain=0.035, vignette=0.1, bed="engraving", mood="triumphant",
                family="editorial", face="serif"),
    "nocturne": _t(bg="#0B0D14", fg="#EFEDE8", accent="#C8A24A", accent2="#6E86A8",
                   grain=0.045, vignette=0.52, bed="washes", mood="cinematic",
                   family="editorial", face="serif"),
}

#: Theme used when nothing is specified.
DEFAULT = "midnight"


def get(name: str | None) -> dict:
    """Resolve a theme by name, falling back to the default."""
    if name and name in THEMES:
        return dict(THEMES[name])
    return dict(THEMES[DEFAULT])


def names() -> list:
    return list(THEMES)


def families() -> dict:
    """Theme names grouped by family, for listing."""
    out: dict = {}
    for name, t in THEMES.items():
        out.setdefault(t["family"], []).append(name)
    return out


def to_spec(name: str | None) -> dict:
    """The subset the engine actually reads, in the shape it expects."""
    t = get(name)
    return {
        "bg": t["bg"], "fg": t["fg"],
        "accent": t["accent"], "accent2": t["accent2"],
        "grain": t["grain"], "scanlines": t["scanlines"],
        "vignette": t["vignette"], "letterbox": t["letterbox"],
        "bg_mode": t["bed"], "face": t["face"],
    }

# Themes and the graphics library

Look and pacing are separate axes.

- A **theme** is the palette and surface treatment: ground, foreground, two
  accents, film grain, scanlines, vignette, letterbox, a default background bed,
  and the musical mood the scorer falls back to.
- A **director** is pacing, shot grammar and transition vocabulary.

They used to be the same object, which meant wanting the brutalist palette
forced the brutalist edit. Any of the 54 themes now composes with any of the
7 directors.

```bash
python3 -m cased . --theme ember --director terminal
python3 -m cased . --list-themes
```

## Choosing a theme

Pick the family first; the individual theme is a matter of taste within it.

| Family | When it fits | Themes |
|---|---|---|
| `deep` | Infrastructure, platforms, anything that must read as credible. The safe default. | midnight, obsidian, abyss, voidline, graphite, eclipse, ironclad, slate, orbit, signal |
| `warm` | Developer tools with warmth; anything about craft or care. | ember, furnace, amber, terracotta, sunset, campfire, rust, goldleaf, hearth |
| `neon` | Social cuts, games, graphics work. Loud on purpose. | neon, synthwave, vaporwave, cyberlime, hologram, magenta, acid, outrun |
| `terminal` | The terminal *is* the product: CLIs, REPLs, shells. | phosphor, amber_crt, ibm, mono, hacker, oscilloscope |
| `bright` | Light grounds. Print, editorial, anything that wants to feel physical. | hotpink, newsprint, blueprint, riso, chalk, swiss, cyanotype |
| `nature` | Climate, mapping, science, anything about the physical world. | forest, ocean, glacier, desert, aurora_borealis, nebula, moss, storm |
| `jewel` | Saturated and premium. Launches that want to feel expensive. | royal, emerald, ruby, sapphire, copper, ultraviolet |

**Light themes change the whole feel.** `swiss`, `newsprint`, `riso`, `chalk`
and `hotpink` run on a light ground, so they read as print rather than cinema.
Use them when the project is editorial or deliberately anti-slick; avoid them
when the film will be watched in a dark room.

### Matching a theme to a project

Ask what the project *is*, not what colour you like:

- A security or reliability project → `deep` or `ironclad`. Sobriety is the message.
- A CLI → `phosphor` or `amber_crt`. The audience already lives there.
- A graphics or audio library → `neon`, `hologram`, `ultraviolet`. Show off.
- A docs or accessibility tool → `hearth`, `chalk`, `cyanotype`. Gentle.
- Anything with a strong existing brand colour → pick the theme whose `accent`
  is nearest, then say so to the user rather than pretending it is exact.

When the user names a colour ("black and orange"), go to the theme list and
pick the match (`ember`, `furnace`, `orbit`) rather than inventing one.

## The graphics library

`python3 -m cased . --list-graphics` prints the live inventory, read out of the
engine itself so it cannot drift:

```
  54  themes
  65  shot types
  82  background beds
  45  overlay layers
  28  transitions
  21  camera moves
   7  directors
```

### Beds

The background is a single GLSL program per bed, compiled on demand. Families
worth knowing when hand-picking one:

- **flowing** — aurora, smoke, warp, silk, washes, curtains, nebula, clouds, mist
- **space** — stars, corona, rays, bloom, vortex, tunnel, starburst
- **geometric** — grid, sungrid, checkerhorizon, rulegrid, draft, hexfield, triangles, diamonds, scales, chevron
- **structural** — plates, facets, crystal, metaballs, mesh, terrain
- **water** — waves, caustics, ripples, interference, rainfall, bubbles
- **print** — halftone, risograin, crosshatch, engraving, stipple, chalkdust
- **material** — paper, concrete, marble, wood, carbon, denim, brushed
- **screen** — static, scanfield, lcd, crtbed, datamosh, rgbsplit, rain, matrix

A structural shot (`arch`, `tree`, `flow`, `callout`, `heatmap`) should sit on
a quiet bed — `aurora`, `smoke`, `stars`, `velvet`. Loud beds (`magma`,
`ripples`, `interference`, `plasma`) fight the content and should carry title
cards only.

### Overlays

`fx` is a list, so layers stack. Keep it to one or two: `motes` plus `grid` is
atmosphere, five at once is noise. The broadcast set (`safearea`, `timecode`,
`watermark`, `caption`) is for technical looks, not for a launch film.

### Verifying

```bash
node scripts/gallery.mjs                 # every primitive, fail on any blank
node scripts/gallery.mjs --only themes   # just the themes
node scripts/gallery.mjs --out /tmp/g    # write the PNGs to look at
```

The self-test runs this, so a shot that throws, or silently paints an empty
frame, fails CI rather than shipping as a blank three seconds.

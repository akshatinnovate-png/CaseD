// Find a repo's frontend, read its real style files, and pull out the palette
// it actually ships. No deploy, no build step — the colours are already in the
// source, and reading them is both cheaper and more honest than screenshotting
// a dev server we have no way to run from a static page.

import { getFile } from './github.js';

// ---------------------------------------------------------------- detection

// Each signal names a framework and the file that proves it. A match on the
// file is evidence; the directory it sits in is the frontend root.
const SIGNALS = [
  [/(^|\/)next\.config\.(m?[jt]s|mjs)$/, 'Next.js'],
  [/(^|\/)nuxt\.config\.[jt]s$/, 'Nuxt'],
  [/(^|\/)svelte\.config\.js$/, 'SvelteKit'],
  [/(^|\/)astro\.config\.(m?[jt]s)$/, 'Astro'],
  [/(^|\/)remix\.config\.js$/, 'Remix'],
  [/(^|\/)gatsby-config\.[jt]s$/, 'Gatsby'],
  [/(^|\/)angular\.json$/, 'Angular'],
  [/(^|\/)vue\.config\.js$/, 'Vue'],
  [/(^|\/)vite\.config\.[jt]s$/, 'Vite'],
  [/(^|\/)tailwind\.config\.([jt]s|mjs|cjs)$/, 'Tailwind'],
  [/(^|\/)_config\.yml$/, 'Jekyll'],
  [/(^|\/)hugo\.(toml|yaml)$/, 'Hugo'],
];

// Where a frontend's colours are declared, best first. Bounded on purpose:
// every entry is a network round-trip.
const STYLE_HINTS = [
  /(^|\/)(tailwind\.config)\.([jt]s|mjs|cjs)$/,
  /(^|\/)(theme|tokens|palette|colors?|colours?)\.(css|scss|less|[jt]sx?|json)$/,
  /(^|\/)(globals?|global|index|main|app|styles?|base|variables|_variables)\.(css|scss|sass|less|styl)$/,
  /(^|\/)theme\/.*\.([jt]sx?|css|scss)$/,
  /\.(css|scss|sass|less|styl)$/,
];

const FRONT_DIR = /^(src|app|web|www|site|docs|client|frontend|ui|public|pages|styles|assets|packages\/[^/]+)(\/|$)/;

/**
 * Identify the frontend from the file tree alone. Returns the frameworks we
 * have evidence for, the directory the UI lives in, and the style files worth
 * reading — never a guess dressed up as a finding.
 */
export function detectFrontend(treePaths) {
  const paths = treePaths || [];
  const frameworks = [];
  for (const [re, name] of SIGNALS) {
    const hit = paths.find(p => re.test(p));
    if (hit && !frameworks.some(f => f.name === name)) frameworks.push({ name, evidence: hit });
  }

  const html = paths.filter(p => /\.html?$/.test(p) && !/node_modules/.test(p));
  const comps = paths.filter(p => /\.(jsx|tsx|vue|svelte)$/.test(p));
  const styles = paths.filter(p => /\.(css|scss|sass|less|styl)$/.test(p) && !/node_modules|\.min\./.test(p));

  // The frontend root is the shallowest directory holding UI files.
  const roots = new Map();
  for (const p of [...comps, ...styles, ...html]) {
    const m = p.match(FRONT_DIR);
    const key = m ? m[1] : (p.includes('/') ? p.split('/')[0] : '(root)');
    roots.set(key, (roots.get(key) || 0) + 1);
  }
  const root = [...roots.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '(root)';

  // Rank style files by how likely they are to carry the palette.
  const ranked = [];
  STYLE_HINTS.forEach((re, tier) => {
    for (const p of paths) {
      if (!re.test(p) || /node_modules|\.min\.|vendor\//.test(p)) continue;
      if (ranked.some(r => r.path === p)) continue;
      ranked.push({ path: p, tier, depth: p.split('/').length });
    }
  });
  ranked.sort((a, b) => a.tier - b.tier || a.depth - b.depth || a.path.localeCompare(b.path));

  return {
    frameworks,
    root,
    isFrontend: frameworks.length > 0 || comps.length > 0 || (html.length > 0 && styles.length > 0),
    counts: { html: html.length, components: comps.length, styles: styles.length },
    styleFiles: ranked.slice(0, 8).map(r => r.path),
  };
}

// ------------------------------------------------------------------ colour

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return seg.map(v => (v + m) * 255);
}

/** sRGB → Oklab. Perceptual, so "nearest colour" matches what the eye says. */
export function oklab([r, g, b]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = ([r, g, b]) => oklab([r, g, b])[0];
const chroma = ([r, g, b]) => { const [, A, B] = oklab([r, g, b]); return Math.hypot(A, B); };

// Tailwind's defaults are the single most common palette on the web, and a
// config that only names them carries no hex at all.
const TW = {
  slate: '#64748B', gray: '#6B7280', zinc: '#71717A', neutral: '#737373', stone: '#78716C',
  red: '#EF4444', orange: '#F97316', amber: '#F59E0B', yellow: '#EAB308', lime: '#84CC16',
  green: '#22C55E', emerald: '#10B981', teal: '#14B8A6', cyan: '#06B6D4', sky: '#0EA5E9',
  blue: '#3B82F6', indigo: '#6366F1', violet: '#8B5CF6', purple: '#A855F7',
  fuchsia: '#D946EF', pink: '#EC4899', rose: '#F43F5E',
};

const NAMED = {
  black: '#000000', white: '#FFFFFF', transparent: null, currentcolor: null, inherit: null,
};

// Words that mark a token as a variant rather than the role itself. A name
// carrying one of these is a container, a state or a shade — not the brand.
const QUALIFIED = /(container|surface|on-|-on$|hover|active|focus|visited|disabled|muted|subtle|faint|dim|border|outline|ring|shadow|overlay|scrim|gradient|from|to|via|dark|light|inverse|alt|\d{2,3}$)/i;

// A custom property whose name says what the colour is for beats one that doesn't.
const ROLE = [
  [/(^|[-_])(bg|background|surface|canvas|paper|base|body)([-_]|$)/i, 'bg'],
  [/(^|[-_])(fg|foreground|text|ink|copy|content|heading|title)([-_]|$)/i, 'ink'],
  [/(^|[-_])(accent|primary|brand|highlight|action|link|cta)([-_]|$)/i, 'accent'],
  [/(^|[-_])(secondary|accent2|tertiary|info|success|warning|danger|error)([-_]|$)/i, 'accent2'],
];

/**
 * Pull every colour out of CSS/JS/JSON style sources, with a weight for how
 * much authority each sighting carries. Declared design tokens outrank a hex
 * buried in one rule, and a colour seen many times outranks a one-off.
 */
/** The role a token name declares, ignoring names that only qualify a role. */
function roleOf(name) {
  const hit = ROLE.find(([r]) => r.test(name));
  if (!hit) return null;
  return QUALIFIED.test(name) ? null : hit[1];
}

export function collectColors(sources) {
  const seen = new Map();   // hex -> { hex, rgb, count, weight, roles:Set, names:Set }

  const note = (raw, weight, role, name) => {
    const rgb = typeof raw === 'string' ? hexToRgb(raw) : raw;
    if (!rgb) return;
    const hex = rgbToHex(rgb);
    let e = seen.get(hex);
    if (!e) seen.set(hex, (e = { hex, rgb, count: 0, weight: 0, roles: new Set(), names: new Set() }));
    e.count++; e.weight += weight;
    if (role) e.roles.add(role);
    if (name) e.names.add(name);
  };

  for (const { path, text } of sources) {
    if (!text) continue;
    const body = String(text).slice(0, 240000);
    // Minified bundles are full of colours with no structure to read.
    if (/\.min\./.test(path) || (body.length > 4000 && !body.includes('\n'))) continue;
    const isConfig = /tailwind\.config|theme|token|palette|colors?\.|colours?\./i.test(path);

    // SCSS and Less keep colours in $vars / @vars and chain them
    // ($primary: $blue), so a role-bearing token often holds another variable.
    // Resolve one hop so the role lands on the colour it actually names.
    const vars = new Map();
    let vm;
    const varRe = /(?:^|\n)\s*[$@]([\w-]+)\s*:\s*([^;\n]+)/g;
    while ((vm = varRe.exec(body))) {
      vars.set(vm[1], vm[2].replace(/\s*!default\s*$/, '').trim());
    }
    const resolve = v => {
      let out = v;
      for (let i = 0; i < 3 && /^[$@][\w-]+$/.test(out.trim()); i++) {
        const next = vars.get(out.trim().slice(1));
        if (next === undefined) break;
        out = next;
      }
      return out;
    };
    for (const [name, raw] of vars) {
      const val = resolve(raw);
      const role = roleOf(name);
      if (!role && !/^(#|rgb|hsl)/i.test(val.trim())) continue;
      const w = (role ? 9 : 4) * (isConfig ? 1.4 : 1);
      for (const c of parseColorValues(val)) note(c, w, role, name);
    }

    // 1. Design tokens: `--name: value` and `name: '#hex'` in a config object.
    const tokenRes = [
      /--([\w-]+)\s*:\s*([^;}\n]+)/g,
      /['"]?([\w-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))['"]/g,
    ];
    for (const re of tokenRes) {
      let m;
      while ((m = re.exec(body))) {
        const name = m[1], val = m[2].trim();
        const role = roleOf(name);
        // A token that names a colour role is the strongest signal there is.
        const w = (role ? 9 : 5) * (isConfig ? 1.4 : 1);
        for (const c of parseColorValues(val)) note(c, w, role, name);
      }
    }

    // 2. Every remaining literal, weighted by how it was written.
    for (const c of parseColorValues(body)) note(c, isConfig ? 1.6 : 1, null, null);

    // 3. Tailwind utility classes name colours the config never spells out.
    let m;
    const util = /\b(?:bg|text|border|from|to|via|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d{2,3})\b/g;
    while ((m = util.exec(body))) {
      const base = hexToRgb(TW[m[1]]); if (!base) continue;
      // Tailwind's scale runs 50 (light) → 950 (dark); 500 is the base hue.
      const step = Number(m[2]), k = (500 - step) / 450;
      const mixed = base.map(v => k > 0 ? v + (255 - v) * k : v * (1 + k * 0.85));
      note(mixed, 2, null, `${m[1]}-${step}`);
    }
  }

  return [...seen.values()].sort((a, b) => b.weight - a.weight);
}

function parseColorValues(text) {
  const out = [];
  let m;
  const hex = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
  while ((m = hex.exec(text))) { const c = hexToRgb(m[1]); if (c) out.push(c); }
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/g;
  while ((m = rgb.exec(text))) out.push([+m[1], +m[2], +m[3]]);
  const hsl = /hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/g;
  while ((m = hsl.exec(text))) out.push(hslToRgb(+m[1], +m[2], +m[3]));
  for (const [name, h] of Object.entries(NAMED)) {
    if (h && new RegExp(`(^|[\\s:;,{])${name}([\\s;,}]|$)`, 'i').test(text)) out.push(hexToRgb(h));
  }
  return out;
}

/**
 * Reduce the colour census to the four roles a theme needs. Honours declared
 * roles where the source states them and infers the rest from luminance and
 * chroma, which is what the eye uses anyway.
 */
export function derivePalette(colors) {
  if (!colors.length) return null;
  const pick = role => colors.find(c => c.roles.has(role));
  const top = colors.slice(0, 40);

  // Background: whatever the source calls one, else the most-used near-neutral
  // at an extreme of the luminance range — pages are light or dark, not mid.
  let bg = pick('bg');
  if (!bg) {
    bg = top.filter(c => chroma(c.rgb) < 0.08 && (lum(c.rgb) < 0.3 || lum(c.rgb) > 0.86))
            .sort((a, b) => b.weight - a.weight)[0]
      || top.slice().sort((a, b) => b.weight - a.weight)[0];
  }
  const bgL = lum(bg.rgb);
  const dark = bgL < 0.5;

  // Ink: the declared one, else the most-used colour that actually contrasts.
  let ink = pick('ink');
  if (!ink || Math.abs(lum(ink.rgb) - bgL) < 0.25) {
    ink = top.filter(c => Math.abs(lum(c.rgb) - bgL) > 0.45 && chroma(c.rgb) < 0.12)
             .sort((a, b) => b.weight - a.weight)[0] || ink;
  }

  // Accent: the declared brand colour, else the most-used colour with real
  // chroma that stays legible against the background.
  const punch = c => c.weight * (0.5 + chroma(c.rgb));
  const vivid = top.filter(c => chroma(c.rgb) > 0.07 && Math.abs(lum(c.rgb) - bgL) > 0.12)
                   .sort((a, b) => punch(b) - punch(a));
  const accent = pick('accent') || vivid[0] || top[0];
  const accent2 = pick('accent2')
    || vivid.find(c => c.hex !== accent.hex && dist(oklab(c.rgb), oklab(accent.rgb)) > 0.12)
    || vivid.find(c => c.hex !== accent.hex);

  const fallbackInk = dark ? [245, 246, 250] : [12, 13, 18];
  return {
    bg: bg.hex,
    fg: ink ? ink.hex : rgbToHex(fallbackInk),
    accent: accent.hex,
    accent2: accent2 ? accent2.hex : accent.hex,
    dark,
    sampled: colors.length,
    evidence: {
      bg: [...bg.names].slice(0, 2),
      fg: ink ? [...ink.names].slice(0, 2) : [],
      accent: [...accent.names].slice(0, 2),
    },
  };
}

/**
 * Rank the built-in themes by how close they sit to an extracted palette.
 * Accent dominates — it is what a brand is recognised by — then background,
 * then the light/dark call, which is the one mismatch nobody forgives.
 */
export function rankThemes(palette, themes) {
  if (!palette) return [];
  const want = {
    bg: oklab(hexToRgb(palette.bg) || [0, 0, 0]),
    fg: oklab(hexToRgb(palette.fg) || [255, 255, 255]),
    accent: oklab(hexToRgb(palette.accent) || [128, 128, 128]),
    accent2: oklab(hexToRgb(palette.accent2) || palette.accent),
  };
  const rows = [];
  for (const [name, t] of Object.entries(themes)) {
    const tb = hexToRgb(t.bg), tf = hexToRgb(t.fg),
          ta = hexToRgb(t.accent), ta2 = hexToRgb(t.accent2 || t.accent);
    if (!tb || !tf || !ta) continue;
    const themeDark = lum(tb) < 0.5;
    const d = 2.4 * dist(want.accent, oklab(ta))
            + 1.0 * dist(want.bg, oklab(tb))
            + 0.5 * dist(want.fg, oklab(tf))
            + 0.6 * Math.min(dist(want.accent2, oklab(ta2)), dist(want.accent, oklab(ta2)))
            + (themeDark === palette.dark ? 0 : 1.1);
    rows.push({ name, theme: t, distance: Math.round(d * 1000) / 1000,
                match: Math.max(0, Math.round((1 - d / 2.6) * 100)) });
  }
  return rows.sort((a, b) => a.distance - b.distance);
}

/**
 * The whole frontend read, end to end: detect, fetch the style files the
 * detector chose, extract the palette, rank the themes against it.
 */
export async function readFrontend(repo, treePaths, token, branch, onStep) {
  const front = detectFrontend(treePaths);
  const sources = [];
  for (const path of front.styleFiles) {
    onStep?.(`reading ${path}`);
    try {
      const text = await getFile(repo, path, token, branch);
      if (text) sources.push({ path, text });
    } catch { /* a file we cannot read is one fewer sample, not a failure */ }
  }
  const colors = collectColors(sources);
  return {
    ...front,
    read: sources.map(s => s.path),
    colors: colors.slice(0, 24).map(c => ({ hex: c.hex, count: c.count,
      weight: Math.round(c.weight * 10) / 10, names: [...c.names].slice(0, 3) })),
    palette: derivePalette(colors),
  };
}

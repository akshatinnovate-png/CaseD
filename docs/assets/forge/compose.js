// The edit, in the browser.
//
// A port of cased/compose.py: takes a story, a director, a theme and the
// scorer's beat map, and returns the same frame-exact shot list the CLI would.
//
// The one idea worth knowing is unchanged: shot boundaries are snapped to the
// music. The scorer picks the tempo first, so every cut lands on a beat and
// each section change lands on an impact. That single constraint is most of
// the difference between a slideshow and something that feels edited.
//
// Verified against the Python composer in scripts/check_compose.mjs.

import { PyRandom } from './random.js';

/** Rows the `callout` shot draws. Must match the slice in stage.html. */
export const CALLOUT_LINES = 13;

/** Longest "what it is" card that still fits the engine's four-line box. */
const CARD_CHARS = 76;

/** Words that read badly as the last one before an ellipsis. */
const TRAIL = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for',
  'on', 'with', 'by', 'from', 'into', 'as', 'that', 'which', 'its', 'it', 'this']);

/** Trim to `limit`, on a word boundary, not ending on a dangling word. */
function ellipsis(text, limit) {
  if (text.length <= limit) return text;
  const words = text.slice(0, limit).replace(/\s+\S*$/, '').split(/\s+/);
  while (words.length > 3 && TRAIL.has(words[words.length - 1].replace(/[,;:]+$/, '').toLowerCase())) {
    words.pop();
  }
  return words.join(' ').replace(/[,;:]+$/, '') + '...';
}

const MIN_SHOT = 1.15;   // below this a shot reads as a flicker
const MAX_SHOT = 4.60;   // above this the eye wanders

/**
 * Python's round(), which is not Math.round().
 *
 * Two things go wrong with the obvious `Math.round(v * 1000) / 1000`. The
 * multiply itself rounds — 0.55 * 0.97 is exactly 0.53349999999999997, below
 * the tie, but times 1000 it becomes exactly 533.5 — and a genuine tie must
 * then break to the even digit, not upwards. Both show up in shot energies.
 *
 * So round the exact decimal expansion instead, which toFixed reports
 * faithfully, and apply the even rule only to a real tie.
 */
function pyRound(v, places) {
  if (!Number.isFinite(v)) return v;
  const neg = v < 0;
  const digits = Math.abs(v).toFixed(Math.min(20, places + 18));
  const dot = digits.indexOf('.');
  const cut = dot + places;                      // last kept character
  const kept = digits.slice(0, cut + 1);
  const rest = digits.slice(cut + 1);
  let up;
  if (!rest || rest[0] < '5') up = false;
  else if (rest[0] > '5') up = true;
  else if (/[1-9]/.test(rest.slice(1))) up = true;
  else {
    // An exact tie: break to the even digit, as Python does.
    const last = kept[kept.length - 1];
    up = (Number(last) % 2) === 1;
  }
  let out = Number(kept);
  if (up) out = Number((out + Math.pow(10, -places)).toFixed(places));
  return neg ? -out : out;
}

const round4 = v => pyRound(v, 4);
const round3 = v => pyRound(v, 3);

/** `3 commits` / `1 commit`. Thousands-separated, as the CLI writes them. */
export function plural(n, word) {
  const i = Number.parseInt(n, 10);
  if (!Number.isFinite(i)) return `${n} ${word}`;
  return `${i.toLocaleString('en-US')} ${word}${i === 1 ? '' : 's'}`;
}

// -------------------------------------------------------------------- copy

/** The first words on screen. Short, declarative, never a sentence. */
function hookLine(story) {
  const name = story.name;
  const tag = (story.tagline || '').trim().replace(/\.+$/, '');
  if (tag && tag.length <= 72) return tag;
  const byKind = {
    tool: `${name} is a command.`,
    service: `${name} runs the hard part.`,
    visual: `${name} draws it.`,
    ai: `${name} thinks it through.`,
    app: `${name}, in the browser.`,
    library: `import ${name.toLowerCase().replace(/ /g, '_')}`,
  };
  return byKind[story.kind] || `This is ${name}.`;
}

// ------------------------------------------------------------ beat snapping

/**
 * Beat times covering [0, duration).
 *
 * A beat map scored for a shorter runtime than the film leaves the back half
 * with nothing to snap to, and the cuts there drift off the music silently.
 * The tempo is constant, so extend the grid arithmetically rather than letting
 * it run out.
 */
function grid(points, step, duration) {
  const out = (points || []).filter(t => t > 0 && t < duration).sort((a, b) => a - b);
  if (step && step > 1e-6) {
    let t = (out.length ? out[out.length - 1] : 0) + step;
    while (t < duration) { out.push(round4(t)); t += step; }
  }
  return out;
}

/** Closest grid point to t inside [lo, hi], or null if the window is empty. */
function nearest(t, points, lo, hi) {
  let best = null, bestD = Infinity;
  for (const g of points) {
    if (g < lo - 1e-9 || g > hi + 1e-9) continue;
    const d = Math.abs(g - t);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}

/**
 * Drop the weakest beats when the runtime cannot hold the whole plan.
 *
 * A short duration asks for more shots than there are seconds; without this
 * the arithmetic hands the last shots zero or negative length. Keep the hook
 * and the end card — a film needs an open and a close — and shed the
 * lowest-weight middles until the rest fit.
 */
function fitToRuntime(plan, duration) {
  const room = Math.max(2, Math.floor(duration / MIN_SHOT));
  if (plan.length <= room) return plan;
  const keep = new Set([0, plan.length - 1]);
  const middles = [];
  for (let i = 1; i < plan.length - 1; i++) middles.push(i);
  middles.sort((a, b) => (plan[b].weight - plan[a].weight) || (a - b));
  for (const i of middles.slice(0, Math.max(0, room - 2))) keep.add(i);
  return plan.filter((_, i) => keep.has(i));
}

/**
 * Distribute shots across the runtime, then snap the cuts to the music.
 *
 * Snapping has to respect two hard constraints — shots may not fall below
 * MIN_SHOT, and the boundaries must stay monotonic — without ever landing
 * off-grid. The trick is to apply those constraints to the *search window*
 * rather than to the result: pick the nearest grid point that is already
 * legal, instead of snapping and then clamping the answer away from the beat.
 */
export function layOut(planIn, duration, beatmap) {
  const beats = grid(beatmap.beats || [], beatmap.spb || 0, duration);
  const accents = (beatmap.accents || []).map(a => a.time)
    .filter(t => t > 0 && t < duration).sort((a, b) => a - b);

  const plan = fitToRuntime(planIn, duration);

  const totalW = plan.reduce((s, x) => s + x.weight, 0) || 1;
  let raw = plan.map(s => Math.max(MIN_SHOT, Math.min(MAX_SHOT, duration * (s.weight / totalW))));
  const scale = duration / raw.reduce((a, b) => a + b, 0);
  raw = raw.map(d => d * scale);

  const n = plan.length;
  const bounds = [0];
  for (let i = 0; i < n - 1; i++) {
    const ideal = bounds[bounds.length - 1] + raw[i];
    const lo = bounds[bounds.length - 1] + MIN_SHOT;
    const hi = duration - MIN_SHOT * (n - 1 - i);    // leave room for what follows
    if (hi < lo) {                                   // too many shots for the runtime
      bounds.push(Math.min(Math.max(ideal, lo), duration));
      continue;
    }
    // A shot flagged `hard` opens a section, so it wants a musical impact. If
    // no impact is reachable, any beat is still better than an arbitrary time,
    // so always fall through to the beat grid.
    let pick = null;
    if (plan[i + 1].hard && accents.length) {
      const cand = nearest(ideal, accents, lo, hi);
      if (cand !== null && Math.abs(cand - ideal) <= 0.85) pick = cand;
    }
    if (pick === null) pick = nearest(ideal, beats, lo, hi);
    if (pick === null) pick = Math.min(Math.max(ideal, lo), hi);
    bounds.push(pick);
  }
  bounds.push(duration);

  return plan.map((s, i) => {
    const shot = {};
    for (const [k, v] of Object.entries(s)) {
      if (k !== 'weight' && k !== 'hard') shot[k] = v;
    }
    shot.start = round4(bounds[i]);
    shot.dur = round4(bounds[i + 1] - bounds[i]);
    return shot;
  });
}

/**
 * Which line of the signature function the callout should point at.
 *
 * Not the def, not the docstring, not a bare `return x` — the line doing the
 * actual work, which is usually the densest expression in the body.
 */
/**
 * Docstring openers, so the callout does not point at one.
 *
 * This lived next to the long-form plan that was deleted, which left
 * `focusLine` referring to a name that no longer existed. Nothing noticed
 * because nothing called `focusLine` any more -- it does again now.
 */
const DOCQ = ['"""', "'''"];

export function focusLine(code) {
  let best = -1, bestI = 0;
  code.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || i === 0) return;
    if (line.startsWith('#') || line.startsWith('@') || DOCQ.includes(line.slice(0, 3))) return;
    if (['else:', 'try:', 'pass'].includes(line)) return;
    let score = line.length * 0.35;
    for (const op of '=+-*/<>[](){}') score += (line.split(op).length - 1) * 2.2;
    if (/\b(for|while|if|return|yield)\b/.test(line)) score += 9;
    if (line.startsWith('def ') || line.startsWith('class ')) score -= 14;
    if (score > best) { best = score; bestI = i; }
  });
  return bestI;
}

/**
 * A share as a person would write it. Python renders 51.0 as "51.0" and this
 * renders the same JSON value as "51", so a share landing on a whole number
 * made the two composers disagree about the text on screen.
 */
function pct(v) {
  const f = Number(v);
  return (Number.isInteger(f) ? String(f) : String(f)) + '%';
}

/**
 * Which extensions belong to which language name, for the editor status bar.
 * Only used to label a file the analyzer already measured -- never to guess
 * at a language the languages table does not already list.
 */
const EXT_OF = {
  Python: ['py'], JavaScript: ['js', 'mjs', 'cjs', 'jsx'],
  TypeScript: ['ts', 'tsx'], HTML: ['html', 'htm'], CSS: ['css'],
  SCSS: ['scss'], Markdown: ['md'], Rust: ['rs'], Go: ['go'],
  Ruby: ['rb'], Java: ['java'], C: ['c', 'h'], 'C++': ['cpp', 'cc', 'hpp'],
  'C#': ['cs'], Shell: ['sh', 'bash'], Swift: ['swift'], Kotlin: ['kt'],
  PHP: ['php'], SQL: ['sql'], Vue: ['vue'], Svelte: ['svelte'],
};

// -------------------------------------------------------------------- plan

/** One measured sentence about the import graph, or nothing. */
function archNote(ins) {
  const mods = (ins && ins.modules) || [];
  const edges = (ins && ins.edges) || [];
  if (mods.length < 4) return '';
  let note = `${plural(mods.length, 'module')}, ${plural(edges.length, 'import')} between them`;
  const hub = ins && ins.hub;
  if (hub) note += ` — everything leans on ${hub.split('/').pop()}`;
  return note;
}

/**
 * The import graph as columns, left depending on right.
 *
 * The ring the old `arch` shot drew put every module the same distance from
 * the middle, which says nothing about direction. Grouping by directory and
 * ordering the columns by how much each is depended upon says it at a
 * glance -- and the directory names are real, so the headings are measured
 * too rather than invented layer names.
 */
function archColumns(ins) {
  const mods = (ins && ins.modules) || [];
  const edges = (ins && ins.edges) || [];
  if (mods.length < 4) return null;

  const byDir = new Map();
  mods.forEach((m, i) => {
    const key = m.dir || '(root)';
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push([i, m]);
  });

  // A column earns its place by weight, not by alphabet.
  const weight = g => g.reduce((a, [, m]) => a + m.loc + 90 * (m.deg_in + m.deg_out), 0);
  let dirs = [...byDir.entries()].sort((x, y) => weight(y[1]) - weight(x[1])).slice(0, 4);
  if (dirs.length < 2) return null;
  // Left to right: the most depended-upon directory sits on the right, the
  // way a call graph reads.
  dirs.sort((x, y) => x[1].reduce((a, [, m]) => a + m.deg_in, 0)
                    - y[1].reduce((a, [, m]) => a + m.deg_in, 0));

  const nodes = [], index = new Map();
  const hub = ins && ins.hub;
  dirs.forEach(([, group], ci) => {
    const pick = [...group].sort((x, y) =>
      (y[1].deg_in * 3 + y[1].deg_out + y[1].loc / 400)
      - (x[1].deg_in * 3 + x[1].deg_out + x[1].loc / 400)).slice(0, 4);
    for (const [mi, m] of pick) {
      index.set(mi, nodes.length);
      nodes.push({ label: m.label, col: ci, note: String(m.loc), hub: m.id === hub });
    }
  });
  if (nodes.length < 4) return null;

  const seen = new Set(), out = [];
  for (const [a, b] of edges) {
    if (!index.has(a) || !index.has(b)) continue;
    const ia = index.get(a), ib = index.get(b);
    if (ia === ib) continue;
    const key = `${ia}:${ib}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([ia, ib]);
  }
  const heads = [], used = new Set();
  for (const [dname] of dirs) {
    const leaf = dname.split('/').pop() || dname;
    // Keep more of the path only when the leaf alone would repeat.
    heads.push(used.has(leaf) ? dname : leaf);
    used.add(leaf);
  }
  return { columns: heads, nodes, edges: out.slice(0, 26) };
}

/**
 * Flatten the acts into a shot list, numbering the ones that survived.
 *
 * An act whose evidence never turned up contributes nothing and takes no
 * number, so a film that could not read an import graph says `04 / 05`
 * rather than leaving a gap where the chapter would have been. The frame
 * marker carries the act's name for every shot inside it, which is what
 * stops a run of dense screens reading as one long undifferentiated take.
 */
function layActs(acts, useCards) {
  const live = acts.filter(a => a.beats.length);
  const total = live.filter(a => a.card && a.title).length;
  const plan = [];
  let n = 0;
  for (const a of live) {
    let mark = '';
    if (a.card && a.title) {
      n++;
      mark = `${String(n).padStart(2, '0')} · ${a.title.toLowerCase()}`;
      if (useCards) {
        plan.push({
          type: 'chaptercard',
          data: {
            number: String(n).padStart(2, '0'),
            total: String(total).padStart(2, '0'),
            text: a.title, sub: a.sub, invert: n % 2 === 1,
          },
          // Light: a card is a breath between two dense screens, not a
          // scene in its own right.
          weight: 0.55, hard: true, section: 'chapter', chapter: mark,
        });
      }
    }
    for (const b of a.beats) {
      if (mark) b.chapter = mark;
      plan.push(b);
    }
  }
  return plan;
}

/**
 * The film. One grammar, whichever director draws it.
 *
 * This used to be one of three plans. The other two — a short arc of title
 * cards and counters, and a long one of diagrams — drew *data about* the
 * repository: a number on a shader, a ring of module names, a globe. They
 * were the same slideshow every time, and no amount of theming fixed that,
 * because the problem was never the colour.
 *
 * So there is one plan now and it draws the repository *as a product*: the
 * files scattered as windows, the top-level directories in orbit, recent work
 * on a board, real source in an editor, the language split on a dashboard.
 * Past about forty seconds it keeps going into the same register — a second
 * file, the README answered in a panel, the two sides of the project split
 * across a screen.
 *
 * Every beat is conditional on evidence, so a repository with no import graph
 * gets no architecture shot rather than an empty one.
 *
 * Nothing here is invented. Every window, card, pill and figure comes out of
 * the analyzer, so the frame stamp reads MEASURED throughout.
 */
export function buildPlan(story, ins, d, duration) {
  const name = story.name;
  const stats = story.stats || {};
  const langs = story.languages || [];

  // Below this runtime the chapter cards would outnumber the screens, so the
  // acts still order the film but announce themselves only in the frame
  // marker. Named `useCards` because the board beat further down builds a
  // list called `cards`, and a flag a later line can quietly overwrite is a
  // flag that will be.
  const useCards = duration >= 30;

  const acts = [];
  const act = (title, sub = '', card = true) => {
    acts.push({ title, sub, card, beats: [] });
  };
  const add = (type, data, weight, section = '', caption = '', hard = false) => {
    const shot = { type, data, weight, hard };
    if (section) shot.section = section;
    if (caption) shot.caption = caption;
    acts[acts.length - 1].beats.push(shot);
  };

  const files = stats.files || 0;
  const feats = story.features || [];
  const commits = stats.commits || stats.commits_seen || 0;
  const moments = story.code_moments || [];
  const tree = (ins && ins.tree) || story.tree || [];

  // ---- the cold open: no card, just the repository --------------------
  act('', '', false);
  // the scatter, then the name for it
  const sample = (story.files_sample || []).slice(0, 13);
  add('appwindows', {
    text: files ? `${plural(files, 'file')}. One *repository*.` : `${name}, *in one place*.`,
    count: Math.max(6, Math.min(files || 9, 13)), seed: story.seed || 7,
    // Real paths, with the line count the analyzer counted.
    files: sample.map(f => ({
      path: f.path, loc: f.loc ?? null, bytes: f.bytes ?? null, lang: f.lang ?? null,
    })),
  }, 1.15, 'the shape', (story.tagline || '').slice(0, 72));

  // ---- what it is -----------------------------------------------------
  act('What it is', (story.tagline || '').slice(0, 96));
  // the top-level directories, in orbit
  let mods = tree.map(t => t.path).filter(p => p && p !== '(root)').slice(0, 8);
  if (mods.length < 3) {
    const seen = [];
    for (const m of story.code_moments || []) {
      const top = m.path.includes('/') ? m.path.split('/')[0] : '(root)';
      if (!seen.includes(top)) seen.push(top);
    }
    mods = seen.slice(0, 8);
  }
  if (mods.length >= 3) {
    const counts = {};
    for (const t of tree) if (t.path) counts[t.path] = t.files;
    add('apporbit', {
      title: 'Everything it is made of.',
      mark: name.slice(0, 2).toUpperCase(),
      // The file count beside each name, where the analyzer counted one.
      items: mods.map(m => (counts[m]
        ? { name: m, meta: plural(counts[m], 'file') } : { name: m })),
    }, 1.45, 'orbit view',
      `${mods.length} top-level ${mods.length === 1 ? 'directory' : 'directories'}`);
  }
  // The README's own claim, answered in a panel. The words are the
  // author's and the panel says so -- nothing here is generated.
  const claims = (ins && ins.claims) || story.claims || [];
  if (claims.length && duration >= 34) {
    add('appchat', {
      app: story.full_name || story.repo || name,
      title: 'In their *own words*.',
      agent: 'README',
      messages: [
        { from: 'you', text: `What is ${name}?` },
        { text: ellipsis(claims[0], 150) },
        ...(feats.length ? [
          { from: 'you', text: 'What does it do?' },
          { text: ellipsis(feats[0], 150) },
        ] : []),
      ],
      prompt: 'Straight from the repository',
    }, 1.2, 'the claim', 'Quoted, not generated.');
  }

  // ---- what it does ---------------------------------------------------
  act('What it does', 'Straight from the README.');
  // what it does, in the author's words
  if (feats.length >= 2) {
    add('bullets', { title: 'what it does', items: feats.slice(0, 5) },
        1.3, 'capability', 'Straight from the README.');
  }
  // The project's own documented commands, actually running. The lines
  // are the README's, not a script somebody imagined.
  const cmds = (story.commands || []).filter(Boolean).slice(0, 3);
  if (cmds.length && duration >= 40) {
    add('terminalrun', {
      title: stats.branch || 'bash',
      dur: 3.4,
      lines: cmds.map(c => ({ kind: 'cmd', text: `$ ${ellipsis(c, 64)}` })),
    }, 1.2, 'run it', 'The commands the README documents.');
  }

  // What the source turned out to know how to do, in the same ring the
  // directories were drawn in.
  const techs = (((ins && ins.techniques) || []).map(t => t.name)).slice(0, 8);
  if (techs.length >= 4 && duration >= 40) {
    add('apporbit', {
      title: 'What the code *knows how to do*.',
      mark: name.slice(0, 2).toUpperCase(),
      items: techs.map(t => ({ name: t })),
    }, 1.3, 'technique', 'Found by reading the source, not the README.');
  }

  // ---- how it works ---------------------------------------------------
  act('How it works', archNote(ins));
  // How the modules actually depend on each other, in columns rather than a
  // ring: left calls right, and the headings name the layers.
  if (duration >= 34) {
    const amap = archColumns(ins);
    if (amap) {
      add('archmap', {
        title: 'How it *fits together*.',
        columns: amap.columns, nodes: amap.nodes, edges: amap.edges,
        note: archNote(ins),
      }, 1.5, 'architecture');
    }
  }
  // the two audiences, if the deep read found techniques
  if (duration >= 45 && ins && (ins.techniques || []).length) {
    // Each side carries what was counted for it: how many places in the
    // source a technique turned up, and how many files a language is in.
    add('appsplit', {
      left: { kicker: 'in the source', text: 'What it *actually does*.',
              items: ins.techniques.slice(0, 6).map(t => ({
                name: t.name, meta: plural(t.hits, 'place'),
              })) },
      right: { kicker: 'in the repo', text: 'What it is *made of*.',
               items: langs.slice(0, 6).map(l => ({
                 name: `${l.name} ${pct(l.share)}`, meta: plural(l.files || 0, 'file'),
               })) },
    }, 1.25, 'two sides', 'Found by reading the code.', true);
  }

  // ---- the code -------------------------------------------------------
  act('The code', moments.length ? (moments[0].caption || '') : '');
  // real source, in an editor

  /**
   * The sidebar, filled from the real tree rather than three names. Four
   * entries in a pane built for a project is the same emptiness the rest of
   * these screens had; the file sample is real paths the analyzer walked.
   */
  const editorFiles = (active) => {
    const paths = [];
    for (const f of story.files_sample || []) {
      if (!paths.includes(f.path)) paths.push(f.path);
    }
    for (const other of moments) if (!paths.includes(other.path)) paths.push(other.path);
    if (stats.hottest_file && !paths.includes(stats.hottest_file)) {
      paths.push(stats.hottest_file);
    }
    const rest = paths.filter(p => p !== active).sort().slice(0, 13);
    const all = [active, ...rest];
    // Three rows reading README.md is a tree that has lost the plot, so a
    // repeated basename keeps the directory that tells them apart, and a
    // label that is still ambiguous after that drops out.
    const counts = {};
    for (const p of all) {
      const base = p.split('/').pop();
      counts[base] = (counts[base] || 0) + 1;
    }
    const out = [], used = new Set();
    for (const p of all) {
      const base = p.split('/').pop();
      const label = counts[base] > 1 && p.includes('/')
        ? p.split('/').slice(-2).join('/') : base;
      if (used.has(label)) continue;
      used.add(label);
      out.push({ name: label, depth: Math.min((p.match(/\//g) || []).length, 3),
                 active: p === active });
    }
    return out;
  };

  /** The status bar cells -- each one measured, none of them filler. */
  const editorStatus = (path, code) => {
    const ext = path.split('.').pop().toLowerCase();
    const lang = (langs.find(l => (EXT_OF[l.name] || []).includes(ext)) || {}).name || '';
    const cells = [stats.branch || 'main'];
    if (lang) cells.push(lang);
    cells.push(`${plural(code.length, 'line')} shown`);
    cells.push(path);
    return cells;
  };

  if (moments.length) {
    const m = moments[0];
    add('appcode', {
      app: story.full_name || story.repo || name,
      title: 'Written *here*.',
      root: m.path.split('/')[0],
      branch: story.branch || stats.branch || 'main',
      action: 'Run',
      tab: m.path.split('/').pop(),
      files: editorFiles(m.path),
      code: (m.code || []).slice(0, 14),
      status: editorStatus(m.path, (m.code || []).slice(0, 14)),
    }, 1.6, 'source', m.caption || 'Real source, not a mockup.');
  }
  // The function the project is actually about, with the working line called
  // out. A second editor pane would be the same picture twice; this is the
  // one shot from the old vocabulary worth keeping, because it says
  // something an editor screenshot cannot -- which line matters.
  const sig = (ins && ins.signature) || {};
  if (sig.code && duration >= 40) {
    const shown = sig.code.slice(0, CALLOUT_LINES);
    add('callout', {
      path: `${sig.module} \u2014 ${sig.name}()`,
      code: shown,
      highlight: focusLine(shown),
      label: 'the idea',
      note: sig.doc
        || `${plural(sig.lines, 'line')}, ${plural(sig.branches || 0, 'branch')}`,
    }, 1.6, 'the idea', 'The line the rest of it is built around.');
  }
  // A second file, further into the tree than the first.
  if (moments.length > 1 && duration >= 50) {
    const m2 = moments[1];
    add('appcode', {
      app: story.full_name || story.repo || name,
      title: 'And *here*.',
      root: m2.path.split('/')[0],
      branch: story.branch || stats.branch || 'main',
      action: 'Test',
      tab: m2.path.split('/').pop(),
      files: editorFiles(m2.path),
      code: (m2.code || []).slice(0, 14),
      status: editorStatus(m2.path, (m2.code || []).slice(0, 14)),
      railActive: 3,
    }, 1.5, 'source', m2.caption || 'Real source, not a mockup.');
  }

  // ---- what it is made of ---------------------------------------------
  act('What it is made of', langs.length ? plural(langs.length, 'language') : '');
  // the stack, on a dashboard
  if (langs.length >= 2) {
    const hero = langs[0];
    add('appdash', {
      app: story.full_name || story.repo || name,
      title: 'The stack, *measured*.',
      value: pct(hero.share), delta: hero.name,
      label: 'share of the codebase',
      // The share ladder is the series: real proportions, in order.
      series: langs.slice(0, 8).map(l => l.share).reverse(),
      // The figures a stack screen carries besides the hero share.
      topline: [
        { label: 'files', value: stats.files || 0 },
        { label: 'lines', value: (stats.loc || 0).toLocaleString('en-US') },
        { label: 'languages', value: langs.length },
        { label: 'directories', value: stats.directories || 0 },
      ],
      // Every language, as a measured row rather than three loose labels.
      rows: langs.slice(0, 5).map(l => ({
        label: l.name, value: pct(l.share),
        frac: l.share / Math.max(langs[0].share, 1), color: l.color ?? null,
      })),
    }, 1.35, 'stack', `${langs.length} languages, measured from the tree.`, true);
  }
  // The tools the repository carries, each over the file that proves it.
  if (duration >= 34) {
    const tiles = [...(story.toolchain || [])];
    // Languages fill the row out with their own measured file counts -- the
    // same evidence rule, counted rather than named.
    for (const l of langs.slice(0, 4)) {
      if (tiles.length >= 6) break;
      if (l.files) tiles.push({ name: l.name, note: plural(l.files, 'file'), icon: 'bolt' });
    }
    if (tiles.length >= 3) {
      add('surfaces', {
        title: 'Built with *what it says it is*.',
        items: tiles.slice(0, 6),
      }, 1.25, 'toolchain', 'Every tile names the file that proves it.', true);
    }
  }

  // ---- the work -------------------------------------------------------
  act('The work', commits ? plural(commits, 'commit') : '');
  // recent work, as a board
  const tl = story.timeline || [];
  if (tl.length >= 3) {
    // A card carries what the commit actually was: the subject, the kind of
    // change its prefix declares, and its position in the history.
    const kind = (text) => {
      const head = text.slice(0, 16).includes(':')
        ? text.split(':')[0].toLowerCase() : text.toLowerCase();
      for (const [key, tag] of [['feat', 'feature'], ['add', 'feature'],
                                ['fix', 'fix'], ['perf', 'speed'],
                                ['refactor', 'refactor'], ['doc', 'docs'],
                                ['test', 'tests']]) {
        if (head.startsWith(key)) return tag;
      }
      return 'change';
    };
    const recent = tl.slice(-9);
    const cards = recent.map((t, i) => ({
      text: ellipsis(t.text, 44), tag: kind(t.text),
      meta: `#${tl.length - recent.length + i + 1}`,
    }));
    const third = Math.max(1, Math.floor(cards.length / 3));
    add('appboard', {
      app: story.full_name || story.repo || name,
      title: 'The work, *on one board*.',
      sprint: commits ? plural(commits, 'commit') : 'recent work',
      columns: [
        { name: 'earlier', cards: cards.slice(0, third) },
        { name: 'then', cards: cards.slice(third, third * 2) },
        { name: 'latest', cards: cards.slice(third * 2) },
      ],
    }, 1.4, 'history', 'Every card is a real commit.', true);
  }
  // The work rate, on the screen a product would show it on. Every figure
  // is a count of real commits in a real window of days.
  const cad = (ins && ins.cadence) || [];
  const active = cad.filter(v => v).length;
  if (cad.length >= 60 && active >= 12 && duration >= 40) {
    const weeks = [];
    for (let i = 0; i + 7 <= cad.length; i += 7) {
      weeks.push(cad.slice(i, i + 7).reduce((a, b) => a + b, 0));
    }
    const busiest = weeks.length ? Math.max(...weeks) : 0;
    const last5 = weeks.slice(-5).reverse();
    add('appdash', {
      app: story.full_name || story.repo || name,
      title: 'The work *rate*.',
      value: String(active), delta: 'days with a commit',
      label: `of the last ${cad.length} days`,
      series: weeks.slice(-16).length ? weeks.slice(-16) : [0, 0],
      railActive: 5,
      topline: [
        { label: 'commits', value: cad.reduce((a, b) => a + b, 0) },
        { label: 'active days', value: active },
        { label: 'weeks', value: weeks.length },
        { label: 'busiest week', value: busiest },
      ],
      rows: last5.map((w, i) => ({
        label: `week ${weeks.length - i}`, value: String(w),
        frac: busiest ? w / busiest : 0.0, color: null,
      })),
    }, 1.3, 'cadence', ((ins && ins.peak_day) || '') || 'Counted from the commit dates.', true);
  }
  // ---- the close: no card ---------------------------------------------
  act('', '', false);
  // the card people screenshot
  add('endcard', {
    name, sub: story.url || story.repo || '', cta: 'made with cased2.0',
  }, 1.0, 'end', '', true);

  return layActs(acts, useCards);
}

// ---------------------------------------------------------------- decorate

/** Attach the director's look to each shot: bed, camera, entrance, fx. */
export function decorate(plan, d, themeSpec) {
  const { beds, cams, ins } = d;
  plan.forEach((s, i) => {
    s.bg = beds[i % beds.length];
    s.cam = cams[i % cams.length];
    s.in = i === 0 ? 'cut' : ins[i % ins.length];
    s.energy = round3(Math.min(1, d.energy * (0.72 + 0.5 * (i / Math.max(plan.length - 1, 1)))));
    s.fx = [...d.fx];

    // Shot-type overrides: some beats want a specific bed.
    if (s.type === 'globe') { s.bg = 'stars'; s.cam = 'none'; }
    if (s.type === 'code') { s.cam = 'none'; s.fx = s.fx.filter(f => f !== 'wave'); }
    if (s.type === 'endcard') {
      s.bg = themeSpec.bg_mode !== 'halftone' ? 'rings' : 'halftone';
      s.cam = 'pull';
      s.energy = round3(d.energy * 0.55);
    }
    if (s.type === 'retro') { s.bg = 'halftone'; s.cam = 'none'; }
    // Structural shots carry their own geometry, so the bed stays quiet and
    // the camera stays still — a drifting frame fights a diagram.
    if (['arch', 'tree', 'flow', 'callout', 'heatmap', 'constellation', 'compare'].includes(s.type)) {
      s.cam = 'none';
      s.energy = round3(Math.min(s.energy, 0.5));
    }
    if (s.type === 'arch' || s.type === 'constellation') s.bg = 'stars';
    if (s.type === 'tree' || s.type === 'flow' || s.type === 'compare') s.bg = 'aurora';
    if (s.type === 'heatmap') {
      // The grid bed is a perspective tunnel; behind a data grid it reads as
      // interference rather than atmosphere.
      s.bg = 'aurora';
      s.energy = 0.25;
    }
    if (s.type === 'bigquote') s.cam = 'push';
  });
}

// ------------------------------------------------------------------- share

/** Post-ready copy. Written to be used verbatim, not edited. */
export function shareCopy(story, director) {
  const name = story.name;
  const tag = (story.tagline || story.description || '').trim();
  const url = story.url || '';
  const stats = story.stats || {};
  const loc = stats.loc, commits = stats.commits;
  const langs = (story.languages || []).slice(0, 3).map(l => l.name).join(', ');

  const proof = [];
  if (loc) proof.push(plural(loc, 'line'));
  if (commits) proof.push(plural(commits, 'commit'));
  const proofS = proof.join(' \u00b7 ');

  let x = `${name}\n\n${tag}`;
  if (proofS) x += `\n\n${proofS}`;
  if (url) x += `\n\n${url}`;

  const linkedin = `I built ${name}.\n\n${tag}\n\n`
    + (langs ? `Under the hood: ${langs}.\n` : '')
    + (proofS ? `${proofS}.\n` : '')
    + (url ? `\nIt's here: ${url}` : '');

  const rstrip = t => t.replace(/\.+$/, '');
  return {
    x: x.trim(),
    linkedin: linkedin.trim(),
    hn: tag ? `Show HN: ${name} \u2013 ${rstrip(tag.slice(0, 70))}` : `Show HN: ${name}`,
    product_hunt: tag ? tag.slice(0, 60) : `${name}, now public`,
    // Alt text describes the film for someone who cannot watch it, so it leads
    // with what the film shows rather than repeating the sales line.
    alt_text: `A ${director.toLowerCase()} launch film for ${name}`
      + (tag ? `, described as: ${rstrip(tag.slice(0, 110))}` : '')
      + '. Title cards, measured statistics, real source code and an '
      + 'end card, cut to a synthesised soundtrack.',
  };
}

// ------------------------------------------------------------- entry point

/**
 * Build the full render spec. `director` and `theme` are names; `themes` and
 * `directors` are the generated tables the site loads as JSON.
 */
export function compose(story, beatmap, {
  duration = 24, director = null, theme = null, width = 1920, height = 1080,
  seed = 0, themes, directors, insight = null,
} = {}) {
  // Mirrors compose.py exactly: the composer does not prefer a director just
  // because an insight report came with it. The CLI resolves `--creative` to
  // the creative director before calling in, and so does the Make page.
  const dname = director && directors[director] ? director : pickDirector(story, directors);
  const d = directors[dname];
  const rng = new PyRandom(seed || story.seed || 1);

  // The atlas director draws the repository as a product; passing an insight
  // report switches any other director to the long-form arc.
  // One grammar, whichever director was picked. The director sets pacing,
  // bed and transition vocabulary; it no longer decides whether the film is
  // a product film, because the slideshow alternative is gone.
  const plan = buildPlan(story, insight, d, duration);

  // The director names a default theme; an explicit theme overrides it. Look
  // and pacing are independent axes, so any theme composes with any director.
  const themeName = theme && themes[theme] ? theme : d.theme;
  const t = themes[themeName] || themes[d.theme];
  const themeSpec = {
    bg: t.bg, fg: t.fg, accent: t.accent, accent2: t.accent2,
    grain: t.grain, scanlines: t.scanlines, vignette: t.vignette,
    letterbox: t.letterbox, bg_mode: t.bg_mode, face: t.face,
  };
  // Let a strong hero language tint the second accent, but only when the theme
  // was not explicitly chosen — if someone asked for `ember`, they asked for
  // ember, not ember-with-a-Python-blue.
  if (!theme && ['cinematic', 'orbit', 'warm'].includes(dname) && story.hero_color) {
    themeSpec.accent2 = story.hero_color;
  }

  decorate(plan, d, themeSpec);
  const shots = layOut(plan, duration, beatmap);

  const bm = {};
  for (const [k, v] of Object.entries(beatmap)) if (k !== 'beats') bm[k] = v;

  return {
    version: '2.0',
    project: story.name,
    director: dname,
    director_label: d.label,
    mode: insight ? 'creative' : 'standard',
    seed: seed || story.seed || 1,
    fps: 30,
    width, height,
    duration: round4(duration),
    theme: themeSpec,
    theme_name: themeName,
    // The frame furniture rides on the director, not the theme.
    hud: !!d.hud,
    hud_label: String(story.name).toUpperCase().slice(0, 18),
    shots,
    beatmap: bm,
    share: shareCopy(story, d.label),
  };
}

/** KIND_DEFAULT from cased/directors.py: a project's kind suggests a style. */
export const KIND_DEFAULT = {
  tool: 'terminal', service: 'orbit', visual: 'hype', ai: 'cinematic',
  app: 'cinematic', library: 'warm', project: 'atlas',
};

/** Mirror of directors.pick. */
export function pickDirector(story, directors) {
  const want = KIND_DEFAULT[story.kind] || 'atlas';
  return directors[want] ? want : Object.keys(directors)[0];
}

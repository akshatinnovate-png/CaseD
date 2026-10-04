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

// -------------------------------------------------------------------- plan

/** Choose which beats this particular repo has earned. */
export function buildPlan(story, dname, d, rng, duration) {
  const name = story.name;
  const stats = story.stats || {};
  const plan = [];
  const add = (type, data, weight, hard = false, extra = {}) =>
    plan.push({ type, data, weight, hard, ...extra });

  // 1 — the hook
  add('title', {
    kicker: story.repo || 'introducing',
    text: hookLine(story),
    caps: ['brutalist', 'hype', 'orbit'].includes(dname),
    sub: '',
    rule: true,
  }, 1.05);

  // 2 — what it actually is.
  // The hook is normally the head of the description, so playing the
  // description next repeats the opening card word for word. Show whatever the
  // hook left behind; if it left nothing, skip the beat.
  const hook = plan[0].data.text;
  const desc = story.description || story.tagline || '';
  let second = desc;
  if (desc.toLowerCase().startsWith(hook.toLowerCase().slice(0, 40))) {
    second = desc.slice(hook.length).replace(/^[\s—–\-:,.]+/, '').trim();
    if (second) second = second[0].toUpperCase() + second.slice(1);
  }
  if (second && second.length > 24) {
    // A title card is read in two seconds, so this stays a line and not a
    // paragraph. The budget used to be 108 characters at a pinned 92px, which
    // overran the four-line box and clipped the sentence mid-phrase; the
    // engine already sizes type to its length, so let it.
    add('title', {
      kicker: 'what it is',
      text: ellipsis(second, CARD_CHARS),
      perLine: 4,
      rule: false,
    }, 1.25);
  }

  // 3 — the brutalist director gets its dialog boxes early
  if (dname === 'brutalist') {
    const wins = [{ title: `${name} 2.0`, body: `> ${desc.slice(0, 76) || 'ready'}` }];
    if (stats.commits) {
      wins.push({ title: 'LOG', body: `${stats.commits} commits\n${stats.loc || 0} lines` });
    }
    add('retro', { windows: wins }, 1.15, true);
  }

  // 4 — proof: the two strongest measured numbers
  for (const h of (story.highlights || []).slice(0, 2)) {
    add('stat', { value: h.value, label: h.label }, 0.72, true);
  }

  // 5 — real source on screen
  const moments = story.code_moments || [];
  if (moments.length) {
    const m = moments[0];
    add('code', { path: m.path, code: m.code, caption: m.caption || '', dur: 3.4 }, 1.45);
  }

  // 6 — what it does
  const feats = story.features || [];
  if (feats.length >= 2) add('bullets', { title: 'what it does', items: feats.slice(0, 5) }, 1.35);

  // 7 — the stack
  const langs = story.languages || [];
  if (langs.length >= 2) {
    add('langs', {
      title: 'built with',
      items: langs.slice(0, 5).map(l => ({ name: l.name, share: l.share, color: l.color })),
    }, 1.0, true);
  }

  // 8 — a second code beat, if the repo has range
  if (moments.length > 1 && duration >= 22) {
    const m = moments[1];
    add('code', { path: m.path, code: m.code, caption: m.caption || '', dur: 3.0 }, 1.25);
  }

  // 9 — history
  const tl = story.timeline || [];
  if (tl.length >= 3 && duration >= 20) {
    add('timeline', { title: 'how it got here', items: tl.slice(-4) }, 1.2);
  }

  // 10 — the scale beat
  if (duration >= 18) {
    add('globe', {
      kicker: 'available now',
      text: 'Ship it anywhere',
      sub: story.license ? `Open source · ${story.license}` : 'Clone it and run it.',
    }, 1.15, true);
  }

  // 11 — the card people screenshot
  add('endcard', {
    name,
    sub: story.url || story.repo || '',
    cta: 'made with cased2.0',
  }, 1.0, true);

  void rng;   // the standard plan is deterministic; the creative one draws
  return plan;
}


/** Opening delimiters of a docstring, built rather than written literally. */
const DOCQ = ['"'.repeat(3), "'".repeat(3)];

/**
 * Which line of the signature function the callout should point at.
 *
 * Not the def, not the docstring, not a bare `return x` — the line doing the
 * actual work, which is usually the densest expression in the body.
 */
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
 * The long-form arc.
 *
 * A minute of title cards and counters is a minute of nothing: by about twenty
 * seconds the viewer has learned the format and starts reading the clock
 * instead of the work. So this plan spends its middle on *structure* — what
 * the repo is made of, how it fits together, which line is the clever one —
 * and only returns to numbers once it has earned them.
 *
 * Every beat is conditional on evidence. A repo with no import graph gets no
 * architecture shot rather than an empty one.
 */
export function buildCreativePlan(story, ins, dname, d, rng, duration) {
  const name = story.name;
  const plan = [];
  const add = (type, data, weight, hard = false) => plan.push({ type, data, weight, hard });

  // 1 -- cold open
  add('title', {
    kicker: story.repo || 'introducing',
    text: hookLine(story),
    caps: false, rule: true,
  }, 1.0);

  // 2 -- the thesis, in the author's own words
  const claims = ins.claims || [];
  if (claims.length) {
    add('bigquote', { text: claims[0], source: 'from the README' }, 1.25, true);
  }

  // 3 -- one number, to ground it
  const hl = story.highlights || [];
  if (hl.length) add('stat', { value: hl[0].value, label: hl[0].label }, 0.7, true);

  // 4 -- what is actually in here
  if ((ins.tree || []).length >= 3) {
    add('tree', { title: 'what is in here', items: ins.tree.slice(0, 8) }, 1.4);
  }

  // 5 -- how it is put together
  const mods = ins.modules || [];
  if (mods.length >= 4) {
    const hub = ins.hub;
    // A node with no edges tells the viewer nothing and crowds the ring. Keep
    // the connected graph; only fall back to isolated modules if the project
    // genuinely has too few connections to fill a shot.
    const linked = mods.filter(m => m.deg_in || m.deg_out);
    const pool = linked.length >= 4 ? linked : mods;
    const rank = m => m.deg_in * 3 + m.deg_out + m.loc / 400;
    const nodes = pool.slice().sort((a, b) => rank(b) - rank(a)).slice(0, 12);
    const idx = new Map(nodes.map((m, i) => [m.id, i]));
    const edges = [];
    for (const [a, b] of ins.edges || []) {
      const ia = mods[a]?.id, ib = mods[b]?.id;
      if (idx.has(ia) && idx.has(ib)) edges.push([idx.get(ia), idx.get(ib)]);
    }
    let note = `${mods.length} modules, ${(ins.edges || []).length} imports between them`;
    if (hub) note += ` \u2014 everything leans on ${hub.split('/').pop()}`;
    add('arch', {
      title: 'architecture',
      nodes: nodes.map(m => ({ label: m.label, hub: m.id === hub })),
      edges: edges.slice(0, 22),
      note,
    }, 1.5);
  }

  // 6 -- the process
  if ((ins.pipeline || []).length >= 3) {
    add('flow', { title: 'how it runs', items: ins.pipeline.slice(0, 5) }, 1.35, true);
  }

  // 7 -- THE CENTREPIECE: the function the project is actually about
  const sig = ins.signature || {};
  if (sig.code && sig.code.length) {
    // The shot renders at most CALLOUT_LINES rows, so the focus index has to
    // be chosen against what will actually be on screen — picking it from the
    // full function silently points at a line nobody sees.
    const shown = sig.code.slice(0, CALLOUT_LINES);
    add('callout', {
      path: `${sig.module} \u2014 ${sig.name}()`,
      code: shown,
      highlight: focusLine(shown),
      label: 'the idea',
      note: sig.doc || `${sig.lines} lines, ${sig.branches || 0} branches`,
    }, 1.75);
  }

  // 8 -- a second look at real source, elsewhere in the tree
  const moments = story.code_moments || [];
  if (moments.length) {
    const m = moments[0];
    add('code', { path: m.path, code: m.code, caption: m.caption || '', dur: 3.2 }, 1.3);
  }

  // 9 -- what it knows how to do
  const techs = ins.techniques || [];
  if (techs.length >= 3) {
    add('constellation', {
      title: 'techniques in the source',
      items: techs.slice(0, 8).map(t => ({ name: t.name })),
    }, 1.3, true);
  }

  // 10 -- the second number
  if (hl.length > 1) add('stat', { value: hl[1].value, label: hl[1].label }, 0.7);

  // 11 -- the shape of the work
  const cad = ins.cadence || [];
  // A heatmap of one busy afternoon is an empty grid with a dot in it. Only
  // earn the shot when there is a spread of activity to actually show.
  const activeDays = cad.filter(Boolean).length;
  if (cad.length >= 60 && activeDays >= 12) {
    add('heatmap', { title: 'the last six months', days: cad, note: ins.peak_day || '' }, 1.25);
  }

  // 12 -- milestones
  const tl = story.timeline || [];
  if (tl.length >= 3) add('timeline', { title: 'how it got here', items: tl.slice(-4) }, 1.2);

  // 13 -- the stack
  const langs = story.languages || [];
  if (langs.length >= 2) {
    add('langs', {
      title: 'built with',
      items: langs.slice(0, 5).map(l => ({ name: l.name, share: l.share, color: l.color })),
    }, 1.0, true);
  }

  // 14 -- what it does for you
  const feats = story.features || [];
  if (feats.length >= 2) add('bullets', { title: 'what it does', items: feats.slice(0, 5) }, 1.35);

  // 15 -- this, not that
  const contrasts = ins.contrasts || [];
  if (contrasts.length) {
    add('compare', {
      left: contrasts[0].left, right: contrasts[0].right,
      leftLabel: name, rightLabel: 'not',
    }, 1.2, true);
  }

  // 16 -- a closing claim
  if (claims.length > 1) add('bigquote', { text: claims[1], source: '' }, 1.15);

  // 17 -- it ships
  add('globe', {
    kicker: 'available now',
    text: 'Ship it anywhere',
    sub: story.license ? `Open source \u00b7 ${story.license}` : 'Clone it and run it.',
  }, 1.1, true);

  // 18 -- the card people screenshot
  add('endcard', {
    name,
    sub: story.url || story.repo || '',
    cta: 'made with cased2.0',
  }, 1.0, true);

  void rng; void dname; void duration;
  return plan;
}


/**
 * A product film.
 *
 * The other plans draw data about the repository. This one draws the
 * repository as a product: the files scattered as windows, the top-level
 * directories in orbit, recent work on a board, real source in an editor, the
 * language split on a dashboard.
 *
 * Nothing here is invented, so the frame stamp reads MEASURED throughout. The
 * shots can draw fabricated screens — that is what `sample` is for — but a
 * film about a real repository has no reason to.
 */
export function buildAtlasPlan(story, ins, d, duration) {
  const name = story.name;
  const stats = story.stats || {};
  const langs = story.languages || [];
  const plan = [];
  let chapter = 0;
  const add = (type, data, weight, section = '', caption = '', hard = false, chap = '') => {
    chapter++;
    const shot = { type, data, weight, hard };
    if (section) shot.section = section;
    if (caption) shot.caption = caption;
    if (chap) shot.chapter = `${String(chapter).padStart(2, '0')} \u00b7 ${chap}`;
    plan.push(shot);
  };

  const files = stats.files || 0;
  const commits = stats.commits || stats.commits_seen || 0;

  // 1 -- the scatter, then the name for it
  add('appwindows', {
    text: files ? `${plural(files, 'file')}. One *repository*.` : `${name}, *in one place*.`,
    count: Math.max(6, Math.min(files || 9, 13)), seed: story.seed || 7,
  }, 1.15, 'the shape', (story.tagline || '').slice(0, 72), false, 'what it is');

  // 2 -- the top-level directories, in orbit
  const tree = (ins && ins.tree) || story.tree || [];
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
    add('apporbit', {
      title: 'Everything it is made of.',
      mark: name.slice(0, 2).toUpperCase(),
      items: mods.map(m => ({ name: m })),
    }, 1.45, 'orbit view',
      `${mods.length} top-level ${mods.length === 1 ? 'directory' : 'directories'}`,
      false, 'layout');
  }

  // 3 -- recent work, as a board
  const tl = story.timeline || [];
  if (tl.length >= 3) {
    const cards = tl.slice(-6).map(t => ({ text: ellipsis(t.text, 46) }));
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
    }, 1.4, 'history', 'Every card is a real commit.', true, 'history');
  }

  // 4 -- real source, in an editor
  const moments = story.code_moments || [];
  if (moments.length) {
    const m = moments[0];
    const files2 = [];
    for (const other of moments) if (!files2.includes(other.path)) files2.push(other.path);
    if (stats.hottest_file && !files2.includes(stats.hottest_file)) files2.push(stats.hottest_file);
    add('appcode', {
      app: story.full_name || story.repo || name,
      title: 'Written *here*.',
      root: m.path.split('/')[0],
      branch: story.branch || stats.branch || 'main',
      action: 'Run',
      tab: m.path.split('/').pop(),
      files: files2.slice(0, 7).map(f => ({
        name: f.split('/').pop(), depth: (f.match(/\//g) || []).length, active: f === m.path,
      })),
      code: (m.code || []).slice(0, 9),
    }, 1.6, 'source', m.caption || 'Real source, not a mockup.', false, 'the code');
  }

  // 5 -- the stack, on a dashboard
  if (langs.length >= 2) {
    const hero = langs[0];
    add('appdash', {
      app: story.full_name || story.repo || name,
      title: 'The stack, *measured*.',
      value: `${hero.share}%`, delta: hero.name,
      label: 'share of the codebase',
      series: langs.slice(0, 8).map(l => l.share).reverse(),
      cards: langs.slice(1, 4).map(l => ({ label: l.name, value: `${l.share}%` })),
    }, 1.35, 'stack', `${langs.length} languages, measured from the tree.`, true, 'stack');
  }

  // 6 -- what it does, in the author's words
  const feats = story.features || [];
  if (feats.length >= 2) {
    add('bullets', { title: 'what it does', items: feats.slice(0, 5) },
        1.3, 'capability', 'Straight from the README.', false, 'what it does');
  }

  // 7 -- the two audiences, if the deep read found techniques
  if (duration >= 45 && ins && (ins.techniques || []).length) {
    add('appsplit', {
      left: { kicker: 'in the source', text: 'What it *actually does*.',
              items: ins.techniques.slice(0, 3).map(t => t.name) },
      right: { kicker: 'in the repo', text: 'What it is *made of*.',
               items: langs.slice(0, 3).map(l => `${l.name} ${l.share}%`) },
    }, 1.25, 'two sides', 'Found by reading the code.', true, 'technique');
  }

  // 8 -- the card people screenshot
  add('endcard', {
    name, sub: story.url || story.repo || '', cta: 'made with cased2.0',
  }, 1.0, 'end', '', true);

  return plan;
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
  const plan = d.hud
    ? buildAtlasPlan(story, insight, d, duration)
    : insight
      ? buildCreativePlan(story, insight, dname, d, rng, duration)
      : buildPlan(story, dname, d, rng, duration);

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
  app: 'cinematic', library: 'warm', project: 'cinematic',
};

/** Mirror of directors.pick. */
export function pickDirector(story, directors) {
  const want = KIND_DEFAULT[story.kind] || 'cinematic';
  return directors[want] ? want : Object.keys(directors)[0];
}

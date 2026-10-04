// The deep read, in the browser.
//
// `analyzeRepo` answers "what is this project?" with facts anyone could count
// — lines, files, commits. That is enough for a 24-second trailer, and it is
// exactly why those trailers feel interchangeable: every repo has lines.
//
// This answers the harder question: what is interesting about THIS one? It
// builds the import graph to find the architectural centre, locates the
// function the project is actually about, recognises the techniques in play
// and reads the shape of the history. That is the material a minute-long film
// needs, because a minute of line-counts is a minute of nothing.
//
// A port of cased/insight.py, with two differences the browser forces, both
// deliberate and both visible in the output:
//
//   1. The CLI parses Python with `ast` to find the signature function. There
//      is no Python parser here, so the signature is found by scanning for
//      function headers across languages. It reads the same shapes — size, a
//      name that says something, a real docstring, branching — but it will
//      occasionally pick a different function than the CLI would.
//   2. The CLI walks the whole checkout. An unauthenticated browser gets 60
//      GitHub API calls an hour, so this reads a bounded number of files,
//      chosen from the tree before anything is fetched. A token raises the
//      limit and the budget with it.
//
// Everything it reports is still measured. Nothing is estimated to fill a gap.

import { getFile } from './github.js';

// ---------------------------------------------------------------------------
// Techniques worth naming on screen.
//
// Keyed by a regex over source text. These are deliberately specific: "uses
// async" is not interesting, "implements Karplus-Strong synthesis" is. If a
// probe is too loose it fires on every repo and the film goes generic again,
// which is the whole thing we are trying to avoid.
// ---------------------------------------------------------------------------

export const TECHNIQUES = [
  [/\bkarplus|plucked.?string/i, 'Karplus-Strong synthesis', 'audio'],
  [/\bfft\b|fourier|spectrogram/i, 'Fourier analysis', 'signal'],
  [/\bwebgl|gl_FragColor|fragment shader|vertexshader/i, 'GPU shaders', 'graphics'],
  [/navigator\.gpu|requestAdapter|@group\(\d/i, 'WebGPU', 'graphics'],
  [/raymarch|signed distance|\bsdf\b/i, 'Ray marching', 'graphics'],
  [/\bfbm\b|perlin|simplex noise|value noise/i, 'Procedural noise', 'graphics'],
  [/quaternion|slerp\b/i, 'Quaternion maths', '3d'],
  [/\bbezier|catmull|spline/i, 'Spline interpolation', 'geometry'],
  [/reverb|convolution|lowpass|highpass|biquad/i, 'DSP filtering', 'audio'],
  [/sidechain|compressor|limiter/i, 'Dynamics processing', 'audio'],
  [/WebAssembly\.(instantiate|compile)|\.wasm['"]|wasm-bindgen/i, 'WebAssembly', 'systems'],
  [/\bsimd\b|vectoris|vectoriz/i, 'SIMD', 'systems'],
  [/\bmutex|rwlock|atomic|lock-free/i, 'Concurrency primitives', 'systems'],
  [/\basyncio|async def|tokio|goroutine|coroutine/i, 'Async concurrency', 'systems'],
  [/\bthreadpool|worker_threads|multiprocessing/i, 'Parallel execution', 'systems'],
  [/\blru_cache|memoi[sz]|\bcache\b.*\bhit\b/i, 'Memoisation', 'perf'],
  [/\bzero-copy|mmap\b|memoryview/i, 'Zero-copy IO', 'perf'],
  [/\bb-?tree|trie\b|bloom filter|skip ?list/i, 'Specialised data structures', 'algorithms'],
  [/dijkstra|a\*\s|bfs\b|dfs\b|topological sort/i, 'Graph algorithms', 'algorithms'],
  [/dynamic programming|memo\[|\bdp\[/i, 'Dynamic programming', 'algorithms'],
  [/levenshtein|edit distance|fuzzy match/i, 'Fuzzy matching', 'algorithms'],
  [/\btokeni[sz]er|lexer|parser|\bast\b|grammar/i, 'Parsing', 'languages'],
  [/\btype ?checker|inference|unification/i, 'Type inference', 'languages'],
  [/\bjit\b|bytecode|codegen|compiler/i, 'Code generation', 'languages'],
  [/\btransformer\b|self.?attention|embedding (layer|matrix)/i, 'Neural networks', 'ml'],
  [/(import|require|from)\s+['"]?(anthropic|openai|@anthropic-ai)|messages\.create|chat\.completions/i, 'LLM integration', 'ml'],
  [/\bffmpeg|libx264|h\.?264|codec/i, 'Video encoding', 'media'],
  [/\bplaywright|puppeteer|headless/i, 'Headless browser automation', 'tooling'],
  [/\bseed\b.*\brandom|deterministic|reproducib/i, 'Deterministic generation', 'rigor'],
  [/property.?based|hypothesis|quickcheck|fuzz/i, 'Property-based testing', 'rigor'],
  [/\bmigration|schema version/i, 'Schema migrations', 'data'],
  [/\bwebsocket|server-sent|\bsse\b/i, 'Realtime transport', 'network'],
  [/\boauth|\bjwt\b|bcrypt|argon2/i, 'Auth and crypto', 'security'],
  [/\bgraphql|\btrpc\b/i, 'Typed API layer', 'network'],
];

/** This module lists every probe as a literal, so scanning it finds all of
 *  them and the film confidently announces techniques the project has never
 *  heard of. Any file carrying the table is evidence of nothing. */
const SELF = /(^|\/)insight\.js$/;

const IMPORT_RE = {
  py: /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm,
  js: /(?:^\s*import\s+[^'"]*from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"])/gm,
};

const CODE_EXT = /\.(py|js|mjs|ts|tsx|jsx)$/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|\.git|\.next|target|__pycache__|coverage|\.venv|venv|third_party)\//;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.|(^|\/)test_/i;

const moduleId = rel => rel.replace(/\.[^./]+$/, '').replace(/\/__init__$/, '');
const locOf = text => text.split('\n').filter(l => l.trim()).length;

// --------------------------------------------------------------- the files

/**
 * Choose which files to read, before spending a single request on them.
 * Source files only, no tests, shallow before deep, bigger before smaller.
 */
function planReads(treeRaw, budget) {
  const rows = [];
  for (const t of treeRaw || []) {
    if (t.type !== 'blob') continue;
    const rel = t.path;
    if (!CODE_EXT.test(rel) || SKIP_DIR.test(rel) || TEST_RE.test(rel)) continue;
    if (/\.min\.|\.d\.ts$/.test(rel)) continue;
    const size = t.size || 0;
    if (size < 300 || size > 400000) continue;
    const depth = rel.split('/').length - 1;
    rows.push({ rel, size, score: Math.min(size / 900, 40) + Math.max(0, 14 - depth * 4) });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, budget);
}

// ---------------------------------------------------------------- the graph

/**
 * Import graph over first-party modules. Third-party edges are dropped —
 * they describe the ecosystem, not this codebase's shape.
 */
function buildGraph(files, ins) {
  const ids = Object.keys(files);
  if (!ids.length) return;
  const index = new Map(ids.map((m, i) => [m, i]));
  const byTail = new Map();
  for (const m of ids) {
    const tail = m.split('/').pop();
    if (!byTail.has(tail)) byTail.set(tail, []);
    byTail.get(tail).push(m);
  }

  const edges = new Set();
  for (const m of ids) {
    const info = files[m];
    const rx = new RegExp(IMPORT_RE[info.lang].source, 'gm');
    let match;
    while ((match = rx.exec(info.text))) {
      const target = (match[1] || match[2] || '').trim();
      if (!target) continue;
      const tail = target.replace(/[./\\]+$/, '').split(/[./\\]/).pop();
      if (!tail) continue;
      for (const cand of byTail.get(tail) || []) {
        if (cand !== m) { edges.add(`${index.get(m)},${index.get(cand)}`); break; }
      }
    }
  }

  const degIn = new Map(), degOut = new Map();
  const pairs = [...edges].map(e => e.split(',').map(Number));
  for (const [s, d] of pairs) {
    degOut.set(s, (degOut.get(s) || 0) + 1);
    degIn.set(d, (degIn.get(d) || 0) + 1);
  }

  ins.modules = ids.map((m, i) => ({
    id: m,
    label: m.split('/').pop(),
    dir: m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : '',
    loc: files[m].loc,
    deg_in: degIn.get(i) || 0,
    deg_out: degOut.get(i) || 0,
  }));
  ins.edges = pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // The hub is what most things depend on, size breaking the tie.
  let hub = ins.modules[0];
  for (const m of ins.modules) {
    const a = m.deg_in * 3 + m.deg_out, b = hub.deg_in * 3 + hub.deg_out;
    if (a > b || (a === b && m.loc > hub.loc)) hub = m;
  }
  ins.hub = hub ? hub.id : '';
}

// ----------------------------------------------------------- the signature

// Function headers across the languages this reads. Each captures the name.
const FN_HEAD = [
  [/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, 'py'],
  [/^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, 'js'],
  [/^(\s*)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/, 'js'],
];

const NAMEY = /(compose|render|analy|score|build|solve|parse|optimi|resolve|plan|infer|pack|schedule|match|transform)/i;

/**
 * The one function the project is really about.
 *
 * Scored on size, a name that says something, a real docstring and density of
 * branching. A 400-line main() loses to a 60-line composeScore() — the point
 * is to show intent, not bulk.
 *
 * The CLI walks a Python AST for this. Without a parser, the end of a function
 * is found by indentation for Python and by brace depth for JavaScript. That
 * is good enough to score a candidate and to cut a slice, which is all the
 * film needs.
 */
function findSignature(files, ins) {
  let best = null;
  for (const m of Object.keys(files)) {
    const info = files[m];
    const lines = info.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let name = null, indent = '', kind = null;
      for (const [re, k] of FN_HEAD) {
        const mm = lines[i].match(re);
        if (mm) { indent = mm[1]; name = mm[2]; kind = k; break; }
      }
      if (!name) continue;
      if (name.startsWith('__') || ['main', 'setup', 'run'].includes(name)) continue;

      const end = kind === 'py' ? pyEnd(lines, i, indent.length) : jsEnd(lines, i);
      const span = end - i;
      if (span < 8 || span > 90) continue;

      const body = lines.slice(i, Math.min(end, i + 14));
      const doc = docOf(lines, i, kind);
      const branches = body.filter(l => /\b(if|for|while|try|switch|catch)\b/.test(l)).length;

      let score = Math.min(span, 50) * 0.5;
      if (name.includes('_')) score += name.length * 0.6;
      if (doc) score += 22 + Math.min(doc.length, 220) * 0.08;
      score += branches * 2.4;
      if (!name.startsWith('_')) score += 14;
      if (NAMEY.test(name)) score += 20;

      if (!best || score > best.score) {
        const trimmed = body.map(l => l.replace(/\s+$/, '').slice(0, 74));
        let pad = Infinity;
        for (const l of trimmed) if (l.trim()) pad = Math.min(pad, l.length - l.trimStart().length);
        if (!Number.isFinite(pad)) pad = 0;
        best = {
          score,
          sig: {
            name, module: info.rel, lines: span,
            doc: doc.replace(/\s+/g, ' ').trim().slice(0, 190),
            branches, code: trimmed.map(l => l.slice(pad)),
          },
        };
      }
    }
  }
  if (best) ins.signature = best.sig;
}

/** Python blocks end where the indentation returns to the header's level. */
function pyEnd(lines, start, indent) {
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim()) continue;
    if (l.length - l.trimStart().length <= indent) return j;
  }
  return lines.length;
}

/** JavaScript blocks end when the braces opened by the header close. */
function jsEnd(lines, start) {
  let depth = 0, seen = false;
  for (let j = start; j < lines.length && j < start + 140; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return j + 1;
  }
  return Math.min(lines.length, start + 140);
}

/** A docstring beneath a def, or the JSDoc/comment block above a function. */
function docOf(lines, i, kind) {
  if (kind === 'py') {
    const next = (lines[i + 1] || '').trim();
    const q = next.slice(0, 3);
    if (q === '"""' || q === "'''") {
      if (next.length > 3 && next.endsWith(q)) return next.slice(3, -3);
      const out = [];
      for (let j = i + 2; j < lines.length && j < i + 20; j++) {
        if (lines[j].includes(q)) return out.join(' ');
        out.push(lines[j].trim());
      }
    }
    return '';
  }
  const out = [];
  for (let j = i - 1; j >= 0 && j > i - 12; j--) {
    const l = lines[j].trim();
    if (!l) { if (out.length) break; continue; }
    if (/^(\*\/|\/\*\*?|\*|\/\/)/.test(l)) {
      out.unshift(l.replace(/^(\/\*\*?|\*\/|\*|\/\/)\s?/, '').replace(/\*\/$/, '').trim());
    } else break;
  }
  return out.filter(Boolean).join(' ');
}

// ------------------------------------------------- techniques and pipeline

function detectTechniques(files, readme, ins) {
  const blobs = [];
  for (const m of Object.keys(files)) {
    if (SELF.test(files[m].rel)) continue;
    blobs.push([files[m].rel, files[m].text.toLowerCase()]);
  }
  if (readme) blobs.push(['README.md', readme.toLowerCase()]);

  const found = [];
  for (const [rx, name, domain] of TECHNIQUES) {
    const hits = blobs.filter(([, text]) => rx.test(text)).map(([rel]) => rel);
    if (!hits.length) continue;
    // A single mention in prose is a passing reference; a mention in real
    // source, or in two places, is the project actually doing the thing.
    const codeHits = hits.filter(h => !h.toLowerCase().endsWith('.md'));
    if (hits.length < 2 || !codeHits.length) continue;
    found.push({ name, domain, where: codeHits[0], hits: hits.length });
  }
  ins.techniques = found.sort((a, b) => b.hits - a.hits).slice(0, 8);
}

/**
 * Stage names, if the project describes itself as a pipeline. Looks for an
 * arrow chain in the README, then falls back to top-level modules ordered by
 * how much they are depended upon.
 */
function inferPipeline(readme, ins) {
  for (const block of String(readme || '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const rows = block[1].split('\n').filter(r => /(->|→|=>)/.test(r));
    if (rows.length < 3) continue;
    const stages = [];
    for (const r of rows.slice(0, 6)) {
      // A pipeline row reads "name   input -> output   prose". The useful
      // note is the output: the first segment after the arrow. Joining every
      // column produces mush like "repo story.json what this project is".
      const parts = r.trim().split(/(?:->|→|=>)/);
      const nm = parts[0].replace(/^[\s`|*-]+|[\s`|*-]+$/g, '').split(/\s{2,}/)[0].trim();
      let note = '';
      if (parts.length > 1) {
        note = parts[1].replace(/^[\s`|*-]+|[\s`|*-]+$/g, '').split(/\s{2,}/)[0].trim();
      }
      if (nm && nm.length < 24) stages.push({ name: nm, note: note.slice(0, 30) });
    }
    if (stages.length >= 3) { ins.pipeline = stages; return; }
  }
  const tops = ins.modules.filter(m => m.id.includes('/'))
    .sort((a, b) => (b.deg_in * 2 + b.loc / 100) - (a.deg_in * 2 + a.loc / 100));
  ins.pipeline = tops.slice(0, 5).map(m => ({ name: m.label, note: `${m.loc} lines` }));
}

function profileDensity(files, ins) {
  const locs = Object.values(files).map(f => f.loc).sort((a, b) => b - a);
  if (!locs.length) return;
  const total = locs.reduce((a, b) => a + b, 0);
  const top = locs.slice(0, Math.max(1, Math.floor(locs.length / 5)));
  ins.density = {
    files: locs.length, total,
    median: locs[Math.floor(locs.length / 2)],
    largest: locs[0],
    // What share of the code lives in the top 20% of files.
    top20_share: Math.round((top.reduce((a, b) => a + b, 0) / total) * 1000) / 10,
  };
}

// ------------------------------------------------------------- the history

/** The commit heatmap, from the commit list the analyzer already fetched. */
function commitCadence(story, ins, weeks = 26) {
  const days = new Map();
  for (const t of story.commitDates || []) {
    const k = String(t).slice(0, 10);
    if (k) days.set(k, (days.get(k) || 0) + 1);
  }
  if (!days.size) return;
  const keys = [...days.keys()].sort();
  const last = new Date(keys[keys.length - 1] + 'T00:00:00Z');
  const grid = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(last.getTime() - i * 86400000);
    grid.push(days.get(d.toISOString().slice(0, 10)) || 0);
  }
  ins.cadence = grid;
  ins.cadence_weeks = Math.max(1, Math.floor(grid.length / 7));
  ins.cadence_days = days.size;
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  ins.peak_day = `${busiest[1]} commit${busiest[1] === 1 ? '' : 's'} on ${busiest[0]}`;
}

/** A small, honest directory listing — the shape of the repo at a glance. */
function buildTree(treeRaw, ins, limit = 14) {
  const entries = new Map();
  for (const t of treeRaw || []) {
    if (t.type !== 'blob' || SKIP_DIR.test(t.path)) continue;
    if (!/\.\w+$/.test(t.path)) continue;
    const top = t.path.includes('/') ? t.path.split('/')[0] : '.';
    const e = entries.get(top) || { bytes: 0, files: 0 };
    e.bytes += t.size || 0;
    e.files += 1;
    entries.set(top, e);
  }
  const rows = [...entries.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, limit);
  const biggest = rows[0]?.[1].bytes || 1;
  ins.tree = rows.map(([name, v]) => ({
    path: name === '.' ? '(root)' : name,
    // The tree API gives bytes, not lines; ~34 bytes a line is the ratio this
    // repo's own sources show. It is labelled "files" on screen for that
    // reason — the bar is the honest part, the line estimate is not shown.
    loc: Math.round(v.bytes / 34),
    files: v.files,
    bar: Math.round((v.bytes / biggest) * 1000) / 1000,
    is_dir: name !== '.',
  }));
  ins.layers = ins.tree.slice(0, 6).map(r => r.path);
}

/** One line naming what is actually notable here. The film's thesis. */
function writeVerdict(ins) {
  const bits = [];
  if (ins.techniques.length) {
    bits.push(ins.techniques.slice(0, 2).map(t => t.name).join(' and ').toLowerCase());
  }
  if ((ins.density.top20_share || 0) > 70) bits.push('a small core doing most of the work');
  if (ins.hub) bits.push(`built around ${ins.hub.split('/').pop()}`);
  ins.verdict = bits.join('; ').slice(0, 150);
}

// ----------------------------------------------------------- entry point

/**
 * Read the repository deeply enough for a long film.
 *
 * `budget` is how many files it may fetch. Without a token the whole page has
 * about 50 requests to spend, so the default is modest; with one it can go
 * much wider and the graph, the techniques and the signature all get better.
 */
export async function inspect(repo, story, token, { budget = 14, onStep } = {}) {
  const ins = {
    modules: [], edges: [], hub: '', layers: [], tree: [], signature: {},
    techniques: [], pipeline: [], cadence: [], cadence_weeks: 0, cadence_days: 0,
    peak_day: '', claims: [], contrasts: [], density: {}, verdict: '',
    read: [],
  };

  const plan = planReads(story.tree_raw, budget);
  const files = {};
  for (const row of plan) {
    onStep?.(`reading ${row.rel}`);
    let text;
    try { text = await getFile(repo, row.rel, token, story.branch); }
    catch { continue; }
    if (!text) continue;
    const loc = locOf(text);
    if (loc < 12) continue;
    files[moduleId(row.rel)] = {
      rel: row.rel, text, loc,
      lang: /\.py$/i.test(row.rel) ? 'py' : 'js',
    };
    ins.read.push(row.rel);
  }

  buildGraph(files, ins);
  findSignature(files, ins);
  detectTechniques(files, story.readme, ins);
  inferPipeline(story.readme, ins);
  profileDensity(files, ins);
  commitCadence(story, ins);
  buildTree(story.tree_raw, ins);
  ins.claims = story.claims || [];
  writeVerdict(ins);
  return ins;
}

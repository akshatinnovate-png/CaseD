// The shots where real source appears on screen.
//
// A port of pick_code_moments/_best_slice/_caption_for from cased/analyze.py.
// The CLI has the whole checkout on disk and can score every file; a browser
// has a file tree and a rate limit, so the scoring that does not need file
// contents (name, language, depth, size) runs first and only the handful of
// winners are actually fetched.
//
// Without this the web film loses both code beats — and "real source appears
// on screen" is the thing that separates a cased film from a slideshow.

import { getFile } from './github.js';

const ENTRY_HINTS = ['main', 'index', 'app', 'cli', 'server', 'core', 'engine',
                     'run', '__main__', 'mod', 'lib', 'root'];

const EXT_LANG = {
  py: 'Python', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', rs: 'Rust',
  go: 'Go', rb: 'Ruby', java: 'Java', kt: 'Kotlin', swift: 'Swift',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#',
  php: 'PHP', ex: 'Elixir', exs: 'Elixir', scala: 'Scala', clj: 'Clojure',
  hs: 'Haskell', lua: 'Lua', sh: 'Shell', bash: 'Shell', zig: 'Zig',
  dart: 'Dart', vue: 'Vue', svelte: 'Svelte', html: 'HTML', css: 'CSS',
  scss: 'SCSS', sql: 'SQL', r: 'R', pl: 'Perl', m: 'Objective-C',
};

const SKIP = /(^|\/)(node_modules|vendor|dist|build|out|\.git|\.next|target|__pycache__|coverage|\.venv|venv)\//;
const SKIP_FILE = /(\.min\.|\.lock$|package-lock|yarn\.lock|\.map$|\.d\.ts$|test|spec|__tests__)/i;

const stemOf = rel => (rel.split('/').pop() || '').replace(/\.[^.]*$/, '').toLowerCase();
const extOf = rel => (rel.split('.').pop() || '').toLowerCase();

/**
 * Slide a window over the file; keep the densest, least-blank region.
 * Returns [startLine, lines] or null.
 */
export function bestSlice(lines, span = 14) {
  const n = lines.length;
  if (!n) return null;
  span = Math.min(span, n);
  let bestI = 0, bestScore = -1e9;
  for (let i = 0; i <= Math.max(0, n - span); i++) {
    const win = lines.slice(i, i + span);
    const filled = win.filter(l => l.trim()).length;
    if (filled < span * 0.65) continue;
    // Prefer modest indentation and reasonable line length.
    const indent = win.filter(l => l.trim())
      .reduce((s, l) => s + (l.length - l.trimStart().length), 0) / Math.max(filled, 1);
    const avgLen = win.reduce((s, l) => s + l.length, 0) / span;
    const over = win.filter(l => l.length > 74).length;
    let score = filled * 3 - indent * 1.2 - Math.abs(avgLen - 46) * 0.35 - over * 6;
    if (win.slice(0, 5).some(l => /^(def |class |export |function |fn |pub |async )/.test(l.trim()))) {
      score += 14;
    }
    if (score > bestScore) { bestScore = score; bestI = i; }
  }
  const win = lines.slice(bestI, bestI + span);
  while (win.length && !win[win.length - 1].trim()) win.pop();
  if (!win.length) return null;
  // De-indent as a block so it sits flush on screen.
  let pad = Infinity;
  for (const l of win) if (l.trim()) pad = Math.min(pad, l.length - l.trimStart().length);
  if (!Number.isFinite(pad)) pad = 0;
  return [bestI + 1, win.map(l => l.slice(pad).replace(/\s+$/, '').slice(0, 76))];
}

/**
 * A short caption for a code shot, never repeated across the film.
 *
 * Two files can both look like an entry point — cli.py and index.html both
 * match — and captioning both "the entry point" reads as a bug on screen.
 * Fall back to the directory when the first choice is taken.
 */
export function captionFor(rel, lang, used) {
  const stem = stemOf(rel);
  let pick = null;
  if (['main', '__main__', 'index', 'app', 'cli'].includes(stem)) pick = 'the entry point';
  else if (stem.includes('engine') || stem.includes('core')) pick = 'the engine room';
  else if (stem.includes('render') || stem.includes('draw')) pick = 'where pixels happen';
  else if (stem.includes('server') || stem.includes('api') || rel.includes('route')) pick = 'the wire protocol';
  else if (stem.includes('model') || stem.includes('schema')) pick = 'the shape of the data';
  else if (stem.includes('parse') || stem.includes('lex') || stem.includes('token')) pick = 'reading the input';
  else if (stem.includes('score') || stem.includes('audio') || stem.includes('sound')) pick = 'where the music comes from';
  else if (stem.includes('compose') || stem.includes('edit')) pick = 'cutting it together';
  else if (stem.includes('analy') || stem.includes('scan')) pick = 'reading the work';

  if (used && pick && used.has(pick)) pick = null;
  if (!pick) {
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const cands = [parent ? `inside ${parent}` : '', `${lang}, where it counts`, rel];
    pick = cands.find(c => c && (!used || !used.has(c))) || rel;
  }
  if (used) used.add(pick);
  return pick;
}

/** Score what the tree alone can tell us, so only the winners get fetched. */
function rank(tree, heroLanguage) {
  const rows = [];
  for (const t of tree) {
    if (t.type !== 'blob') continue;
    const rel = t.path;
    if (SKIP.test(rel) || SKIP_FILE.test(rel)) continue;
    const lang = EXT_LANG[extOf(rel)];
    if (!lang) continue;
    // Too small to fill a frame, or so big that fetching it is a waste.
    const size = t.size || 0;
    if (size < 400 || size > 220000) continue;

    const stem = stemOf(rel);
    let score = 0;
    if (ENTRY_HINTS.some(h => h === stem)) score += 46;
    else if (ENTRY_HINTS.some(h => stem.includes(h))) score += 20;
    if (heroLanguage && lang === heroLanguage) score += 30;
    score += Math.max(0, 16 - (rel.split('/').length - 1) * 5);
    // Line count is not known without the file; bytes stand in for it.
    score += Math.min(size / 1200, 22);
    rows.push({ score, rel, lang, size });
  }
  return rows.sort((a, b) => b.score - a.score);
}

/**
 * Fetch and slice the best few files. `want` shots, at most `budget` requests —
 * a rate-limited browser cannot afford to read the whole repository.
 */
export async function readCodeMoments(repo, story, token, { want = 3, budget = 7,
                                                            onStep } = {}) {
  const ranked = rank(story.tree_raw || story.treeRaw || [], story.hero_language);
  const moments = [];
  const seenDirs = new Set();
  const seenCaptions = new Set();
  let spent = 0;

  for (const row of ranked) {
    if (moments.length >= want || spent >= budget) break;
    const dir = row.rel.includes('/') ? row.rel.slice(0, row.rel.lastIndexOf('/')) : '.';
    if (seenDirs.has(dir) && moments.length) continue;   // spread across the codebase

    spent++;
    onStep?.(`reading ${row.rel}`);
    let text;
    try { text = await getFile(repo, row.rel, token, story.branch); }
    catch { continue; }
    if (!text) continue;

    const lines = text.split('\n');
    // Now that the body is here, apply the parts of the score that need it.
    const body = lines.join('\n');
    if (/\b(TODO|FIXME|XXX)\b/.test(body) && ranked.length > moments.length + 2) {
      // Only skip for it when there is something else to reach for.
      if (spent < budget) continue;
    }
    const slice = bestSlice(lines, 14);
    if (!slice) continue;

    seenDirs.add(dir);
    moments.push({
      path: row.rel,
      lang: row.lang,
      color: story.languages?.find(l => l.name === row.lang)?.color || story.hero_color,
      start_line: slice[0],
      code: slice[1],
      caption: captionFor(row.rel, row.lang, seenCaptions),
    });
  }
  return moments;
}

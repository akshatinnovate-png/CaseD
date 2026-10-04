/* =======================================================================
   forge / github
   -----------------------------------------------------------------------
   The browser's version of cased/analyze.py.

   The CLI walks a checkout; this cannot, so it reads the same facts out of
   the GitHub REST API instead. The API sends `Access-Control-Allow-Origin: *`
   on public repositories, so every call here runs straight from the page with
   no backend and no proxy.

   Unauthenticated callers get 60 requests an hour per IP, which this flow can
   exhaust on a big repository. A read-only token lifts it to 5,000; the UI
   offers one and never stores it anywhere but this browser.
   ======================================================================= */

const API = 'https://api.github.com';

export class RateLimited extends Error {
  constructor(resetAt) {
    super('GitHub rate limit reached');
    this.resetAt = resetAt;
  }
}

function headers(token) {
  const h = { Accept: 'application/vnd.github+json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(path, token, { allow404 = false } = {}) {
  const res = await fetch(API + path, { headers: headers(token) });
  if (res.status === 404 && allow404) return null;
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      throw new RateLimited(reset ? new Date(reset) : null);
    }
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json();
}

/** Accepts a URL, an owner/repo, or a git@ remote. */
export function parseRepo(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^git\+/, '').replace(/^(https?:\/\/|git@|ssh:\/\/git@)/, '')
       .replace(/\.git$/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  // A github.com URL owns its first two path segments; everything after them is
  // /tree/<branch>/<path>, /blob/..., /pull/<n> and must not be mistaken for them.
  const host = s.match(/^(?:www\.)?github\.com[/:]+(.*)$/);
  const parts = (host ? host[1] : s).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  const ok = n => /^[\w.-]+$/.test(n) && n !== '.' && n !== '..';
  if (!ok(owner) || !ok(repo)) return null;
  if (!host && parts.length > 2) return null;  // a bare path that is not a repo
  return { owner, repo };
}

const LANG_COLORS = {
  Python: '#3572A5', TypeScript: '#3178C6', JavaScript: '#F1E05A', Rust: '#DEA584',
  Go: '#00ADD8', Ruby: '#701516', Java: '#B07219', Kotlin: '#A97BFF',
  Swift: '#F05138', C: '#555555', 'C++': '#F34B7D', 'C#': '#178600',
  PHP: '#4F5D95', Elixir: '#6E4A7E', Scala: '#C22D40', Clojure: '#DB5855',
  Haskell: '#5E5086', Lua: '#000080', Shell: '#89E051', Zig: '#EC915C',
  Dart: '#00B4AB', HTML: '#E34C26', CSS: '#563D7C', SCSS: '#C6538C',
  Vue: '#41B883', Svelte: '#FF3E00', Astro: '#FF5A1F', Nix: '#7E7EFF',
  Jupyter: '#DA5B0B', 'Objective-C': '#438EFF', Perl: '#0298C3', R: '#198CE7',
};
export const langColor = n => LANG_COLORS[n] || '#8B949E';

const b64 = s => {
  try { return decodeURIComponent(escape(atob(String(s).replace(/\n/g, '')))); }
  catch { try { return atob(String(s).replace(/\n/g, '')); } catch { return ''; } }
};

/* --- README prose, the same rules the CLI uses ------------------------- */

const stripMd = t => t
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/[`*#>]+/g, '');

function readmePitch(md) {
  // Markdown hard-wraps, so reading line by line slices sentences in half.
  // Rebuild the paragraph first, then cut on a sentence boundary.
  const para = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const skip = !line || /^(#|\||>|<|!\[|\[!|```|---|===|[-*+] )/.test(line);
    if (skip) { if (para.length) break; continue; }
    const clean = stripMd(line).trim();
    if (!clean) continue;
    if (!para.length && (clean.length < 12 || /^(install|npm |pip |git clone)/i.test(clean))) continue;
    para.push(clean);
    if (para.join(' ').length > 260) break;
  }
  if (!para.length) return '';
  const text = para.join(' ').replace(/\s+/g, ' ').trim();
  const m = text.match(/^(.{24,200}?[.!?])(\s|$)/);
  return (m ? m[1] : text).replace(/[\s—–,;:-]+$/, '');
}

function readmeFeatures(md) {
  const feats = [], generic = [];
  let inSection = false;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      inSection = /(feature|what(?:'s| is)|why|highlight|capabilit|how it works)/i.test(line);
      continue;
    }
    const m = line.match(/^[-*+]\s+(.+)$/);
    if (!m) continue;
    const body = m[1].trim();
    // "**Lead-in.** Supporting detail" is a headline plus a footnote; on
    // screen we only want the headline.
    const lead = body.match(/^\*\*(.+?)\*\*/);
    let txt = stripMd(lead ? lead[1] : body).trim();
    txt = txt.split(/(?<=[.!?])\s/)[0].trim().replace(/\.$/, '');
    if (txt.length > 10 && txt.length <= 66) (inSection ? feats : generic).push(txt);
  }
  return (feats.length ? feats : generic).slice(0, 6);
}

const DANGLING = new Set(['the','a','an','and','or','but','of','to','in','for','on',
  'with','by','from','behind','into','about','as','that','which','than','so','it',
  'its','your','this','instead','too','also','not','only','even','just','both',
  'either','neither','rather','because','while','when','where','how','why']);

function readmeClaims(md) {
  const body = md.replace(/```[\s\S]*?```/g, '');
  const paras = [];
  let cur = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || /^(#|\||>|<|!\[|\[|```)/.test(line)) {
      if (cur.length) { paras.push(cur.join(' ')); cur = []; }
      continue;
    }
    cur.push(line.replace(/^[-*+]\s+/, ''));
  }
  if (cur.length) paras.push(cur.join(' '));

  const out = [];
  for (const p of paras) {
    const text = stripMd(p).replace(/https?:\/\/\S+/g, '');
    for (let sent of text.split(/(?<=[.!?])\s+/)) {
      sent = sent.trim().replace(/\.$/, '');
      if (sent.length < 26 || sent.length > 92) continue;
      if (/(install|npm |pip |git clone|requires?|see the|license)/i.test(sent)) continue;
      if (!/\b(is|are|was|does|can|will|has|have|never|no |every|only|turns|reads|renders|makes|gives|keeps|runs|works)\b/i.test(sent)) continue;
      out.push(sent);
    }
  }
  const seen = new Set();
  return out
    .filter(c => !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()))
    .map(c => {
      const w = c.split(/\s+/);
      let score = 100 - Math.abs(c.length - 54) * 0.9;
      if (DANGLING.has(w[w.length - 1].toLowerCase().replace(/[,;:]$/, ''))) score -= 60;
      if (/[:;,]$/.test(c)) score -= 60;   // a colon means "see below", not a claim
      if (/\b(never|every|no |only|without|instead|not)\b/i.test(c)) score += 14;
      if (/\b(you|your)\b/i.test(c)) score += 8;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(x => x.c);
}

/** Trim to a readable lead-in: whole sentence, then clause, then word. */
function shorten(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const sentence = t.match(/^(.{16,}?[.!?])(\s|$)/);
  if (sentence && sentence[1].length <= max) return sentence[1].trim();
  const clause = t.slice(0, max + 1).match(/^(.{16,})(?: [\u2014\u2013-] |: |; |, )/);
  if (clause) return clause[1].trim();
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > 16 ? cut.slice(0, sp) : cut).replace(/[\s\u2014\u2013,;:-]+$/, '');
}

const fmt = n => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'K';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
  return String(n);
};

const plural = (n, w) => `${Number(n).toLocaleString()} ${w}${Number(n) === 1 ? '' : 's'}`;

/* --- the walk ---------------------------------------------------------- */

export async function analyzeRepo({ owner, repo }, token, onStep = () => {}) {
  onStep(`reading ${owner}/${repo}`);
  const meta = await gh(`/repos/${owner}/${repo}`, token);
  const branch = meta.default_branch || 'main';

  onStep('languages, contributors, commits');
  const [langs, contributors, commits, readmeRaw] = await Promise.all([
    gh(`/repos/${owner}/${repo}/languages`, token).catch(() => ({})),
    gh(`/repos/${owner}/${repo}/contributors?per_page=12`, token).catch(() => []),
    gh(`/repos/${owner}/${repo}/commits?per_page=100&sha=${branch}`, token).catch(() => []),
    gh(`/repos/${owner}/${repo}/readme`, token, { allow404: true }).catch(() => null),
  ]);

  onStep('file tree');
  let tree = [];
  try {
    const t = await gh(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
    tree = Array.isArray(t?.tree) ? t.tree : [];
  } catch { /* very large repos can refuse; the rest still works */ }

  const readme = readmeRaw?.content ? b64(readmeRaw.content) : '';

  // Language mix by bytes, which is what the API gives.
  const totalBytes = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, bytes]) => ({
      name, bytes, color: langColor(name),
      share: Math.round((bytes / totalBytes) * 1000) / 10,
    }));

  // Directories by file count; the API tree has sizes for blobs.
  const dirs = new Map();
  let sourceFiles = 0, testFiles = 0;
  for (const node of tree) {
    if (node.type !== 'blob') continue;
    sourceFiles++;
    if (/(^|\/)(tests?|spec|__tests__|e2e)(\/|$)|(_test\.|\.test\.|\.spec\.|^test_)/i.test(node.path)) testFiles++;
    const top = node.path.includes('/') ? node.path.split('/')[0] : '(root)';
    const d = dirs.get(top) || { files: 0, bytes: 0 };
    d.files++; d.bytes += node.size || 0;
    dirs.set(top, d);
  }
  const dirRows = [...dirs.entries()]
    .filter(([k]) => !k.startsWith('.'))
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 8);
  const biggest = dirRows[0]?.[1].bytes || 1;
  const treeRows = dirRows.map(([path, v]) => ({
    path, loc: v.files, files: v.files, is_dir: path !== '(root)',
    bar: Math.round((v.bytes / biggest) * 1000) / 1000,
  }));

  // Commit cadence over the window the API returned.
  const days = new Map();
  const subjects = [];
  for (const c of commits) {
    const when = c?.commit?.author?.date;
    if (when) {
      const k = when.slice(0, 10);
      days.set(k, (days.get(k) || 0) + 1);
    }
    const s = (c?.commit?.message || '').split('\n')[0];
    if (s) subjects.push(s);
  }
  let cadence = [];
  if (days.size) {
    const keys = [...days.keys()].sort();
    const last = new Date(keys[keys.length - 1] + 'T00:00:00Z');
    const WEEKS = 26;
    for (let i = WEEKS * 7 - 1; i >= 0; i--) {
      const d = new Date(last.getTime() - i * 86400000);
      cadence.push(days.get(d.toISOString().slice(0, 10)) || 0);
    }
  }

  // Milestones from conventional-commit prefixes, newest last.
  const PRI = [[/^(feat|add|introduc|implement|new)\b/i, 'feature'],
               [/^(perf|optimi|speed|fast)\b/i, 'speed'],
               [/^(fix|bug|patch|repair)\b/i, 'fix'],
               [/^(refactor|rework|rewrite|clean)\b/i, 'refactor'],
               [/(release|v\d+\.\d+|ship|launch)/i, 'release']];
  const seenT = new Set();
  const timeline = [];
  for (const subj of subjects) {
    const s = subj.replace(/^\w+(\([^)]*\))?!?:\s*/, '').trim();
    if (s.length < 8 || s.length > 64) continue;
    const key = s.toLowerCase().slice(0, 28);
    if (seenT.has(key)) continue;
    if (!PRI.some(([rx]) => rx.test(subj))) continue;
    seenT.add(key);
    timeline.push({ text: s[0].toUpperCase() + s.slice(1) });
    if (timeline.length >= 6) break;
  }
  timeline.reverse();

  const description = (meta.description || readmePitch(readme) || '').trim();
  const stats = {
    files: sourceFiles,
    bytes: totalBytes,
    test_files: testFiles,
    contributors: Array.isArray(contributors) ? contributors.length : 0,
    commits_seen: commits.length,
    stars: meta.stargazers_count || 0,
    forks: meta.forks_count || 0,
    open_issues: meta.open_issues_count || 0,
    age_days: meta.created_at
      ? Math.max(0, Math.round((Date.now() - new Date(meta.created_at)) / 86400000)) : 0,
  };

  // Only measured facts go on screen, and each is labelled honestly: the API
  // caps the commit list, so this says "recent commits", not "commits".
  const highlights = [];
  const add = (value, label) => { if (value) highlights.push({ value: fmt(value), label }); };
  add(stats.files, 'files');
  if (stats.stars > 9) add(stats.stars, 'stars');
  add(stats.commits_seen >= 100 ? '100+' : stats.commits_seen, 'recent commits');
  if (stats.contributors > 1) add(stats.contributors, 'contributors');
  if (stats.age_days > 1) add(stats.age_days, 'days in the making');
  if (stats.test_files) add(stats.test_files, 'test files');

  return {
    owner, repo, branch,
    name: meta.name || repo,
    full_name: meta.full_name || `${owner}/${repo}`,
    url: meta.html_url,
    homepage: (meta.homepage || '').trim(),
    description,
    tagline: shorten(description, 72),
    license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION'
      ? meta.license.spdx_id : '',
    topics: meta.topics || [],
    languages,
    hero_language: languages[0]?.name || '',
    hero_color: languages[0]?.color || '',
    stats,
    highlights: highlights.slice(0, 5),
    tree: treeRows,
    cadence,
    cadence_days: days.size,
    timeline,
    features: readmeFeatures(readme),
    claims: readmeClaims(readme),
    contributorNames: (Array.isArray(contributors) ? contributors : [])
      .map(c => c.login).filter(Boolean).slice(0, 9),
    readme,
    treePaths: tree.filter(t => t.type === 'blob').map(t => t.path),
    // The raw entries, with type and size, so the code-shot picker can rank
    // files without fetching any of them first.
    tree_raw: tree.map(t => ({ path: t.path, type: t.type, size: t.size || 0 })),
    // Raw authored dates, for the deep read's own heatmap.
    commitDates: commits.map(c => c?.commit?.author?.date).filter(Boolean),
    summaryLine: [plural(stats.files, 'file'),
                  languages[0] ? `${languages[0].share}% ${languages[0].name}` : null,
                  stats.stars > 9 ? plural(stats.stars, 'star') : null]
      .filter(Boolean).join(' · '),
  };
}

/** Fetch one file's text through the API (CORS-safe, unlike raw.githubusercontent). */
export async function getFile({ owner, repo }, path, token, ref) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const j = await gh(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${q}`,
                     token, { allow404: true });
  if (!j || Array.isArray(j) || !j.content) return null;
  return b64(j.content);
}

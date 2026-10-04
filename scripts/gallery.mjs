#!/usr/bin/env node
/**
 * cased2.0 graphics gallery + verifier.
 *
 * Renders every primitive the engine knows -- every shot type, every
 * background bed, every overlay, every transition and camera move -- and
 * reports anything that throws or comes out blank.
 *
 * A library this size cannot be checked by eye on every change, and a shot
 * that silently renders an empty frame looks exactly like one that was
 * never scheduled. This is the thing that catches that.
 *
 *   node scripts/gallery.mjs            # verify only, exit non-zero on failure
 *   node scripts/gallery.mjs --out DIR  # also write PNGs and contact sheets
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const STAGE = join(ROOT, 'cased', 'engine', 'stage.html');

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const OUT = arg('out');
const ONLY = arg('only');            // shots | beds | fx | motion
const WIDTH = Number(arg('width', 960));
const HEIGHT = Number(arg('height', 540));

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const roots = [];
  for (const cmd of ['npm root -g', 'npm root']) {
    try { roots.push(execSync(cmd, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim()); }
    catch { /* npm may not be on PATH */ }
  }
  roots.push(join(ROOT, 'node_modules'));
  for (const r of roots) {
    for (const nm of ['playwright', 'playwright-core']) {
      const entry = join(r, nm, 'index.mjs');
      if (existsSync(entry)) return await import(pathToFileURL(entry).href);
    }
  }
  throw new Error('Playwright not found. npm i -g playwright');
}

/* ---------------------------------------------------------------------
   Fixtures: plausible data for every shot type, so each one is exercised
   the way a real film would use it.
   --------------------------------------------------------------------- */
const LANGS = [
  { name: 'Python', share: 46.2, color: '#3572A5' },
  { name: 'JavaScript', share: 28.1, color: '#F1E05A' },
  { name: 'HTML', share: 15.4, color: '#E34C26' },
  { name: 'CSS', share: 10.3, color: '#563D7C' },
];
const CODE = [
  'def compose(story, beatmap, duration=24.0):',
  '    """Turn a story into a frame-exact shot list."""',
  '    dname, d = pick(director, story.get("kind"))',
  '    plan = build_plan(story, dname, d, rng, duration)',
  '    decorate(plan, d, rng)',
  '    shots = _lay_out(plan, duration, beatmap)',
  '    return {"shots": shots, "theme": theme}',
];
const SERIES = [3, 7, 5, 12, 9, 18, 14, 22, 19, 27, 24, 31];

const FIXTURES = {
  title:    { kicker: 'owner/repo', text: 'You shipped it. Now make the trailer.', rule: true,
              sub: 'A launch film, from one command.' },
  stat:     { value: '3140', label: 'lines of source' },
  code:     { path: 'cased/compose.py', code: CODE, caption: 'the entry point', dur: 3 },
  bullets:  { title: 'what it does', items: ['It reads the repository, not a webpage',
              'Real source appears on screen', 'Every cut lands on a beat',
              'Same seed, same film'] },
  globe:    { kicker: 'available now', text: 'Ship it anywhere', sub: 'Open source · MIT' },
  langs:    { title: 'built with', items: LANGS },
  timeline: { title: 'how it got here', items: [{ text: 'First commit' }, { text: 'Added the scorer' },
              { text: 'Beat-synced the edit' }, { text: 'Shipped v2' }] },
  retro:    { windows: [{ title: 'README', body: '> ready' }, { title: 'LOG', body: '42 commits' }] },
  endcard:  { name: 'cased2.0', sub: 'github.com/you/repo', cta: 'made with cased2.0' },
  arch:     { title: 'architecture',
              nodes: [{ label: 'core', hub: true }, { label: 'cli' }, { label: 'render' },
                      { label: 'score' }, { label: 'compose' }, { label: 'analyze' }],
              edges: [[1,0],[2,0],[3,0],[0,4],[0,5],[5,2]],
              note: '11 modules, 10 imports between them' },
  tree:     { title: 'what is in here', items: [
              { path: 'cased', loc: 4169, bar: 1.0, is_dir: true },
              { path: 'docs', loc: 1322, bar: 0.32, is_dir: true },
              { path: 'skills', loc: 426, bar: 0.11, is_dir: true },
              { path: 'scripts', loc: 305, bar: 0.08, is_dir: true }] },
  flow:     { title: 'how it runs', items: [{ name: 'analyze', note: 'story.json' },
              { name: 'score', note: 'score.wav' }, { name: 'compose', note: 'spec.json' },
              { name: 'render', note: 'cased.mp4' }] },
  callout:  { path: 'cased/compose.py — compose()', code: CODE, highlight: 3,
              label: 'the idea', note: 'Every cut is snapped onto the beat grid.' },
  heatmap:  { title: 'the last six months',
              days: Array.from({ length: 182 }, (_, i) => (i * 7 % 11 === 0 ? 0 : (i % 5))),
              note: '9 commits on 2026-09-14' },
  constellation: { title: 'techniques in the source', items: [
              { name: 'Karplus-Strong synthesis' }, { name: 'GPU shaders' },
              { name: 'Procedural noise' }, { name: 'Video encoding' },
              { name: 'Deterministic generation' }, { name: 'Parsing' }] },
  compare:  { left: 'The score is a score', right: 'a song',
              leftLabel: 'cased2.0', rightLabel: 'not' },
  bigquote: { text: 'The numbers on screen are measured from your code, never invented.',
              source: 'from the README' },
  kpi:      { title: 'at a glance', items: [{ value: '3140', label: 'lines' },
              { value: '42', label: 'commits' }, { value: '11', label: 'modules' },
              { value: '4', label: 'languages' }] },
  barchart: { title: 'lines by directory', items: [
              { label: 'cased', value: 4169 }, { label: 'docs', value: 1322 },
              { label: 'skills', value: 426 }, { label: 'scripts', value: 305 },
              { label: 'examples', value: 87 }] },
  linechart:{ title: 'commits per week', values: SERIES },
  sparkline:{ value: '1599', label: 'queries per second', values: SERIES },
  meter:    { value: 78, max: 100, label: 'test coverage' },
  table:    { title: 'the numbers', columns: ['metric', 'value', 'delta'],
              rows: [['Lines', '3,140', '+412'], ['Commits', '42', '+6'],
                     ['Modules', '11', '+1'], ['Tests', '28', '+4']] },
  numbergrid: { items: [{ value: '3140', label: 'lines of source' },
              { value: '42', label: 'commits' }, { value: '11', label: 'modules' },
              { value: '28', label: 'tests' }] },
  heatgrid: { title: 'activity', columns: ['M','T','W','T','F','S','S'],
              rows: [{ label: 'analyze', values: [3,1,4,1,5,0,2] },
                     { label: 'score', values: [0,2,2,4,1,0,0] },
                     { label: 'compose', values: [5,3,0,1,2,1,3] },
                     { label: 'render', values: [1,1,1,2,4,2,0] }] },
  split:    { text: 'Every cut lands on a beat.', value: '92', label: 'BPM',
              sub: 'The scorer picks the tempo first.' },
  bigtype:  { text: 'SHIPPED' },
  steps:    { title: 'four stages', items: [
              { title: 'Analyze', note: 'read the repository' },
              { title: 'Score', note: 'write the soundtrack' },
              { title: 'Compose', note: 'cut to the beat' },
              { title: 'Render', note: 'frame-stepped capture' }] },
  checklist:{ title: 'what it ships with', items: ['Beat-synced cuts', 'Synthesised score',
              'Every aspect ratio', 'Share copy', 'Reproducible from a seed'] },
  badges:   { title: 'the stack', items: ['Python 3.11', 'Node 22', 'FFmpeg', 'Chromium',
              'MIT', 'Zero deps'] },
  cards:    { items: [{ kicker: '01', title: 'It reads the repo', note: 'Not a webpage.' },
              { kicker: '02', title: 'It writes the score', note: 'Nobody else has it.' },
              { kicker: '03', title: 'It cuts to the beat', note: 'Every single time.' }] },
  lowerthird: { name: 'Akshat Sarkar', role: 'author · cased2.0' },
  marquee:  { text: 'ANALYZE · SCORE · COMPOSE · RENDER' },
  credits:  { items: [{ label: 'built by', value: 'Akshat Sarkar' },
              { label: 'music', value: 'synthesised in the standard library' },
              { label: 'render', value: 'headless Chromium + FFmpeg' },
              { label: 'licence', value: 'MIT' }] },
  filelist: { title: 'output', items: [{ path: 'cased.mp4', size: '4.3 MB' },
              { path: 'cased.gif', size: '3.8 MB' }, { path: 'poster.png', size: '850 KB' },
              { path: 'SHARE.md', size: '1.2 KB' }, { path: 'spec.json', size: '14 KB' }] },
  terminalrun: { title: 'bash', dur: 3.4, lines: [
              { kind: 'cmd', text: '$ python3 -m cased .' }, { kind: 'out', text: '' },
              { kind: 'dim', text: '1/4  reading the repository' },
              { kind: 'ok',  text: '  ✓ 3,140 lines · 11 files' },
              { kind: 'dim', text: '2/4  writing the score' },
              { kind: 'ok',  text: '  ✓ 92 BPM minor' },
              { kind: 'dim', text: '4/4  rendering' },
              { kind: 'ok',  text: '  ✓ cased.mp4' }] },
  diff:     { path: 'cased/compose.py', lines: [
              { op: ' ', text: 'def _lay_out(plan, duration, beatmap):' },
              { op: '-', text: '    snapped = _snap(acc, grid)' },
              { op: '-', text: '    if snapped - bounds[-1] < MIN_SHOT:' },
              { op: '+', text: '    lo = bounds[-1] + MIN_SHOT' },
              { op: '+', text: '    hi = duration - MIN_SHOT * (n - 1 - i)' },
              { op: '+', text: '    pick = _nearest(ideal, beats, lo, hi)' },
              { op: ' ', text: '    bounds.append(pick)' }] },
  stack:    { items: [{ name: 'Control', note: 'policy' }, { name: 'Ingest', note: 'classify' },
              { name: 'Storage', note: 'never lose a write' }, { name: 'Sync', note: 'peers' }] },
  sequence: { items: [{ title: 'Read', note: 'the repository' }, { title: 'Score', note: 'the music' },
              { title: 'Cut', note: 'to the beat' }, { title: 'Render', note: 'to MP4' }] },
  avatars:  { title: 'contributors', items: ['Akshat Sarkar', 'Jane Doe', 'Sam Lee', 'Ravi P'],
              note: '4 people, 42 commits' },
  worldmap: { pins: [{ lat: 51, lon: 0 }, { lat: 37, lon: -122 }, { lat: 19, lon: 73 },
              { lat: -33, lon: 151 }, { lat: 35, lon: 139 }] },
  logo:     { name: 'cased2.0', sub: 'you shipped it — now make the trailer' },
  quotecard:{ text: 'Most teams will tell you their system works. We hand you the crowbar.',
              author: 'Akshat Sarkar', role: 'author' },
  pillars:  { items: [{ title: 'It survives', note: 'crash, partition, overload' },
              { title: 'It decides', note: 'what may leave the device' },
              { title: 'It proves', note: 'a simulator and published defects' }] },
  timelinehz: { title: 'the road here', items: [
              { label: 'First commit', note: 'Jun' }, { label: 'Scorer', note: 'Jul' },
              { label: 'Beat sync', note: 'Aug' }, { label: 'v2.0', note: 'Oct' }] },
  titlecard:{ text: 'Now make the trailer', sub: 'cased2.0' },
  chapter:  { number: '02', text: 'The edit' },
  statement:{ text: 'Every cut lands on a beat, because the scorer picks the tempo first.' },
  ratio:    { value: 7, total: 7, label: 'deletions delivered on a dying link' },
  versus:   { left: { label: 'cased2.0', value: '4.3 MB' },
              right: { label: 'before', value: '27.8 MB' } },
  ranked:   { title: 'biggest files', items: [
              { label: 'engine/stage.html', value: 3913 }, { label: 'cased/analyze.py', value: 671 },
              { label: 'cased/score.py', value: 470 }, { label: 'cased/compose.py', value: 402 },
              { label: 'cased/insight.py', value: 388 }] },
  legend:   { title: 'what the colours mean', items: LANGS.map(l => (
              { label: l.name, color: l.color, note: l.share + '%' })) },
  matrixtable: { title: 'what ships where', corner: 'feature',
              columns: ['24s', '60s', 'slim'],
              rows: [{ label: 'Beat-synced cuts', values: [1,1,1] },
                     { label: 'Import graph', values: [0,1,0] },
                     { label: 'Signature function', values: [0,1,0] },
                     { label: 'Hand-written shots', values: [0,0,1] }] },
  funnel:   { title: 'from clone to film', items: [
              { label: 'Files walked', value: 1240 }, { label: 'Source files', value: 410 },
              { label: 'Scored for appeal', value: 96 }, { label: 'On screen', value: 3 }] },
  dumbbell: { title: 'before and after', fromLabel: 'before', toLabel: 'after', items: [
              { label: 'MP4 size (MB)', from: 27.8, to: 4.3 },
              { label: 'GIF size (MB)', from: 44.5, to: 3.8 },
              { label: 'Cuts on beat', from: 4, to: 9 }] },
  waffle:   { title: 'coverage', value: 78, total: 100, columns: 10, label: 'of statements' },
  bulletchart: { title: 'against target', items: [
              { label: 'Render time (s)', value: 214, target: 300 },
              { label: 'MP4 size (MB)', value: 4.3, target: 8 },
              { label: 'Shots', value: 16, target: 18 }] },
  scatter:  { title: 'size against churn',
              points: Array.from({ length: 36 }, (_, i) => (
                { x: (i * 37) % 100, y: ((i * 61) % 100) * 0.8 + 10 })) },
  treemapbox: { title: 'where the code lives', items: [
              { label: 'engine', value: 3913 }, { label: 'analyze', value: 671 },
              { label: 'score', value: 470 }, { label: 'compose', value: 402 },
              { label: 'insight', value: 388 }, { label: 'cli', value: 300 }] },
  gantt:    { title: 'the build', items: [
              { label: 'Analyzer', start: 0, len: 3 }, { label: 'Scorer', start: 2, len: 3 },
              { label: 'Engine', start: 3, len: 5 }, { label: 'Site', start: 6, len: 3 }] },
  orgchart: { root: 'cli', children: ['analyze', 'score', 'compose', 'render'] },
  keycaps:  { title: 'one command', keys: ['p','y','t','h','o','n','3'] },
  appcode: { app: 'atlasos / techstart', title: 'Ship from the *same* workspace.',
             root: 'web', branch: 'main', action: 'Run', tab: 'stripe.ts',
             files: [{ name: 'app', depth: 0 }, { name: 'lib', depth: 0 },
                     { name: 'integrations', depth: 1 },
                     { name: 'stripe.ts', depth: 2, active: true },
                     { name: 'razorpay.ts', depth: 2 }, { name: 'shopify.ts', depth: 2 },
                     { name: 'webhooks.ts', depth: 1 }, { name: 'signal.ts', depth: 1 }],
             code: ['export async function syncStripe(org) {',
                    '  const events = await stripe.events.list({', '    since: cursor,',
                    '  });', '  for (const e of events) {',
                    '    await revenue.upsert(org.id, e);', '  }',
                    '  return signal("sales.synced", events.length);', '}'] },
  appboard: { app: 'atlasos / techstart', title: 'Plan the week on *one* board.',
              sprint: 'Sprint 12 \u00b7 Launch week',
              columns: [{ name: 'To do', cards: [{ text: 'Pricing page copy', tag: 'marketing' },
                                                 { text: 'Onboarding email v2', tag: 'growth' }] },
                        { name: 'In progress', cards: [{ text: 'Analytics API endpoints', tag: 'backend' }] },
                        { name: 'Done', cards: [{ text: 'Stripe sync', tag: 'shipped' },
                                                { text: 'Auth flow' }, { text: 'Invite teammates' }] }] },
  appdash: { app: 'atlasos / techstart', title: 'Revenue, not *spreadsheets*.',
             value: '$47.7k', delta: '+23%', label: 'monthly recurring revenue',
             series: [12, 14, 13, 18, 21, 19, 26, 31, 29, 36, 41, 47],
             cards: [{ label: 'Stripe', value: 'connected' }, { label: 'Churn', value: '1.8%' },
                     { label: 'Net new', value: '+14' }] },
  appchat: { app: 'atlasos / techstart', title: 'An agent that *knows* your company.',
             agent: 'HEYAI', prompt: 'Ask anything',
             messages: [{ from: 'you', text: 'What slipped this week?' },
                        { text: 'Two launch tasks moved: pricing copy and the onboarding email.' },
                        { from: 'you', text: 'Who owns them?' }] },
  apporbit: { title: 'Everything a young company runs on.', mark: 'AT',
              items: ['Projects', 'Tasks', 'Docs', 'Sales', 'Hiring', 'Feedback', 'Agent', 'Cap table'] },
  appwindows: { text: 'Twelve tabs. One *company*.', count: 11, seed: 7 },
  appsplit: { left: { kicker: 'for builders', text: 'Stop stitching tools. *Run the company.*',
                      items: ['Ship product', 'Close customers', 'Grow the team'] },
              right: { kicker: 'for investors', text: 'Skip the PDF update. *See the company.*',
                       items: ['Live portfolio signal', 'Thesis-matched deal flow', 'Churn and runway flags'] } },
  browserframe: { url: 'akshatinnovate-png.github.io/CaseD',
              heading: 'You shipped it. Now make the trailer.',
              sub: 'cased2.0 reads your repository and renders a launch film.' },
  deviceframe: { heading: 'Vertical, too', sub: '9:16 for reels and shorts' },
  endslate: { name: 'cased2.0', links: ['github.com/you/repo', 'MIT', 'made with cased2.0'] },
};

const THEME = {
  bg: '#06070C', fg: '#FFFFFF', accent: '#7C5CFF', accent2: '#39D0FF',
  grain: 0.05, scanlines: false, vignette: 1.0, letterbox: false, bg_mode: 'aurora',
};

function oneShot(type, data, extra = {}) {
  return {
    version: '2.0', project: 'gallery', seed: 1234, fps: 30,
    width: WIDTH, height: HEIGHT, duration: 6,
    theme: { ...THEME, ...(extra.theme || {}) },
    shots: [{
      type, start: 0, dur: 6, in: extra.in || 'cut',
      bg: extra.bg || 'aurora', cam: extra.cam || 'none',
      energy: 0.55, fx: extra.fx || [], data,
    }],
  };
}

const RESET = '\x1b[0m', RED = '\x1b[91m', GREEN = '\x1b[92m', DIM = '\x1b[2m';

async function main() {
  const { chromium } = await loadPlaywright();
  if (OUT) mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
           '--enable-unsafe-swiftshader', '--force-color-profile=srgb',
           '--disable-lcd-text', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(pathToFileURL(STAGE).href, { waitUntil: 'load' });

  const inventory = await page.evaluate(() => ({
    shots: Object.keys(BUILD), beds: BED_NAMES, fx: FX_NAMES,
    ins: IN_NAMES, cams: CAM_NAMES,
  }));

  const failures = [];
  const groups = {};

  /** Render one spec and report how much of the frame it actually painted. */
  async function shoot(label, spec, group, file) {
    const before = pageErrors.length;
    let coverage = 0, err = '';
    try {
      await page.evaluate(s => window.__CASED.load(s), spec);
      await page.evaluate(() => window.__CASED.seek(4.4));
      coverage = await page.evaluate(() => {
        // How much of the DOM layer is non-empty: the bed always paints, so
        // measuring the whole frame would pass a shot that drew nothing.
        const layer = document.querySelector('#dom > .layer');
        if (!layer) return 0;
        const r = layer.getBoundingClientRect();
        if (!r.width || !r.height) return 0;
        const vis = [...layer.querySelectorAll('*')].filter(e => {
          const b = e.getBoundingClientRect();
          return b.width > 1 && b.height > 1;
        });
        return vis.length;
      });
    } catch (e) { err = e.message; }
    const newErrs = pageErrors.slice(before);
    if (newErrs.length) err = err || newErrs[0];
    const ok = !err && coverage > 0;
    if (!ok) failures.push({ label, group, err: err || 'rendered nothing' });
    (groups[group] ||= []).push({ label, ok, coverage, err });
    if (OUT) {
      const dir = join(OUT, group);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, (file || label) + '.png') });
    }
  }

  const want = g => !ONLY || ONLY === g;

  if (want('shots')) {
    process.stderr.write(`\n${DIM}shots${RESET}\n`);
    for (const type of inventory.shots) {
      const data = FIXTURES[type];
      if (!data) { failures.push({ label: type, group: 'shots', err: 'no fixture' }); continue; }
      await shoot(type, oneShot(type, data), 'shots');
    }
  }
  if (want('beds')) {
    process.stderr.write(`${DIM}beds${RESET}\n`);
    for (const bed of inventory.beds) {
      await shoot(bed, oneShot('bigtype', { text: bed.toUpperCase() }, { bg: bed }), 'beds');
    }
  }
  if (want('fx')) {
    process.stderr.write(`${DIM}fx${RESET}\n`);
    for (const f of inventory.fx) {
      await shoot(f, oneShot('bigtype', { text: f.toUpperCase() },
                             { bg: 'smoke', fx: [f] }), 'fx');
    }
  }
  if (want('themes')) {
    process.stderr.write(`${DIM}themes${RESET}\n`);
    const themes = JSON.parse(readFileSync(join(ROOT, 'docs', 'assets', 'themes.json'), 'utf8'));
    for (const [name, t] of Object.entries(themes)) {
      await shoot(name, oneShot('titlecard',
        { text: name.replace(/_/g, ' '), sub: `${t.bg}  ${t.accent}  ${t.accent2}` },
        { theme: t, bg: t.bg_mode, cam: 'none' }), 'themes');
    }
  }
  if (want('motion')) {
    process.stderr.write(`${DIM}motion${RESET}\n`);
    for (const t of inventory.ins) {
      await shoot('in:' + t, oneShot('bigtype', { text: t.toUpperCase() }, { in: t }),
                  'motion', 'in-' + t);
    }
    for (const c of inventory.cams) {
      await shoot('cam:' + c, oneShot('bigtype', { text: c.toUpperCase() }, { cam: c }),
                  'motion', 'cam-' + c);
    }
  }

  await browser.close();

  const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  process.stderr.write('\n');
  for (const [g, list] of Object.entries(groups)) {
    const bad = list.filter(r => !r.ok).length;
    const mark = bad ? `${RED}${bad} failed${RESET}` : `${GREEN}all ok${RESET}`;
    process.stderr.write(`  ${g.padEnd(8)} ${String(list.length).padStart(3)}   ${mark}\n`);
  }
  process.stderr.write(`\n  total primitives rendered: ${total}\n`);
  process.stderr.write(`  shot types ${inventory.shots.length} · beds ${inventory.beds.length} · ` +
    `overlays ${inventory.fx.length} · transitions ${inventory.ins.length} · ` +
    `cameras ${inventory.cams.length}\n`);

  if (failures.length) {
    process.stderr.write(`\n${RED}${failures.length} failure(s):${RESET}\n`);
    failures.forEach(f => process.stderr.write(`   ${f.group}/${f.label}: ${f.err}\n`));
    return 1;
  }
  process.stderr.write(`\n${GREEN}every primitive rendered${RESET}\n`);
  if (OUT) process.stderr.write(`${DIM}frames written to ${OUT}${RESET}\n`);
  return 0;
}

main().then(c => process.exit(c)).catch(e => {
  console.error('gallery failed:', e.message);
  process.exit(1);
});

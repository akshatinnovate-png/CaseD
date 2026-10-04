// The Make flow: paste a repo, get a film, in this tab.
//
// Everything here runs client-side. The GitHub REST API sends
// Access-Control-Allow-Origin: *, so the repository can be read straight from
// the page; the scorer, the composer and the engine are the same code the CLI
// runs, so the film previewed here is the film the CLI renders from the spec.
//
// What a static page genuinely cannot do is deploy the project's frontend —
// there is no builder, no node, nowhere to deploy to. It does not need to:
// the colours a frontend ships are already in its style files, so forge reads
// those and matches a theme to them. No deploy, same outcome.

import { parseRepo, analyzeRepo, getFile, RateLimited } from './forge/github.js';
import { readFrontend, rankThemes } from './forge/palette.js';
import { readCodeMoments } from './forge/code.js';
import { inspect } from './forge/insight.js';
import { invent } from './forge/invent.js';
import { layOut, decorate, shareCopy } from './forge/compose.js';
import { composeScore, wavBytes, toAudioBuffer, SR } from './forge/score.js';
import { compose, pickDirector } from './forge/compose.js';
import * as groq from './forge/groq.js';

const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const S = {
  themes: null, directors: null,
  story: null, frontend: null, ranked: [], insight: null, repo: null,
  theme: null, director: null, duration: 24, creative: false, invented: false,
  inventedPlan: null,
  spec: null, bus: null, beatmap: null, copy: null,
  playing: false, raf: 0, startedAt: 0, startedFrom: 0,
  audioCtx: null, audioBuf: null, audioNode: null,
};

// ------------------------------------------------------------------- log

function log(msg, kind) {
  const li = el('li', kind || '', msg);
  $('#log').append(li);
  return li;
}
const clearLog = () => { $('#log').textContent = ''; };

function show(id) {
  const n = $(id);
  n.hidden = false;
  return n;
}

// ------------------------------------------------------------- boot data

const dataReady = (async () => {
  const [themes, directors] = await Promise.all([
    fetch('assets/themes.json').then(r => r.json()),
    fetch('assets/directors.json').then(r => r.json()),
  ]);
  S.themes = themes;
  S.directors = directors;
  // What the planner may reach for. Read from the engine rather than listed
  // here, so the catalogue cannot drift from what actually renders.
  try {
    const src = await fetch('engine/stage.html').then(r => r.text());
    S.shotTypes = [...src.matchAll(/^BUILD\.([a-zA-Z_][\w]*) =/gm)].map(m => m[1]);
  } catch { S.shotTypes = ['title', 'stat', 'code', 'bullets', 'langs', 'endcard']; }

  const dsel = $('#director');
  dsel.append(el('option', '', 'Match the project'));
  dsel.firstChild.value = '';
  for (const [name, d] of Object.entries(directors)) {
    const o = el('option', '', `${d.label} — ${d.blurb}`);
    o.value = name;
    dsel.append(o);
  }

  const fsel = $('#filter');
  const fams = [...new Set(Object.values(themes).map(t => t.family))].sort();
  for (const f of fams) {
    const o = el('option', '', f[0].toUpperCase() + f.slice(1));
    o.value = f;
    fsel.append(o);
  }
})();

// ------------------------------------------------------------ github token

const GH_STORE = 'cased.github.token';
const ghInput = $('#ghtoken');

function ghToken() {
  const v = ghInput.value.trim();
  return v || null;
}
try {
  const saved = localStorage.getItem(GH_STORE);
  if (saved) ghInput.value = saved;
} catch { /* storage blocked: run tokenless */ }
ghInput.addEventListener('change', () => {
  try {
    const v = ghInput.value.trim();
    if (v) localStorage.setItem(GH_STORE, v); else localStorage.removeItem(GH_STORE);
  } catch { /* nothing to do */ }
  $('#gh-hint').textContent = ghInput.value.trim()
    ? 'Saved in this browser only. Creative mode can now read much more.'
    : 'Without a token GitHub allows 60 requests an hour, shared by everything here.';
  budgetNote();
$('#invented-hint').textContent = S.invented
  ? 'Each run designs its own shots, so two runs of the same repo differ.'
  : 'Off: shots come from the built-in library.';
});

// ---------------------------------------------------------------- the key

const keyInput = $('#groq');
const keyHint = $('#groq-hint');
try {
  const saved = groq.getKey();
  if (saved) { keyInput.value = saved; keyHint.textContent = 'Key loaded from this browser.'; }
} catch { /* storage blocked: run keyless */ }

keyInput.addEventListener('change', () => {
  const v = keyInput.value.trim();
  keyHint.className = 'mk-hint';
  if (!v) {
    groq.clearKey();
    keyHint.textContent = 'No key. The copy will come from your README.';
    return;
  }
  if (!groq.looksLikeKey(v)) {
    keyHint.textContent = 'That does not look like a Groq key (they start gsk_).';
    keyHint.classList.add('bad');
    return;
  }
  groq.setKey(v);
  keyHint.textContent = 'Saved in this browser only. Press Check to confirm it works.';
});

$('#groq-check').addEventListener('click', async () => {
  const v = keyInput.value.trim();
  keyHint.className = 'mk-hint';
  if (!v) { keyHint.textContent = 'Nothing to check — the film works without a key.'; return; }
  keyHint.textContent = 'Checking…';
  try {
    const { model } = await groq.checkKey(v);
    groq.setKey(v);
    keyHint.textContent = `Working. Copy will be written by ${model}.`;
    keyHint.classList.add('good');
  } catch (e) {
    keyHint.textContent = e.status === 401
      ? 'Groq rejected that key.'
      : `${e.message}. The film still works without a key.`;
    keyHint.classList.add('bad');
  }
});

// --------------------------------------------------------------- the run

$('#repo').addEventListener('keydown', e => { if (e.key === 'Enter') $('#go').click(); });

$('#go').addEventListener('click', async () => {
  const raw = $('#repo').value.trim();
  const repo = parseRepo(raw);
  const hint = $('#repo-hint');
  if (!repo) {
    $('#repo').setAttribute('aria-invalid', 'true');
    hint.textContent = 'Could not read an owner and name out of that.';
    hint.className = 'mk-hint bad';
    return;
  }
  $('#repo').removeAttribute('aria-invalid');
  hint.className = 'mk-hint';
  hint.textContent = `Reading ${repo.owner}/${repo.repo}…`;

  $('#go').disabled = true;
  clearLog();
  stop();

  try {
    await dataReady;
    await run(repo);
  } catch (e) {
    if (e instanceof RateLimited) {
      log(`GitHub rate-limited this browser. It resets at ${e.resetAt
        ? new Date(e.resetAt).toLocaleTimeString() : 'the top of the hour'}. `
        + 'A personal access token raises the limit a long way.', 'err');
    } else {
      log(e.message || String(e), 'err');
    }
  } finally {
    $('#go').disabled = false;
  }
});

async function run(repo) {
  // --- 1. read the repository
  S.repo = repo;
  const story = await analyzeRepo(repo, ghToken(), s => log(s));
  S.story = story;
  log(`${story.full_name}: ${story.summaryLine}`, 'done');
  renderFound(story);
  show('#step-read');

  // --- 2. read the frontend it ships, and rank the themes against it
  const front = await readFrontend(repo, story.treePaths, ghToken(), story.branch, s => log(s));
  S.frontend = front;
  if (front.frameworks.length) {
    log(`frontend: ${front.frameworks.map(f => f.name).join(', ')} in ${front.root}/`, 'done');
  } else if (front.isFrontend) {
    log(`frontend: ${front.counts.styles} style and ${front.counts.html} HTML `
      + `files in ${front.root}/`, 'done');
  } else {
    log('no frontend found, so the theme is yours to pick', 'done');
  }

  // --- 3. real source for the code shots
  story.code_moments = await readCodeMoments(repo, story, ghToken(), { onStep: s => log(s) });
  if (story.code_moments.length) {
    log(`source: ${story.code_moments.map(m => m.path).join(', ')}`, 'done');
  } else {
    log('no file was a good fit for a code shot, so the film skips them', 'done');
  }

  S.ranked = front.palette ? rankThemes(front.palette, S.themes) : [];
  if (front.palette) {
    log(`palette: ${front.palette.accent} on ${front.palette.bg} `
      + `(${front.palette.sampled} colours read) -> ${S.ranked[0].name} `
      + `at ${S.ranked[0].match}%`, 'done');
  }
  renderPalette(front);
  S.theme = S.ranked.length ? S.ranked[0].name : null;
  renderThemes();
  show('#step-theme');

  // --- 4. the copy
  const key = groq.getKey();
  if (key) {
    log('asking Groq for the copy…');
    try {
      S.copy = await groq.enrich(
        { story, frontend: front, directors: S.directors, theme: S.theme }, key);
      const d = S.copy.dropped.length;
      log(`copy by ${S.copy.model}`
        + (d ? `, ${d} line${d === 1 ? '' : 's'} dropped for quoting a number `
             + 'nobody measured' : ''), 'done');
    } catch (e) {
      S.copy = groq.offlineCopy(story);
      log(`Groq: ${e.message}. Using the README instead.`, 'err');
    }
  } else {
    S.copy = groq.offlineCopy(story);
  }

  if (S.creative) await deepRead();
  if (S.invented && !await inventFilm()) {
    S.invented = false;
    $('#invented').setAttribute('aria-pressed', 'false');
  }

  await build();
  show('#step-film');
  show('#step-get');
  $('#step-film').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --------------------------------------------------------------- the film

/** Fold the chosen copy back into the story the composer reads. */
function storyForFilm() {
  const s = { ...S.story };
  const c = S.copy;
  if (!c) return s;
  if (c.hook) s.tagline = c.hook;
  if (c.what_it_is) s.description = c.what_it_is;
  if (c.features && c.features.length >= 2) s.features = c.features;
  // The composer reads `kind` to pick a director and `code_moments` to show
  // source; neither is invented here, both come out of the analyzer.
  s.kind = s.kind || 'project';
  return s;
}

async function build() {
  const wait = $('#screen-wait');
  wait.hidden = false;
  wait.textContent = 'scoring…';

  S.duration = Math.max(6, Math.min(240, Number($('#duration').value) || 24));
  const chosen = $('#director').value || null;
  const story = storyForFilm();
  const insight = S.creative ? S.insight : null;

  // Mood follows the theme unless the director pins one, exactly as the CLI —
  // which also resolves --creative to the creative director before composing.
  const dname = chosen || (insight ? 'creative' : null)
    || S.copy?.director || pickDirector(story, S.directors);
  const t = S.themes[S.theme] || S.themes[S.directors[dname].theme];
  const mood = S.directors[dname].mood || t.mood || 'cinematic';
  const seed = S.story.stats.files + S.story.stats.commits_seen || 1;

  const { bus, beatmap } = composeScore(S.duration, mood, seed,
                                        S.directors[dname].intensity ?? 1);
  S.bus = bus;
  S.beatmap = beatmap;

  wait.textContent = 'cutting…';

  // An invented film is cut by the same layout as any other, so it is still
  // edited to the music; only where the shots came from differs.
  if (S.invented && S.inventedPlan?.kept?.length >= 3) {
    S.spec = cutInvented(story, beatmap, dname, themeSpecFor(dname));
    S.director = dname;
    $('#film-sub').textContent =
      `${S.spec.shots.length} shots over ${S.duration}s, cut to ${beatmap.bpm} BPM. `
      + `${S.spec.invented_count} written for this repo, ${S.spec.theme_name} palette.`;
    await loadStage();
    renderMarks();
    renderGet();
    fitStage();
    wait.hidden = true;
    return;
  }

  S.spec = compose(story, beatmap, {
    duration: S.duration, director: dname, theme: S.theme,
    seed, themes: S.themes, directors: S.directors, insight,
  });
  S.director = dname;

  $('#film-sub').textContent =
    `${S.spec.shots.length} shots over ${S.duration}s, cut to ${beatmap.bpm} BPM. `
    + `${S.directors[dname].label} direction, ${S.spec.theme_name} palette`
    + (insight ? ', creative arc.' : '.');

  await loadStage();
  renderMarks();
  renderGet();
  fitStage();
  wait.hidden = true;
}

/* ---------------------------------------------------------------- stage
 *
 * The engine runs in a frame with sandbox="allow-scripts" and no
 * allow-same-origin, so this page cannot reach into it and it cannot reach
 * back. That is deliberate: this page's localStorage holds the viewer's Groq
 * key and GitHub token, and shot code written by a model runs in that frame.
 * An opaque origin cannot read either one.
 *
 * The cost is that every call is a message. These wrap that back up into
 * something that reads like a function call.
 */
let stageReady = null;
let msgSeq = 0;
const pending = new Map();

addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m || m.channel !== 'cased') return;
  if (m.event === 'ready') { stageReady?.(); return; }
  const slot = pending.get(m.id);
  if (!slot) return;
  pending.delete(m.id);
  m.ok ? slot.resolve(m.value) : slot.reject(new Error(m.error || 'engine error'));
});

function stageCall(call, extra = {}, timeout = 15000) {
  const f = $('#stage');
  if (!f || !f.contentWindow) return Promise.reject(new Error('no engine frame'));
  const id = ++msgSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`engine did not answer "${call}"`));
    }, timeout);
    f.contentWindow.postMessage({ channel: 'cased', id, call, ...extra }, '*');
  });
}

/** Resolves once the framed engine has announced itself. */
function whenStageReady() {
  return new Promise(res => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(); } };
    stageReady = finish;
    // It may have announced itself before this listener existed, so ask.
    stageCall('ping', {}, 1500).then(finish, () => {});
    setTimeout(finish, 6000);
  });
}

async function loadStage() {
  await whenStageReady();
  try {
    await stageCall('load', { spec: S.spec }, 30000);
    await stageCall('seek', { t: 0 });
    seekUI(0);
  } catch (e) {
    log(`the preview engine did not load: ${e.message}`, 'err');
  }
}

/**
 * The engine draws at 1920x1080; scale it to whatever the screen gives us.
 *
 * A hidden step has no width, so measuring before the step is revealed scales
 * the film to nothing — which looks exactly like a renderer that failed. Skip
 * the zero and let the observer below do it again once the box has a size.
 */
function fitStage() {
  const box = $('.mk-screen');
  const f = $('#stage');
  if (!box || !f) return;
  const w = box.clientWidth;
  if (w < 1) return;
  f.style.transform = `scale(${w / 1920})`;
}
addEventListener('resize', fitStage);
// Covers reveal, resize and zoom without anyone having to remember the order.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(fitStage).observe($('.mk-screen'));
}

// ------------------------------------------------------------- transport

function seekUI(t) {
  const d = S.duration || 1;
  $('#scrub').value = String(Math.round((t / d) * 1000));
  $('#time').textContent = `${t.toFixed(1)} / ${d.toFixed(1)}`;
}

function seek(t) {
  const at = Math.max(0, Math.min(S.duration, t));
  // Fire and forget: a dropped seek is one stale frame, and awaiting it would
  // stall playback behind the slowest frame in the film.
  stageCall('seek', { t: at }).catch(() => {});
  seekUI(t);
}

function play(from = 0) {
  if (!S.bus) return;
  stop();
  S.playing = true;
  $('#play').classList.add('on');

  // Audio and picture share one clock: the AudioContext's. Driving the frames
  // off currentTime keeps them locked even when a frame takes too long.
  try {
    S.audioCtx = S.audioCtx || new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SR,
    });
    S.audioBuf = S.audioBuf || toAudioBuffer(S.audioCtx, S.bus);
    S.audioNode = S.audioCtx.createBufferSource();
    S.audioNode.buffer = S.audioBuf;
    S.audioNode.connect(S.audioCtx.destination);
    S.audioNode.start(0, from);
  } catch { S.audioNode = null; }

  const t0 = S.audioCtx ? S.audioCtx.currentTime : performance.now() / 1000;
  const tick = () => {
    if (!S.playing) return;
    const now = S.audioCtx ? S.audioCtx.currentTime : performance.now() / 1000;
    const t = from + (now - t0);
    if (t >= S.duration) { seek(S.duration); stop(); return; }
    seek(t);
    S.raf = requestAnimationFrame(tick);
  };
  S.raf = requestAnimationFrame(tick);
}

function stop() {
  S.playing = false;
  $('#play')?.classList.remove('on');
  if (S.raf) cancelAnimationFrame(S.raf);
  S.raf = 0;
  if (S.audioNode) { try { S.audioNode.stop(); } catch { /* already stopped */ } }
  S.audioNode = null;
}

$('#play').addEventListener('click', () => {
  if (S.playing) stop();
  else {
    const at = (Number($('#scrub').value) / 1000) * S.duration;
    play(at >= S.duration - 0.05 ? 0 : at);
  }
});

$('#scrub').addEventListener('input', () => {
  stop();
  seek((Number($('#scrub').value) / 1000) * S.duration);
});

/**
 * How many files the deep read may fetch. Without a token the whole page has
 * roughly 50 requests an hour to spend and the rest of the flow already uses
 * about ten, so the budget stays small; a token lifts the ceiling to 5,000 and
 * the graph, the techniques and the signature all get better for it.
 */
const readBudget = () => (ghToken() ? 60 : 14);

function budgetNote() {
  const dur = Number($('#duration').value) || 24;
  const bits = [];
  if (S.creative) {
    bits.push(`Reads up to ${readBudget()} source files`
      + (ghToken() ? '.' : ' — add a GitHub token to read many more.'));
  } else if (dur >= CREATIVE_FROM) {
    bits.push(`Past ${CREATIVE_FROM}s the standard shot list runs out and every `
      + 'shot overstays. Turn on creative mode for a film this long.');
  }
  $('#creative-hint').textContent = S.creative
    ? bits.join(' ')
    : 'Off: the standard arc — hook, numbers, source, stack, end card.';
  $('#dur-hint').textContent = !S.creative && dur >= CREATIVE_FROM ? bits[0] || '' : '';
}

$('#invented').addEventListener('click', async () => {
  const hint = $('#invented-hint');
  hint.className = 'mk-hint';

  // Turning it on without a key used to flip the switch and then flip it
  // straight back, which looks like a broken control rather than a missing
  // key. Refuse before changing anything, and point at the field.
  if (!S.invented && !groq.getKey()) {
    hint.textContent = 'This is the one thing that needs a Groq key \u2014 add one above.';
    hint.classList.add('bad');
    $('#groq').focus();
    $('#groq').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  S.invented = !S.invented;
  $('#invented').setAttribute('aria-pressed', String(S.invented));
  S.inventedPlan = null;
  hint.textContent = S.invented
    ? 'Each run designs its own shots, so two runs of the same repo differ.'
    : 'Off: shots come from the built-in library.';
  if (!S.story) return;
  if (S.invented && !await inventFilm()) {
    // The run failed for a reason already logged; do not leave the switch on
    // claiming something that did not happen.
    S.invented = false;
    $('#invented').setAttribute('aria-pressed', 'false');
    hint.textContent = 'Inventing did not produce enough usable shots \u2014 using the library.';
    hint.classList.add('bad');
  }
  build();
});

$('#creative').addEventListener('click', async () => {
  S.creative = !S.creative;
  $('#creative').setAttribute('aria-pressed', String(S.creative));
  $('#creative-auto').hidden = true;
  // Creative mode's default runtime is a minute, as it is from the CLI.
  if (S.creative && Number($('#duration').value) < CREATIVE_FROM) setDuration(60);
  budgetNote();
  await rebuild();
});

/** Past this, the standard eleven-beat plan has nothing left to show. */
const CREATIVE_FROM = 45;

function setDuration(v) {
  $('#duration').value = String(v);
  for (const b of document.querySelectorAll('.mk-dur-presets button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.dur) === Number(v)));
  }
  // A film this long cannot be filled by counters and title cards, so asking
  // for one is asking for the structural beats. Switch over rather than
  // rendering a minute of shots that each overstay by seconds.
  if (Number(v) >= CREATIVE_FROM && !S.creative) {
    S.creative = true;
    $('#creative').setAttribute('aria-pressed', 'true');
    $('#creative-auto').hidden = false;
  }
  budgetNote();
}

/** Rebuild, first doing the deep read if creative mode now needs it. */
async function rebuild() {
  if (!S.story) return;
  if (S.creative && !S.insight) await deepRead();
  build();
}

for (const b of document.querySelectorAll('.mk-dur-presets button')) {
  b.addEventListener('click', () => { setDuration(Number(b.dataset.dur)); rebuild(); });
}

let durTimer = 0;
$('#duration').addEventListener('input', () => {
  setDuration($('#duration').value);
  clearTimeout(durTimer);
  durTimer = setTimeout(rebuild, 600);
});
$('#director').addEventListener('change', () => { if (S.story) build(); });

/**
 * Have the model design the graphics.
 *
 * The plan it returns is cut to the beat by the same layout the built-in
 * directors use, so an invented film is still edited to the music. Shots that
 * failed validation are simply absent; the beat they would have taken is
 * redistributed across the ones that survived.
 */
async function inventFilm() {
  const key = groq.getKey();
  if (!key) { log('invented graphics need a Groq key', 'err'); return false; }

  // Validation measures what a shot actually drew, and an element inside a
  // display:none subtree measures 0x0 -- so a perfectly good shot reads as
  // blank if the step is still hidden. Reveal the stage before probing it.
  show('#step-film');
  fitStage();

  const wait = $('#screen-wait');
  wait.hidden = false;
  wait.textContent = 'designing the graphics\u2026';

  const theme = S.themes[S.theme] || S.themes[S.directors.cinematic.theme];
  const themeSpec = {
    bg: theme.bg, fg: theme.fg, accent: theme.accent, accent2: theme.accent2,
    grain: theme.grain, scanlines: theme.scanlines, vignette: theme.vignette,
    letterbox: theme.letterbox, bg_mode: theme.bg_mode, face: theme.face,
  };

  await whenStageReady();
  try {
    const r = await invent({
      story: S.story, insight: S.insight, frontend: S.frontend,
      themeName: S.theme, theme: themeSpec, shotTypes: S.shotTypes,
      duration: S.duration, call: stageCall,
    }, key, m => log(m));
    S.inventedPlan = r;
    if (r.look) log(`look: ${r.look}`, 'done');
    const made = r.kept.filter(x => x.invent).length;
    log(`${r.kept.length} shots, ${made} of them newly written`, 'done');
    if (r.rejected.length) {
      log(`${r.rejected.length} dropped: `
        + r.rejected.map(x => `${x.name} (${x.stage})`).join(', '), 'err');
    }
    if (r.dropped.length) {
      log(`${r.dropped.length} line(s) dropped for quoting a number nobody measured`, 'err');
    }
    return r.kept.length >= 3;
  } catch (e) {
    log(`inventing failed: ${e.message}`, 'err');
    return false;
  }
}

/** The deep read, on demand — it costs requests, so only when asked for. */
async function deepRead() {
  const wait = $('#screen-wait');
  wait.hidden = false;
  wait.textContent = 'reading the architecture…';
  log('reading the architecture, techniques and history…');
  S.insight = await inspect(S.repo, S.story, ghToken(),
                            { budget: readBudget(), onStep: m => log(m) });
  const i = S.insight;
  log(`read ${i.read.length} files: ${i.modules.length} modules, `
    + `${i.edges.length} imports`
    + (i.hub ? `, centred on ${i.hub.split('/').pop()}` : ''), 'done');
  if (i.signature.name) {
    log(`signature: ${i.signature.name}() in ${i.signature.module}`, 'done');
  }
  if (i.techniques.length) {
    log(`techniques: ${i.techniques.map(t => t.name).join(', ')}`, 'done');
  }
}

/** The theme spec the engine reads, for a given director. */
function themeSpecFor(dname) {
  const t = S.themes[S.theme] || S.themes[S.directors[dname].theme];
  return {
    bg: t.bg, fg: t.fg, accent: t.accent, accent2: t.accent2,
    grain: t.grain, scanlines: t.scanlines, vignette: t.vignette,
    letterbox: t.letterbox, bg_mode: t.bg_mode, face: t.face,
  };
}

/** Turn the invented plan into a spec, beat-snapped like any other film. */
function cutInvented(story, beatmap, dname, themeSpec) {
  const d = S.directors[dname];
  const MARKUP_AWARE = /^(app|gen)/;
  const strip = (v) => typeof v === 'string' ? v.replace(/\*([^*]+)\*/g, '$1') : v;
  const plan = S.inventedPlan.kept.map((shot, i) => {
    const type = shot.invent || shot.use;
    let data = shot.data || {};
    if (!MARKUP_AWARE.test(type)) {
      data = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, strip(v)]));
    }
    return {
    type,
    data,
    weight: Math.max(0.6, Math.min(1.9, Number(shot.weight) || 1)),
    hard: i > 0 && (i % 3 === 0),
    ...(shot.caption ? { caption: strip(shot.caption) } : {}),
  };
  });
  decorate(plan, d, themeSpec);
  const shots = layOut(plan, S.duration, beatmap);
  const bm = {};
  for (const [k, v] of Object.entries(beatmap)) if (k !== 'beats') bm[k] = v;
  return {
    version: '2.0', project: story.name, director: dname, director_label: d.label,
    mode: 'invented',
    // The source of every shot the model wrote travels with the spec, so the
    // CLI can render the same film the browser previewed.
    generated: S.inventedPlan.kept.filter(s => s.source)
      .map(s => ({ name: s.invent, source: s.source })),
    invented_count: S.inventedPlan.kept.filter(s => s.invent).length,
    look: S.inventedPlan.look || '',
    seed: story.seed || 1, fps: 30, width: 1920, height: 1080,
    duration: Math.round(S.duration * 1e4) / 1e4,
    theme: themeSpec, theme_name: S.theme || d.theme,
    shots, beatmap: bm, share: shareCopy(story, d.label),
  };
}

// --------------------------------------------------------------- renderers

function renderFound(story) {
  const box = $('#found');
  box.textContent = '';
  const row = (label, build) => {
    const r = el('div', 'mk-found-row');
    r.append(el('dt', '', label));
    const dd = el('dd');
    build(dd);
    r.append(dd);
    box.append(r);
  };

  row('Project', dd => {
    dd.append(el('div', '', story.name));
    if (story.tagline) {
      const p = el('div', '', story.tagline);
      p.style.color = 'var(--muted)';
      p.style.fontSize = '13px';
      p.style.marginTop = '4px';
      dd.append(p);
    }
  });

  if (story.highlights.length) {
    row('Measured', dd => {
      const ul = el('ul');
      for (const h of story.highlights) {
        const li = el('li');
        const n = el('span', 'num', h.value);
        li.append(n, document.createTextNode(' ' + h.label));
        ul.append(li);
      }
      dd.append(ul);
    });
  }

  if (story.languages.length) {
    row('Languages', dd => {
      const bar = el('div', 'mk-langbar');
      for (const l of story.languages.slice(0, 6)) {
        const i = el('i');
        i.style.width = `${l.share}%`;
        i.style.background = l.color;
        bar.append(i);
      }
      const keys = el('div', 'mk-langkeys');
      for (const l of story.languages.slice(0, 6)) {
        const s = el('span');
        const b = el('b');
        b.style.background = l.color;
        s.append(b, document.createTextNode(`${l.name} ${l.share}%`));
        keys.append(s);
      }
      dd.append(bar, keys);
    });
  }

  if (story.features.length) {
    row('From the README', dd => {
      const ul = el('ul');
      for (const f of story.features.slice(0, 5)) ul.append(el('li', '', f));
      dd.append(ul);
    });
  }

  if (story.timeline.length) {
    row('Recent work', dd => {
      const ul = el('ul');
      for (const t of story.timeline.slice(-4)) ul.append(el('li', '', t.text));
      dd.append(ul);
    });
  }
}

function renderPalette(front) {
  const wrap = $('#palette');
  const p = front.palette;
  if (!p) {
    wrap.hidden = true;
    $('#theme-sub').textContent =
      'No style files to read a palette from, so every theme is on the table.';
    return;
  }
  wrap.hidden = false;
  const box = $('#swatches');
  box.textContent = '';
  for (const [role, hex] of [['ground', p.bg], ['ink', p.fg],
                             ['accent', p.accent], ['second', p.accent2]]) {
    const s = el('div', 'mk-swatch');
    const i = el('i');
    i.style.background = hex;
    s.append(i, el('span', '', role), el('code', '', hex));
    box.append(s);
  }
  const names = [...new Set([...(p.evidence.bg || []), ...(p.evidence.accent || [])])]
    .filter(Boolean).slice(0, 4);
  $('#evidence').textContent = [
    `read from ${front.read.length} file${front.read.length === 1 ? '' : 's'}: `
      + front.read.join(', '),
    names.length ? `tokens: ${names.map(n => '--' + n).join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

function renderThemes() {
  const box = $('#themes');
  box.textContent = '';
  const fam = $('#filter').value;

  let rows = S.ranked.length
    ? S.ranked
    : Object.entries(S.themes).map(([name, t]) => ({ name, theme: t, match: null }));
  if (fam) rows = rows.filter(r => (r.theme || S.themes[r.name]).family === fam);

  for (const r of rows) {
    const t = r.theme || S.themes[r.name];
    const b = el('button', 'mk-theme');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(r.name === S.theme));
    b.dataset.theme = r.name;

    const sw = el('div', 'mk-theme-sw');
    for (const c of [t.bg, t.accent, t.accent2, t.fg]) {
      const i = el('i');
      i.style.background = c;
      sw.append(i);
    }
    const meta = el('div', 'mk-theme-meta');
    const nm = el('div', 'mk-theme-name');
    nm.append(el('span', '', r.name));
    if (r.match !== null) nm.append(el('span', 'mk-theme-match', r.match + '%'));
    meta.append(nm, el('div', 'mk-theme-fam', `${t.family} · ${t.mood}`));
    b.append(sw, meta);

    b.addEventListener('click', () => {
      S.theme = r.name;
      for (const other of box.children) {
        other.setAttribute('aria-pressed', String(other.dataset.theme === S.theme));
      }
      if (S.story) build();
    });
    box.append(b);
  }
}

$('#filter').addEventListener('change', renderThemes);

function renderMarks() {
  const box = $('#marks');
  box.textContent = '';
  for (const s of S.spec.shots.slice(1)) {
    const i = el('i');
    i.style.left = `${(s.start / S.duration) * 100}%`;
    i.dataset.t = s.start.toFixed(1);
    box.append(i);
  }
}

// ------------------------------------------------------------- downloads

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const slug = () => (S.story?.repo || 'film').replace(/[^\w.-]+/g, '-').toLowerCase();

function renderGet() {
  const target = S.story.url || S.story.full_name;
  $('#cmd').textContent =
    `python3 -m cased ${target} --theme ${S.spec.theme_name} `
    + `--director ${S.director}${S.creative ? ' --creative' : ''} `
    + `--duration ${S.duration} --quality high`;
  // The CLI's deep read walks the whole checkout and parses Python properly,
  // so it finds more than a rate-limited browser can.
  $('#cmd-long').textContent =
    `python3 -m cased ${target} --theme ${S.spec.theme_name} `
    + `--creative --duration ${Math.max(60, S.duration)} --quality high`;

  const box = $('#share');
  box.textContent = '';
  const sh = S.spec.share;
  for (const [key, label] of [['x', 'X / Twitter'], ['linkedin', 'LinkedIn'],
                              ['hn', 'Show HN'], ['product_hunt', 'Product Hunt'],
                              ['alt_text', 'Alt text']]) {
    if (!sh[key]) continue;
    const b = el('button', '', '');
    b.type = 'button';
    b.append(el('span', '', label), el('b', '', 'copy'));
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(sh[key]);
        b.lastChild.textContent = 'copied';
        setTimeout(() => { b.lastChild.textContent = 'copy'; }, 1600);
      } catch {
        b.lastChild.textContent = 'blocked';
      }
    });
    box.append(b);
  }
}

$('#dl-spec').addEventListener('click', () => {
  save(new Blob([JSON.stringify(S.spec, null, 1)], { type: 'application/json' }),
       `${slug()}-spec.json`);
});

$('#dl-wav').addEventListener('click', () => {
  save(new Blob([wavBytes(S.bus)], { type: 'audio/wav' }), `${slug()}-score.wav`);
});

for (const [btn, src] of [['#copy-cmd', '#cmd'], ['#copy-long', '#cmd-long']]) {
  $(btn).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($(src).textContent);
      $(btn).textContent = 'Copied';
      setTimeout(() => { $(btn).textContent = 'Copy'; }, 1600);
    } catch { $(btn).textContent = 'Blocked'; }
  });
}

// --- recording --------------------------------------------------------
//
// The engine draws its text as DOM, not into the canvas, because that is what
// keeps type crisp when the CLI screenshots each frame. A canvas captureStream
// would therefore record the backgrounds and none of the words, so recording
// here captures the tab itself. That costs resolution and runs in real time,
// which is why the spec download next to it exists.

const recNote = $('#rec-note');

$('#dl-video').addEventListener('click', async () => {
  const btn = $('#dl-video');
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    recNote.textContent = 'This browser cannot record a tab. Use the spec and FFmpeg.';
    return;
  }

  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
      preferCurrentTab: true,
    });
  } catch {
    recNote.textContent = 'Screen capture was declined.';
    return;
  }

  // Mix the real score in rather than recording whatever the speakers emit.
  const tracks = [...display.getVideoTracks()];
  let ctx = null;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = toAudioBuffer(ctx, S.bus);
    src.connect(dest);
    src.start();
    tracks.push(...dest.stream.getAudioTracks());
  } catch { /* video only */ }

  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(new MediaStream(tracks),
                                type ? { mimeType: type, videoBitsPerSecond: 8e6 } : {});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise(res => { rec.onstop = res; });
  btn.classList.add('rec');
  btn.disabled = true;
  btn.textContent = 'Recording…';
  recNote.textContent = 'Leave this tab in front until it finishes.';

  rec.start(250);
  seek(0);
  play(0);

  await new Promise(res => setTimeout(res, (S.duration + 0.4) * 1000));
  stop();
  rec.stop();
  await done;
  for (const t of tracks) t.stop();
  if (ctx) { try { await ctx.close(); } catch { /* already closed */ } }

  btn.classList.remove('rec');
  btn.disabled = false;
  btn.textContent = 'Record WebM';

  const blob = new Blob(chunks, { type: type || 'video/webm' });
  save(blob, `${slug()}-cased.webm`);
  recNote.textContent = `Saved ${(blob.size / 1e6).toFixed(1)} MB. `
    + 'For 1080p with exact frames, use the spec and FFmpeg.';
});

// Prefill from ?repo= so a link can carry the repository, and ?creative=1 or
// ?duration= so a link can carry the whole setup.
const q = new URLSearchParams(location.search);
if (q.get('repo')) $('#repo').value = q.get('repo');
if (q.get('duration')) setDuration(Number(q.get('duration')) || 24);
if (q.get('invent') === '1') {
  S.invented = true;
  $('#invented').setAttribute('aria-pressed', 'true');
}
if (q.get('creative') === '1') {
  S.creative = true;
  $('#creative').setAttribute('aria-pressed', 'true');
  if (!q.get('duration')) setDuration(60);
}
setDuration($('#duration').value);
$('#gh-hint').textContent = ghInput.value.trim()
  ? 'Loaded from this browser.'
  : 'Without a token GitHub allows 60 requests an hour, shared by everything here.';
budgetNote();

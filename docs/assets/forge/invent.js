// Let the model design the graphics.
//
// Everything else in this project picks from a library someone already wrote.
// That is why two films about different repositories still rhyme: the shot
// types are the same twenty compositions in a different order. This asks
// gpt-oss-120b to design shots for *this* project and write the code for them,
// so the same repository filmed twice can genuinely differ.
//
// Three things make that safe enough to ship:
//
//   The frame it runs in has nothing to steal. It is sandboxed to an opaque
//   origin, so the page's Groq key and GitHub token are unreachable, and its
//   CSP sets connect-src 'none', so there is nowhere to send anything anyway.
//
//   The model writes compositions, never facts. It is handed the measured
//   numbers and may only arrange them; everything it writes still goes through
//   the same guard that drops a line quoting a number nobody measured.
//
//   Nothing it writes is trusted to work. Every generated shot is registered,
//   rendered at several points, and checked for whether it drew anything,
//   whether it threw, and whether the same time twice gives the same frame.
//   Anything that fails is dropped and a built-in takes the beat.

import { MODEL, GroqError, scrubCopy, factsFor } from './groq.js';

const API = 'https://api.groq.com/openai/v1';

async function chat(key, messages, { maxTokens = 3000, temperature = 0.7 } = {}) {
  let res;
  try {
    res = await fetch(API + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, temperature, max_tokens: maxTokens,
        response_format: { type: 'json_object' }, messages,
      }),
    });
  } catch { throw new GroqError('could not reach api.groq.com', 0); }
  if (res.status === 401) throw new GroqError('that key was rejected', 401);
  if (res.status === 429) throw new GroqError('rate limited by Groq', 429);
  if (!res.ok) throw new GroqError(`Groq returned ${res.status}`, res.status);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content || '';
  try { return JSON.parse(text); }
  catch { throw new GroqError('Groq did not return JSON', 0); }
}

// --------------------------------------------------------------- the plan

const PLAN_SYSTEM = `You are directing a short film about one software project.

You will be given measured facts about it, the shot types already available,
and the palette the film uses. Design the edit.

You may do two things:
  - use an existing shot type, by name
  - invent a new one, by describing what it draws

Invent where the project has something the library has no shape for. Do not
invent a bar chart; there is one. Invent when the facts suggest a picture
nobody wrote yet.

Hard rules:
- Never state a number, percentage, duration or quantity that is not in the
  facts you were given. Do not estimate, do not write "10x" or "millions".
- Never claim a feature or integration the facts do not mention.
- Plain words. No exclamation marks, no "revolutionary", "seamless", "unleash".
- A headline may wrap one phrase in *asterisks* to set it in the accent italic.

Reply with JSON:
{
  "look": "one sentence on the visual idea holding the film together",
  "shots": [
    { "use": "<existing shot type>", "data": { ... }, "weight": 1.2,
      "caption": "short line for the lower caption" },
    { "invent": "genSomething", "draws": "what it shows and how it moves",
      "data": { ... }, "weight": 1.4, "caption": "..." }
  ]
}

Between 8 and 16 shots. "data" must contain only values taken from the facts.
Weights are 0.7 to 1.8 and decide how long each shot holds.`;

const CODE_SYSTEM = `You write one shot for a deterministic film renderer.

Reply with JSON: { "source": "<a JavaScript arrow function expression>" }

The source must evaluate to exactly this shape:

  (d, api) => {
    // build DOM once, here
    return { node, update(lt) { /* set styles from lt */ } };
  }

- \`d\` is the data object given in the brief.
- \`node\` must be api.el('div', 'layer') with children appended to it.
- \`update(lt)\` is called with lt from 0 to 1 across the shot. THE ONLY INPUT
  IS lt. The renderer asks for frames in any order and expects the same pixels
  every time, so update must be a pure function of lt. No clock, no random, no
  counters that accumulate across calls.
- Build the DOM once outside update. update only sets style properties.

api gives you, and nothing else:
  el(tag, className, text)  create an element ('layer' is the root class)
  px(n)                     a CSS length scaled to the frame; ALWAYS use it
  esc(s)                    escape text
  seg(lt, a, b, ease)       0..1 eased between a and b   (ease optional)
  E                         { out, expo, lin, back, bounce } easings
  clamp(v, lo, hi) lerp(a, b, t) rng(seed)
  stage                     { W, H, vertical, light, serif, theme }

CSS variables available: var(--bg) var(--fg) var(--accent) var(--accent2)
var(--muted) var(--line). Use them; never hard-code a colour.

Positioning: the root is absolutely positioned over the full frame. Use
percentages or px() values. Keep content inside 8% margins.

Forbidden, and they are undefined so they will throw: window, document, parent,
top, self, globalThis, fetch, setTimeout, requestAnimationFrame, Date,
localStorage, Function, performance. Math.random is rejected outright.

Write real code. No placeholders, no comments promising more.`;

/** A short description of what the library already has, for the planner. */
function catalogue(shotTypes) {
  return shotTypes.join(', ');
}

/**
 * Ask for the edit. Returns { look, shots } with every number checked against
 * the facts before it can reach the screen.
 */
export async function planFilm({ story, insight, frontend, themeName, shotTypes, duration },
                               key, onStep) {
  const facts = factsFor(story, frontend);
  if (insight) {
    facts.architecture = {
      modules: insight.modules?.length || 0,
      imports: insight.edges?.length || 0,
      hub: insight.hub || '',
      layers: insight.layers || [],
      techniques: (insight.techniques || []).map(t => t.name),
      pipeline: (insight.pipeline || []).map(p => p.name),
      signature: insight.signature?.name
        ? { name: insight.signature.name, module: insight.signature.module,
            doc: insight.signature.doc }
        : null,
    };
  }

  onStep?.('asking for the edit');
  const plan = await chat(key, [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: [
      'Facts:', JSON.stringify(facts, null, 1), '',
      `Runtime: ${duration} seconds.`,
      `Palette: ${themeName}.`,
      `Shot types already available: ${catalogue(shotTypes)}`,
    ].join('\n') },
  ], { maxTokens: 4000, temperature: 0.8 });

  // Captions and headlines go through the same guard as any other copy: a
  // number the facts do not contain does not reach the screen.
  const shots = [];
  const dropped = [];
  for (const shot of (plan.shots || []).slice(0, 18)) {
    const lines = [shot.caption, shot.data?.title, shot.data?.text, shot.data?.heading]
      .filter(x => typeof x === 'string');
    const { dropped: bad } = scrubCopy(lines, facts);
    if (bad.length) {
      dropped.push(...bad);
      for (const b of bad) {
        if (shot.caption === b.line) shot.caption = '';
        for (const k of ['title', 'text', 'heading']) {
          if (shot.data && shot.data[k] === b.line) shot.data[k] = '';
        }
      }
    }
    shots.push(shot);
  }
  return { look: plan.look || '', shots, dropped, facts };
}

/** Ask for the code for one invented shot. */
export async function drawShot(brief, key) {
  const out = await chat(key, [
    { role: 'system', content: CODE_SYSTEM },
    { role: 'user', content: [
      `Name: ${brief.invent}`,
      `It draws: ${brief.draws}`,
      `The data object it will receive:`, JSON.stringify(brief.data ?? {}, null, 1),
    ].join('\n') },
  ], { maxTokens: 2600, temperature: 0.6 });
  const src = String(out.source || '').trim();
  if (!src) throw new GroqError('Groq returned no source', 0);
  return src;
}

// ------------------------------------------------------- canonical data

/**
 * Fill a built-in shot's data from the measured story.
 *
 * The model is good at choosing which shot a beat wants and at writing the
 * line above it. It is not given the data contracts, and it should not be:
 * every figure in a cased film comes out of the analyzer, so letting a
 * language model supply them would be the one thing this project does not do.
 *
 * Left to itself it emits `stat` with a label and no value, which renders 0,
 * and `langs` with names and no shares, which renders names and blank space.
 * So the model's copy is kept -- titles, captions, the phrasing it chose --
 * and every number is replaced with the real one.
 *
 * A type with no builder here keeps whatever the model sent; the probe then
 * decides whether it draws.
 */
export function canonicalData(type, given, { story, insight }) {
  const d = { ...(given || {}) };
  const stats = story.stats || {};
  const langs = story.languages || [];
  const hl = story.highlights || [];
  const tl = story.timeline || [];
  const moments = story.code_moments || [];
  const ins = insight || {};
  const keepTitle = (fallback) => d.title || fallback;

  switch (type) {
    case 'stat': {
      // Match the label the model asked for against a measured highlight,
      // rather than inventing a number to sit under it.
      const want = String(d.label || '').toLowerCase();
      const hit = hl.find(h => want && h.label.toLowerCase().includes(want.split(' ')[0]))
               || hl[0];
      if (!hit) return null;
      return { value: hit.value, label: hit.label };
    }
    case 'langs':
      if (langs.length < 2) return null;
      return { title: keepTitle('built with'),
               items: langs.slice(0, 5).map(l => ({ name: l.name, share: l.share, color: l.color })) };
    case 'tree': {
      const rows = (ins.tree || story.tree || []).filter(t => t.path);
      if (rows.length < 3) return null;
      return { title: keepTitle('what is in here'), items: rows.slice(0, 8) };
    }
    case 'timeline':
      if (tl.length < 3) return null;
      return { title: keepTitle('how it got here'), items: tl.slice(-4) };
    case 'bullets': {
      const items = (story.features || []).slice(0, 5);
      // The model may have written better bullets than the README; keep them
      // if it did, since they already passed the number guard.
      const mine = Array.isArray(d.items) ? d.items.filter(x => typeof x === 'string') : [];
      const use = mine.length >= 2 ? mine.slice(0, 5) : items;
      if (use.length < 2) return null;
      return { title: keepTitle('what it does'), items: use };
    }
    case 'code': case 'callout': {
      const m = moments.find(x => x.path === d.path) || moments[0];
      if (!m || !m.code) return null;
      return type === 'code'
        ? { path: m.path, code: m.code, caption: d.caption || m.caption || '', dur: 3.2 }
        : { path: m.path, code: m.code.slice(0, 13), highlight: 0,
            label: d.label || 'the idea', note: d.note || m.caption || '' };
    }
    case 'heatmap': {
      const days = ins.cadence || [];
      if (days.filter(Boolean).length < 12) return null;
      return { title: keepTitle('the last six months'), days, note: ins.peak_day || '' };
    }
    case 'kpi': {
      const items = hl.slice(0, 4).map(h => ({ label: h.label, value: h.value }));
      if (!items.length) return null;
      return { title: keepTitle(''), items };
    }
    case 'arch': {
      const mods = ins.modules || [];
      if (mods.length < 4) return null;
      const linked = mods.filter(m => m.deg_in || m.deg_out);
      const pool = linked.length >= 4 ? linked : mods;
      const nodes = pool.slice().sort((a, b) =>
        (b.deg_in * 3 + b.deg_out) - (a.deg_in * 3 + a.deg_out)).slice(0, 12);
      const idx = new Map(nodes.map((m, i) => [m.id, i]));
      const edges = [];
      for (const [a, b] of ins.edges || []) {
        const ia = mods[a]?.id, ib = mods[b]?.id;
        if (idx.has(ia) && idx.has(ib)) edges.push([idx.get(ia), idx.get(ib)]);
      }
      return { title: keepTitle('architecture'),
               nodes: nodes.map(m => ({ label: m.label, hub: m.id === ins.hub })),
               edges: edges.slice(0, 22),
               note: `${mods.length} modules, ${(ins.edges || []).length} imports between them` };
    }
    case 'flow':
      if ((ins.pipeline || []).length < 3) return null;
      return { title: keepTitle('how it runs'), items: ins.pipeline.slice(0, 5) };
    case 'constellation':
      if ((ins.techniques || []).length < 3) return null;
      return { title: keepTitle('techniques in the source'),
               items: ins.techniques.slice(0, 8).map(t => ({ name: t.name })) };
    case 'globe':
      return { kicker: d.kicker || 'available now',
               text: d.text || 'Ship it anywhere',
               sub: story.license ? `Open source \u00b7 ${story.license}` : 'Clone it and run it.' };
    case 'endcard':
      return { name: story.name, sub: story.url || story.repo || '',
               cta: 'made with cased2.0' };
    default:
      return d;
  }
}

// ----------------------------------------------------------- validation

/**
 * Register a generated shot and prove it works before it is allowed into a
 * film: it must compile, draw something, not throw, and give the same frame
 * when the same time is asked for twice.
 *
 * `call` is the host's postMessage wrapper for the sandboxed engine frame.
 */
export async function validateShot(call, { name, source, data, theme }) {
  if (source) {
    const reg = await call('register', { name, source }).then(
      () => ({ ok: true }), e => ({ ok: false, error: e.message }));
    if (!reg.ok) return { ok: false, stage: 'compile', error: reg.error };
  }

  const probeSpec = {
    version: '2.0', project: 'probe', fps: 30, width: 1920, height: 1080,
    duration: 2, seed: 1, theme,
    shots: [{ type: name, data: data || {}, start: 0, dur: 2,
              bg: theme.bg_mode, cam: 'none', in: 'cut', energy: 0.3, fx: [] }],
  };
  try { await call('load', { spec: probeSpec }, 20000); }
  catch (e) { return { ok: false, stage: 'load', error: e.message }; }

  let report;
  try { report = await call('probe', { times: [0.15, 0.5, 0.85] }, 20000); }
  catch (e) { return { ok: false, stage: 'probe', error: e.message }; }

  const threw = report.find(r => r.error);
  if (threw) return { ok: false, stage: 'render', error: threw.error };
  const drew = Math.max(...report.map(r => r.visible || 0));
  if (drew < 2) return { ok: false, stage: 'blank', error: 'drew nothing' };
  // A shot handed a field it did not understand draws happily and prints the
  // word. Only the text on screen says so.
  const ph = report.find(r => r.placeholder);
  if (ph) {
    return { ok: false, stage: 'placeholder',
             error: `printed "${ph.placeholder}" where a value should be` };
  }
  const drift = report.find(r => r.stable === false);
  if (drift) {
    return { ok: false, stage: 'determinism',
             error: `frame at ${drift.t} differs when asked for twice` };
  }
  // A shot whose frames never change is a still, not a shot. Only applied to
  // generated code: a built-in that holds steady mid-shot is a design choice.
  if (source) {
    const sigs = new Set(report.map(r => r.sig));
    if (sigs.size < 2) return { ok: false, stage: 'static', error: 'never animates' };
  }

  return { ok: true, visible: drew };
}

/**
 * The whole invented path: plan, write the novel shots, keep the ones that
 * survive, and report what happened to the rest.
 */
export async function invent({ story, insight, frontend, themeName, theme, shotTypes,
                               duration, call }, key, onStep) {
  const plan = await planFilm(
    { story, insight, frontend, themeName, shotTypes, duration }, key, onStep);

  const kept = [];
  const rejected = [];
  for (const shot of plan.shots) {
    if (shot.use) {
      if (!shotTypes.includes(shot.use)) {
        rejected.push({ name: shot.use, stage: 'unknown', error: 'no such shot type' });
        continue;
      }
      // The model chose the shot; the data comes from the analyzer. Left to
      // itself it sends `stat` a label with no value, which renders 0.
      const data = canonicalData(shot.use, shot.data, { story, insight });
      if (!data) {
        rejected.push({ name: shot.use, stage: 'no evidence',
                        error: 'the repository has nothing to put in it' });
        onStep?.(`${shot.use} dropped: nothing measured to fill it`);
        continue;
      }
      const verdict = await validateShot(call, { name: shot.use, data, theme });
      if (verdict.ok) kept.push({ ...shot, data });
      else {
        rejected.push({ name: shot.use, ...verdict });
        onStep?.(`${shot.use} rejected: ${verdict.stage} \u2014 ${verdict.error}`);
      }
      continue;
    }
    if (!shot.invent) continue;
    const name = /^gen[A-Za-z0-9_]{1,40}$/.test(shot.invent)
      ? shot.invent : 'gen' + String(shot.invent).replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
    onStep?.(`drawing ${name}`);
    let source;
    try { source = await drawShot({ ...shot, invent: name }, key); }
    catch (e) { rejected.push({ name, stage: 'write', error: e.message }); continue; }

    const verdict = await validateShot(call, { name, source, data: shot.data, theme });
    if (verdict.ok) {
      kept.push({ ...shot, invent: name, type: name, source });
      onStep?.(`${name} drew ${verdict.visible} elements and held still`);
    } else {
      rejected.push({ name, ...verdict });
      onStep?.(`${name} rejected: ${verdict.stage} — ${verdict.error}`);
    }
  }
  return { ...plan, kept, rejected };
}

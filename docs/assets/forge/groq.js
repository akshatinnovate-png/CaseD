// Groq, for the copy only.
//
// Two rules shape this whole module.
//
// The key is the user's. It is typed into the page, kept in their own browser,
// and sent to exactly one place: api.groq.com. It is never logged, never put
// in a URL, and never travels to this site's origin — there is no backend to
// send it to, which is the point.
//
// The model writes words, never facts. Every number in a cased film is
// measured from the repository, and a language model asked for "impressive
// stats" will cheerfully produce benchmarks that do not exist. So the model is
// given the measured facts and allowed to choose and rephrase lines; anything
// it returns carrying a number that is not already in those facts is rejected,
// by `scrubCopy` below, and the measured line is kept instead. The film is
// identical in structure with or without a key.

const API = 'https://api.groq.com/openai/v1';
const KEY_STORE = 'cased.groq.key';

/** Models to prefer, best first. Availability is checked at run time, because
 *  hosted model names come and go faster than a static page can track. */
const PREFERRED = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'moonshotai/kimi-k2-instruct',
  'qwen/qwen3-32b',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

export class GroqError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// --------------------------------------------------------------------- key

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

export function setKey(k) {
  try {
    const v = String(k || '').trim();
    if (v) localStorage.setItem(KEY_STORE, v);
    else localStorage.removeItem(KEY_STORE);
    return true;
  } catch { return false; }   // private mode, blocked storage: run keyless
}

export function clearKey() { return setKey(''); }

/** Groq keys are `gsk_` followed by a long opaque string. */
export const looksLikeKey = k => /^gsk_[A-Za-z0-9]{20,}$/.test(String(k || '').trim());

// ------------------------------------------------------------------- calls

async function call(path, key, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // A blocked host, an offline browser and a CORS refusal all land here.
    throw new GroqError('could not reach api.groq.com', 0);
  }
  if (res.status === 401) throw new GroqError('that key was rejected', 401);
  if (res.status === 429) throw new GroqError('rate limited by Groq', 429);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* no body */ }
    throw new GroqError(detail || `Groq returned ${res.status}`, res.status);
  }
  return res.json();
}

export async function listModels(key) {
  const j = await call('/models', key, null);
  return (j.data || []).map(m => m.id).filter(Boolean);
}

export function pickModel(available) {
  for (const want of PREFERRED) if (available.includes(want)) return want;
  // Prefer something instruction-tuned over an audio or guard model.
  const text = available.filter(m => !/whisper|tts|guard|vision|embed/i.test(m));
  return text[0] || available[0] || PREFERRED[0];
}

/** Confirm a key works, and report which model it will use. */
export async function checkKey(key) {
  const models = await listModels(key);
  return { ok: true, model: pickModel(models), models: models.length };
}

// ------------------------------------------------------------- the honesty guard

/**
 * Numeric tokens, with their units attached.
 *
 * The unit is part of the claim: "2" and "2M" are not the same statement, and
 * neither are "100" and "100ms". Matching bare digits lets a model smuggle
 * "2M requests a second" past the guard on the strength of a repository that
 * happens to have 2 commits — which is exactly what the first version of this
 * did. So a token is the digits plus whatever is welded to them.
 */
const NUM_TOKEN = /\d[\d,._]*(?:[a-zA-Z%]+)?/g;

const normalise = tok => String(tok).toLowerCase().replace(/[,_]/g, '').replace(/\.+$/, '');

function allowedNumbers(facts) {
  const ok = new Set();
  const note = tok => {
    const n = normalise(tok);
    if (!n) return;
    ok.add(n);
    // Shares in this data are percentages, so a measured 55.2 also licenses
    // "55.2%" on screen. Nothing else gains a unit it was not measured with.
    if (/^[\d.]+$/.test(n)) ok.add(n + '%');
  };
  const walk = v => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') {
      note(String(v));
      if (Number.isFinite(v) && !Number.isInteger(v)) note(String(Math.round(v)));
      return;
    }
    if (typeof v === 'string') { for (const m of v.matchAll(NUM_TOKEN)) note(m[0]); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  return ok;
}

/**
 * Drop any line carrying a number the facts do not contain.
 *
 * This is the guard that keeps the film honest. Asked to make copy punchy, a
 * model will write "10x faster" or "2M requests a second" without being asked
 * for a benchmark at all, and on screen that is indistinguishable from a
 * measurement. Rather than trusting a prompt not to, every candidate line is
 * checked against the numbers actually measured from the repository.
 *
 * Returns { kept, dropped } so the page can say what it threw away.
 */
export function scrubCopy(lines, facts) {
  const ok = allowedNumbers(facts);
  const kept = [], dropped = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    let bad = null;
    for (const m of line.matchAll(NUM_TOKEN)) {
      const tok = normalise(m[0]);
      if (!tok || ok.has(tok)) continue;
      // A bare integer that the facts hold in some other unit is still a
      // number the facts never measured, so it goes too.
      bad = m[0];
      break;
    }
    if (bad) dropped.push({ line, number: bad });
    else kept.push(line);
  }
  return { kept, dropped };
}

// ----------------------------------------------------------------- enrich

const SYSTEM = `You write copy for short launch films about software projects.

You will be given measured facts about one repository: its name, description,
languages, file counts, commit history, README features and the colours its
frontend actually ships.

Rules you must follow:
- Never state a number, benchmark, percentage, duration or quantity that is
  not already present in the facts you were given. Do not estimate. Do not
  write "10x", "millions", "sub-second" or similar.
- Never claim a feature, integration or user that the facts do not mention.
- Write in plain words. No exclamation marks, no "revolutionary", no
  "game-changing", no "seamless", no "unleash", no emoji.
- Short lines. A title card is read in two seconds.

Reply with JSON only, matching this shape:
{
  "hook": "6-9 words, the first thing on screen",
  "what_it_is": "one sentence, under 110 characters",
  "features": ["3 to 5 items, each under 48 characters"],
  "closing": "3-6 words for the end card",
  "director": "one of the director names you were given",
  "theme_reason": "one short sentence on why the chosen theme suits this project"
}`;

/** The facts the model is allowed to work from — and nothing else. */
export function factsFor(story, frontend) {
  return {
    name: story.name,
    full_name: story.full_name || story.repo || '',
    description: story.description || '',
    tagline: story.tagline || '',
    topics: (story.topics || []).slice(0, 10),
    license: story.license || '',
    languages: (story.languages || []).slice(0, 5)
      .map(l => ({ name: l.name, share: l.share })),
    stats: story.stats || {},
    highlights: story.highlights || [],
    readme_features: (story.features || []).slice(0, 8),
    readme_claims: (story.claims || []).slice(0, 6),
    recent_commits: (story.timeline || []).map(t => t.text).slice(0, 6),
    frontend: frontend ? {
      frameworks: (frontend.frameworks || []).map(f => f.name),
      palette: frontend.palette ? {
        bg: frontend.palette.bg, fg: frontend.palette.fg,
        accent: frontend.palette.accent, dark: frontend.palette.dark,
      } : null,
    } : null,
  };
}

/**
 * Ask Groq for the copy. Returns the same shape `offlineCopy` does, so the
 * caller never branches on whether a key was present.
 */
export async function enrich({ story, frontend, directors, theme }, key, opts = {}) {
  const facts = factsFor(story, frontend);
  const model = opts.model || pickModel(await listModels(key));
  const prompt = [
    `Facts (JSON):`, JSON.stringify(facts, null, 1), '',
    `Director names you may choose from: ${Object.keys(directors || {}).join(', ')}`,
    theme ? `The theme chosen for this film is "${theme}".` : '',
  ].filter(Boolean).join('\n');

  const j = await call('/chat/completions', key, {
    model,
    temperature: 0.4,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
  });

  const text = j.choices?.[0]?.message?.content || '';
  let out;
  try { out = JSON.parse(text); } catch { throw new GroqError('Groq did not return JSON', 0); }

  // Everything the model wrote goes through the guard before it can reach the
  // screen, and anything it drops falls back to the measured copy.
  const base = offlineCopy(story);
  const single = (v, fallback) => {
    const { kept } = scrubCopy([v], facts);
    return kept[0] || fallback;
  };
  const feats = scrubCopy(Array.isArray(out.features) ? out.features : [], facts);
  const dropped = [
    ...scrubCopy([out.hook, out.what_it_is, out.closing], facts).dropped,
    ...feats.dropped,
  ];

  return {
    source: 'groq',
    model,
    hook: single(out.hook, base.hook),
    what_it_is: single(out.what_it_is, base.what_it_is),
    features: feats.kept.length >= 2 ? feats.kept.slice(0, 5) : base.features,
    closing: single(out.closing, base.closing),
    director: (directors && directors[out.director]) ? out.director : base.director,
    theme_reason: single(out.theme_reason, ''),
    dropped,
  };
}

/**
 * The copy with no key and no network: taken straight from the analyzer.
 * This is the default path, not a degraded one — the structure, the cuts and
 * the numbers are the same either way.
 */
export function offlineCopy(story) {
  const tag = (story.tagline || story.description || '').trim().replace(/\.+$/, '');
  return {
    source: 'measured',
    model: null,
    hook: tag && tag.length <= 72 ? tag : story.name,
    // Hand over the whole description. Slicing it here cut the sentence
    // mid-word and left the composer nothing to recognise as too long, so the
    // card rendered a fragment with no ellipsis. Trimming is the composer's
    // job — it knows the hook has already been shown and what the card fits.
    what_it_is: story.description || tag || '',
    features: (story.features || []).slice(0, 5),
    closing: 'made with cased2.0',
    director: null,
    theme_reason: '',
    dropped: [],
  };
}

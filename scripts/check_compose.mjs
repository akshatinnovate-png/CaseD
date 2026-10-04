// Verify docs/assets/forge/compose.js against cased/compose.py.
//
// Runs the real analyzer on this repository to get a story, then composes the
// same film through both implementations and diffs the specs. The cut times
// are the part that matters: if the browser snapped differently, the preview
// would not be the film the CLI renders.
//
//   node scripts/check_compose.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** JSON null is not Python None, so interpolate literals the way Python reads them. */
const py = v => v === null || v === undefined ? 'None' : JSON.stringify(v);
const { compose } = await import(join(ROOT, 'docs/assets/forge/compose.js'));
const { composeScore } = await import(join(ROOT, 'docs/assets/forge/score.js'));

const themes = JSON.parse(readFileSync(join(ROOT, 'docs/assets/themes.json'), 'utf8'));
const directors = JSON.parse(readFileSync(join(ROOT, 'docs/assets/directors.json'), 'utf8'));

const CASES = [
  // Creative mode: the long-form arc, driven by the Python insight report so
  // both sides plan from identical evidence. (The browser's own insight layer
  // reads fewer files and has no Python AST, which is checked separately —
  // this case is about the composer agreeing on the arc it builds.)
  { duration: 60, director: null, theme: null, seed: 7, creative: true },
  { duration: 90, director: 'creative', theme: 'ember', seed: 4, creative: true },
  // The atlas director draws the repo as a product and turns the frame
  // furniture on, so it exercises a different plan builder entirely.
  { duration: 34, director: 'atlas', theme: null, seed: 7 },
  { duration: 60, director: 'atlas', theme: 'inkwell', seed: 3, creative: true },
  { duration: 24, director: null, theme: null, seed: 7 },
  { duration: 24, director: 'brutalist', theme: 'hotpink', seed: 7 },
  { duration: 60, director: 'cinematic', theme: 'daylight', seed: 3 },
  { duration: 12, director: 'hype', theme: 'neon', seed: 11 },
  { duration: 40, director: 'terminal', theme: 'phosphor', seed: 2 },
  { duration: 8,  director: 'orbit', theme: 'abyss', seed: 5 },
];

let failures = 0;

for (const c of CASES) {
  const out = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
from pathlib import Path
from cased.analyze import analyze
from cased import score, compose as comp
story_obj = analyze(Path(${JSON.stringify(ROOT)}), seed=${c.seed})
story = json.loads(story_obj.to_json())
insight = None
if ${c.creative ? 'True' : 'False'}:
    from cased.insight import inspect
    insight = json.loads(inspect(Path(${JSON.stringify(ROOT)}), story).to_json())
buf, bm = score.compose_score(${c.duration}, "cinematic", ${c.seed}, 1.0)
spec = comp.compose(story, bm, duration=${c.duration},
                    director=${py(c.director)},
                    theme=${py(c.theme)}, seed=${c.seed}, insight=insight)
print(json.dumps({"story": story, "spec": spec, "insight": insight}))
`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

  const story = out.story;
  const { beatmap } = composeScore(c.duration, 'cinematic', c.seed, 1.0);
  const got = compose(story, beatmap, { ...c, themes, directors, insight: out.insight });
  const want = out.spec;

  const label = `${c.creative ? 'creative ' : ''}${c.duration}s `
    + `${c.director || 'auto'}/${c.theme || 'auto'} seed=${c.seed}`;
  const bad = [];

  for (const k of ['project', 'director', 'director_label', 'mode', 'seed',
                   'fps', 'width', 'height', 'duration', 'theme_name',
                   'hud', 'hud_label']) {
    if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) {
      bad.push(`${k}: py ${JSON.stringify(want[k])} vs js ${JSON.stringify(got[k])}`);
    }
  }
  if (JSON.stringify(want.theme) !== JSON.stringify(got.theme)) bad.push('theme spec differs');
  if (JSON.stringify(want.share) !== JSON.stringify(got.share)) {
    for (const k of Object.keys(want.share)) {
      if (want.share[k] !== got.share[k]) {
        bad.push(`share.${k}:\n         py ${JSON.stringify(want.share[k])}\n         js ${JSON.stringify(got.share[k])}`);
      }
    }
  }

  if (want.shots.length !== got.shots.length) {
    bad.push(`shot count: py ${want.shots.length} vs js ${got.shots.length}`);
  } else {
    for (let i = 0; i < want.shots.length; i++) {
      const a = want.shots[i], b = got.shots[i];
      for (const k of ['type', 'start', 'dur', 'bg', 'cam', 'in', 'energy',
                       'section', 'chapter', 'caption', 'sample']) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          bad.push(`shot[${i}].${k}: py ${JSON.stringify(a[k])} vs js ${JSON.stringify(b[k])}`);
        }
      }
      if (JSON.stringify(a.fx) !== JSON.stringify(b.fx)) bad.push(`shot[${i}].fx differs`);
      if (JSON.stringify(a.data) !== JSON.stringify(b.data)) {
        bad.push(`shot[${i}](${a.type}).data differs:\n         py ${JSON.stringify(a.data).slice(0, 180)}\n         js ${JSON.stringify(b.data).slice(0, 180)}`);
      }
    }
  }

  const ok = !bad.length;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(36)} ${got.shots.length} shots, ` +
              `cuts [${got.shots.map(s => s.start.toFixed(2)).join(' ')}]`);
  for (const b of bad.slice(0, 10)) console.log(`       ${b}`);
  if (bad.length > 10) console.log(`       ... and ${bad.length - 10} more`);
}

console.log(failures
  ? `FAIL ${failures}/${CASES.length} cases`
  : `all ${CASES.length} cases match cased/compose.py`);
process.exit(failures ? 1 : 0);

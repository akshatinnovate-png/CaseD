// Verify docs/assets/forge/score.js against cased/score.py.
//
// Renders the same seed, mood and duration through both and compares the beat
// map field by field and the 16-bit WAV sample by sample. The web preview and
// the CLI must agree, or "same seed, same film" is only true within one of them.
//
//   node scripts/check_score.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { composeScore, toStereo16 } = await import(join(ROOT, 'docs/assets/forge/score.js'));

const CASES = [
  { duration: 24, mood: 'cinematic', seed: 7, intensity: 1.0 },
  { duration: 12, mood: 'brutalist', seed: 3, intensity: 0.9 },
  { duration: 60, mood: 'hype', seed: 11, intensity: 1.0 },
  { duration: 8,  mood: 'warm', seed: 5, intensity: 0.8 },
  { duration: 45, mood: 'triumphant', seed: 2, intensity: 1.0 },
  { duration: 30, mood: 'retro', seed: 19, intensity: 0.95 },
];

const tmp = mkdtempSync(join(tmpdir(), 'cased-score-'));
let failures = 0;

for (const c of CASES) {
  const wav = join(tmp, `${c.mood}-${c.seed}.wav`);
  const bmJson = execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
from pathlib import Path
from cased import score
buf, bm = score.compose_score(${c.duration}, ${JSON.stringify(c.mood)}, ${c.seed}, ${c.intensity})
score.write_wav(buf, Path(${JSON.stringify(wav)}))
print(json.dumps(bm))
`], { encoding: 'utf8' });

  const want = JSON.parse(bmJson);
  const { bus, beatmap: got } = composeScore(c.duration, c.mood, c.seed, c.intensity);

  const label = `${c.mood} seed=${c.seed} ${c.duration}s`;
  const bad = [];

  for (const k of ['bpm', 'spb', 'bar', 'scale', 'root_midi', 'duration']) {
    if (String(want[k]) !== String(got[k])) bad.push(`${k}: py ${want[k]} vs js ${got[k]}`);
  }
  for (const k of ['bars', 'beats', 'kicks']) {
    if (want[k].length !== got[k].length) { bad.push(`${k}: ${want[k].length} vs ${got[k].length}`); continue; }
    const off = want[k].findIndex((v, i) => Math.abs(v - got[k][i]) > 1e-6);
    if (off >= 0) bad.push(`${k}[${off}]: py ${want[k][off]} vs js ${got[k][off]}`);
  }
  if (JSON.stringify(want.sections) !== JSON.stringify(got.sections)) {
    bad.push(`sections: py ${JSON.stringify(want.sections)} vs js ${JSON.stringify(got.sections)}`);
  }
  if (JSON.stringify(want.accents) !== JSON.stringify(got.accents)) bad.push('accents differ');

  // Sample comparison against the WAV Python just wrote.
  const raw = readFileSync(wav);
  const pySamples = new Int16Array(raw.buffer, raw.byteOffset + 44,
                                   (raw.length - 44) / 2);
  const jsSamples = toStereo16(bus);
  let maxDiff = 0, nDiff = 0, firstDiff = -1;
  if (pySamples.length !== jsSamples.length) {
    bad.push(`sample count: py ${pySamples.length} vs js ${jsSamples.length}`);
  } else {
    for (let i = 0; i < pySamples.length; i++) {
      const d = Math.abs(pySamples[i] - jsSamples[i]);
      if (d) { nDiff++; if (firstDiff < 0) firstDiff = i; if (d > maxDiff) maxDiff = d; }
    }
  }

  const ppm = pySamples.length ? (nDiff / pySamples.length) * 1e6 : 0;
  const ok = !bad.length && maxDiff <= 2;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${pySamples.length} samples, ` +
              `${nDiff} differ (${ppm.toFixed(1)} ppm), max |delta| ${maxDiff}` +
              (firstDiff >= 0 ? `, first at ${firstDiff}` : ''));
  for (const b of bad) console.log(`       ${b}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures
  ? `FAIL ${failures}/${CASES.length} cases`
  : `all ${CASES.length} cases match cased/score.py`);
process.exit(failures ? 1 : 0);

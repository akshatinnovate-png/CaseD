// Verify docs/assets/forge/random.js against CPython's random.Random.
//
// The web preview and the CLI render must draw the same numbers or "same seed,
// same film" is false across the two. This regenerates ground truth by running
// the installed python3 and compares every draw.
//
//   node scripts/check_random.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PyRandom } = await import(join(ROOT, 'docs/assets/forge/random.js'));

const PY = `
import json, random
out = {}
for seed in (0, 1, 7, 42, 12345, 2**33 + 5):
    r = random.Random(seed or 1)
    out[str(seed)] = {
      "random": [r.random() for _ in range(6)],
      "randint_88_100": [r.randint(88, 100) for _ in range(6)],
      "choice5": [r.choice([45, 47, 48, 50, 52]) for _ in range(6)],
      "uniform": [r.uniform(-1.0, 1.0) for _ in range(4)],
      "getrandbits8": [r.getrandbits(8) for _ in range(6)],
      "randint_pow2": [r.randint(0, 3) for _ in range(6)],
      "tail": [r.random() for _ in range(3)],
    }
print(json.dumps(out))
`;

const truth = JSON.parse(execFileSync('python3', ['-c', PY], { encoding: 'utf8' }));

let checks = 0, bad = 0;
const eq = (a, b) => (typeof a === 'number' && !Number.isInteger(a)
  ? Math.abs(a - b) < 1e-15 : a === b);

for (const [seed, want] of Object.entries(truth)) {
  const r = new PyRandom(Number(seed) || 1);
  const got = {
    random: Array.from({ length: 6 }, () => r.random()),
    randint_88_100: Array.from({ length: 6 }, () => r.randint(88, 100)),
    choice5: Array.from({ length: 6 }, () => r.choice([45, 47, 48, 50, 52])),
    uniform: Array.from({ length: 4 }, () => r.uniform(-1, 1)),
    getrandbits8: Array.from({ length: 6 }, () => r.getrandbits(8)),
    randint_pow2: Array.from({ length: 6 }, () => r.randint(0, 3)),
    tail: Array.from({ length: 3 }, () => r.random()),
  };
  for (const k of Object.keys(want)) {
    for (let i = 0; i < want[k].length; i++) {
      checks++;
      if (!eq(want[k][i], got[k][i])) {
        bad++;
        if (bad <= 8) console.log(`  seed ${seed} ${k}[${i}]: python ${want[k][i]} !== js ${got[k][i]}`);
      }
    }
  }
}

console.log(bad
  ? `FAIL ${bad}/${checks} draws differ from CPython`
  : `ok  ${checks} draws match CPython exactly (6 seeds)`);
process.exit(bad ? 1 : 0);

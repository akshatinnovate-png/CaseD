// Verify the invented-number guard in docs/assets/forge/groq.js.
//
// When a Groq key is supplied, a language model writes the copy. Asked to make
// it punchy, models volunteer benchmarks nobody measured — and on a title card
// an invented number is indistinguishable from a real one. scrubCopy is what
// stops that, so it gets a test of its own.
//
// The first version matched bare digits and let "2M requests a second" through
// on the strength of a repository with 2 commits. These probes keep it honest.
//
//   node scripts/check_guard.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const g = await import(join(ROOT, 'docs/assets/forge/groq.js'));

// Facts measured from this repository, through the real analyzer.
const story = JSON.parse(execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})
from pathlib import Path
from cased.analyze import analyze
print(analyze(Path(${JSON.stringify(ROOT)}), seed=7).to_json())
`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

const facts = g.factsFor(story, null);
const loc = story.stats.loc;
const share = story.languages[0].share;
const lang = story.languages[0].name;

const PROBES = [
  // Lines with no numbers at all are always fine.
  ['keep', 'Turn a repository into a cinematic launch film'],
  ['keep', 'Cuts land on every beat'],
  ['keep', 'The soundtrack is generated, not licensed'],
  // Measured numbers, in either notation.
  ['keep', `${loc.toLocaleString('en-US')} lines of it`],
  ['keep', `${loc} lines of it`],
  ['keep', `${share}% ${lang}`],
  ['keep', `${story.stats.files} files`],
  // Invented scale, speed, adoption and precision.
  ['drop', '10x faster than the alternative'],
  ['drop', 'Handles 2M requests a second'],
  ['drop', 'Sub-100ms cold start'],
  ['drop', 'Trusted by 5,000 developers'],
  ['drop', '99.9% uptime'],
  ['drop', 'Renders in 4K'],
  ['drop', 'Saves 20 hours a week'],
  ['drop', 'Over 1M downloads'],
  ['drop', 'Three times smaller, 50% quicker'],
  ['drop', 'Used by 42 teams in production'],
  // A measured magnitude does not license a different unit on the same digits.
  ['drop', `${story.stats.commits}M commits`],
];

let bad = 0;
for (const [want, line] of PROBES) {
  const { kept } = g.scrubCopy([line], facts);
  const got = kept.length ? 'keep' : 'drop';
  if (got !== want) {
    bad++;
    console.log(`  BAD  ${got} (want ${want}): ${line}`);
  }
}

// A batch call must report what it threw away, so the page can say so.
const mixed = g.scrubCopy(['Cuts land on every beat', '10x faster'], facts);
if (mixed.kept.length !== 1 || mixed.dropped.length !== 1) {
  bad++;
  console.log(`  BAD  batch split: kept ${mixed.kept.length}, dropped ${mixed.dropped.length}`);
}
if (mixed.dropped[0] && mixed.dropped[0].number !== '10x') {
  bad++;
  console.log(`  BAD  dropped number reported as ${JSON.stringify(mixed.dropped[0].number)}`);
}

// With no key the copy comes from the analyzer, and must itself survive.
const off = g.offlineCopy(story);
const offLines = [off.hook, off.what_it_is, ...off.features, off.closing].filter(Boolean);
const offScrub = g.scrubCopy(offLines, facts);
if (offScrub.dropped.length) {
  bad++;
  console.log(`  BAD  measured copy fails its own guard: ` +
              offScrub.dropped.map(d => d.line).join(' | '));
}

console.log(bad
  ? `FAIL ${bad} guard checks wrong`
  : `ok  ${PROBES.length} probes + batch + offline copy all behave correctly`);
process.exit(bad ? 1 : 0);

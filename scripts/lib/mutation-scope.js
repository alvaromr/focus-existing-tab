// What a scoped mutation run re-runs (docs/DEVELOPMENT.md, "Tests"). Pure decisions over file
// contents passed in; scripts/mutation.js reads the files and runs Stryker.
//
// Stryker's command runner reports no per-test coverage, so its incremental mode cannot see a
// changed test: it would reuse every mutant in unchanged source. The scope closes that gap. It
// records, per unit test file, what the test depends on (itself, the relative modules it imports,
// transitively, and the files it reads); when any of those changed, the src/lib modules that test
// reaches are re-run.
import { createHash } from 'node:crypto';
import { dirname, join, normalize } from 'node:path';

export const INCREMENTAL = 'reports/stryker-incremental.json';
export const SCOPE = 'reports/mutation-scope.json';

/**
 * @typedef {Record<string, string>} Fingerprint what every mutant depends on
 * @typedef {{ fingerprint: Fingerprint, inputs: Record<string, string[]>, hashes: Record<string, string> }} Scope
 */

/** @param {string} text */
export const hashOf = (text) => createHash('sha256').update(text).digest('hex');

const IMPORT = /^import[^'"]*['"](\.[^'"]+)['"]/gm;
const READ = /new URL\(['"](\.[^'"]+)['"], import\.meta\.url\)/g;

/**
 * A test's inputs: itself, its relative imports (transitively) and the files it reads.
 * @param {string} test path from the repository root
 * @param {(path: string) => string} read
 */
export const inputsOf = (test, read) => {
  const seen = new Set([test]);
  const queue = [test];
  for (let file = queue.pop(); file; file = queue.pop()) {
    const text = read(file);
    for (const [, spec] of [...text.matchAll(IMPORT), ...text.matchAll(READ)]) {
      const path = normalize(join(dirname(file), spec));
      if (seen.has(path)) continue;
      seen.add(path);
      if (path.endsWith('.js')) queue.push(path);
    }
  }
  return [...seen].sort();
};

/**
 * What every mutant depends on: a change here invalidates every previous result.
 * @param {{ configText: string, strykerVersion: string, nodeVersion: string }} sources
 * @returns {Fingerprint}
 */
export const fingerprintOf = ({ configText, strykerVersion, nodeVersion }) => ({
  'stryker.config.json': hashOf(configText),
  '@stryker-mutator/core': strykerVersion,
  node: nodeVersion.split('.')[0],
});

/**
 * Why every mutant must run, or '' when a scoped run is enough.
 * @param {{ full: boolean, previous: Scope | undefined, fingerprint: Fingerprint }} state
 */
export const fullRunReason = ({ full, previous, fingerprint }) => {
  if (full) return 'requested with --full';
  if (!previous) return `no previous result (${INCREMENTAL})`;
  const changed = Object.keys(fingerprint).filter((key) => previous.fingerprint[key] !== fingerprint[key]);
  return changed.length ? `changed since the last run: ${changed.join(', ')}` : '';
};

/**
 * The tests whose inputs changed since the previous run (new and removed ones included), and the
 * src/lib modules they reach, whose stored results are stale.
 * @param {Scope} previous
 * @param {Record<string, string[]>} inputs the current inputs per test
 * @param {(path: string) => string} hash the current hash of a path ('missing' when absent)
 */
export const staleModules = (previous, inputs, hash) => {
  const all = [...new Set([...Object.keys(previous.hashes), ...Object.values(inputs).flat()])];
  const changed = new Set(all.filter((path) => previous.hashes[path] !== hash(path)));
  const affected = [
    ...Object.entries(inputs).filter(([test, paths]) => !previous.inputs[test] || paths.some((p) => changed.has(p))),
    ...Object.entries(previous.inputs).filter(([test]) => !inputs[test]),
  ];
  return {
    tests: affected.map(([test]) => test).sort(),
    modules: [...new Set(affected.flatMap(([, paths]) => paths.filter((p) => p.startsWith('src/lib/'))))].sort(),
  };
};

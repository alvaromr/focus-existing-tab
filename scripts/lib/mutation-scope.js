// What a scoped mutation run re-runs (docs/DEVELOPMENT.md, "Tests"). Pure decisions over file
// contents passed in; scripts/mutation.js reads the files and runs Stryker.
//
// Stryker's incremental mode re-runs a mutant when its own code or the body of a test covering it
// changed. It cannot see the rest of what a test depends on: code outside the test bodies (a
// helper at the top of the file), an imported helper or fixture, or another src/lib module the
// mutated one imports; it would reuse those mutants. The scope closes that gap. It records, per
// unit test file, what the test depends on (itself, the relative modules it imports, transitively,
// and the files it reads); when any of those changed, the src/lib modules that test reaches are
// re-run.
import { createHash } from 'node:crypto';
import { dirname, join, normalize } from 'node:path';

export const INCREMENTAL = 'reports/stryker-incremental.json';
export const SCOPE = 'reports/mutation-scope.json';

/**
 * @typedef {Record<string, string>} Fingerprint what every mutant depends on
 * @typedef {{ timeoutMS: number, timeoutFactor: number }} Timeout the per-mutant timeout's parts
 * @typedef {{ fingerprint: Fingerprint, timeout: Timeout, inputs: Record<string, string[]>, hashes: Record<string, string> }} Scope
 * @typedef {{ files: Record<string, { mutants: { status: string }[] }> }} Report Stryker's stored results
 */

/** @param {string} text */
export const hashOf = (text) => createHash('sha256').update(text).digest('hex');

const IMPORT = /^import[^'"]*['"](\.[^'"]+)['"]/gm;
// Vitest, the test runner, is the one package a test may import: its version is in the fingerprint.
const PACKAGE = /^import[^'"]*['"]((?!node:|vitest['"])[^.'"][^'"]*)['"]/gm;
const READ = /new URL\(['"](\.[^'"]+)['"], import\.meta\.url\)/g;

/**
 * A test's inputs: itself, its relative imports (transitively) and the files it reads. Any other
 * package import than Vitest throws: its version is not among the inputs, so a dependency upgrade
 * would go unseen.
 * @param {string} test path from the repository root
 * @param {(path: string) => string} read
 */
export const inputsOf = (test, read) => {
  const seen = new Set([test]);
  const queue = [test];
  for (let file = queue.pop(); file; file = queue.pop()) {
    const text = read(file);
    for (const [, name] of text.matchAll(PACKAGE)) {
      throw new Error(`${file} imports the package ${name}; scripts/lib/mutation-scope.js does not track its version`);
    }
    for (const [, spec] of [...text.matchAll(IMPORT), ...text.matchAll(READ)]) {
      const path = normalize(join(dirname(file), spec));
      if (seen.has(path)) continue;
      seen.add(path);
      if (path.endsWith('.js')) queue.push(path);
    }
  }
  return [...seen].sort();
};

// Stryker config keys that change neither which mutants exist nor how their tests run. `mutate`
// is among them because the incremental mode identifies each mutant by file, mutator, replacement
// and location: mutants new to the set run, and mutants gone from it are dropped. For the same
// reason the Stryker version is not in the fingerprint.
const INERT_CONFIG = new Set(['$schema', 'mutate', 'reporters', 'htmlReporter', 'tempDirName', 'thresholds']);
// The per-mutant timeout's parts, with Stryker's defaults. A change to them re-runs only the
// mutants it can flip (timeoutRerun), so they stay out of the fingerprint.
const DEFAULT_TIMEOUT = { timeoutMS: 5000, timeoutFactor: 1.5 };

/**
 * The per-mutant timeout a config sets, Stryker's default for each part it leaves out.
 * @param {Record<string, unknown>} config
 * @returns {Timeout}
 */
export const timeoutOf = (config) => ({
  timeoutMS: Number(config.timeoutMS ?? DEFAULT_TIMEOUT.timeoutMS),
  timeoutFactor: Number(config.timeoutFactor ?? DEFAULT_TIMEOUT.timeoutFactor),
});

/**
 * The statuses whose stored results a timeout change can flip: a shorter part, the survivors (they
 * may now time out); a longer one, the timed-out mutants (they may now survive).
 * @param {Timeout} previous
 * @param {Timeout} current
 */
export const timeoutRerun = (previous, current) => {
  const parts = /** @type {(keyof Timeout)[]} */ (Object.keys(DEFAULT_TIMEOUT));
  return [
    ...(parts.some((part) => current[part] < previous[part]) ? ['Survived'] : []),
    ...(parts.some((part) => current[part] > previous[part]) ? ['Timeout'] : []),
  ];
};

/**
 * Drops from the stored results every mutant with one of these statuses, so Stryker re-runs it.
 * @param {Report} report
 * @param {string[]} statuses
 * @returns {Report}
 */
export const withoutStatuses = (report, statuses) => ({
  ...report,
  files: Object.fromEntries(
    Object.entries(report.files).map(([file, result]) => [
      file,
      { ...result, mutants: result.mutants.filter((mutant) => !statuses.includes(mutant.status)) },
    ]),
  ),
});

/**
 * What every mutant depends on: how the tests run (any Stryker config key not known to be inert),
 * the Node major they run on and the Vitest version every test imports. A change here invalidates
 * every previous result.
 * @param {{ config: Record<string, unknown>, nodeVersion: string, vitestVersion: string }} sources
 * @returns {Fingerprint}
 */
export const fingerprintOf = ({ config, nodeVersion, vitestVersion }) => {
  const keys = Object.keys(config).filter((key) => !INERT_CONFIG.has(key) && !(key in DEFAULT_TIMEOUT));
  return {
    'stryker.config.json': hashOf(JSON.stringify(keys.sort().map((key) => [key, config[key]]))),
    node: nodeVersion.split('.')[0],
    vitest: vitestVersion,
  };
};

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

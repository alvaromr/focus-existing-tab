// Mutation testing, scoped by default: Stryker's incremental mode reuses the result of every mutant
// whose code and tests did not change since the last run. `pnpm mutation --full` runs every mutant.
//
// Stryker's command runner reports no per-test coverage, so its incremental mode cannot see a
// changed test: it would reuse every mutant in unchanged source. This script closes that gap. It
// records, per unit test file, what the test depends on (itself, the src/lib modules it imports,
// transitively, and the files it reads); when any of those changed, it drops the results of the
// src/lib modules that test reaches, so Stryker runs their mutants again. What every mutant depends
// on (the Stryker config and version, the Node major) triggers a full run, with the reason printed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { REPO_DIR } from './lib/cdp.js';

const INCREMENTAL = 'reports/stryker-incremental.json';
const SCOPE = 'reports/mutation-scope.json';

/** @param {string} path */
const read = (path) => readFileSync(join(REPO_DIR, path), 'utf8');
/** @param {string} path */
const hash = (path) =>
  existsSync(join(REPO_DIR, path)) ? createHash('sha256').update(read(path)).digest('hex') : 'missing';

/** What every mutant depends on: a change here invalidates every previous result. */
const fingerprint = () => ({
  'stryker.config.json': hash('stryker.config.json'),
  '@stryker-mutator/core': JSON.parse(read('node_modules/@stryker-mutator/core/package.json')).version,
  node: process.versions.node.split('.')[0],
});

const IMPORT = /^import[^'"]*['"](\.[^'"]+)['"]/gm;
const READ = /new URL\(['"](\.[^'"]+)['"], import\.meta\.url\)/g;

/** A test's inputs: itself, its relative imports (transitively) and the files it reads. @param {string} test */
const inputsOf = (test) => {
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

const tests = readdirSync(join(REPO_DIR, 'test'))
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => `test/${name}`);
/** @type {Record<string, string[]>} */
const inputs = Object.fromEntries(tests.map((test) => [test, inputsOf(test)]));
/** @param {string[]} paths */
const hashes = (paths) => Object.fromEntries(paths.map((path) => [path, hash(path)]));
const scope = { fingerprint: fingerprint(), inputs, hashes: hashes([...new Set(Object.values(inputs).flat())]) };

/** Why every mutant must run, or '' when a scoped run is enough. */
const fullRunReason = () => {
  if (process.argv.includes('--full')) return 'requested with --full';
  if (!existsSync(join(REPO_DIR, INCREMENTAL)) || !existsSync(join(REPO_DIR, SCOPE)))
    return `no previous result (${INCREMENTAL})`;
  /** @type {typeof scope} */
  const previous = JSON.parse(read(SCOPE));
  const changed = Object.entries(scope.fingerprint)
    .filter(([key, value]) => previous.fingerprint[/** @type {keyof typeof scope.fingerprint} */ (key)] !== value)
    .map(([key]) => key);
  return changed.length ? `changed since the last run: ${changed.join(', ')}` : '';
};

/** Drops the stored results of the src/lib modules reached by a test whose inputs changed. */
const invalidateChangedTests = () => {
  /** @type {typeof scope} */
  const previous = JSON.parse(read(SCOPE));
  const all = [...new Set([...Object.keys(previous.hashes), ...Object.keys(scope.hashes)])];
  const current = hashes(all);
  const changed = new Set(all.filter((path) => previous.hashes[path] !== current[path]));
  const affected = [
    ...Object.entries(scope.inputs).filter(
      ([test, paths]) => !previous.inputs[test] || paths.some((p) => changed.has(p)),
    ),
    ...Object.entries(previous.inputs).filter(([test]) => !scope.inputs[test]),
  ];
  const modules = [...new Set(affected.flatMap(([, paths]) => paths.filter((p) => p.startsWith('src/lib/'))))].sort();
  if (!modules.length) return;
  const names = affected.map(([test]) => test).join(', ');
  console.log(`mutation: ${names} or what it reads changed; re-running ${modules.join(', ')}`);
  const report = JSON.parse(read(INCREMENTAL));
  for (const module of modules) delete report.files[module];
  writeFileSync(join(REPO_DIR, INCREMENTAL), JSON.stringify(report));
};

const reason = fullRunReason();
if (reason) console.log(`mutation: full run, ${reason}`);
else invalidateChangedTests();

// Bounds: half the cores at lower priority; the per-mutant timeout lives in stryker.config.json.
const concurrency = String(Math.max(1, Math.floor(availableParallelism() / 2)));
const args = ['-n', '10', 'stryker', 'run', '--incremental', '--concurrency', concurrency];
if (reason) args.push('--force');
const stored = () => (existsSync(join(REPO_DIR, INCREMENTAL)) ? statSync(join(REPO_DIR, INCREMENTAL)).mtimeMs : 0);
const before = stored();
const run = spawnSync('nice', args, { cwd: REPO_DIR, stdio: 'inherit' });
if (run.error) throw run.error;
// Record the scope whenever Stryker stored new results, survivors included: they stay reusable.
// A run that stored nothing (a crash, a failed dry run) keeps the previous scope.
if (stored() !== before) writeFileSync(join(REPO_DIR, SCOPE), `${JSON.stringify(scope, null, 2)}\n`);
process.exit(run.status ?? 1);

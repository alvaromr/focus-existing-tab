// Mutation testing, scoped by default: Stryker's incremental mode reuses the result of every mutant
// whose code and tests did not change since the last run, and scripts/lib/mutation-scope.js decides
// which test changes re-run which modules. `pnpm mutation --full` runs every mutant.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { REPO_DIR } from './lib/cdp.js';
import {
  INCREMENTAL,
  SCOPE,
  fingerprintOf,
  fullRunReason,
  hashOf,
  inputsOf,
  staleModules,
} from './lib/mutation-scope.js';

/** @param {string} path */
const read = (path) => readFileSync(join(REPO_DIR, path), 'utf8');
/** @param {string} path */
const exists = (path) => existsSync(join(REPO_DIR, path));
/** @param {string} path */
const hash = (path) => (exists(path) ? hashOf(read(path)) : 'missing');

const tests = readdirSync(join(REPO_DIR, 'test'))
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => `test/${name}`);
/** @type {Record<string, string[]>} */
const inputs = Object.fromEntries(tests.map((test) => [test, inputsOf(test, read)]));
const fingerprint = fingerprintOf({
  config: JSON.parse(read('stryker.config.json')),
  nodeVersion: process.versions.node,
  vitestVersion: JSON.parse(read('node_modules/vitest/package.json')).version,
});
const paths = [...new Set(Object.values(inputs).flat())];
const scope = { fingerprint, inputs, hashes: Object.fromEntries(paths.map((path) => [path, hash(path)])) };

const previous = exists(INCREMENTAL) && exists(SCOPE) ? JSON.parse(read(SCOPE)) : undefined;
const reason = fullRunReason({ full: process.argv.includes('--full'), previous, fingerprint });
if (reason) console.log(`mutation: full run, ${reason}`);
else {
  // Drops the stored results of the src/lib modules reached by a test whose inputs changed.
  const stale = staleModules(previous, inputs, hash);
  if (stale.modules.length) {
    console.log(`mutation: ${stale.tests.join(', ')} or what it reads changed; re-running ${stale.modules.join(', ')}`);
    const report = JSON.parse(read(INCREMENTAL));
    for (const module of stale.modules) delete report.files[module];
    writeFileSync(join(REPO_DIR, INCREMENTAL), JSON.stringify(report));
  }
}

// Bounds: half the cores at lower priority; the per-mutant timeout lives in stryker.config.json.
const concurrency = String(Math.max(1, Math.floor(availableParallelism() / 2)));
const args = ['-n', '10', 'stryker', 'run', '--incremental', '--concurrency', concurrency];
if (reason) args.push('--force');
const stored = () => (exists(INCREMENTAL) ? statSync(join(REPO_DIR, INCREMENTAL)).mtimeMs : 0);
const before = stored();
const run = spawnSync('nice', args, { cwd: REPO_DIR, stdio: 'inherit' });
if (run.error) throw run.error;
// Record the scope whenever Stryker stored new results, survivors included: they stay reusable.
// A run that stored nothing (a crash, a failed dry run) keeps the previous scope.
if (stored() !== before) writeFileSync(join(REPO_DIR, SCOPE), `${JSON.stringify(scope, null, 2)}\n`);
process.exit(run.status ?? 1);

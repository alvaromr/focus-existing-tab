import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintOf, fullRunReason, inputsOf, staleModules } from '../scripts/lib/mutation-scope.js';

// A small repository: two src/lib modules (b imports a), a shared test helper and a fixture.
/** @type {Record<string, string>} */
const REPO = {
  'src/lib/a.js': 'export const a = 1;',
  'src/lib/b.js': "import { a } from './a.js';\nexport const b = a;",
  'src/lib/c.js': 'export const c = 3;',
  'test/helper.js': "import { c } from '../src/lib/c.js';\nexport const h = c;",
  'test/fixture.json': '{}',
  'test/a.test.js': "import { test } from 'node:test';\nimport { a } from '../src/lib/a.js';",
  // Split so that the mutation script, which reads this file too, does not take it for a read.
  'test/b.test.js': "import { b } from '../src/lib/b.js';\nnew URL(" + "'./fixture.json', import.meta.url);",
  'test/c.test.js': "import { h } from './helper.js';",
  'test/tool.test.js': "import { x } from '../scripts/lib/tool.js';",
  'scripts/lib/tool.js': 'export const x = 0;',
};

/** @param {Record<string, string>} files */
const reader = (files) => (/** @type {string} */ path) => {
  if (!(path in files)) throw new Error(`missing ${path}`);
  return files[path];
};
/** @param {Record<string, string>} files */
const hasher = (files) => (/** @type {string} */ path) => files[path] ?? 'missing';
/** @param {Record<string, string>} files */
const inputsIn = (files) =>
  Object.fromEntries(
    Object.keys(files)
      .filter((path) => path.endsWith('.test.js'))
      .map((path) => [path, inputsOf(path, reader(files))]),
  );
/** The scope recorded by a run over `files`. @param {Record<string, string>} files */
const recorded = (files) => {
  const inputs = inputsIn(files);
  const paths = [...new Set(Object.values(inputs).flat())];
  return { fingerprint: {}, inputs, hashes: Object.fromEntries(paths.map((path) => [path, hasher(files)(path)])) };
};
/** What a scoped run over `files` re-runs after a run over REPO. @param {Record<string, string>} files */
const staleAfter = (files) => staleModules(recorded(REPO), inputsIn(files), hasher(files));

test("a test's inputs are itself, its relative imports transitively and the files it reads", () => {
  assert.deepEqual(inputsOf('test/a.test.js', reader(REPO)), ['src/lib/a.js', 'test/a.test.js']);
  assert.deepEqual(inputsOf('test/b.test.js', reader(REPO)), [
    'src/lib/a.js',
    'src/lib/b.js',
    'test/b.test.js',
    'test/fixture.json',
  ]);
  assert.deepEqual(inputsOf('test/c.test.js', reader(REPO)), ['src/lib/c.js', 'test/c.test.js', 'test/helper.js']);
});

test('an import cycle is followed once', () => {
  const files = {
    'test/x.test.js': "import '../src/lib/x.js';",
    'src/lib/x.js': "import './y.js';",
    'src/lib/y.js': "import './x.js';",
  };
  assert.deepEqual(inputsOf('test/x.test.js', reader(files)), ['src/lib/x.js', 'src/lib/y.js', 'test/x.test.js']);
});

test('a package import is refused, since its version is not among the inputs', () => {
  const files = { 'test/p.test.js': "import { test } from 'node:test';\nimport x from 'some-package';" };
  assert.throws(
    () => inputsOf('test/p.test.js', reader(files)),
    /^Error: test\/p\.test\.js imports the package some-package/,
  );
});

test('a full run is due when asked with --full or with no previous result, whatever else', () => {
  const fingerprint = { node: '22' };
  const previous = { fingerprint, inputs: {}, hashes: {} };
  assert.equal(fullRunReason({ full: true, previous, fingerprint }), 'requested with --full');
  assert.equal(
    fullRunReason({ full: false, previous: undefined, fingerprint }),
    'no previous result (reports/stryker-incremental.json)',
  );
});

test('a full run is due when the fingerprint changed, naming what changed', () => {
  const previous = { fingerprint: { config: '1', node: '22', other: 'x' }, inputs: {}, hashes: {} };
  assert.equal(fullRunReason({ full: false, previous, fingerprint: { config: '1', node: '22', other: 'x' } }), '');
  assert.equal(
    fullRunReason({ full: false, previous, fingerprint: { config: '2', node: '24', other: 'x' } }),
    'changed since the last run: config, node',
  );
});

const CONFIG = {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  mutate: ['src/lib/**/*.js'],
  testRunner: 'command',
  commandRunner: { command: "node --test 'test/**/*.test.js'" },
  coverageAnalysis: 'off',
  timeoutFactor: 10,
  timeoutMS: 2000,
  reporters: ['clear-text'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  tempDirName: '.stryker-tmp',
  thresholds: { high: 100, low: 95, break: 100 },
};
const fingerprint = (config = CONFIG, nodeVersion = '22.11.0') => fingerprintOf({ config, nodeVersion });

test('the fingerprint holds how the tests run and the Node major, not the Stryker version', () => {
  assert.deepEqual(Object.keys(fingerprint()), ['stryker.config.json', 'node']);
  assert.equal(fingerprint().node, '22');
  assert.deepEqual(fingerprint(CONFIG, '22.20.1'), fingerprint());
  assert.notDeepEqual(fingerprint(CONFIG, '24.0.0'), fingerprint());
});

test('config that changes neither which mutants exist nor how their tests run leaves the fingerprint', () => {
  const { thresholds, ...rest } = CONFIG;
  for (const config of [
    { ...CONFIG, $schema: 'other.json' },
    { ...CONFIG, mutate: ['src/lib/**/*.js', 'src/ui/**/*.js'] },
    { ...CONFIG, reporters: ['html'] },
    { ...CONFIG, htmlReporter: { fileName: 'other.html' } },
    { ...CONFIG, tempDirName: '.tmp' },
    { ...CONFIG, thresholds: { high: 90, low: 80, break: 80 } },
    { thresholds, ...rest },
  ]) {
    assert.deepEqual(fingerprint(config), fingerprint(), JSON.stringify(config));
  }
});

test('config that changes how the tests run changes the fingerprint, an unknown key too', () => {
  for (const config of [
    { ...CONFIG, testRunner: 'mocha' },
    { ...CONFIG, commandRunner: { command: 'node --test' } },
    { ...CONFIG, coverageAnalysis: 'perTest' },
    { ...CONFIG, timeoutFactor: 20 },
    { ...CONFIG, timeoutMS: 5000 },
    { ...CONFIG, plugins: ['x'] },
  ]) {
    assert.notDeepEqual(fingerprint(config), fingerprint(), JSON.stringify(config));
  }
});

test('nothing changed re-runs nothing', () => {
  assert.deepEqual(staleAfter(REPO), { tests: [], modules: [] });
});

test('a changed module re-runs the modules its tests reach, dependents included', () => {
  assert.deepEqual(staleAfter({ ...REPO, 'src/lib/a.js': 'export const a = 2;' }), {
    tests: ['test/a.test.js', 'test/b.test.js'],
    modules: ['src/lib/a.js', 'src/lib/b.js'],
  });
});

test('a changed shared helper re-runs only the modules reached by the tests that use it', () => {
  assert.deepEqual(staleAfter({ ...REPO, 'test/helper.js': "import { c } from '../src/lib/c.js';\n// edited" }), {
    tests: ['test/c.test.js'],
    modules: ['src/lib/c.js'],
  });
});

test('a changed fixture or test re-runs the modules that test reaches', () => {
  assert.deepEqual(staleAfter({ ...REPO, 'test/fixture.json': '{"x":1}' }).modules, ['src/lib/a.js', 'src/lib/b.js']);
  assert.deepEqual(staleAfter({ ...REPO, 'test/a.test.js': `${REPO['test/a.test.js']}\n// edited` }).modules, [
    'src/lib/a.js',
  ]);
});

test('a new or removed test re-runs the modules it reaches or reached', () => {
  assert.deepEqual(staleAfter({ ...REPO, 'test/c2.test.js': "import '../src/lib/c.js';" }), {
    tests: ['test/c2.test.js'],
    modules: ['src/lib/c.js'],
  });
  const withoutA = { ...REPO };
  delete withoutA['test/a.test.js'];
  assert.deepEqual(staleAfter(withoutA), { tests: ['test/a.test.js'], modules: ['src/lib/a.js'] });
});

test('a change outside src/lib reached only by tests of other code re-runs nothing', () => {
  assert.deepEqual(staleAfter({ ...REPO, 'scripts/lib/tool.js': 'export const x = 1;' }), {
    tests: ['test/tool.test.js'],
    modules: [],
  });
});

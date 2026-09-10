import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, DEFAULT_CONFIG, parseList, effectiveQuery, compileRegex } from '../src/lib/config.js';

test('empty input yields the defaults', () => {
  const { config, errors } = normalizeConfig(undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(config, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
});

test('invalid values fall back, unknown keys are dropped', () => {
  const { config } = normalizeConfig({
    enabled: 'yes',
    mode: 'both',
    inTabNavigation: 'explode',
    scope: 1,
    pinnedPolicy: null,
    normalization: { ignoreWww: false, bogus: true },
    query: { compare: false, ignored: 'a, b\nc' },
    extra: 1,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.mode, 'blacklist');
  assert.equal(config.inTabNavigation, 'back');
  assert.equal(config.scope, 'all');
  assert.equal(config.pinnedPolicy, 'protect');
  assert.deepEqual(config.normalization, { ...DEFAULT_CONFIG.normalization, ignoreWww: false });
  assert.deepEqual(config.query, { compare: false, orderMatters: false, ignored: ['a', 'b', 'c'], significant: [] });
  assert.equal('extra' in config, false);
  assert.equal('bogus' in config.normalization, false);
});

test('rules: string shorthand, defaults and per-rule query overrides', () => {
  const { config, errors } = normalizeConfig({
    whitelist: [
      'a.com',
      { pattern: ' b.com ', type: 'regex', enabled: false, query: { compare: false, significant: 'id' } },
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.whitelist[0], {
    pattern: 'a.com',
    type: 'glob',
    enabled: true,
    query: { compare: null, ignored: null, significant: null },
  });
  assert.deepEqual(config.whitelist[1], {
    pattern: 'b.com',
    type: 'regex',
    enabled: false,
    query: { compare: false, ignored: null, significant: ['id'] },
  });
});

test('invalid rules are removed and reported', () => {
  const { config, errors } = normalizeConfig({
    blacklist: ['', { pattern: '(', type: 'regex' }, 42, 'ok.com'],
  });
  assert.deepEqual(
    config.blacklist.map((r) => r.pattern),
    ['ok.com'],
  );
  assert.deepEqual(
    errors.map((e) => [e.list, e.index, e.code]),
    [
      ['blacklist', 0, 'empty'],
      ['blacklist', 1, 'regex'],
      ['blacklist', 2, 'invalid'],
    ],
  );
});

test('parseList trims, splits on newline/comma and dedupes', () => {
  assert.deepEqual(parseList(' a ,b\n\nb, c '), ['a', 'b', 'c']);
  assert.deepEqual(parseList(['x', ' x', '']), ['x']);
  assert.deepEqual(parseList(null), []);
});

test('effectiveQuery merges rule overrides over the global query', () => {
  const { config } = normalizeConfig({ query: { compare: true, ignored: ['utm_*'], significant: ['id'] } });
  assert.deepEqual(effectiveQuery(config, null), config.query);
  assert.deepEqual(effectiveQuery(config, { query: { compare: false, ignored: null, significant: ['v'] } }), {
    compare: false,
    orderMatters: false,
    ignored: ['utm_*'],
    significant: ['v'],
  });
});

test('compileRegex supports /body/flags and bare bodies', () => {
  assert.equal(compileRegex('/abc/i').flags, 'i');
  assert.equal(compileRegex('abc').source, 'abc');
  assert.throws(() => compileRegex('('));
});

// ---- edge cases ----

test('compileRegex drops the stateful g and y flags and rejects invalid flags', () => {
  assert.equal(compileRegex('/abc/gimsuy').flags, 'imsu');
  assert.equal(compileRegex('/abc/g').flags, '');
  assert.throws(() => compileRegex('/abc/q'));
  assert.equal(compileRegex('/a/b/i').source, 'a\\/b');
});

test('normalizeConfig is idempotent and overrides the version', () => {
  const once = normalizeConfig({
    version: 99,
    mode: 'whitelist',
    whitelist: ['a.com'],
    query: { ignored: 'x' },
  }).config;
  assert.equal(once.version, 1);
  assert.deepEqual(normalizeConfig(once).config, once);
});

test('wrong types for lists and query fields are coerced or dropped', () => {
  const { config, errors } = normalizeConfig({
    whitelist: { pattern: 'a.com' },
    blacklist: [
      null,
      undefined,
      [],
      { pattern: 42 },
      { pattern: 'ok.com', query: { compare: 'yes', ignored: 5, significant: ['a', ' a ', ''] } },
    ],
    query: { compare: 'true', ignored: 7, significant: null },
    normalization: 'nope',
  });
  assert.deepEqual(config.whitelist, []);
  assert.deepEqual(
    config.blacklist.map((r) => r.pattern),
    ['42', 'ok.com'],
  );
  assert.deepEqual(config.blacklist[1].query, { compare: null, ignored: ['5'], significant: ['a'] });
  assert.deepEqual(config.query, { compare: true, orderMatters: false, ignored: ['7'], significant: [] });
  assert.deepEqual(config.normalization, DEFAULT_CONFIG.normalization);
  assert.deepEqual(
    errors.map((e) => e.code),
    ['invalid', 'invalid', 'empty'],
  );
});

test('non-object inputs yield defaults', () => {
  for (const raw of [null, 42, 'str', true, []]) {
    assert.deepEqual(normalizeConfig(raw).config, normalizeConfig({}).config, String(raw));
  }
});

test('parseList edge inputs', () => {
  assert.deepEqual(parseList('   \n , , \n'), []);
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual(parseList(42), ['42']);
  assert.deepEqual(parseList([1, null, 'a']), ['1', 'null', 'a']);
});

test('effectiveQuery tolerates rules without a query object', () => {
  const { config } = normalizeConfig({});
  assert.deepEqual(effectiveQuery(config, {}), config.query);
  assert.deepEqual(effectiveQuery(config, undefined), config.query);
});

test('new behaviour switches: enums, booleans and ranking coercion', () => {
  const { config } = normalizeConfig({
    groupPolicy: 'prefer',
    incognitoPolicy: 'shared',
    windowTypes: 'normal',
    ranking: ['loaded', 'bogus', 'active', 'loaded', 42],
    tieBreak: 'newest',
    restoreMinimized: false,
    actOnReload: true,
    countFocusOnly: false,
    normalization: { ignorePort: true, caseInsensitivePath: true },
    query: { orderMatters: true },
  });
  assert.equal(config.groupPolicy, 'ignore');
  assert.equal(config.incognitoPolicy, 'shared');
  assert.equal(config.windowTypes, 'normal');
  assert.deepEqual(config.ranking, ['loaded', 'active']);
  assert.equal(config.tieBreak, 'newest');
  assert.equal(config.restoreMinimized, false);
  assert.equal(config.actOnReload, true);
  assert.equal(config.countFocusOnly, false);
  assert.equal(config.normalization.ignorePort, true);
  assert.equal(config.normalization.caseInsensitivePath, true);
  assert.equal(config.query.orderMatters, true);
  assert.deepEqual(normalizeConfig({ ranking: 'window' }).config.ranking, [...DEFAULT_CONFIG.ranking]);
  assert.deepEqual(normalizeConfig({ ranking: [] }).config.ranking, []);
  assert.equal(effectiveQuery(config, { query: { compare: false } }).orderMatters, true);
});

test('DEFAULT_CONFIG is deeply frozen', () => {
  assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
  assert.equal(Object.isFrozen(DEFAULT_CONFIG.query), true);
  assert.equal(Object.isFrozen(DEFAULT_CONFIG.query.ignored), true);
  assert.equal(Object.isFrozen(DEFAULT_CONFIG.normalization), true);
});

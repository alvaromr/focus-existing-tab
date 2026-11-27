import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRule, normalizeConfig } from '../src/lib/config.js';
import { readConfigLink, savedConfigFragment } from '../src/lib/config-link.js';

const current = normalizeConfig({ blacklist: [{ pattern: 'bank.com' }], query: { compare: false } }).config;
/** @param {unknown} patch */
const link = (patch) => `#config=${encodeURIComponent(JSON.stringify(patch))}`;

test('an address without a configuration link reads as no link', () => {
  for (const hash of ['', '#', '#config', '#configuration={}', '#x=1&config={}']) {
    assert.equal(readConfigLink(hash, current), null, hash);
  }
});

test('a link changes only the fields it names, and those of normalization and query one by one', () => {
  const result = readConfigLink(link({ showBadge: false, query: { ignored: ['atlOrigin'] } }), current);
  assert.deepEqual(result, {
    config: { ...current, showBadge: false, query: { ...current.query, ignored: ['atlOrigin'] } },
    unapplied: [],
  });
});

test('a list in a link replaces the whole list, and its rules gain the default fields', () => {
  const result = readConfigLink(link({ blacklist: [{ pattern: 'a.com', query: { compare: null } }] }), current);
  assert.deepEqual(result, { config: { ...current, blacklist: [createRule({ pattern: 'a.com' })] }, unapplied: [] });
});

test('a link may be percent-encoded or raw JSON, and a + stays a +', () => {
  const patch = { excludedGroups: ['A+B work'] };
  const expected = { config: { ...current, excludedGroups: ['A+B work'] }, unapplied: [] };
  assert.deepEqual(readConfigLink(link(patch), current), expected);
  assert.deepEqual(readConfigLink(`#config=${JSON.stringify(patch)}`, current), expected);
});

test('fields a link names that do not exist or that are not stored as given are reported by path', () => {
  const patch = {
    version: 1,
    showBadge: {},
    mode: 'whitlist',
    query: { nope: 1, compare: 'yes', significant: ['id'] },
    ranking: ['window', 'nope'],
    whitelist: [{ pattern: '' }],
    blacklist: [{ pattern: 'a.com', type: 'regexp', query: { compare: {} } }],
    normalization: [],
    excludedGroups: {},
    toString: 'x',
  };
  assert.deepEqual(readConfigLink(link(patch), current)?.unapplied, [
    'showBadge',
    'mode',
    'query.nope',
    'query.compare',
    'ranking',
    'whitelist',
    'blacklist.0.type',
    'blacklist.0.query.compare',
    'normalization',
    'excludedGroups',
    'toString',
  ]);
});

test('#config alone asks for the saved configuration, answered percent-encoded after #saved=', () => {
  const answer = savedConfigFragment('#config', current);
  assert.equal(answer, `#saved=${encodeURIComponent(JSON.stringify(current))}`);
  assert.deepEqual(JSON.parse(decodeURIComponent(String(answer).slice('#saved='.length))), current);
  for (const hash of ['', '#', '#config=', '#config={}', '#configs', `#saved=${encodeURIComponent('{}')}`]) {
    assert.equal(savedConfigFragment(hash, current), null, hash);
  }
});

test('a link that is not percent-encoded JSON of an object is rejected', () => {
  assert.throws(() => readConfigLink('#config=%E0', current), URIError);
  assert.throws(() => readConfigLink('#config={', current), SyntaxError);
  for (const value of ['[]', 'null', '"x"', '1']) {
    assert.throws(() => readConfigLink(`#config=${value}`, current), {
      name: 'TypeError',
      message: 'The configuration link holds no JSON object.',
    });
  }
});

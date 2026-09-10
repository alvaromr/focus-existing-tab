import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, isEligibleUrl, isBlankUrl } from '../src/lib/normalize.js';
import { DEFAULT_CONFIG } from '../src/lib/config.js';

const N = DEFAULT_CONFIG.normalization;
const Q = DEFAULT_CONFIG.query;
const key = (url, n = N, q = Q) => normalizeUrl(url, n, q);

test('internal URLs are not eligible', () => {
  for (const u of [
    'chrome://newtab/',
    'chrome://extensions',
    'about:blank',
    'chrome-extension://abc/options.html',
    'file:///tmp/a.html',
    'data:text/html,hi',
    'view-source:https://a.com',
    'javascript:void(0)',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(isEligibleUrl(u), false, u);
    assert.equal(key(u), null, u);
  }
  assert.equal(isEligibleUrl('https://a.com'), true);
  assert.equal(isEligibleUrl('http://a.com'), true);
});

test('blank URLs', () => {
  assert.equal(isBlankUrl(''), true);
  assert.equal(isBlankUrl(undefined), true);
  assert.equal(isBlankUrl('chrome://newtab/'), true);
  assert.equal(isBlankUrl('about:blank'), true);
  assert.equal(isBlankUrl('https://a.com'), false);
});

test('default normalization: fragment, www, scheme, trailing slash, host case', () => {
  const expected = 'http://example.com/path';
  assert.equal(key('https://www.example.com/path/#section'), expected);
  assert.equal(key('http://EXAMPLE.com/path'), expected);
  assert.equal(key('https://example.com/path/'), expected);
  assert.equal(key('https://example.com/path///'), expected);
});

test('root path keeps a single slash', () => {
  assert.equal(key('https://example.com'), 'http://example.com/');
  assert.equal(key('https://example.com/'), 'http://example.com/');
});

test('path case and port are significant', () => {
  assert.notEqual(key('https://a.com/Path'), key('https://a.com/path'));
  assert.notEqual(key('https://a.com:8080/'), key('https://a.com/'));
});

test('each normalization option can be disabled', () => {
  const off = {
    ignoreFragment: false,
    ignoreWww: false,
    ignoreScheme: false,
    ignoreTrailingSlash: false,
    caseInsensitiveHost: false,
  };
  assert.equal(key('https://www.a.com/p/#x', off), 'https://www.a.com/p/#x');
  assert.notEqual(key('https://a.com/p#x', off), key('https://a.com/p#y', off));
  assert.notEqual(key('https://www.a.com/p', off), key('https://a.com/p', off));
  assert.notEqual(key('https://a.com/p', off), key('http://a.com/p', off));
  assert.notEqual(key('https://a.com/p/', off), key('https://a.com/p', off));
  assert.equal(key('https://a.com/p#', off), 'https://a.com/p');
});

test('tracking params are ignored by default, others compared and sorted', () => {
  assert.equal(key('https://a.com/p?utm_source=x&b=2&a=1&fbclid=zzz&gclid=1'), key('https://a.com/p?a=1&b=2'));
  assert.equal(key('https://a.com/p?b=2&a=1'), 'http://a.com/p?a=1&b=2');
  assert.notEqual(key('https://a.com/p?a=1'), key('https://a.com/p?a=2'));
  assert.notEqual(key('https://a.com/p?a=1'), key('https://a.com/p'));
  assert.equal(key('https://a.com/p?utm_campaign=x'), 'http://a.com/p');
});

test('query compare=false ignores every param except the significant ones', () => {
  const q = { compare: false, ignored: [], significant: ['id', 'p*'] };
  assert.equal(key('https://a.com/v?id=7&t=1&page=2', N, q), 'http://a.com/v?id=7&page=2');
  assert.equal(key('https://a.com/v?t=1', N, q), 'http://a.com/v');
});

test('significant params win over ignored globs', () => {
  const q = { compare: true, ignored: ['utm_*'], significant: ['utm_content'] };
  assert.equal(key('https://a.com/?utm_source=a&utm_content=b', N, q), 'http://a.com/?utm_content=b');
});

test('repeated params keep all values', () => {
  assert.equal(key('https://a.com/?x=2&x=1'), 'http://a.com/?x=1&x=2');
});

test('accepts URL objects', () => {
  assert.equal(key(new URL('https://a.com/x')), 'http://a.com/x');
});

// ---- edge cases ----

test('scheme is case-insensitive and default ports are dropped', () => {
  assert.equal(key('HTTPS://A.COM/'), 'http://a.com/');
  assert.equal(key('https://a.com:443/'), 'http://a.com/');
  assert.equal(key('http://a.com:80/'), 'http://a.com/');
  assert.notEqual(key('https://a.com:80/'), key('https://a.com/'));
});

test('IDN hosts compare in punycode, IPv6 hosts keep brackets and port', () => {
  assert.equal(key('https://münchen.de/'), 'http://xn--mnchen-3ya.de/');
  assert.equal(key('https://MÜNCHEN.de/'), key('https://xn--mnchen-3ya.de/'));
  assert.equal(key('http://[::1]:8080/x'), 'http://[::1]:8080/x');
});

test('credentials in the URL are ignored', () => {
  assert.equal(key('https://user:pw@a.com/'), 'http://a.com/');
});

test('repeated root slashes normalize to a single one', () => {
  assert.equal(key('https://a.com//'), 'http://a.com/');
  assert.equal(key('https://a.com///x//'), 'http://a.com///x');
  const keepSlash = { ...N, ignoreTrailingSlash: false };
  assert.equal(key('https://a.com//', keepSlash), 'http://a.com//');
});

test('empty query, valueless params and encoding variants', () => {
  assert.equal(key('https://a.com/?'), 'http://a.com/');
  assert.equal(key('https://a.com/?a'), 'http://a.com/?a=');
  assert.equal(key('https://a.com/?a='), 'http://a.com/?a=');
  assert.equal(key('https://a.com/?q=a%20b'), key('https://a.com/?q=a+b'));
  assert.equal(key('https://a.com/?q=%C3%A9'), key('https://a.com/?q=é'));
  assert.equal(key('https://a.com/?utm_source='), 'http://a.com/');
});

test('wildcard-only significant or ignored lists', () => {
  assert.equal(
    key('https://a.com/?b=1&a=2', N, { compare: false, ignored: [], significant: ['*'] }),
    'http://a.com/?a=2&b=1',
  );
  assert.equal(key('https://a.com/?b=1&a=2', N, { compare: true, ignored: ['*'], significant: [] }), 'http://a.com/');
});

test('param name matching is case-sensitive and exact', () => {
  assert.equal(key('https://a.com/?UTM_SOURCE=x'), 'http://a.com/?UTM_SOURCE=x');
  assert.equal(key('https://a.com/?fbclid2=x'), 'http://a.com/?fbclid2=x');
});

test('fragments with query-like content are still fragments', () => {
  assert.equal(key('https://a.com/p#?utm_source=x'), 'http://a.com/p');
  assert.equal(key('https://a.com/p#a=1', { ...N, ignoreFragment: false }), 'http://a.com/p#a=1');
});

test('ignorePort drops any port, caseInsensitivePath lowercases the path', () => {
  assert.equal(key('https://a.com:8080/X', { ...N, ignorePort: true }), 'http://a.com/X');
  assert.equal(key('https://a.com:8080/X', { ...N, caseInsensitivePath: true }), 'http://a.com:8080/x');
  assert.equal(key('https://a.com/Path/', { ...N, caseInsensitivePath: true }), key('https://a.com/path'));
});

test('query.orderMatters keeps the original parameter order', () => {
  const ordered = { ...Q, orderMatters: true };
  assert.equal(key('https://a.com/?b=2&a=1', N, ordered), 'http://a.com/?b=2&a=1');
  assert.notEqual(key('https://a.com/?b=2&a=1', N, ordered), key('https://a.com/?a=1&b=2', N, ordered));
  assert.equal(key('https://a.com/?b=2&utm_source=x&a=1', N, ordered), 'http://a.com/?b=2&a=1');
});

test('unusual but valid inputs never throw', () => {
  for (const u of [
    'https://a.com/%',
    'https://a.com/?%zz=1',
    'https://a.com/\u0000',
    'https://a.com/' + 'x'.repeat(10000),
    'https://a.com/?' + 'k=v&'.repeat(2000),
  ]) {
    assert.doesNotThrow(() => key(u), u.slice(0, 40));
  }
});

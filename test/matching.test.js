import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleMatches, findMatchingRule, resolveDecision, analyzeUrl } from '../src/lib/matching.js';
import { normalizeConfig, createRule } from '../src/lib/config.js';

const glob = (pattern, extra = {}) => createRule({ pattern, type: 'glob', ...extra });
const regex = (pattern, extra = {}) => createRule({ pattern, type: 'regex', ...extra });
const cfg = (overrides) => normalizeConfig(overrides).config;

test('host glob matches the host and its subdomains', () => {
  const r = glob('example.com');
  assert.equal(ruleMatches(r, 'https://example.com/a?b=1'), true);
  assert.equal(ruleMatches(r, 'https://www.example.com/'), true);
  assert.equal(ruleMatches(r, 'https://deep.sub.example.com/'), true);
  assert.equal(ruleMatches(r, 'https://EXAMPLE.COM/'), true);
  assert.equal(ruleMatches(r, 'https://notexample.com/'), false);
  assert.equal(ruleMatches(r, 'https://example.com.evil.net/'), false);
});

test('host glob with wildcards', () => {
  assert.equal(ruleMatches(glob('*.google.com'), 'https://mail.google.com/'), true);
  assert.equal(ruleMatches(glob('*.google.com'), 'https://google.com/'), false);
  assert.equal(ruleMatches(glob('*google*'), 'https://google.es/'), true);
  assert.equal(ruleMatches(glob('git?ub.com'), 'https://github.com/'), true);
});

test('URL glob is anchored and scheme-less unless the pattern has a scheme', () => {
  const r = glob('github.com/anthropics/*');
  assert.equal(ruleMatches(r, 'https://github.com/anthropics/claude-code'), true);
  assert.equal(ruleMatches(r, 'http://github.com/anthropics/'), true);
  assert.equal(ruleMatches(r, 'https://github.com/anthropics'), false);
  assert.equal(ruleMatches(r, 'https://github.com/other/anthropics/x'), false);
  assert.equal(ruleMatches(glob('https://a.com/*'), 'https://a.com/x'), true);
  assert.equal(ruleMatches(glob('https://a.com/*'), 'http://a.com/x'), false);
  assert.equal(ruleMatches(glob('*/login*'), 'https://x.com/login?next=1'), true);
});

test('regex rules match the full URL, with optional /body/flags form', () => {
  assert.equal(ruleMatches(regex('^https://a\\.com/\\d+$'), 'https://a.com/42'), true);
  assert.equal(ruleMatches(regex('^https://a\\.com/\\d+$'), 'https://a.com/x'), false);
  assert.equal(ruleMatches(regex('/A\\.COM/i'), 'https://a.com/'), true);
  assert.equal(ruleMatches(regex('A\\.COM'), 'https://a.com/'), false);
});

test('unparseable URLs never match', () => {
  assert.equal(ruleMatches(glob('*'), 'nope'), false);
  assert.equal(findMatchingRule([glob('*')], ''), null);
});

test('findMatchingRule skips disabled rules and returns the first match', () => {
  const rules = [glob('a.com', { enabled: false }), glob('*.com'), glob('a.com')];
  assert.equal(findMatchingRule(rules, 'https://a.com/'), rules[1]);
  assert.equal(findMatchingRule(rules, 'https://a.org/'), null);
});

test('blacklist mode: act on everything except blacklisted', () => {
  const c = cfg({ mode: 'blacklist', blacklist: ['bank.com', { pattern: '/\\/checkout/', type: 'regex' }] });
  assert.deepEqual(resolveDecision(c, 'https://a.com/'), { act: true, reason: 'ok', rule: null });
  assert.equal(resolveDecision(c, 'https://online.bank.com/').reason, 'blacklisted');
  assert.equal(resolveDecision(c, 'https://shop.com/checkout/1').act, false);
  assert.equal(resolveDecision(c, 'chrome://settings').reason, 'internal');
});

test('whitelist mode: act only on whitelisted', () => {
  const c = cfg({ mode: 'whitelist', whitelist: ['docs.example.com'] });
  assert.equal(resolveDecision(c, 'https://docs.example.com/x').act, true);
  assert.equal(resolveDecision(c, 'https://example.com/x').reason, 'not-whitelisted');
});

test('disabled config never acts', () => {
  assert.equal(resolveDecision(cfg({ enabled: false }), 'https://a.com/').reason, 'disabled');
});

test('whitelist rules provide query overrides even in blacklist mode', () => {
  const c = cfg({
    mode: 'blacklist',
    whitelist: [{ pattern: 'youtube.com', query: { compare: false, significant: ['v'] } }],
  });
  const a = analyzeUrl(c, 'https://www.youtube.com/watch?v=abc&t=10s&list=x');
  assert.equal(a.act, true);
  assert.equal(a.rule.pattern, 'youtube.com');
  assert.equal(a.key, 'http://youtube.com/watch?v=abc');
  assert.equal(analyzeUrl(c, 'https://other.com/?a=1').key, 'http://other.com/?a=1');
});

test('per-rule ignored/significant override the global lists', () => {
  const c = cfg({
    query: { compare: true, ignored: ['utm_*'], significant: [] },
    whitelist: [{ pattern: 'a.com', query: { ignored: ['page'], significant: ['utm_term'] } }],
  });
  assert.equal(analyzeUrl(c, 'https://a.com/?page=2&utm_term=k&utm_x=1').key, 'http://a.com/?utm_term=k&utm_x=1');
});

test('analyzeUrl returns null key when not acting', () => {
  assert.equal(analyzeUrl(cfg({ mode: 'whitelist' }), 'https://a.com/').key, null);
});

// ---- edge cases ----

test('a regex rule that fails to compile never matches (and never throws)', () => {
  assert.equal(ruleMatches(regex('('), 'https://a.com/'), false);
  assert.equal(findMatchingRule([regex('('), glob('a.com')], 'https://a.com/').pattern, 'a.com');
});

test('regex rules with g/y flags give stable results across calls', () => {
  const r = regex('/a\\.com/g');
  assert.equal(ruleMatches(r, 'https://a.com/'), true);
  assert.equal(ruleMatches(r, 'https://a.com/'), true);
  assert.equal(ruleMatches(r, 'https://a.com/'), true);
});

test('host globs are case-insensitive and support host:port', () => {
  assert.equal(ruleMatches(glob('Example.COM'), 'https://example.com/'), true);
  assert.equal(ruleMatches(glob('localhost:8765'), 'http://localhost:8765/a'), true);
  assert.equal(ruleMatches(glob('localhost:8765'), 'http://localhost:9999/a'), false);
  assert.equal(ruleMatches(glob('localhost'), 'http://localhost:8765/a'), true);
  assert.equal(ruleMatches(glob('*:8765'), 'http://127.0.0.1:8765/'), true);
  assert.equal(ruleMatches(glob('127.0.0.1'), 'http://127.0.0.1:8765/'), true);
});

test('IDN hosts must be given in punycode in patterns', () => {
  assert.equal(ruleMatches(glob('xn--mnchen-3ya.de'), 'https://münchen.de/'), true);
  assert.equal(ruleMatches(glob('münchen.de'), 'https://münchen.de/'), false);
});

test('glob specials: ? matches any single char, regex metacharacters are literal', () => {
  assert.equal(ruleMatches(glob('a.com/x?y=*'), 'https://a.com/x?y=1'), true);
  assert.equal(ruleMatches(glob('a.com/x?y=*'), 'https://a.com/xZy=1'), true);
  assert.equal(ruleMatches(glob('a.com/(x)+[1].html'), 'https://a.com/(x)+[1].html'), true);
  assert.equal(ruleMatches(glob('a.com/(x)+[1].html'), 'https://a.com/x.html'), false);
  assert.equal(ruleMatches(glob('a.com/$|()+[].*'), 'https://a.com/$|()+[].z'), true);
  // The URL parser rewrites `\` to `/` and percent-encodes `{}` and `^` before rules see the URL.
  // Whether `^` is percent-encoded depends on the URL parser version (spec change adopted by
  // newer Node); patterns always see whatever the parser produced.
  const caretPath = new URL('https://a.com/^').pathname.slice(1);
  assert.equal(ruleMatches(glob(`a.com/${caretPath}`), 'https://a.com/^'), true);
  assert.equal(ruleMatches(glob('a.com/x/y'), 'https://a.com/x\\y'), true);
  assert.equal(ruleMatches(glob('a.com/%7Bx%7D'), 'https://a.com/{x}'), true);
});

test('URL globs see the raw href (encoding, ports, credentials stripped by the parser)', () => {
  assert.equal(ruleMatches(glob('a.com:8080/*'), 'https://a.com:8080/x'), true);
  assert.equal(ruleMatches(glob('a.com/caf%C3%A9'), 'https://a.com/café'), true);
  assert.equal(ruleMatches(glob('a.com/*'), 'https://user:pw@a.com/x'), false);
  assert.equal(ruleMatches(glob('*a.com/*'), 'https://user:pw@a.com/x'), true);
});

test('rules without an explicit enabled flag are enabled; URL objects accepted', () => {
  const r = { pattern: 'a.com', type: 'glob' };
  assert.equal(findMatchingRule([r], new URL('https://a.com/')), r);
  assert.equal(resolveDecision(cfg({ blacklist: ['a.com'] }), new URL('https://a.com/')).act, false);
});

test('whitelist mode with only disabled rules acts nowhere', () => {
  const c = cfg({ mode: 'whitelist', whitelist: [{ pattern: '*', enabled: false }] });
  assert.equal(resolveDecision(c, 'https://a.com/').reason, 'not-whitelisted');
});

test('blacklist wins over whitelist overrides in blacklist mode', () => {
  const c = cfg({ whitelist: ['a.com'], blacklist: ['a.com'] });
  const d = resolveDecision(c, 'https://a.com/');
  assert.equal(d.act, false);
  assert.equal(d.reason, 'blacklisted');
});

test('invalid or internal URLs are reported as internal', () => {
  assert.equal(analyzeUrl(cfg(), 'not a url').reason, 'internal');
  assert.equal(analyzeUrl(cfg(), 'chrome-extension://abc/x.html').reason, 'internal');
  assert.equal(analyzeUrl(cfg(), '').reason, 'internal');
});

import { globToRegExpSource } from './glob.js';
import { compileRegex, effectiveQuery } from './config.js';
import { isEligibleUrl, normalizeUrl, parseUrl } from './normalize.js';

/** @typedef {import('./config.js').Config} Config */
/** @typedef {import('./config.js').Rule} Rule */
/** @typedef {(u: URL) => string} Subject the part of a URL a pattern is compared against */
/** @typedef {{ act: boolean, reason: string, rule: Rule | null }} Decision */

/** @type {Map<string, { re: RegExp, subject: Subject }>} */
const cache = new Map();

/**
 * Compiles a rule into a RegExp over the string returned by `subject(rule, url)`.
 * Glob rules:
 *  - without `/`: a host rule. `example.com` matches `example.com` and any subdomain;
 *    patterns starting with `*` are plain globs over the hostname. With a `:` the pattern
 *    is compared against `host:port` instead (`localhost:8080`).
 *  - with `/`: a URL rule, anchored. Matched against `host/path?query` (scheme stripped)
 *    unless the pattern itself contains `://`.
 * Regex rules are tested against the full URL (`/body/flags` or bare body).
 * @param {Rule} rule
 */
function compileRule(rule) {
  const key = `${rule.type}:${rule.pattern}`;
  let compiled = cache.get(key);
  // Stryker disable next-line ConditionalExpression: the cache only saves recompiling; skipping it changes no result.
  if (compiled) return compiled;

  if (rule.type === 'regex') {
    compiled = { re: compileRegex(rule.pattern), subject: SUBJECTS.href };
  } else if (!rule.pattern.includes('/')) {
    const body = globToRegExpSource(rule.pattern.toLowerCase());
    const prefix = rule.pattern.startsWith('*') ? '' : '(?:[^/]*\\.)?';
    // `host:port` patterns compare against host+port, plain ones against the hostname.
    const subject = rule.pattern.includes(':') ? SUBJECTS.hostport : SUBJECTS.host;
    compiled = { re: new RegExp(`^${prefix}${body}$`), subject };
  } else {
    const body = globToRegExpSource(rule.pattern);
    const subject = rule.pattern.includes('://') ? SUBJECTS.href : SUBJECTS.schemeless;
    compiled = { re: new RegExp(`^${body}$`), subject };
  }
  // Stryker disable next-line CallExpression: cache only, as above.
  cache.set(key, compiled);
  return compiled;
}

/**
 * The part of a URL each kind of pattern is compared against.
 * @type {Record<'host' | 'hostport' | 'schemeless' | 'href', Subject>}
 */
const SUBJECTS = {
  host: (u) => u.hostname.toLowerCase(),
  hostport: (u) => u.host.toLowerCase(),
  schemeless: (u) => u.href.slice(u.protocol.length + 2),
  href: (u) => u.href,
};

/** @param {Rule} rule @param {string | URL | null | undefined} url */
export function ruleMatches(rule, url) {
  const u = url instanceof URL ? url : parseUrl(url);
  if (!u) return false;
  // Throws on an invalid regex: rules reach here only after normalizeConfig has validated them.
  const { re, subject } = compileRule(rule);
  return re.test(subject(u));
}

/** @param {readonly Rule[]} rules @param {string | URL | null | undefined} url */
export function findMatchingRule(rules, url) {
  const u = url instanceof URL ? url : parseUrl(url);
  return rules.find((r) => r.enabled !== false && ruleMatches(r, u)) || null;
}

/**
 * Decides whether the extension should act on a URL.
 * In 'whitelist' mode the URL must match a whitelist rule. In 'blacklist' mode it must not
 * match a blacklist rule; whitelist rules are still consulted only to pick per-rule query
 * overrides.
 * @param {Config} config
 * @param {string | URL | null | undefined} url
 * @returns {Decision}
 */
export function resolveDecision(config, url) {
  const u = url instanceof URL ? url : parseUrl(url);
  if (!config.enabled) return { act: false, reason: 'disabled', rule: null };
  if (!isEligibleUrl(u)) return { act: false, reason: 'internal', rule: null };
  const rule = findMatchingRule(config.whitelist, u);
  if (config.mode === 'whitelist') {
    return rule ? { act: true, reason: 'ok', rule } : { act: false, reason: 'not-whitelisted', rule: null };
  }
  if (findMatchingRule(config.blacklist, u)) return { act: false, reason: 'blacklisted', rule };
  return { act: true, reason: 'ok', rule };
}

/**
 * Comparison key of a URL under the query options resolved for `rule`.
 * @param {Config} config
 * @param {string | URL | null | undefined} url
 * @param {Rule | null} rule
 */
export function keyFor(config, url, rule) {
  return normalizeUrl(url, config.normalization, effectiveQuery(config, rule));
}

/**
 * Decision plus key for a URL, using its own matched rule.
 * @param {Config} config
 * @param {string | URL | null | undefined} url
 * @returns {Decision & { key: string | null }}
 */
export function analyzeUrl(config, url) {
  const decision = resolveDecision(config, url);
  const key = decision.act ? keyFor(config, url, decision.rule) : null;
  return { ...decision, key };
}

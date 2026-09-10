import { globToRegExpSource } from './glob.js';
import { compileRegex, effectiveQuery } from './config.js';
import { isEligibleUrl, normalizeUrl, parseUrl } from './normalize.js';

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
 */
export function compileRule(rule) {
  const key = `${rule.type}:${rule.pattern}`;
  let compiled = cache.get(key);
  if (compiled) return compiled;

  if (rule.type === 'regex') {
    compiled = { re: compileRegex(rule.pattern), subject: 'href' };
  } else if (!rule.pattern.includes('/')) {
    const body = globToRegExpSource(rule.pattern.toLowerCase());
    const prefix = rule.pattern.startsWith('*') ? '' : '(?:[^/]*\\.)?';
    // `host:port` patterns compare against host+port, plain ones against the hostname.
    const subject = rule.pattern.includes(':') ? 'hostport' : 'host';
    compiled = { re: new RegExp(`^${prefix}${body}$`), subject };
  } else {
    const body = globToRegExpSource(rule.pattern);
    compiled = { re: new RegExp(`^${body}$`), subject: rule.pattern.includes('://') ? 'href' : 'schemeless' };
  }
  cache.set(key, compiled);
  return compiled;
}

function subjectOf(kind, u) {
  if (kind === 'host') return u.hostname.toLowerCase();
  if (kind === 'hostport') return u.host.toLowerCase();
  if (kind === 'schemeless') return u.href.slice(u.protocol.length + 2);
  return u.href;
}

export function ruleMatches(rule, url) {
  const u = url instanceof URL ? url : parseUrl(url);
  if (!u) return false;
  try {
    const { re, subject } = compileRule(rule);
    return re.test(subjectOf(subject, u));
  } catch {
    return false;
  }
}

export function findMatchingRule(rules, url) {
  const u = url instanceof URL ? url : parseUrl(url);
  if (!u) return null;
  return rules.find((r) => r.enabled !== false && ruleMatches(r, u)) || null;
}

/**
 * Decides whether the extension should act on a URL.
 * In 'whitelist' mode the URL must match a whitelist rule. In 'blacklist' mode it must not
 * match a blacklist rule; whitelist rules are still consulted only to pick per-rule query
 * overrides.
 * @returns {{ act: boolean, reason: string, rule: import('./config.js').Rule|null }}
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

/** Comparison key of a URL under the query options resolved for `rule`. */
export function keyFor(config, url, rule) {
  return normalizeUrl(url, config.normalization, effectiveQuery(config, rule));
}

/** Decision plus key for a URL, using its own matched rule. */
export function analyzeUrl(config, url) {
  const decision = resolveDecision(config, url);
  const key = decision.act ? keyFor(config, url, decision.rule) : null;
  return { ...decision, key };
}

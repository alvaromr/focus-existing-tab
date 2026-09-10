/**
 * @typedef {{ compare: boolean|null, ignored: string[]|null, significant: string[]|null }} RuleQuery
 * @typedef {{ pattern: string, type: string, enabled: boolean, query: RuleQuery }} Rule
 * @typedef {{ ignoreFragment: boolean, ignoreWww: boolean, ignoreScheme: boolean, ignoreTrailingSlash: boolean,
 *   ignorePort: boolean, caseInsensitiveHost: boolean, caseInsensitivePath: boolean }} Normalization
 * @typedef {{ compare: boolean, orderMatters: boolean, ignored: string[], significant: string[] }} QueryOptions
 * @typedef {{ version: number, enabled: boolean, mode: string, whitelist: Rule[], blacklist: Rule[],
 *   closeDuplicate: boolean, focusWindow: boolean, inTabNavigation: string, scope: string, pinnedPolicy: string,
 *   groupPolicy: string, incognitoPolicy: string, windowTypes: string, ranking: string[], tieBreak: string,
 *   restoreMinimized: boolean, actOnReload: boolean, countFocusOnly: boolean, showBadge: boolean,
 *   normalization: Normalization, query: QueryOptions }} Config
 */

export const CONFIG_VERSION = 1;

export const MODES = ['blacklist', 'whitelist'];
export const IN_TAB_ACTIONS = ['back', 'focus', 'close', 'ignore'];
export const SCOPES = ['all', 'window'];
export const PINNED_POLICIES = ['protect', 'ignore', 'normal'];
export const GROUP_POLICIES = ['ignore', 'same'];
export const INCOGNITO_POLICIES = ['separate', 'shared'];
export const WINDOW_TYPES = ['all', 'normal'];
export const RANK_CRITERIA = ['group', 'window', 'active', 'pinned', 'loaded'];
export const TIE_BREAKS = ['oldest', 'newest'];
export const RULE_TYPES = ['glob', 'regex'];

export const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  enabled: true,
  // 'blacklist': act on everything except blacklisted URLs. 'whitelist': act only on whitelisted URLs.
  mode: 'blacklist',
  whitelist: [],
  blacklist: [],
  // false: only focus the existing tab, never close the new one.
  closeDuplicate: true,
  // Bring the window of the existing tab to the front.
  focusWindow: true,
  // What to do when the duplicate navigation happens inside a tab that already had a page.
  inTabNavigation: 'back',
  // 'all' windows or only the 'window' of the navigating tab.
  scope: 'all',
  // 'protect': pinned tabs are never closed. 'ignore': pinned tabs are not considered. 'normal'.
  pinnedPolicy: 'protect',
  // 'ignore': tab groups play no role. 'same': only tabs in the same group (ungrouped counts as
  // a group of its own).
  groupPolicy: 'ignore',
  // 'separate': normal and incognito tabs never match each other. 'shared': they do (only
  // possible when the extension is allowed in incognito).
  incognitoPolicy: 'separate',
  // 'all': tabs in app/popup windows (PWAs) count too. 'normal': only regular browser windows.
  windowTypes: 'all',
  // Ordered criteria to pick the tab to focus/keep when several match; earlier wins.
  // Criteria left out are not considered. Remaining ties go to the 'oldest' or 'newest' tab.
  ranking: Object.freeze(['window', 'active', 'pinned', 'loaded']),
  tieBreak: 'oldest',
  // Un-minimize the window of the existing tab before focusing it.
  restoreMinimized: true,
  // Reloading a page that another tab already shows counts as opening a duplicate.
  actOnReload: false,
  // Count in the badge also when the extension only focuses (no close/back).
  countFocusOnly: true,
  showBadge: true,
  normalization: Object.freeze({
    ignoreFragment: true,
    ignoreWww: true,
    ignoreScheme: true,
    ignoreTrailingSlash: true,
    ignorePort: false,
    caseInsensitiveHost: true,
    caseInsensitivePath: false,
  }),
  query: Object.freeze({
    compare: true,
    // false: ?a=1&b=2 equals ?b=2&a=1.
    orderMatters: false,
    ignored: Object.freeze([
      'utm_*',
      'fbclid',
      'gclid',
      'dclid',
      'msclkid',
      'yclid',
      'mc_cid',
      'mc_eid',
      '_hsenc',
      '_hsmi',
      'igshid',
    ]),
    significant: Object.freeze([]),
  }),
});

export function createRule(overrides = {}) {
  return {
    pattern: '',
    type: 'glob',
    enabled: true,
    // Per-rule query overrides; null means "inherit the global setting".
    query: { compare: null, ignored: null, significant: null },
    ...overrides,
  };
}

/** Splits a textarea/comma separated list into trimmed, unique, non-empty entries. */
export function parseList(text) {
  if (Array.isArray(text)) return [...new Set(text.map((s) => String(s).trim()).filter(Boolean))];
  return [
    ...new Set(
      String(text ?? '')
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function pickBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function pickNullableBool(value) {
  return typeof value === 'boolean' ? value : null;
}

/** Ordered, de-duplicated subset of RANK_CRITERIA; anything else falls back to the default. */
function pickRanking(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((c) => RANK_CRITERIA.includes(c)))];
}

function pickNullableList(value) {
  if (value == null) return null;
  return parseList(value);
}

/**
 * Compiles a regex rule. Accepts `/body/flags` or a bare body. Throws on invalid patterns.
 * The `g` and `y` flags are dropped: they make `test()` stateful (lastIndex), which would
 * alternate results on a cached RegExp.
 */
export function compileRegex(pattern) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(pattern);
  return m ? new RegExp(m[1], m[2].replace(/[gy]/g, '')) : new RegExp(pattern);
}

function normalizeRule(raw, listName, index, errors) {
  if (typeof raw === 'string') raw = { pattern: raw };
  if (!raw || typeof raw !== 'object') {
    errors.push({ list: listName, index, code: 'invalid' });
    return null;
  }
  const rule = createRule({
    pattern: String(raw.pattern ?? '').trim(),
    type: pickEnum(raw.type, RULE_TYPES, 'glob'),
    enabled: pickBool(raw.enabled, true),
    query: {
      compare: pickNullableBool(raw.query?.compare),
      ignored: pickNullableList(raw.query?.ignored),
      significant: pickNullableList(raw.query?.significant),
    },
  });
  if (!rule.pattern) {
    errors.push({ list: listName, index, code: 'empty' });
    return null;
  }
  if (rule.type === 'regex') {
    try {
      compileRegex(rule.pattern);
    } catch {
      errors.push({ list: listName, index, code: 'regex', pattern: rule.pattern });
      return null;
    }
  }
  return rule;
}

function normalizeRules(raw, listName, errors) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => normalizeRule(r, listName, i, errors)).filter(Boolean);
}

/**
 * Coerces any object (storage contents, imported JSON) into a valid config.
 * Unknown keys are dropped, invalid values fall back to defaults and invalid rules are
 * reported in `errors` and removed.
 * @returns {{ config: Config, errors: Array<{list:string,index:number,code:string,pattern?:string}> }}
 */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const d = DEFAULT_CONFIG;
  const config = {
    version: CONFIG_VERSION,
    enabled: pickBool(src.enabled, d.enabled),
    mode: pickEnum(src.mode, MODES, d.mode),
    whitelist: normalizeRules(src.whitelist, 'whitelist', errors),
    blacklist: normalizeRules(src.blacklist, 'blacklist', errors),
    closeDuplicate: pickBool(src.closeDuplicate, d.closeDuplicate),
    focusWindow: pickBool(src.focusWindow, d.focusWindow),
    inTabNavigation: pickEnum(src.inTabNavigation, IN_TAB_ACTIONS, d.inTabNavigation),
    scope: pickEnum(src.scope, SCOPES, d.scope),
    pinnedPolicy: pickEnum(src.pinnedPolicy, PINNED_POLICIES, d.pinnedPolicy),
    groupPolicy: pickEnum(src.groupPolicy, GROUP_POLICIES, d.groupPolicy),
    incognitoPolicy: pickEnum(src.incognitoPolicy, INCOGNITO_POLICIES, d.incognitoPolicy),
    windowTypes: pickEnum(src.windowTypes, WINDOW_TYPES, d.windowTypes),
    ranking: pickRanking(src.ranking, d.ranking),
    tieBreak: pickEnum(src.tieBreak, TIE_BREAKS, d.tieBreak),
    restoreMinimized: pickBool(src.restoreMinimized, d.restoreMinimized),
    actOnReload: pickBool(src.actOnReload, d.actOnReload),
    countFocusOnly: pickBool(src.countFocusOnly, d.countFocusOnly),
    showBadge: pickBool(src.showBadge, d.showBadge),
    normalization: /** @type {Normalization} */ (
      Object.fromEntries(Object.entries(d.normalization).map(([k, v]) => [k, pickBool(src.normalization?.[k], v)]))
    ),
    query: {
      compare: pickBool(src.query?.compare, d.query.compare),
      orderMatters: pickBool(src.query?.orderMatters, d.query.orderMatters),
      ignored: src.query?.ignored == null ? [...d.query.ignored] : parseList(src.query.ignored),
      significant: src.query?.significant == null ? [] : parseList(src.query.significant),
    },
  };
  return { config, errors };
}

/** Query options that apply to a URL: global settings overridden by the matched rule. */
export function effectiveQuery(config, rule) {
  const q = rule?.query || {};
  return {
    compare: q.compare ?? config.query.compare,
    orderMatters: config.query.orderMatters,
    ignored: q.ignored ?? config.query.ignored,
    significant: q.significant ?? config.query.significant,
  };
}

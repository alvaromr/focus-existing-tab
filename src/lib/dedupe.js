import { analyzeUrl, keyFor } from './matching.js';
import { matchesAnyGlob } from './glob.js';

function tabUrl(tab) {
  return tab.url || tab.pendingUrl;
}

/** Whether this tab may be closed by the extension. */
export function canCloseTab(config, tab) {
  return !(tab.pinned && config.pinnedPolicy !== 'normal');
}

function isConsidered(config, tab) {
  return !(tab.pinned && config.pinnedPolicy === 'ignore');
}

// Chrome reports -1 (TAB_GROUP_ID_NONE) for ungrouped tabs; treat "no group" as a group of its own.
function groupOf(tab) {
  return tab.groupId ?? -1;
}

/** Ids of the tab groups (from `chrome.tabGroups.query`) whose title matches `config.excludedGroups`. */
export function excludedGroupIds(config, groups) {
  // Stryker disable next-line StringLiteral: any non-title stand-in is equivalent; '' only keeps a pattern like "undefined" from matching an untitled group.
  return new Set(groups.filter((g) => matchesAnyGlob(config.excludedGroups, g.title ?? '', 'iu')).map((g) => g.id));
}

// Excluded tabs are never duplicates and never block others: those in an excluded group, or any
// grouped tab under groupPolicy 'exclude'.
function isExcluded(config, tab, excludedIds) {
  const group = groupOf(tab);
  return excludedIds.has(group) || (config.groupPolicy === 'exclude' && group !== -1);
}

const CRITERIA = {
  // Deduplicate-all has no reference group (undefined), which no tab's group equals.
  group: (tab, ref) => groupOf(tab) === ref.groupId,
  window: (tab, ref) => tab.windowId === ref.windowId,
  active: (tab) => !!tab.active,
  pinned: (tab) => !!tab.pinned,
  loaded: (tab) => !tab.discarded,
};

// Score by the configured criteria in order: the first criterion outweighs all later ones.
function rank(tab, ref, config) {
  return config.ranking.reduce(
    (score, name, i) => score + (CRITERIA[name](tab, ref) ? 2 ** (config.ranking.length - i) : 0),
    0,
  );
}

/** The tab to keep / focus among equals. `ref` = { windowId, groupId? } of the reference tab. */
function best(tabs, ref, config) {
  const newest = config.tieBreak === 'newest';
  return tabs.reduce((a, b) => {
    const ra = rank(a, ref, config);
    const rb = rank(b, ref, config);
    if (ra > rb) return a;
    if (ra < rb) return b;
    // Stryker disable next-line EqualityOperator: tab ids are unique, so < and <= never differ.
    return a.id < b.id !== newest ? a : b;
  });
}

/**
 * Finds an already open tab showing the same page as `url` (the page `tab` is navigating to).
 * Tabs in `excludedIds` (group ids, see `excludedGroupIds`) neither count as duplicates nor are
 * matched against.
 * @returns {object|null} the tab to focus, or null.
 */
export function findExistingTab(config, tabs, tab, url, rule, excludedIds = new Set()) {
  if (isExcluded(config, tab, excludedIds)) return null;
  const key = keyFor(config, url, rule);
  if (!key) return null;
  const candidates = tabs.filter(
    (t) =>
      t.id !== tab.id &&
      t.id != null &&
      !isExcluded(config, t, excludedIds) &&
      (config.incognitoPolicy === 'shared' || !!t.incognito === !!tab.incognito) &&
      (config.scope === 'all' || t.windowId === tab.windowId) &&
      (config.groupPolicy !== 'same' || groupOf(t) === groupOf(tab)) &&
      isConsidered(config, t) &&
      keyFor(config, tabUrl(t), rule) === key,
  );
  if (!candidates.length) return null;
  return best(candidates, { windowId: tab.windowId, groupId: groupOf(tab) }, config);
}

/**
 * Groups every open tab by key and picks which ones to close so that one tab per page remains.
 * Tabs in `excludedIds` (group ids, see `excludedGroupIds`) are left out entirely.
 * @returns {{ close: number[], keep: Array<{key:string, tab:object, duplicates:object[]}> }}
 */
export function planDedupeAll(config, tabs, activeWindowId, excludedIds = new Set()) {
  const groups = new Map();
  for (const t of tabs) {
    if (t.id == null || !isConsidered(config, t) || isExcluded(config, t, excludedIds)) continue;
    const { key } = analyzeUrl(config, tabUrl(t)); // null when the extension does not act on it
    if (!key) continue;
    const groupKey = JSON.stringify([
      // Stryker disable next-line BooleanLiteral: inverting the label still keeps incognito and normal tabs apart.
      config.incognitoPolicy === 'separate' && !!t.incognito,
      config.scope === 'window' && t.windowId,
      config.groupPolicy === 'same' && groupOf(t),
      key,
    ]);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(t);
  }
  const close = [];
  const keep = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const winner = best(group, { windowId: activeWindowId }, config);
    const duplicates = group.filter((t) => t !== winner && canCloseTab(config, t));
    close.push(...duplicates.map((t) => t.id));
    keep.push({ key, tab: winner, duplicates });
  }
  return { close, keep };
}

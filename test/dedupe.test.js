import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingTab, planDedupeAll, canCloseTab, tabUrl, groupOf } from '../src/lib/dedupe.js';
import { normalizeConfig } from '../src/lib/config.js';

const cfg = (overrides) => normalizeConfig(overrides).config;
let nextId = 1;
const tab = (url, extra = {}) => ({
  id: nextId++,
  windowId: 1,
  active: false,
  pinned: false,
  incognito: false,
  url,
  ...extra,
});

test('tabUrl prefers url and falls back to pendingUrl', () => {
  assert.equal(tabUrl({ url: 'https://a.com/', pendingUrl: 'https://b.com/' }), 'https://a.com/');
  assert.equal(tabUrl({ url: '', pendingUrl: 'https://b.com/' }), 'https://b.com/');
  assert.equal(tabUrl({}), '');
});

test('finds an equivalent tab and ignores the navigating tab itself', () => {
  const c = cfg();
  const existing = tab('https://www.example.com/page/?utm_source=x');
  const other = tab('https://example.com/other');
  const nav = tab('chrome://newtab/');
  assert.equal(findExistingTab(c, [existing, other, nav], nav, 'http://example.com/page#top', null), existing);
  assert.equal(findExistingTab(c, [existing, other, nav], existing, 'http://example.com/page', null), null);
});

test('prefers same window, then active, then pinned, then the oldest', () => {
  const c = cfg();
  const url = 'https://a.com/';
  const nav = tab('chrome://newtab/', { windowId: 2 });
  const older = tab(url, { windowId: 1 });
  const pinned = tab(url, { windowId: 1, pinned: true });
  const active = tab(url, { windowId: 1, active: true });
  const sameWindow = tab(url, { windowId: 2 });
  assert.equal(findExistingTab(c, [older, pinned, active, sameWindow], nav, url, null), sameWindow);
  assert.equal(findExistingTab(c, [older, pinned, active], nav, url, null), active);
  assert.equal(findExistingTab(c, [older, pinned], nav, url, null), pinned);
  assert.equal(findExistingTab(c, [tab(url), older], nav, url, null), older);
});

test('scope=window only looks at the same window', () => {
  const c = cfg({ scope: 'window' });
  const nav = tab('chrome://newtab/', { windowId: 2 });
  const other = tab('https://a.com/', { windowId: 1 });
  assert.equal(findExistingTab(c, [other], nav, 'https://a.com/', null), null);
  const same = tab('https://a.com/', { windowId: 2 });
  assert.equal(findExistingTab(c, [other, same], nav, 'https://a.com/', null), same);
});

test('incognito and normal tabs never match each other', () => {
  const c = cfg();
  const nav = tab('chrome://newtab/', { incognito: true });
  assert.equal(findExistingTab(c, [tab('https://a.com/')], nav, 'https://a.com/', null), null);
  const priv = tab('https://a.com/', { incognito: true });
  assert.equal(findExistingTab(c, [priv], nav, 'https://a.com/', null), priv);
});

test('pinned policy', () => {
  const pinnedTab = tab('https://a.com/', { pinned: true });
  const nav = tab('chrome://newtab/');
  assert.equal(findExistingTab(cfg({ pinnedPolicy: 'ignore' }), [pinnedTab], nav, 'https://a.com/', null), null);
  assert.equal(findExistingTab(cfg({ pinnedPolicy: 'protect' }), [pinnedTab], nav, 'https://a.com/', null), pinnedTab);
  assert.equal(canCloseTab(cfg({ pinnedPolicy: 'protect' }), pinnedTab), false);
  assert.equal(canCloseTab(cfg({ pinnedPolicy: 'ignore' }), pinnedTab), false);
  assert.equal(canCloseTab(cfg({ pinnedPolicy: 'normal' }), pinnedTab), true);
  assert.equal(canCloseTab(cfg({ pinnedPolicy: 'protect' }), nav), true);
});

test('uses the rule query overrides for both sides of the comparison', () => {
  const c = cfg({ whitelist: [{ pattern: 'yt.com', query: { compare: false, significant: ['v'] } }] });
  const existing = tab('https://yt.com/watch?v=1&t=5');
  const nav = tab('chrome://newtab/');
  assert.equal(findExistingTab(c, [existing], nav, 'https://yt.com/watch?v=1&t=9', c.whitelist[0]), existing);
  assert.equal(findExistingTab(c, [existing], nav, 'https://yt.com/watch?v=2', c.whitelist[0]), null);
});

test('planDedupeAll keeps one tab per page and respects lists and pinned tabs', () => {
  const c = cfg({ blacklist: ['skip.com'] });
  const a1 = tab('https://a.com/');
  const a2 = tab('https://www.a.com/#x', { active: true });
  const a3 = tab('https://a.com/?utm_source=1', { pinned: true });
  const b1 = tab('https://b.com/');
  const s1 = tab('https://skip.com/');
  const s2 = tab('https://skip.com/');
  const internal1 = tab('chrome://newtab/');
  const internal2 = tab('chrome://newtab/');
  const plan = planDedupeAll(c, [a1, a2, a3, b1, s1, s2, internal1, internal2], 1);
  assert.deepEqual(plan.close, [a1.id]);
  assert.equal(plan.keep.length, 1);
  assert.equal(plan.keep[0].tab, a2);
});

test('planDedupeAll separates windows when scope=window and incognito groups', () => {
  const c = cfg({ scope: 'window' });
  const w1 = tab('https://a.com/', { windowId: 1 });
  const w2 = tab('https://a.com/', { windowId: 2 });
  const w2b = tab('https://a.com/', { windowId: 2 });
  const inc = tab('https://a.com/', { windowId: 1, incognito: true });
  assert.deepEqual(planDedupeAll(c, [w1, w2, w2b, inc], 1).close, [w2b.id]);
  assert.deepEqual(planDedupeAll(cfg(), [w1, w2, w2b, inc], 1).close.sort(), [w2.id, w2b.id].sort());
});

test('planDedupeAll never acts when disabled', () => {
  assert.deepEqual(planDedupeAll(cfg({ enabled: false }), [tab('https://a.com/'), tab('https://a.com/')], 1).close, []);
});

// ---- edge cases ----

test('tabs without id and non-eligible URLs are ignored', () => {
  const c = cfg();
  const nav = tab('chrome://newtab/');
  const noId = { url: 'https://a.com/', windowId: 1, incognito: false };
  assert.equal(findExistingTab(c, [noId], nav, 'https://a.com/', null), null);
  assert.equal(findExistingTab(c, [tab('https://a.com/')], nav, 'chrome://settings', null), null);
  assert.equal(findExistingTab(c, [tab('https://a.com/')], nav, 'nope', null), null);
  assert.deepEqual(planDedupeAll(c, [noId, noId, tab('chrome://a'), tab('chrome://a')], 1).close, []);
});

test('a loading tab (pendingUrl only) counts as a candidate', () => {
  const loading = tab('', { pendingUrl: 'https://a.com/' });
  assert.equal(findExistingTab(cfg(), [loading], tab('chrome://newtab/'), 'https://a.com/', null), loading);
});

test('discarded tabs rank below loaded ones, the oldest wins ties', () => {
  const nav = tab('chrome://newtab/');
  const discarded = tab('https://a.com/', { discarded: true });
  const loaded = tab('https://a.com/');
  assert.equal(findExistingTab(cfg(), [discarded, loaded], nav, 'https://a.com/', null), loaded);
  const d1 = tab('https://a.com/', { discarded: true });
  const d2 = tab('https://a.com/', { discarded: true });
  assert.equal(findExistingTab(cfg(), [d2, d1], nav, 'https://a.com/', null), d1);
});

test('pinned policy in planDedupeAll', () => {
  const active = tab('https://a.com/', { active: true });
  const pinnedDup = tab('https://a.com/', { pinned: true });
  const plain = tab('https://a.com/');
  assert.deepEqual(planDedupeAll(cfg({ pinnedPolicy: 'protect' }), [active, pinnedDup, plain], 1).close, [plain.id]);
  assert.deepEqual(
    planDedupeAll(cfg({ pinnedPolicy: 'normal' }), [active, pinnedDup, plain], 1).close.sort(),
    [pinnedDup.id, plain.id].sort(),
  );
  assert.deepEqual(planDedupeAll(cfg({ pinnedPolicy: 'ignore' }), [active, pinnedDup, plain], 1).close, [plain.id]);
});

test('planDedupeAll prefers the active window and tolerates an unknown one', () => {
  const w1 = tab('https://a.com/', { windowId: 1 });
  const w2 = tab('https://a.com/', { windowId: 2 });
  assert.deepEqual(planDedupeAll(cfg(), [w1, w2], 2).close, [w1.id]);
  assert.deepEqual(planDedupeAll(cfg(), [w1, w2], undefined).close, [w2.id]);
});

test('planDedupeAll respects whitelist mode and per-rule query overrides', () => {
  const c = cfg({
    mode: 'whitelist',
    whitelist: [{ pattern: 'yt.com', query: { compare: false, significant: ['v'] } }],
  });
  const y1 = tab('https://yt.com/watch?v=1&t=1');
  const y2 = tab('https://yt.com/watch?v=1&t=2');
  const y3 = tab('https://yt.com/watch?v=2');
  const other1 = tab('https://other.com/');
  const other2 = tab('https://other.com/');
  const plan = planDedupeAll(c, [y1, y2, y3, other1, other2], 1);
  assert.deepEqual(plan.close, [y2.id]);
  assert.equal(plan.keep[0].duplicates[0], y2);
});

test('canCloseTab treats a missing pinned flag as not pinned', () => {
  assert.equal(canCloseTab(cfg(), { id: 1 }), true);
});

// ---- tab groups ----

test('groupPolicy=ignore (default): groups play no role', () => {
  const c = cfg();
  assert.equal(c.groupPolicy, 'ignore');
  const grouped = tab('https://a.com/', { groupId: 7 });
  const nav = tab('chrome://newtab/', { groupId: -1 });
  assert.equal(findExistingTab(c, [grouped], nav, 'https://a.com/', null), grouped);
  const other = tab('https://a.com/', { groupId: 9 });
  assert.equal(findExistingTab(c, [other], tab('https://b.com/', { groupId: 7 }), 'https://a.com/', null), other);
  assert.equal(groupOf({}), -1);
});

test('groupPolicy=same: only the same group; ungrouped is a group of its own', () => {
  const c = cfg({ groupPolicy: 'same' });
  const inGroup7 = tab('https://a.com/', { groupId: 7 });
  const inGroup9 = tab('https://a.com/', { groupId: 9 });
  const ungrouped = tab('https://a.com/', { groupId: -1 });
  const navIn7 = tab('https://b.com/', { groupId: 7 });
  const navUngrouped = tab('chrome://newtab/');
  assert.equal(findExistingTab(c, [inGroup9, ungrouped, inGroup7], navIn7, 'https://a.com/', null), inGroup7);
  assert.equal(findExistingTab(c, [inGroup9, inGroup7], navUngrouped, 'https://a.com/', null), null);
  assert.equal(findExistingTab(c, [inGroup9, ungrouped], navUngrouped, 'https://a.com/', null), ungrouped);
  const plan = planDedupeAll(c, [inGroup7, inGroup9, ungrouped, tab('https://a.com/', { groupId: 7 })], 1);
  assert.deepEqual(plan.close, [plan.keep[0].duplicates[0].id]);
  assert.equal(plan.keep[0].tab, inGroup7);
});

test('ranking with "group" first: same group outranks same window and active', () => {
  const c = cfg({ ranking: ['group', 'window', 'active', 'pinned', 'loaded'] });
  const activeOtherGroup = tab('https://a.com/', { windowId: 2, active: true, groupId: 9 });
  const sameGroupOtherWindow = tab('https://a.com/', { windowId: 1, groupId: 7 });
  const nav = tab('https://b.com/', { windowId: 2, groupId: 7 });
  assert.equal(
    findExistingTab(c, [activeOtherGroup, sameGroupOtherWindow], nav, 'https://a.com/', null),
    sameGroupOtherWindow,
  );
  // Without a same-group candidate the next criteria apply.
  assert.equal(
    findExistingTab(c, [activeOtherGroup, tab('https://a.com/', { windowId: 1 })], nav, 'https://a.com/', null),
    activeOtherGroup,
  );
  // Dedupe-all has no reference group: the criterion never matches there.
  assert.deepEqual(planDedupeAll(c, [sameGroupOtherWindow, activeOtherGroup], 2).close, [sameGroupOtherWindow.id]);
});

// ---- configurable ranking, tie-break, incognito ----

test('ranking order is honoured and excluded criteria are ignored', () => {
  const nav = tab('chrome://newtab/', { windowId: 1 });
  const pinnedOtherWindow = tab('https://a.com/', { windowId: 2, pinned: true });
  const activeSameWindow = tab('https://a.com/', { windowId: 1, active: true });
  const url = 'https://a.com/';
  assert.equal(
    findExistingTab(
      cfg({ ranking: ['pinned', 'window', 'active'] }),
      [activeSameWindow, pinnedOtherWindow],
      nav,
      url,
      null,
    ),
    pinnedOtherWindow,
  );
  assert.equal(
    findExistingTab(cfg({ ranking: ['active'] }), [pinnedOtherWindow, activeSameWindow], nav, url, null),
    activeSameWindow,
  );
  // Only "loaded": a loaded tab beats a discarded one whatever else they are.
  const discardedActive = tab(url, { windowId: 1, active: true, discarded: true });
  assert.equal(
    findExistingTab(cfg({ ranking: ['loaded'] }), [discardedActive, pinnedOtherWindow], nav, url, null),
    pinnedOtherWindow,
  );
});

test('empty ranking falls back to the tie-break only', () => {
  const nav = tab('chrome://newtab/');
  const older = tab('https://a.com/', { windowId: 2 });
  const newer = tab('https://a.com/', { windowId: 1, active: true, pinned: true });
  assert.equal(findExistingTab(cfg({ ranking: [] }), [newer, older], nav, 'https://a.com/', null), older);
  assert.equal(
    findExistingTab(cfg({ ranking: [], tieBreak: 'newest' }), [older, newer], nav, 'https://a.com/', null),
    newer,
  );
});

test('tieBreak=newest keeps the newest tab on equal rank, also in dedupe-all', () => {
  const c = cfg({ tieBreak: 'newest' });
  const t1 = tab('https://a.com/');
  const t2 = tab('https://a.com/');
  const t3 = tab('https://a.com/');
  assert.equal(findExistingTab(c, [t1, t2, t3], tab('chrome://newtab/'), 'https://a.com/', null), t3);
  assert.deepEqual(planDedupeAll(c, [t1, t2, t3], 1).close.sort(), [t1.id, t2.id].sort());
});

test('incognitoPolicy=shared matches across normal and incognito tabs', () => {
  const c = cfg({ incognitoPolicy: 'shared' });
  const normal = tab('https://a.com/');
  const priv = tab('https://a.com/', { incognito: true });
  assert.equal(
    findExistingTab(c, [normal], tab('chrome://newtab/', { incognito: true }), 'https://a.com/', null),
    normal,
  );
  assert.deepEqual(planDedupeAll(c, [normal, priv], 1).close, [priv.id]);
  assert.deepEqual(planDedupeAll(cfg(), [normal, priv], 1).close, []);
});

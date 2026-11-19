import { resolveDecision } from './lib/matching.js';
import { isBlankUrl, isEligibleUrl } from './lib/normalize.js';
import { excludedGroupIds, findExistingTab, planDedupeAll } from './lib/dedupe.js';
import { createNavigationTracker } from './lib/navigation-tracker.js';
import { chooseAction, countsAsAvoided, isReload } from './lib/navigation-action.js';
import { badgeOf } from './lib/badge.js';
import { log } from './lib/log.js';
import {
  addAvoided,
  loadConfig,
  loadStats,
  onConfigChange,
  onStatsChange,
  resetStats,
  updateConfig,
} from './chrome/storage.js';

// Catch handlers. `warnOn`: an expected race (the tab or window went away); the caller goes on
// with `null`. `errorOn`: anything else.
const warnOn = (context) => (cause) => {
  log.warn(context, cause);
  return null;
};
const errorOn = (context) => (cause) => log.error(context, cause);

// ---------- configuration ----------

let config = null;
const nav = createNavigationTracker();
// Handlers wait for the configuration and for the tabs already open when the worker started:
// the tracker treats a tab it does not know as newer than any navigation it handles.
const ready = Promise.all([
  loadConfig().then((c) => {
    config = c;
  }),
  chrome.tabs.query({}).then((tabs) => nav.seed(tabs)),
]);
onConfigChange((c) => {
  config = c;
  refreshBadge().catch(errorOn('refreshing the badge'));
});
onStatsChange(() => refreshBadge().catch(errorOn('refreshing the badge')));

// ---------- navigation events ----------

chrome.tabs.onCreated.addListener((tab) => nav.tabCreated(tab));
chrome.tabs.onRemoved.addListener((tabId) => nav.tabRemoved(tabId));

chrome.webNavigation.onBeforeNavigate.addListener(({ frameId, tabId, url, timeStamp }) => {
  if (frameId !== 0) return;
  const context = nav.beforeNavigate(tabId, url, timeStamp);
  handleNavigation(tabId, url, 'before', context, nav.startOf(tabId)).catch(errorOn('handling a navigation'));
});

chrome.webNavigation.onCommitted.addListener(({ frameId, tabId, url, transitionType, timeStamp }) => {
  if (frameId !== 0) return;
  const { goBack: back, check } = nav.committed(tabId, url, transitionType, timeStamp);
  if (back) return goBack(tabId);
  const start = nav.startOf(tabId);
  const handled = check ? handleNavigation(tabId, url, 'committed', check, start) : Promise.resolve();
  handled.catch(errorOn('handling a navigation')).finally(() => nav.settled(tabId));
});

chrome.webNavigation.onErrorOccurred.addListener(({ frameId, tabId }) => {
  if (frameId === 0) nav.errorOccurred(tabId);
});

/**
 * Decides and executes what to do with a main-frame navigation of `tabId` to `url`.
 * `stage` is 'before' (onBeforeNavigate) or 'committed' (onCommitted re-check). `start` is when
 * the navigation started (`nav.startOf`, read when its event fired).
 */
async function handleNavigation(tabId, url, stage, { wasNew, prevUrl }, start) {
  await ready;
  if (nav.shouldSkip(tabId)) return;
  if (!config.enabled || !isEligibleUrl(url)) return;

  const decision = resolveDecision(config, url);
  if (!decision.act) return;

  const tab = await chrome.tabs.get(tabId).catch(warnOn('reading the navigating tab'));
  if (!tab) return;
  const previous = prevUrl ?? tab.url ?? '';
  if (isReload(config, previous, url)) return;
  const [tabs, excluded] = await Promise.all([queryTabs(), queryExcludedGroups()]);
  // A tab that started navigating after this navigation is its duplicate, not its original.
  const earlier = tabs.filter((t) => !nav.navigatedAfter(t.id, start));
  const target = findExistingTab(config, earlier, tab, url, decision.rule, excluded);
  if (!target) return;

  const action = chooseAction(config, tab, wasNew || isBlankUrl(previous));
  if (action === 'ignore') return;

  await focusTab(target);
  if (action === 'close') await chrome.tabs.remove(tabId).catch(warnOn('closing the duplicate tab'));
  if (action === 'back' && nav.scheduleGoBack(tabId, url, stage) === 'now') goBack(tabId);
  if (countsAsAvoided(config, action)) await addAvoided(1);
}

// ---------- tab actions ----------

// Tabs the extension may match against; app/popup windows (PWAs) are optional.
function queryTabs() {
  return chrome.tabs.query(config.windowTypes === 'normal' ? { windowType: 'normal' } : {});
}

async function queryExcludedGroups() {
  return excludedGroupIds(config, await chrome.tabGroups.query({}));
}

function goBack(tabId) {
  nav.goBackIssued(tabId);
  chrome.tabs.goBack(tabId).catch((cause) => {
    log.warn('going back in the duplicate tab', cause);
    nav.goBackFailed(tabId);
  });
}

async function focusTab(tab) {
  if (config.focusWindow) {
    const win = await chrome.windows.get(tab.windowId).catch(warnOn('reading the window of the existing tab'));
    if (win) {
      const update = { focused: true };
      if (win.state === 'minimized' && config.restoreMinimized) update.state = 'normal';
      await chrome.windows.update(tab.windowId, update).catch(warnOn('focusing the window of the existing tab'));
    }
  }
  await chrome.tabs.update(tab.id, { active: true }).catch(warnOn('activating the existing tab'));
}

async function dedupeAll() {
  await ready;
  const [tabs, current, excluded] = await Promise.all([
    queryTabs(),
    chrome.windows.getLastFocused().catch(warnOn('reading the last focused window')),
    queryExcludedGroups(),
  ]);
  const plan = planDedupeAll(config, tabs, current?.id, excluded);
  if (!plan.close.length) return { closed: 0 };
  // tabs.remove rejects without closing anything when one of the tabs is already gone.
  const removed = await chrome.tabs.remove(plan.close).then(() => true, warnOn('closing the duplicate tabs'));
  if (!removed) return { closed: 0 };
  await addAvoided(plan.close.length);
  return { closed: plan.close.length };
}

async function toggleEnabled() {
  await ready;
  return updateConfig({ enabled: !config.enabled });
}

// ---------- badge, commands, messages ----------

async function refreshBadge() {
  await ready;
  const { text, color } = badgeOf(config, (await loadStats()).avoided);
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'dedupe-all') dedupeAll().catch(errorOn('deduplicating all tabs'));
  if (command === 'toggle-enabled') toggleEnabled().catch(errorOn('toggling the extension'));
});

const MESSAGE_HANDLERS = {
  dedupeAll,
  toggleEnabled,
  resetStats,
  getState: async () => {
    await ready;
    return { config, stats: await loadStats() };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (typeof type !== 'string' || !Object.hasOwn(MESSAGE_HANDLERS, type)) return false;
  MESSAGE_HANDLERS[type]()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => refreshBadge().catch(errorOn('refreshing the badge')));
chrome.runtime.onStartup.addListener(() => refreshBadge().catch(errorOn('refreshing the badge')));
refreshBadge().catch(errorOn('refreshing the badge'));

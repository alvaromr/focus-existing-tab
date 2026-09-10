import { resolveDecision } from './lib/matching.js';
import { isBlankUrl, isEligibleUrl } from './lib/normalize.js';
import { canCloseTab, findExistingTab, planDedupeAll } from './lib/dedupe.js';
import { createNavigationTracker } from './lib/navigation-tracker.js';
import {
  addAvoided,
  loadConfig,
  loadStats,
  onConfigChange,
  onStatsChange,
  resetStats,
  updateConfig,
} from './lib/storage.js';

// ---------- configuration ----------

let config = null;
const ready = loadConfig().then((c) => {
  config = c;
});
onConfigChange((c) => {
  config = c;
  refreshBadge();
});
onStatsChange(() => refreshBadge());

// ---------- navigation events ----------

const nav = createNavigationTracker();
chrome.tabs.query({}).then((tabs) => nav.seed(tabs));

chrome.tabs.onCreated.addListener((tab) => nav.tabCreated(tab));
chrome.tabs.onRemoved.addListener((tabId) => nav.tabRemoved(tabId));

chrome.webNavigation.onBeforeNavigate.addListener(({ frameId, tabId, url }) => {
  if (frameId !== 0) return;
  handleNavigation(tabId, url, 'before', nav.beforeNavigate(tabId, url)).catch(console.error);
});

chrome.webNavigation.onCommitted.addListener(({ frameId, tabId, url, transitionType }) => {
  if (frameId !== 0) return;
  const { goBack: back, check } = nav.committed(tabId, url, transitionType);
  if (back) return goBack(tabId);
  const handled = check ? handleNavigation(tabId, url, 'committed', check) : Promise.resolve();
  handled.catch(console.error).finally(() => nav.settled(tabId));
});

chrome.webNavigation.onErrorOccurred.addListener(({ frameId, tabId }) => {
  if (frameId === 0) nav.errorOccurred(tabId);
});

/**
 * Decides and executes what to do with a main-frame navigation of `tabId` to `url`.
 * `stage` is 'before' (onBeforeNavigate) or 'committed' (onCommitted re-check).
 */
async function handleNavigation(tabId, url, stage, { wasNew, prevUrl }) {
  await ready;
  if (nav.shouldSkip(tabId)) return;
  if (!config.enabled || !isEligibleUrl(url)) return;

  const decision = resolveDecision(config, url);
  if (!decision.act) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const previous = prevUrl ?? tab.url ?? '';
  // Reloading the page the tab already shows is not opening a duplicate (unless configured so).
  if (previous === url && !config.actOnReload) return;
  const target = findExistingTab(config, await queryTabs(), tab, url, decision.rule);
  if (!target) return;

  const action = chooseAction(tab, wasNew || isBlankUrl(previous));
  if (action === 'ignore') return;

  await focusTab(target);
  if (action === 'close') await chrome.tabs.remove(tabId).catch(() => {});
  if (action === 'back' && nav.scheduleGoBack(tabId, url, stage) === 'now') goBack(tabId);
  if (action !== 'focus' || config.countFocusOnly) await addAvoided(1);
}

/** 'close' | 'back' | 'focus' | 'ignore' for the navigating tab. */
function chooseAction(tab, isNewTab) {
  const action = isNewTab ? 'close' : config.inTabNavigation;
  if (action === 'close' && (!config.closeDuplicate || !canCloseTab(config, tab))) return 'focus';
  return action;
}

// ---------- tab actions ----------

// Tabs the extension may match against; app/popup windows (PWAs) are optional.
function queryTabs() {
  return chrome.tabs.query(config.windowTypes === 'normal' ? { windowType: 'normal' } : {});
}

function goBack(tabId) {
  nav.goBackIssued(tabId);
  chrome.tabs.goBack(tabId).catch(() => nav.goBackFailed(tabId));
}

async function focusTab(tab) {
  if (config.focusWindow) {
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (win) {
      const update = { focused: true };
      if (win.state === 'minimized' && config.restoreMinimized) update.state = 'normal';
      await chrome.windows.update(tab.windowId, update).catch(() => {});
    }
  }
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
}

async function dedupeAll() {
  await ready;
  const [tabs, current] = await Promise.all([queryTabs(), chrome.windows.getLastFocused().catch(() => null)]);
  const plan = planDedupeAll(config, tabs, current?.id);
  if (plan.close.length) {
    await chrome.tabs.remove(plan.close).catch(() => {});
    await addAvoided(plan.close.length);
  }
  return { closed: plan.close.length };
}

async function toggleEnabled() {
  await ready;
  return updateConfig({ enabled: !config.enabled });
}

// ---------- badge, commands, messages ----------

const BADGE_COLOR = '#2563eb';
const BADGE_COLOR_OFF = '#6b7280';

async function refreshBadge() {
  await ready;
  const { avoided } = await loadStats();
  let text = '';
  if (!config.enabled) text = 'OFF';
  else if (config.showBadge && avoided > 0) text = avoided > 9999 ? '9999+' : String(avoided);
  await chrome.action.setBadgeBackgroundColor({ color: config.enabled ? BADGE_COLOR : BADGE_COLOR_OFF });
  await chrome.action.setBadgeText({ text });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'dedupe-all') dedupeAll().catch(console.error);
  if (command === 'toggle-enabled') toggleEnabled().catch(console.error);
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

chrome.runtime.onInstalled.addListener(() => refreshBadge().catch(console.error));
chrome.runtime.onStartup.addListener(() => refreshBadge().catch(console.error));
refreshBadge().catch(console.error);

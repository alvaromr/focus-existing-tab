// Per-tab navigation bookkeeping, kept apart from chrome.* so the event sequences can be
// unit-tested. The service worker feeds it raw events and asks what to do.
//
// State is lost when the service worker is suspended, which is harmless: every entry only
// matters for a few hundred milliseconds around a navigation.

const SKIP_TTL_MS = 2000;

/**
 * What a navigation is evaluated with: whether its tab is fresh, and the URL it had committed.
 * @typedef {{ wasNew: boolean, prevUrl: string | undefined }} NavigationContext
 */
/** @typedef {'before' | 'committed'} Stage */

/** @param {{ now?: () => number }} [options] the clock, injectable for tests */
export function createNavigationTracker({ now = Date.now } = {}) {
  /** @type {Set<number>} tabs created and not yet committed a navigation */
  const newTabs = new Set();
  /** @type {Map<number, string>} tabId -> last committed URL (tab.url lags behind events) */
  const committedUrl = new Map();
  /** @type {Set<number>} tabs that must go back as soon as the duplicate commits */
  const pendingBack = new Set();
  /** @type {Map<number, number>} tabId -> deadline; the tab is performing a goBack we triggered */
  const skipUntil = new Map();
  /** @type {Map<number, string>} tabId -> url seen in onBeforeNavigate */
  const lastBefore = new Map();
  // tabId -> time (ms since epoch) its latest navigation started. Times, not arrival order: Chrome
  // does not order events across APIs, so a tab's onBeforeNavigate can arrive after the onCreated
  // of a tab opened later.
  /** @type {Map<number, number>} */
  const startedAt = new Map();

  return {
    /**
     * Seed committed URLs from the tabs that already exist (service worker start).
     * @param {{ id?: number, url?: string }[]} tabs
     */
    seed(tabs) {
      // A tab without an id never fires navigation events, so its entry stays inert.
      for (const t of tabs) {
        const id = /** @type {number} */ (t.id);
        if (!committedUrl.has(id)) committedUrl.set(id, t.url || '');
      }
    },

    /** @param {{ id: number, url?: string }} tab */
    tabCreated(tab) {
      newTabs.add(tab.id);
      committedUrl.set(tab.id, tab.url || '');
      // onCreated carries no time; its arrival is a late bound. A tab created with a URL can be
      // listed by chrome.tabs.query before its onBeforeNavigate arrives.
      startedAt.set(tab.id, now());
    },

    /** @param {number} tabId */
    tabRemoved(tabId) {
      newTabs.delete(tabId);
      committedUrl.delete(tabId);
      pendingBack.delete(tabId);
      skipUntil.delete(tabId);
      lastBefore.delete(tabId);
      startedAt.delete(tabId);
    },

    /**
     * onBeforeNavigate (main frame). Returns the context to evaluate the navigation with.
     * Must be called synchronously from the event: onCommitted may arrive before any await.
     * @param {number} tabId
     * @param {string} url
     * @param {number} [timeStamp] when the navigation started (the event's timeStamp)
     * @returns {NavigationContext}
     */
    beforeNavigate(tabId, url, timeStamp = now()) {
      lastBefore.set(tabId, url);
      startedAt.set(tabId, timeStamp);
      return { wasNew: newTabs.has(tabId), prevUrl: committedUrl.get(tabId) };
    },

    /**
     * onCommitted (main frame). Returns { goBack: true } when a deferred goBack must run now,
     * or { check: context } when the committed URL must be evaluated (redirect, or a navigation
     * that never fired onBeforeNavigate: prerender activation, service worker restarted), or {}.
     * @param {number} tabId
     * @param {string} url
     * @param {string} transitionType
     * @param {number} [timeStamp] when the commit happened (the event's timeStamp)
     * @returns {{ goBack?: true, check?: NavigationContext }}
     */
    committed(tabId, url, transitionType, timeStamp = now()) {
      const prevUrl = committedUrl.get(tabId);
      committedUrl.set(tabId, url);
      if (pendingBack.delete(tabId)) {
        newTabs.delete(tabId);
        return { goBack: true };
      }
      const seenBefore = lastBefore.get(tabId);
      lastBefore.delete(tabId);
      if (seenBefore === undefined) startedAt.set(tabId, timeStamp);
      const needsCheck = seenBefore !== url && transitionType !== 'reload';
      return needsCheck ? { check: { wasNew: newTabs.has(tabId), prevUrl } } : {};
    },

    /**
     * When the tab's latest navigation started (0: none seen, such as a seeded tab). Read it
     * synchronously from the event, before any await, to identify that navigation later.
     * @param {number} tabId
     */
    startOf(tabId) {
      return startedAt.get(tabId) ?? 0;
    },

    /**
     * Whether the tab started navigating after `time`, the start of the navigation being handled.
     * Such a tab is the duplicate of that navigation, never its original, however late the worker
     * handles it. A tab the tracker does not know yet (its onCreated still queued) is newer too.
     * @param {number} tabId
     * @param {number} time
     */
    navigatedAfter(tabId, time) {
      if (!committedUrl.has(tabId)) return true;
      return (startedAt.get(tabId) ?? 0) > time;
    },

    /**
     * Call once the committed navigation has been fully handled.
     * @param {number} tabId
     */
    settled(tabId) {
      newTabs.delete(tabId);
      skipUntil.delete(tabId);
    },

    /** @param {number} tabId */
    errorOccurred(tabId) {
      pendingBack.delete(tabId);
      skipUntil.delete(tabId);
      lastBefore.delete(tabId);
    },

    /**
     * True while the tab is performing the goBack we triggered (cleared by settled/error/TTL).
     * @param {number} tabId
     */
    shouldSkip(tabId) {
      return now() < (skipUntil.get(tabId) ?? 0); // no marker: nothing to skip
    },

    /**
     * Mark that a goBack was issued for the tab; its own events must be ignored.
     * @param {number} tabId
     */
    goBackIssued(tabId) {
      skipUntil.set(tabId, now() + SKIP_TTL_MS);
    },

    /** @param {number} tabId */
    goBackFailed(tabId) {
      skipUntil.delete(tabId);
    },

    /**
     * Decide whether to go back now (the duplicate already committed) or once it commits.
     * @param {number} tabId
     * @param {string} url
     * @param {Stage} stage
     * @returns {'now' | 'later'}
     */
    scheduleGoBack(tabId, url, stage) {
      if (stage === 'committed' || committedUrl.get(tabId) === url) return 'now';
      pendingBack.add(tabId);
      return 'later';
    },
  };
}

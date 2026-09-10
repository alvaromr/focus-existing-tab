// Per-tab navigation bookkeeping, kept apart from chrome.* so the event sequences can be
// unit-tested. The service worker feeds it raw events and asks what to do.
//
// State is lost when the service worker is suspended, which is harmless: every entry only
// matters for a few hundred milliseconds around a navigation.

export const SKIP_TTL_MS = 2000;

export function createNavigationTracker({ now = Date.now } = {}) {
  const newTabs = new Set(); // tabs created and not yet committed a navigation
  const committedUrl = new Map(); // tabId -> last committed URL (tab.url lags behind events)
  const pendingBack = new Set(); // tabs that must go back as soon as the duplicate commits
  const skipUntil = new Map(); // tabId -> deadline; the tab is performing a goBack we triggered
  const lastBefore = new Map(); // tabId -> url seen in onBeforeNavigate

  return {
    /** Seed committed URLs from the tabs that already exist (service worker start). */
    seed(tabs) {
      for (const t of tabs) if (t.id != null && !committedUrl.has(t.id)) committedUrl.set(t.id, t.url || '');
    },

    tabCreated(tab) {
      newTabs.add(tab.id);
      committedUrl.set(tab.id, tab.url || '');
    },

    tabRemoved(tabId) {
      newTabs.delete(tabId);
      committedUrl.delete(tabId);
      pendingBack.delete(tabId);
      skipUntil.delete(tabId);
      lastBefore.delete(tabId);
    },

    /**
     * onBeforeNavigate (main frame). Returns the context to evaluate the navigation with.
     * Must be called synchronously from the event: onCommitted may arrive before any await.
     */
    beforeNavigate(tabId, url) {
      lastBefore.set(tabId, url);
      return { wasNew: newTabs.has(tabId), prevUrl: committedUrl.get(tabId) };
    },

    /**
     * onCommitted (main frame). Returns { goBack: true } when a deferred goBack must run now,
     * or { check: context } when the committed URL must be evaluated (redirect, or a navigation
     * that never fired onBeforeNavigate: prerender activation, service worker restarted), or {}.
     */
    committed(tabId, url, transitionType) {
      const prevUrl = committedUrl.get(tabId);
      committedUrl.set(tabId, url);
      if (pendingBack.delete(tabId)) {
        newTabs.delete(tabId);
        return { goBack: true };
      }
      const seenBefore = lastBefore.get(tabId);
      lastBefore.delete(tabId);
      const needsCheck = seenBefore !== url && transitionType !== 'reload';
      return needsCheck ? { check: { wasNew: newTabs.has(tabId), prevUrl } } : {};
    },

    /** Call once the committed navigation has been fully handled. */
    settled(tabId) {
      newTabs.delete(tabId);
      skipUntil.delete(tabId);
    },

    errorOccurred(tabId) {
      pendingBack.delete(tabId);
      skipUntil.delete(tabId);
      lastBefore.delete(tabId);
    },

    /** True while the tab is performing the goBack we triggered (cleared by settled/error/TTL). */
    shouldSkip(tabId) {
      const deadline = skipUntil.get(tabId);
      if (deadline === undefined) return false;
      if (now() < deadline) return true;
      skipUntil.delete(tabId);
      return false;
    },

    /** Mark that a goBack was issued for the tab; its own events must be ignored. */
    goBackIssued(tabId) {
      skipUntil.set(tabId, now() + SKIP_TTL_MS);
    },

    goBackFailed(tabId) {
      skipUntil.delete(tabId);
    },

    /** Decide whether to go back now (the duplicate already committed) or once it commits. */
    scheduleGoBack(tabId, url, stage) {
      if (stage === 'committed' || committedUrl.get(tabId) === url) return 'now';
      pendingBack.add(tabId);
      return 'later';
    },
  };
}

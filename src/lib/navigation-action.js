import { canCloseTab } from './dedupe.js';

/** Opening the page the tab already shows (reload, retyping it) is not a duplicate, unless configured so. */
export function isReload(config, previousUrl, url) {
  return previousUrl === url && !config.actOnReload;
}

/**
 * What to do with the navigating tab once an existing tab was found.
 * @returns {'close' | 'back' | 'focus' | 'ignore'}
 */
export function chooseAction(config, tab, isNewTab) {
  const action = isNewTab ? 'close' : config.inTabNavigation;
  if (action === 'close' && (!config.closeDuplicate || !canCloseTab(config, tab))) return 'focus';
  return action;
}

/** Whether an action adds to the "duplicates avoided" counter. */
export function countsAsAvoided(config, action) {
  return action !== 'focus' || config.countFocusOnly;
}

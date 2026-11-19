import { canCloseTab } from './dedupe.js';

/** @typedef {import('./config.js').Config} Config */
/** @typedef {'close' | 'back' | 'focus' | 'ignore'} Action */

/**
 * Opening the page the tab already shows (reload, retyping it) is not a duplicate, unless configured so.
 * @param {Config} config
 * @param {string} previousUrl
 * @param {string} url
 */
export function isReload(config, previousUrl, url) {
  return previousUrl === url && !config.actOnReload;
}

/**
 * What to do with the navigating tab once an existing tab was found.
 * @param {Config} config
 * @param {import('./dedupe.js').Tab} tab
 * @param {boolean} isNewTab
 * @returns {Action}
 */
export function chooseAction(config, tab, isNewTab) {
  const action = isNewTab ? 'close' : /** @type {Action} */ (config.inTabNavigation);
  if (action === 'close' && (!config.closeDuplicate || !canCloseTab(config, tab))) return 'focus';
  return action;
}

/**
 * Whether an action adds to the "duplicates avoided" counter.
 * @param {Config} config
 * @param {Action} action
 */
export function countsAsAvoided(config, action) {
  return action !== 'focus' || config.countFocusOnly;
}

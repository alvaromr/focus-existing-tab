/** @param {string} key @param {string|string[]} [substitutions] */
export function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/** @param {ParentNode} root @param {string} selector @returns {HTMLElement[]} */
const all = (root, selector) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);

/**
 * Applies translations to elements carrying data-i18n (textContent),
 * data-i18n-placeholder, data-i18n-title attributes.
 * @param {ParentNode} [root]
 */
export function applyI18n(root = document) {
  for (const el of all(root, '[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of all(root, '[data-i18n-placeholder]')) {
    /** @type {HTMLInputElement} */ (el).placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of all(root, '[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  if (root === document) document.title = t(document.documentElement.dataset.i18nTitle || 'extName');
}

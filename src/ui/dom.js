// DOM lookups for the extension pages. A missing element is a broken page, so they throw with the
// selector instead of handing back null.

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el;
}

/**
 * The first element under `root` matching `selector`, typed as the control it is expected to be.
 * @template {Element} [T=HTMLInputElement]
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {T}
 */
export function one(root, selector) {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`${selector} is missing from the page`);
  return /** @type {T} */ (el);
}

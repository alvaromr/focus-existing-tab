// The configuration link: the options page address with a partial configuration in its fragment,
// `#config={"query":{"ignored":["atlOrigin"]}}`, so scripts and agents can change settings
// without the form; `#config` alone asks for the saved configuration. Format and rules:
// docs/CONFIGURATION.md, "Configuration link".
import { normalizeConfig } from './config.js';

/** @typedef {import('./config.js').Config} Config */
/** @typedef {import('./config.js').UntrustedObject} UntrustedObject */

const READ_REQUEST = '#config';
const WRITE_PREFIX = `${READ_REQUEST}=`;
const SAVED_PREFIX = '#saved=';

/**
 * The address fragment that answers a request for the saved configuration.
 * @param {string} hash the address fragment, as `location.hash`
 * @param {Config} config the saved configuration
 * @returns {string | null} `#saved=` and the configuration as percent-encoded JSON, or null when
 *   `hash` is not `#config` alone
 */
export function savedConfigFragment(hash, config) {
  return hash === READ_REQUEST ? `${SAVED_PREFIX}${encodeURIComponent(JSON.stringify(config))}` : null;
}

/** @param {unknown} value @returns {value is UntrustedObject} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether two values are both objects, or both lists of the same length, so they compare field by
 * field or item by item.
 * @param {unknown} given @param {unknown} stored
 */
function isSameShape(given, stored) {
  if (typeof given !== 'object' || given === null || typeof stored !== 'object' || stored === null) return false;
  if (Array.isArray(given) !== Array.isArray(stored)) return false;
  return !Array.isArray(given) || given.length === /** @type {unknown[]} */ (stored).length;
}

/**
 * Paths of the fields of `given` that `stored` does not hold as given. Only the fields `given`
 * names are compared, so the default fields a rule gains on normalization do not count.
 * @param {unknown} given @param {unknown} stored @param {string} path
 * @returns {string[]}
 */
function unappliedPaths(given, stored, path) {
  if (!isSameShape(given, stored)) return given === stored ? [] : [path];
  const fields = /** @type {UntrustedObject} */ (stored);
  return Object.entries(/** @type {UntrustedObject} */ (given)).flatMap(([key, value]) =>
    unappliedPaths(value, Object.hasOwn(fields, key) ? fields[key] : undefined, path ? `${path}.${key}` : key),
  );
}

/**
 * Reads the configuration link in an address fragment and applies it over the current configuration.
 * The fields it names replace the current ones; those of an object field (`normalization`, `query`)
 * replace one by one.
 * @param {string} hash the address fragment, as `location.hash`
 * @param {Config} current
 * @returns {{ config: Config, unapplied: string[] } | null} null when the fragment holds no
 *   configuration to apply (`#config` alone asks to read it); otherwise the resulting configuration and the paths of the fields it does not hold as the link
 *   gave them (unknown fields, invalid values, dropped rules)
 * @throws {URIError | SyntaxError | TypeError} when the link is not JSON of an object, raw or
 *   percent-encoded
 */
export function readConfigLink(hash, current) {
  if (!hash.startsWith(WRITE_PREFIX)) return null;
  const patch = JSON.parse(decodeURIComponent(hash.slice(WRITE_PREFIX.length)));
  if (!isObject(patch)) throw new TypeError('The configuration link holds no JSON object.');
  const base = /** @type {UntrustedObject} */ (current);
  // fromEntries defines a `__proto__` key as a plain field instead of setting the prototype.
  const merged = Object.fromEntries([
    ...Object.entries(base),
    ...Object.entries(patch).map(([key, value]) => [
      key,
      isObject(value) && isObject(base[key]) ? { ...base[key], ...value } : value,
    ]),
  ]);
  const { config } = normalizeConfig(merged);
  return { config, unapplied: unappliedPaths(patch, config, '') };
}

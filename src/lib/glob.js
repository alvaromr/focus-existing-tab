// Minimal glob: `*` matches any run of characters (including `/`), `?` matches one.
/** @type {Map<string, RegExp>} */
const cache = new Map();

/** @param {string} glob */
export function globToRegExpSource(glob) {
  return glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

/** @param {string} glob @param {string} flags */
function globToRegExp(glob, flags) {
  const key = `${flags}:${glob}`;
  let re = cache.get(key);
  // Stryker disable next-line ConditionalExpression: the cache only saves recompiling; skipping it changes no result.
  if (!re) {
    re = new RegExp(`^${globToRegExpSource(glob)}$`, flags);
    // Stryker disable next-line CallExpression: cache only, as above.
    cache.set(key, re);
  }
  return re;
}

/** @param {string} glob @param {string} value @param {string} flags */
function globMatches(glob, value, flags) {
  return globToRegExp(glob, flags).test(value);
}

/** @param {readonly string[]} globs @param {string} value @param {string} [flags] */
export function matchesAnyGlob(globs, value, flags = '') {
  return globs.some((g) => globMatches(g, value, flags));
}

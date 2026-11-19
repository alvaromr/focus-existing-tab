// Minimal glob: `*` matches any run of characters (including `/`), `?` matches one.
const cache = new Map();

export function globToRegExpSource(glob) {
  return glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

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

function globMatches(glob, value, flags) {
  return globToRegExp(glob, flags).test(value);
}

export function matchesAnyGlob(globs, value, flags = '') {
  return globs.some((g) => globMatches(g, value, flags));
}

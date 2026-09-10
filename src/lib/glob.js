// Minimal glob: `*` matches any run of characters (including `/`), `?` matches one.
const cache = new Map();

export function globToRegExpSource(glob) {
  return glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

export function globToRegExp(glob, flags = '') {
  const key = `${flags}:${glob}`;
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(`^${globToRegExpSource(glob)}$`, flags);
    cache.set(key, re);
  }
  return re;
}

export function globMatches(glob, value, flags = '') {
  return globToRegExp(glob, flags).test(value);
}

export function matchesAnyGlob(globs, value, flags = '') {
  return globs.some((g) => globMatches(g, value, flags));
}

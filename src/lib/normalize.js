import { matchesAnyGlob } from './glob.js';

// URLs that mean "empty tab": a navigation away from them is treated as a fresh tab.
const BLANK_URLS = new Set([
  '',
  'about:blank',
  'about:newtab',
  'chrome://newtab/',
  'chrome://new-tab-page/',
  'chrome://new-tab-page-third-party/',
  'edge://newtab/',
  'brave://newtab/',
]);

export function isBlankUrl(url) {
  return BLANK_URLS.has(url || '');
}

export function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Only regular web pages are deduplicated. Everything else (chrome://, about:,
// chrome-extension://, file://, data:, view-source:, devtools://…) is internal.
export function isEligibleUrl(url) {
  const u = url instanceof URL ? url : parseUrl(url);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
}

function filterParams(entries, query) {
  const significant = query.significant || [];
  const ignored = query.ignored || [];
  return entries.filter(([name]) => {
    if (matchesAnyGlob(significant, name)) return true;
    if (matchesAnyGlob(ignored, name)) return false;
    return query.compare;
  });
}

function compareEntries([ka, va], [kb, vb]) {
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (va === vb) return 0;
  return va < vb ? -1 : 1;
}

/**
 * Builds the comparison key of a URL. Two URLs are duplicates when their keys are equal.
 * Returns null for non-eligible URLs.
 * @param {string|URL} url
 * @param {import('./config.js').Normalization} normalization
 * @param {import('./config.js').QueryOptions} query
 * @returns {string|null}
 */
export function normalizeUrl(url, normalization, query) {
  const u = url instanceof URL ? url : parseUrl(url);
  if (!isEligibleUrl(u)) return null;

  const scheme = normalization.ignoreScheme ? 'http:' : u.protocol;
  let host = normalization.caseInsensitiveHost ? u.hostname.toLowerCase() : u.hostname;
  if (normalization.ignoreWww) host = host.replace(/^www\./, '');
  const port = u.port && !normalization.ignorePort ? `:${u.port}` : '';

  let path = u.pathname;
  if (normalization.ignoreTrailingSlash) path = path.replace(/\/+$/, '') || '/';
  if (normalization.caseInsensitivePath) path = path.toLowerCase();

  const kept = filterParams([...u.searchParams.entries()], query);
  if (!query.orderMatters) kept.sort(compareEntries);
  const search = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';

  const hash = normalization.ignoreFragment || u.hash === '#' ? '' : u.hash;

  return `${scheme}//${host}${port}${path}${search}${hash}`;
}

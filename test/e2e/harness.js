// Shared harness of the e2e suites: a local test server, headless Chromium with the extension
// (scripts/lib/cdp.js), polling helpers and the check log. Each suite starts its own browser, so
// its scenarios never see another suite's tabs, settings or counter.
import { createServer } from 'node:http';
import { launchChromium, sleep } from '../../scripts/lib/cdp.js';

/** @typedef {(url: string) => boolean} UrlMatch */

/** @param {string} prefix @returns {UrlMatch} */
export const startsWith = (prefix) => (url) => url.startsWith(prefix);
/** @param {string} expected @returns {UrlMatch} */
export const equals = (expected) => (url) => url === expected;

// Polls `probe` until `done(value)` holds or the timeout passes, and returns the last value.
// Checks wait for the outcome instead of sleeping a fixed time, which races a slow machine.
/**
 * @template T
 * @param {() => Promise<T>} probe
 * @param {(value: T) => boolean} done
 * @returns {Promise<T>}
 */
export async function waitFor(probe, done, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(50);
  }
}

/** @param {{ extraArgs?: string[] }} [options] passed to launchChromium */
export async function startSuite(options) {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    res.setHeader('content-type', 'text/html');
    if (url.startsWith('/redirect')) {
      res.writeHead(302, { location: '/a' });
      return res.end();
    }
    res.end(`<title>${url}</title><h1>${url}</h1>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
  // Listening on a TCP port, the address is an AddressInfo.
  const BASE = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const browser = await launchChromium(options);
  const { events, pages, evaluate, swSession } = browser;

  /** @type {{ name: string, ok: boolean }[]} */
  const results = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const urls = async () => JSON.stringify((await pages()).map((t) => t.url));
  /** @param {UrlMatch} match */
  const countPages = async (match) => (await pages()).filter((t) => match(t.url)).length;
  // Every tab as the extension sees it, and the service worker's warnings: the detail of a failed check.
  const tabsSeen = async () =>
    JSON.stringify({
      tabs: await evaluate(
        swSession,
        `chrome.tabs.query({}).then((ts) => ts.map((t) => [t.id, t.windowId, t.groupId, t.status, t.url || t.pendingUrl]))`,
      ),
      warnings: events
        .filter(
          (e) => e.sessionId === swSession && e.method === 'Runtime.consoleAPICalled' && e.params.type === 'warning',
        )
        .map((e) =>
          e.params.args?.map((/** @type {{ value?: unknown, description?: string }} */ a) => a.value ?? a.description),
        ),
    });
  // While a page is navigating its execution context can vanish; the poll then simply retries.
  /** @param {string} sessionId @param {string} expression */
  const read = (sessionId, expression) => evaluate(sessionId, expression).catch(() => undefined);
  // A new target starts on a complete about:blank before navigating to its URL: wait for a page of
  // the test server, or a slow machine moves on before the navigation has even started.
  /** @param {string} sessionId */
  const loaded = (sessionId) =>
    waitFor(
      () => read(sessionId, 'document.readyState + " " + location.origin'),
      (state) => state === `complete ${BASE}`,
    );

  /** Checks that neither the given pages nor the service worker threw or logged an error. @param {string[]} pageSessions */
  const checkNoErrors = async (pageSessions) => {
    // Grace period for asynchronous errors triggered by the last actions to reach the event log.
    await sleep(500);
    const pageErrors = events.filter(
      (e) => pageSessions.includes(e.sessionId) && e.method === 'Runtime.exceptionThrown',
    );
    check(
      'no page exceptions',
      pageErrors.length === 0,
      JSON.stringify(pageErrors.map((e) => e.params.exceptionDetails?.exception?.description)),
    );
    const swErrors = events.filter(
      (e) =>
        e.sessionId === swSession &&
        (e.method === 'Runtime.exceptionThrown' ||
          (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')),
    );
    check(
      'no service worker errors',
      swErrors.length === 0,
      JSON.stringify(
        swErrors.map(
          (e) =>
            e.params.exceptionDetails?.exception?.description ||
            e.params.args?.map((/** @type {{ value: unknown }} */ a) => a.value),
        ),
      ),
    );
  };

  /** Runs the suite's scenarios, then closes everything and exits with the result. @param {() => Promise<void>} scenarios */
  const run = async (scenarios) => {
    try {
      await scenarios();
    } finally {
      await browser.close();
      server.close();
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  };

  return { ...browser, BASE, check, urls, countPages, tabsSeen, read, loaded, checkNoErrors, run };
}

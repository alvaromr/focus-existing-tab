// End-to-end smoke test: headless Chromium + the unpacked extension, driven over CDP.
// Browser requirements and CHROME override: see scripts/lib/cdp.js. Usage: pnpm test:e2e
import { createServer } from 'node:http';
import { launchChromium, sleep } from '../../scripts/lib/cdp.js';

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

const browser = await launchChromium();
const { cdp, events, pages, open, attach, evaluate, extId, swSession } = browser;

/** @type {{ name: string, ok: boolean }[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
/** @typedef {(url: string) => boolean} UrlMatch */
const urls = async () => JSON.stringify((await pages()).map((t) => t.url));
/** @param {UrlMatch} match */
const countPages = async (match) => (await pages()).filter((t) => match(t.url)).length;
/** @param {string} prefix @returns {UrlMatch} */
const startsWith = (prefix) => (url) => url.startsWith(prefix);
/** @param {string} expected @returns {UrlMatch} */
const equals = (expected) => (url) => url === expected;

// Polls `probe` until `done(value)` holds or the timeout passes, and returns the last value.
// Checks wait for the outcome instead of sleeping a fixed time, which races a slow machine.
/**
 * @template T
 * @param {() => Promise<T>} probe
 * @param {(value: T) => boolean} done
 * @returns {Promise<T>}
 */
async function waitFor(probe, done, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(50);
  }
}
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
/** @param {string} sessionId */
// A new target starts on a complete about:blank before navigating to its URL: wait for a page of
// the test server, or a slow machine moves on before the navigation has even started.
const loaded = (sessionId) =>
  waitFor(
    () => read(sessionId, 'document.readyState + " " + location.origin'),
    (state) => state === `complete ${BASE}`,
  );

try {
  // 1. New tab with a duplicate URL (tracking param + fragment) is closed.
  const first = await open(`${BASE}/a`);
  await loaded(await attach(first));
  await open(`${BASE}/a?utm_source=x#frag`);
  const afterDuplicate = await waitFor(
    () => countPages(startsWith(`${BASE}/a`)),
    (n) => n === 1,
  );
  check('duplicate new tab closed', afterDuplicate === 1, await urls());
  check(
    'original tab kept and active',
    (await pages()).some((t) => t.targetId === first),
  );

  // 2. Different query value is not a duplicate.
  await loaded(await attach(await open(`${BASE}/a?id=2`)));
  check('different significant param is kept', (await countPages(startsWith(`${BASE}/a`))) === 2, await urls());

  // 3. Redirect to a duplicate URL: caught at onCommitted.
  await open(`${BASE}/redirect`);
  const afterRedirect = await waitFor(
    async () => (await pages()).map((t) => t.url),
    (list) => list.filter(equals(`${BASE}/a`)).length === 1 && !list.some((u) => u.includes('redirect')),
  );
  check(
    'redirected duplicate closed',
    afterRedirect.filter(equals(`${BASE}/a`)).length === 1 && !afterRedirect.some((u) => u.includes('redirect')),
    JSON.stringify(afterRedirect),
  );

  // 4. In-tab navigation to a duplicate: focus existing and go back.
  const b = await open(`${BASE}/b`);
  const bSession = await attach(b);
  await loaded(bSession);
  await cdp('Page.navigate', { url: `${BASE}/a` }, bSession);
  const bUrl = await waitFor(
    async () => (await pages()).find((t) => t.targetId === b)?.url,
    (url) => url === `${BASE}/b`,
  );
  check('in-tab duplicate went back', bUrl === `${BASE}/b`, bUrl === `${BASE}/b` ? bUrl : await tabsSeen());
  check('tab count after in-tab back', (await countPages(equals(`${BASE}/a`))) === 1);

  // 5. Reload of an existing page is not treated as a duplicate.
  const documentId = `performance.timeOrigin + ':' + document.readyState`;
  const before = await evaluate(bSession, documentId);
  await cdp('Page.reload', {}, bSession);
  await waitFor(
    () => read(bSession, documentId),
    (id) => id !== undefined && id !== before && id.endsWith(':complete'),
  );
  check(
    'reload keeps the tab',
    (await pages()).some((t) => t.targetId === b),
  );

  // 6. Excluded groups, by default Claude in Chrome's ("Claude", with a status prefix while it
  // works), are isolated both ways: Claude may open a page the user has open, and its tabs never
  // block the user.
  const claude = await evaluate(
    swSession,
    `(async () => {
      const blank = await chrome.tabs.create({ url: 'about:blank' });
      const groupId = await chrome.tabs.group({ tabIds: [blank.id] });
      await chrome.tabGroups.update(groupId, { title: '⌛Claude' });
      await chrome.tabs.update(blank.id, { url: '${BASE}/a' });
      return blank.id;
    })()`,
  );
  const claudeTab = () =>
    evaluate(swSession, `chrome.tabs.get(${claude}).then((t) => t.status + ' ' + t.url, () => null)`);
  const claudeState = await waitFor(claudeTab, (s) => s === `complete ${BASE}/a`);
  check('Claude group may open a page open elsewhere', claudeState === `complete ${BASE}/a`, claudeState);
  await evaluate(swSession, `chrome.tabs.update(${claude}, { url: '${BASE}/d' })`);
  await waitFor(claudeTab, (s) => s === `complete ${BASE}/d`);
  await loaded(await attach(await open(`${BASE}/d`)));
  check('Claude group tab does not block the user', (await countPages(equals(`${BASE}/d`))) === 2, await urls());
  await evaluate(swSession, `chrome.tabs.remove(${claude})`);

  // 7. Badge counter.
  const badgeText = () => evaluate(swSession, 'chrome.action.getBadgeText({})');
  const badge = await waitFor(badgeText, (text) => text === '3');
  check('badge shows counter', badge === '3', `badge=${badge}`);

  // 8. Popup: toggle off, open duplicates (kept), toggle on, dedupe-all closes them.
  const popupSession = await attach(await open(`chrome-extension://${extId}/popup/popup.html`));
  const counterShown = (/** @type {string} */ text) => /(Duplicates avoided|Duplicados evitados)\s*3\b/.test(text);
  const popupText = await waitFor(() => read(popupSession, 'document.body?.innerText ?? ""'), counterShown);
  check('popup renders localized text and counter', counterShown(popupText), JSON.stringify(popupText));
  await evaluate(popupSession, 'document.getElementById("enabled").click()');
  const badgeOff = await waitFor(badgeText, (text) => text === 'OFF');
  check('badge shows OFF when disabled', badgeOff === 'OFF', `badge=${badgeOff}`);
  for (const path of ['/c', '/c', '/c?utm_medium=y']) await loaded(await attach(await open(`${BASE}${path}`)));
  check('disabled: duplicates are kept', (await countPages(startsWith(`${BASE}/c`))) === 3);
  await evaluate(popupSession, 'document.getElementById("enabled").click()');
  await waitFor(badgeText, (text) => text !== 'OFF');
  await evaluate(popupSession, 'document.getElementById("dedupe").click()');
  const popupMsg = await waitFor(
    () => evaluate(popupSession, 'document.getElementById("message").textContent'),
    (text) => /^2 /.test(text),
  );
  const dedupedAll = (await countPages(startsWith(`${BASE}/c`))) === 1 && /^2 /.test(popupMsg);
  check('dedupeAll closes remaining duplicates', dedupedAll, dedupedAll ? popupMsg : `${popupMsg} ${await tabsSeen()}`);

  // 9. Options page loads, validates and saves.
  const optSession = await attach(await open(`chrome-extension://${extId}/options/options.html`));
  await waitFor(
    () => read(optSession, `document.querySelector('[name="excludedGroups"]')?.value ?? ''`),
    (value) => Boolean(value),
  );
  const o = await evaluate(
    optSession,
    `(async () => {
      const until = async (done) => { for (let i = 0; i < 200 && !(await done()); i++) await new Promise(r => setTimeout(r, 50)); };
      const groupsField = document.querySelector('[name="excludedGroups"]');
      const shownGroups = groupsField.value;
      groupsField.value = shownGroups + '\\nWork';
      document.querySelector('button.add[data-list="blacklist"]').click();
      const row = document.querySelector('table[data-list="blacklist"] tbody tr:last-child');
      row.querySelector('.r-pattern').value = '(';
      row.querySelector('.r-type').value = 'regex';
      document.getElementById('save').click();
      await until(() => !document.getElementById('errors').hidden);
      const errorShown = !document.getElementById('errors').hidden;
      row.querySelector('.r-pattern').value = 'bank.com';
      row.querySelector('.r-type').value = 'glob';
      document.getElementById('save').click();
      const saved = async () => (await chrome.storage.sync.get('config')).config?.blacklist?.length > 0;
      await until(saved);
      const { config } = await chrome.storage.sync.get('config');
      document.getElementById('testUrl').value = 'https://online.bank.com/x';
      document.getElementById('testUrl').dispatchEvent(new Event('input'));
      return { errorShown, shownGroups, savedGroups: config.excludedGroups, saved: config.blacklist.map(r => r.pattern), status: document.getElementById('status').textContent, test: document.getElementById('testDecision').textContent };
    })()`,
  );
  check('options validates invalid regex', o.errorShown === true, JSON.stringify(o));
  check('options saves a rule and tester reflects it', o.saved?.[0] === 'bank.com' && /No act|No actúa/.test(o.test));
  check(
    'options shows and saves excluded groups',
    o.shownGroups === 'Claude\nClaude (MCP)\n?Claude\n?Claude (MCP)' && o.savedGroups?.at(-1) === 'Work',
    JSON.stringify({ shown: o.shownGroups, saved: o.savedGroups }),
  );
  // Grace period for asynchronous errors triggered by the last actions to reach the event log.
  await sleep(500);

  const pageErrors = events.filter(
    (e) => [popupSession, optSession].includes(e.sessionId) && e.method === 'Runtime.exceptionThrown',
  );
  check(
    'no popup/options exceptions',
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
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

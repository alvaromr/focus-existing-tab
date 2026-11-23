// End-to-end scenarios that depend on a setting or on the browser around the tab: windows,
// lists, pinned tabs, groups, ranking, in-tab actions, internal pages, help and language.
// Each scenario starts from the default configuration and no test tab. Usage: pnpm test:e2e
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_DIR, launchChromium } from '../../scripts/lib/cdp.js';
import { startSuite, waitFor } from './harness.js';

const { BASE, open, attach, evaluate, extId, swSession, ...suite } = await startSuite();
const { check, tabsSeen, read } = suite;

/** @typedef {{ id: number, windowId: number, active: boolean, url: string }} SeenTab */

/** @param {string} expression run in the service worker */
const sw = (expression) => evaluate(swSession, expression);
/** @param {string} path @returns {Promise<SeenTab[]>} the tabs showing BASE + path, loaded or not */
const tabsAt = (path) =>
  sw(`chrome.tabs.query({}).then((ts) => ts
    .map((t) => ({ id: t.id, windowId: t.windowId, active: t.active, url: t.url || t.pendingUrl }))
    .filter((t) => t.url === '${BASE}${path}'))`);
/** @param {string} path @param {number} count */
const waitTabs = (path, count) =>
  waitFor(
    () => tabsAt(path),
    (ts) => ts.length === count,
  );
/** @param {number} tabId @param {string} path */
const waitLoaded = (tabId, path) =>
  waitFor(
    () => sw(`chrome.tabs.get(${tabId}).then((t) => t.status + ' ' + t.url, () => null)`),
    (s) => s === `complete ${BASE}${path}`,
  );
/** Opens BASE + path in a new tab and waits until it shows the page. @param {string} path @param {number} [windowId] */
const openTab = async (path, windowId) => {
  const where = windowId === undefined ? '' : `windowId: ${windowId}, `;
  const tab = await sw(`chrome.tabs.create({ ${where}url: '${BASE}${path}' }).then((t) => t.id)`);
  await waitLoaded(tab, path);
  return /** @type {number} */ (tab);
};
// A duplicate opened in a new tab: the extension acts at onBeforeNavigate, so waiting for the
// page to load leaves no room for an action still to come.
/** @param {string} path @param {number} [windowId] */
const openDuplicate = async (path, windowId) => {
  const where = windowId === undefined ? '' : `windowId: ${windowId}, `;
  const tab = await sw(`chrome.tabs.create({ ${where}url: '${BASE}${path}' }).then((t) => t.id)`);
  await waitFor(
    () => sw(`chrome.tabs.get(${tab}).then((t) => t.status, () => 'gone')`),
    (s) => s === 'complete' || s === 'gone',
  );
  return /** @type {number} */ (tab);
};
/** @param {number} tabId */
const isActive = (tabId) => sw(`chrome.tabs.get(${tabId}).then((t) => t.active, () => null)`);
// A headless browser reports every window as focused, so the window the extension brings to the
// front is read from its calls: windows.update is wrapped to record the ids it focuses, and how.
await sw(`(() => {
  globalThis.focusedWindows = [];
  const update = chrome.windows.update.bind(chrome.windows);
  chrome.windows.update = (id, info) => {
    if (info.focused) globalThis.focusedWindows.push({ id, state: info.state });
    return update(id, info);
  };
})()`);
const lastFocusedWindow = () => sw('globalThis.focusedWindows.at(-1)?.id ?? null');
// The user types the address: driven over CDP like the address bar, not through chrome.tabs.update.
/** @param {string} from the page the tab shows, unique among the open ones @param {string} to */
const typeInTab = async (from, to) => {
  const target = (await suite.pages()).find((t) => t.url === `${BASE}${from}`);
  if (!target) throw new Error(`no tab shows ${from}: ${await tabsSeen()}`);
  await suite.cdp('Page.navigate', { url: `${BASE}${to}` }, await attach(target.targetId));
};

// Settings go through the extension's own storage and are read back through its message API,
// so a scenario starts only once the service worker holds them.
const pageSession = await attach(await open(`chrome-extension://${extId}/popup/popup.html`));
const getConfig = () =>
  read(pageSession, `chrome.runtime.sendMessage({ type: 'getState' }).then((r) => r.result.config)`);
/** @param {Record<string, unknown>} patch */
const setConfig = async (patch) => {
  const config = { ...(await getConfig()), ...patch };
  await evaluate(pageSession, `chrome.storage.sync.set({ config: ${JSON.stringify(config)} })`);
  const wanted = JSON.stringify(Object.values(patch));
  /** @param {Record<string, unknown>} c */
  const holds = (c) => JSON.stringify(Object.keys(patch).map((k) => c?.[k])) === wanted;
  check(`settings applied: ${Object.keys(patch).join(', ')}`, holds(await waitFor(getConfig, holds)));
};
// Back to the default configuration and to no tab of the test server.
const reset = async () => {
  await evaluate(pageSession, `chrome.storage.sync.remove('config')`);
  await sw('globalThis.focusedWindows = []');
  await waitFor(getConfig, (c) => c?.blacklist?.length === 0 && c?.closeDuplicate === true);
  await sw(`chrome.tabs.query({}).then((ts) => chrome.tabs.remove(
    ts.filter((t) => (t.url || t.pendingUrl || '').startsWith('${BASE}')).map((t) => t.id)))`);
};

await suite.run(async () => {
  // 1. Another window, minimized: it is restored and focused, and the duplicate closed.
  const w1 = await sw(`chrome.windows.create({ url: '${BASE}/w' }).then((w) => w.id)`);
  const [inW1] = await waitTabs('/w', 1);
  await waitLoaded(inW1.id, '/w');
  await sw(`chrome.windows.update(${w1}, { state: 'minimized' })`);
  const w2 = await sw(`chrome.windows.create({ url: 'about:blank' }).then((w) => w.id)`);
  await openDuplicate('/w', w2);
  const afterWindow = await waitTabs('/w', 1);
  check('duplicate in another window closed', afterWindow.length === 1, JSON.stringify(afterWindow));
  const focusCall = await waitFor(
    () => sw('globalThis.focusedWindows.at(-1) ?? null'),
    (call) => call?.id === w1,
  );
  check(
    'existing tab focused, its window restored and focused',
    (await isActive(inW1.id)) === true && focusCall?.id === w1 && focusCall?.state === 'normal',
    JSON.stringify(focusCall),
  );
  await reset();

  // 2. Blacklist: a listed site is never deduplicated.
  // As stored: normalizeConfig completes a rule with these defaults.
  const rule = {
    pattern: '127.0.0.1',
    type: 'glob',
    enabled: true,
    query: { compare: null, ignored: null, significant: null },
  };
  await setConfig({ blacklist: [rule] });
  await openTab('/k');
  await openDuplicate('/k');
  check('blacklisted duplicate kept', (await tabsAt('/k')).length === 2, await tabsSeen());
  await reset();

  // 3. Whitelist mode with an empty list acts nowhere.
  await setConfig({ mode: 'whitelist' });
  await openTab('/k');
  await openDuplicate('/k');
  check('whitelist mode, empty list: duplicate kept', (await tabsAt('/k')).length === 2, await tabsSeen());
  await reset();

  // 4. Pinned: by default a pinned tab is focused and the duplicate closed; ignored, it is no original.
  const pinned = await openTab('/p');
  await sw(`chrome.tabs.update(${pinned}, { pinned: true })`);
  await openDuplicate('/p');
  check('duplicate of a pinned tab closed', (await waitTabs('/p', 1)).length === 1, await tabsSeen());
  check('pinned tab focused', (await isActive(pinned)) === true);
  await setConfig({ pinnedPolicy: 'ignore' });
  await openDuplicate('/p');
  check('pinned tabs ignored: duplicate kept', (await tabsAt('/p')).length === 2, await tabsSeen());
  await reset();

  // 5. Focus only: the existing tab is focused and the duplicate stays open.
  await setConfig({ closeDuplicate: false });
  const original = await openTab('/f');
  await openDuplicate('/f');
  const focused = await waitFor(
    () => isActive(original),
    (a) => a === true,
  );
  check('focus only: duplicate kept', (await tabsAt('/f')).length === 2, await tabsSeen());
  check('focus only: existing tab focused', focused === true);
  await reset();

  // 6. Ignored parameters: a parameter listed as ignored no longer tells pages apart.
  await openTab('/q?a=1');
  await openDuplicate('/q?a=2');
  check('different parameter value kept', (await tabsAt('/q?a=2')).length === 1, await tabsSeen());
  const { query } = await getConfig();
  await setConfig({ query: { ...query, ignored: [...query.ignored, 'a'] } });
  await openDuplicate('/q?a=3');
  check('ignored parameter: duplicate closed', (await waitTabs('/q?a=3', 0)).length === 0, await tabsSeen());
  await reset();

  // 7. In-tab navigation, "Only focus" and "Do nothing": the tab keeps the page it opened.
  for (const [inTabNavigation, existingFocused] of /** @type {const} */ ([
    ['focus', true],
    ['ignore', false],
  ])) {
    await setConfig({ inTabNavigation });
    const existing = await openTab('/i');
    const navigating = await openTab('/y');
    await typeInTab('/y', '/i');
    await waitLoaded(navigating, '/i');
    const active = await waitFor(
      () => isActive(existing),
      (a) => a === existingFocused,
    );
    check(`in-tab "${inTabNavigation}": tab stays on the page`, (await tabsAt('/i')).length === 2, await tabsSeen());
    check(`in-tab "${inTabNavigation}": existing tab focused is ${existingFocused}`, active === existingFocused);
    await reset();
  }

  // 8. Priority: the same window wins by default; with "Is the active tab" first, the active one.
  // Disabled while the page is opened in both windows, or the second one would be closed.
  await setConfig({ enabled: false });
  const p1 = await sw(`chrome.windows.create({ url: '${BASE}/r' }).then((w) => w.id)`);
  const [inP1] = await waitTabs('/r', 1);
  await waitLoaded(inP1.id, '/r');
  const p2 = await sw(`chrome.windows.create({ url: 'about:blank' }).then((w) => w.id)`);
  const inP2 = await openTab('/r', p2);
  const third = await openTab('/x', p1);
  await setConfig({ enabled: true });
  await typeInTab('/x', '/r');
  const sameWindow = await waitFor(
    () => isActive(inP1.id),
    (a) => a === true,
  );
  check(
    'priority: the tab in the same window is focused',
    sameWindow === true && (await lastFocusedWindow()) === p1,
    await tabsSeen(),
  );
  await waitLoaded(third, '/x');
  await setConfig({ ranking: ['active', 'window', 'pinned', 'loaded'] });
  await sw(`chrome.tabs.update(${third}, { active: true })`);
  await typeInTab('/x', '/r');
  const activeFirst = await waitFor(lastFocusedWindow, (id) => id === p2);
  await waitLoaded(third, '/x');
  check(
    'priority: with "active" first, the active tab in the other window is focused',
    activeFirst === p2 && (await isActive(inP2)) === true && (await isActive(inP1.id)) === false,
    await tabsSeen(),
  );
  await reset();

  // 9. Groups: a grouped tab blocks an ungrouped duplicate, unless only the same group counts.
  const grouped = await openTab('/g');
  await sw(`chrome.tabs.group({ tabIds: [${grouped}] })`);
  await openDuplicate('/g');
  check('duplicate outside the group closed', (await waitTabs('/g', 1)).length === 1, await tabsSeen());
  await setConfig({ groupPolicy: 'same' });
  await openDuplicate('/g');
  check('same group only: duplicate kept', (await tabsAt('/g')).length === 2, await tabsSeen());
  await reset();

  // 10. Internal pages are never deduplicated.
  const internalTabs = () =>
    sw(`chrome.tabs.query({}).then((ts) => ts
      .filter((t) => (t.url || t.pendingUrl) === 'chrome://version/').map((t) => t.status))`);
  for (let i = 0; i < 2; i++) await sw(`chrome.tabs.create({ url: 'chrome://version/' })`);
  // Settled once no tab is loading: the second one was then either kept or closed.
  const internal = await waitFor(internalTabs, (ss) => !ss.includes('loading'));
  check('internal pages kept', internal.length === 2, await tabsSeen());

  // 10b. Shortcuts: both commands have a key. Pressing one is manual: a key event sent over the
  // DevTools protocol reaches the page, never the extension's shortcut.
  const commands = await sw(`chrome.commands.getAll().then((cs) => cs.map((c) => [c.name, Boolean(c.shortcut)]))`);
  const keyed = new Map(commands);
  check(
    'shortcuts registered',
    keyed.get('dedupe-all') === true && keyed.get('toggle-enabled') === true,
    JSON.stringify(commands),
  );

  // 11. Help: a "?" unfolds its text under the option and folds it again.
  const options = await attach(await open(`chrome-extension://${extId}/options/options.html`));
  await waitFor(
    () => read(options, `document.querySelectorAll('button.help').length`),
    (n) => n > 0,
  );
  const help = await evaluate(
    options,
    `(() => {
      const button = document.querySelector('button.help');
      const note = button.closest('[data-help]').nextElementSibling;
      const state = () => [note.hidden, button.getAttribute('aria-expanded')];
      const before = state();
      button.click();
      const open = state();
      button.click();
      return { before, open, closed: state(), text: note.textContent === button.title };
    })()`,
  );
  check(
    'help unfolds and folds',
    JSON.stringify(help) ===
      JSON.stringify({ before: [true, 'false'], open: [false, 'true'], closed: [true, 'false'], text: true }),
    JSON.stringify(help),
  );

  // 12. URL tester: it decides with the settings in the form, even unsaved ones.
  const tester = await evaluate(
    options,
    `(async () => {
      const test = () => {
        const field = document.getElementById('testUrl');
        field.value = '${BASE}/a?utm_source=x';
        field.dispatchEvent(new Event('input'));
        return ['testDecision', 'testRule', 'testKey'].map((id) => document.getElementById(id).textContent);
      };
      const before = test();
      document.querySelector('button.add[data-list="blacklist"]').click();
      document.querySelector('table[data-list="blacklist"] tbody tr:last-child .r-pattern').value = '127.0.0.1';
      const after = test();
      const { config } = await chrome.storage.sync.get('config');
      return { before, after, saved: config?.blacklist ?? [] };
    })()`,
  );
  check(
    'URL tester: decision, rule and key',
    tester.before[0] === (await evaluate(options, `chrome.i18n.getMessage('reasonOk')`)) &&
      tester.before[2] === `${BASE}/a`,
    JSON.stringify(tester),
  );
  check(
    'URL tester: an unsaved blacklist rule changes the decision',
    tester.after[0] === (await evaluate(options, `chrome.i18n.getMessage('reasonBlacklisted')`)) &&
      tester.saved.length === 0,
    JSON.stringify(tester),
  );

  // 13. Export and import: the exported form comes back whole; invalid rules are dropped with a warning.
  const files = mkdtempSync(join(tmpdir(), 'fet-files-'));
  try {
    await suite.cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: files });
    const exported = join(files, 'focus-existing-tab-config.json');
    await evaluate(options, `document.getElementById('export').click()`);
    await waitFor(
      async () => existsSync(exported),
      (done) => done,
    );
    const json = JSON.parse(readFileSync(exported, 'utf8'));
    check('export holds the form', json.blacklist?.[0]?.pattern === '127.0.0.1', JSON.stringify(json.blacklist));
    await suite.cdp('DOM.enable', {}, options);
    /** @param {string} file */
    const importFile = async (file) => {
      const { root } = await suite.cdp('DOM.getDocument', {}, options);
      const { nodeId } = await suite.cdp(
        'DOM.querySelector',
        { nodeId: root.nodeId, selector: '#importFile' },
        options,
      );
      await suite.cdp('DOM.setFileInputFiles', { nodeId, files: [file] }, options);
    };
    const status = () => read(options, `document.getElementById('status').textContent`);
    const closeField = `document.querySelector('[name="closeDuplicate"]')`;
    await evaluate(options, `${closeField}.checked = false`);
    await importFile(exported);
    const loadedMessage = await evaluate(options, `chrome.i18n.getMessage('importLoaded')`);
    const afterImport = await waitFor(status, (s) => s === loadedMessage);
    check(
      'import fills the form back',
      afterImport === loadedMessage && (await evaluate(options, `${closeField}.checked`)) === true,
      JSON.stringify(afterImport),
    );
    const invalid = join(files, 'invalid.json');
    writeFileSync(invalid, JSON.stringify({ blacklist: [{ pattern: '(', type: 'regex' }] }));
    await importFile(invalid);
    const dropped = await evaluate(options, `chrome.i18n.getMessage('importDropped', ['1'])`);
    const afterInvalid = await waitFor(status, (s) => s?.endsWith(dropped));
    check('import warns of a dropped invalid rule', afterInvalid?.endsWith(dropped), JSON.stringify(afterInvalid));
  } finally {
    rmSync(files, { recursive: true, force: true });
  }
  await suite.checkNoErrors([pageSession, options]);

  // 14. Language: the pages follow the browser's language, whatever the system's is.
  for (const language of ['en', 'es']) {
    const label = JSON.parse(readFileSync(join(REPO_DIR, '_locales', language, 'messages.json'), 'utf8'))
      .popupAvoidedLabel.message;
    const browser = await launchChromium({ language });
    try {
      const popup = await browser.attach(await browser.open(`chrome-extension://${browser.extId}/popup/popup.html`));
      const text = await waitFor(
        () => browser.evaluate(popup, 'document.body?.innerText ?? ""').catch(() => ''),
        (t) => t.includes(label),
      );
      check(`browser in "${language}": popup in "${language}"`, text.includes(label), JSON.stringify(text));
    } finally {
      await browser.close();
    }
  }
});

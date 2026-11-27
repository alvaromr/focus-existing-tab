// End-to-end smoke test: headless Chromium + the unpacked extension, driven over CDP.
// Browser requirements and CHROME override: see scripts/lib/cdp.js. Usage: pnpm test:e2e
import { isDeepStrictEqual } from 'node:util';
import { equals, startSuite, startsWith, waitFor } from './harness.js';

const { BASE, cdp, pages, open, attach, evaluate, extId, swSession, ...suite } = await startSuite();
const { check, urls, countPages, tabsSeen, read, loaded } = suite;

await suite.run(async () => {
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

  // 10. Configuration link: saves the fields it names, all or nothing; a web page cannot open it.
  const optionsUrl = `chrome-extension://${extId}/options/options.html`;
  const stored = () => evaluate(optSession, `chrome.storage.sync.get('config').then((s) => s.config)`);
  /** @param {string} key @param {string[]} [substitutions] */
  const message = (key, substitutions = []) =>
    evaluate(optSession, `chrome.i18n.getMessage(${JSON.stringify(key)}, ${JSON.stringify(substitutions)})`);
  /** @type {string[]} */
  const linkSessions = [];
  /** Opens a configuration link; returns the page's status and fragment once it shows a status. @param {string} json @param {boolean} [raw] */
  const openLink = async (json, raw = false) => {
    const session = await attach(await open(`${optionsUrl}#config=${raw ? json : encodeURIComponent(json)}`));
    linkSessions.push(session);
    return waitFor(
      () => read(session, `({ status: document.getElementById('status').textContent, hash: location.hash })`),
      (page) => Boolean(page?.status),
    );
  };
  const savedBefore = await stored();
  const applied = await openLink('{"showBadge":false,"query":{"ignored":["atlOrigin"]}}');
  const savedAfter = await stored();
  const expected = { ...savedBefore, showBadge: false, query: { ...savedBefore.query, ignored: ['atlOrigin'] } };
  check(
    'configuration link saves the fields it names and keeps the rest',
    applied?.status === (await message('statusSaved')) &&
      applied?.hash === '' &&
      JSON.stringify(savedAfter) === JSON.stringify(expected),
    JSON.stringify({ applied, savedAfter }),
  );
  const rejected = await openLink('{"showBadge":true, "mode":"whitlist"}', true);
  check(
    'configuration link in raw JSON with an invalid field saves nothing',
    rejected?.status === (await message('linkUnapplied', ['mode'])) &&
      JSON.stringify(await stored()) === JSON.stringify(savedAfter),
    JSON.stringify(rejected),
  );
  const malformed = await openLink('{');
  check(
    'malformed configuration link is reported',
    malformed?.status.startsWith(await message('linkError', [''])),
    JSON.stringify(malformed),
  );
  const reader = await attach(await open(`${optionsUrl}#config`));
  linkSessions.push(reader);
  const answer = String(
    await waitFor(
      () => read(reader, 'location.hash'),
      (h) => String(h).startsWith('#saved='),
    ),
  );
  const shown = answer.startsWith('#saved=') ? JSON.parse(decodeURIComponent(answer.slice('#saved='.length))) : null;
  check('#config alone shows the saved configuration', isDeepStrictEqual(shown, await stored()), answer);
  await evaluate(reader, `location.hash = '#config'`);
  const again = String(
    await waitFor(
      () => read(reader, 'location.hash'),
      (h) => String(h).startsWith('#saved='),
    ),
  );
  check('a link in a tab already showing the page is answered too', again.startsWith('#saved='), again.slice(0, 20));
  const web = await attach(await open(`${BASE}/w`));
  await loaded(web);
  const forged = `${optionsUrl}#config=${encodeURIComponent('{"enabled":false}')}`;
  await evaluate(web, `location.href = ${JSON.stringify(forged)}`);
  const landed = await waitFor(
    () => read(web, 'location.href'),
    (href) => href !== undefined && href !== `${BASE}/w`,
  );
  const enabledAfter = (await stored()).enabled;
  check(
    'a web page cannot open the configuration link',
    !String(landed).startsWith(optionsUrl) && enabledAfter === true,
    JSON.stringify({ landed, enabledAfter }),
  );
  await suite.checkNoErrors([popupSession, optSession, ...linkSessions]);
});

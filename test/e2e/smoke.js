// End-to-end smoke test: headless Chromium + the unpacked extension, driven over CDP.
// Browser requirements and CHROME override: see scripts/lib/cdp.js. Usage: npm run test:e2e
import { createServer } from 'node:http';
import { launchChromium, sleep } from '../../scripts/lib/cdp.js';

const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/redirect')) {
    res.writeHead(302, { location: '/a' });
    return res.end();
  }
  res.end(`<title>${req.url}</title><h1>${req.url}</h1>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await launchChromium();
const { cdp, events, pages, open, attach, evaluate, extId, swSession } = browser;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const urls = async () => JSON.stringify((await pages()).map((t) => t.url));

try {
  // 1. New tab with a duplicate URL (tracking param + fragment) is closed.
  const first = await open(`${BASE}/a`);
  await sleep(800);
  await open(`${BASE}/a?utm_source=x#frag`);
  await sleep(1500);
  let list = await pages();
  check('duplicate new tab closed', list.filter((t) => t.url.startsWith(`${BASE}/a`)).length === 1, await urls());
  check(
    'original tab kept and active',
    list.some((t) => t.targetId === first),
  );

  // 2. Different query value is not a duplicate.
  await open(`${BASE}/a?id=2`);
  await sleep(1200);
  list = await pages();
  check(
    'different significant param is kept',
    list.filter((t) => t.url.startsWith(`${BASE}/a`)).length === 2,
    await urls(),
  );

  // 3. Redirect to a duplicate URL: caught at onCommitted.
  await open(`${BASE}/redirect`);
  await sleep(1500);
  list = await pages();
  check(
    'redirected duplicate closed',
    list.filter((t) => t.url === `${BASE}/a`).length === 1 && !list.some((t) => t.url.includes('redirect')),
    await urls(),
  );

  // 4. In-tab navigation to a duplicate: focus existing and go back.
  const b = await open(`${BASE}/b`);
  await sleep(800);
  const bSession = await attach(b);
  await cdp('Page.navigate', { url: `${BASE}/a` }, bSession);
  await sleep(2000);
  list = await pages();
  const bNow = list.find((t) => t.targetId === b);
  check('in-tab duplicate went back', bNow && bNow.url === `${BASE}/b`, bNow?.url);
  check('tab count after in-tab back', list.filter((t) => t.url === `${BASE}/a`).length === 1);

  // 5. Reload of an existing page is not treated as a duplicate.
  await cdp('Page.reload', {}, bSession);
  await sleep(1000);
  check(
    'reload keeps the tab',
    (await pages()).some((t) => t.targetId === b),
  );

  // 6. Badge counter.
  const badge = await evaluate(swSession, 'chrome.action.getBadgeText({})');
  check('badge shows counter', badge === '3', `badge=${badge}`);

  // 7. Popup: toggle off, open duplicates (kept), toggle on, dedupe-all closes them.
  const popup = await open(`chrome-extension://${extId}/popup/popup.html`);
  await sleep(800);
  const popupSession = await attach(popup);
  const popupText = await evaluate(popupSession, 'document.body.innerText');
  check(
    'popup renders localized text and counter',
    /(Duplicates avoided|Duplicados evitados)\s*3\b/.test(popupText),
    JSON.stringify(popupText),
  );
  await evaluate(popupSession, 'document.getElementById("enabled").click()');
  await sleep(500);
  const badgeOff = await evaluate(swSession, 'chrome.action.getBadgeText({})');
  check('badge shows OFF when disabled', badgeOff === 'OFF', `badge=${badgeOff}`);
  await open(`${BASE}/c`);
  await open(`${BASE}/c`);
  await open(`${BASE}/c?utm_medium=y`);
  await sleep(1500);
  check('disabled: duplicates are kept', (await pages()).filter((t) => t.url.startsWith(`${BASE}/c`)).length === 3);
  await evaluate(popupSession, 'document.getElementById("enabled").click()');
  await sleep(500);
  await evaluate(popupSession, 'document.getElementById("dedupe").click()');
  await sleep(1200);
  list = await pages();
  const popupMsg = await evaluate(popupSession, 'document.getElementById("message").textContent');
  check(
    'dedupeAll closes remaining duplicates',
    list.filter((t) => t.url.startsWith(`${BASE}/c`)).length === 1 && /^2 /.test(popupMsg),
    popupMsg,
  );

  // 8. Options page loads, validates and saves.
  const options = await open(`chrome-extension://${extId}/options/options.html`);
  await sleep(800);
  const optSession = await attach(options);
  const o = await evaluate(
    optSession,
    `(async () => {
      document.querySelector('button.add[data-list="blacklist"]').click();
      const row = document.querySelector('table[data-list="blacklist"] tbody tr:last-child');
      row.querySelector('.r-pattern').value = '(';
      row.querySelector('.r-type').value = 'regex';
      document.getElementById('save').click();
      await new Promise(r => setTimeout(r, 200));
      const errorShown = !document.getElementById('errors').hidden;
      row.querySelector('.r-pattern').value = 'bank.com';
      row.querySelector('.r-type').value = 'glob';
      document.getElementById('save').click();
      await new Promise(r => setTimeout(r, 300));
      const { config } = await chrome.storage.sync.get('config');
      document.getElementById('testUrl').value = 'https://online.bank.com/x';
      document.getElementById('testUrl').dispatchEvent(new Event('input'));
      return { errorShown, saved: config.blacklist.map(r => r.pattern), status: document.getElementById('status').textContent, test: document.getElementById('testDecision').textContent };
    })()`,
  );
  check('options validates invalid regex', o.errorShown === true, JSON.stringify(o));
  check('options saves a rule and tester reflects it', o.saved?.[0] === 'bank.com' && /No act|No actúa/.test(o.test));
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
      swErrors.map((e) => e.params.exceptionDetails?.exception?.description || e.params.args?.map((a) => a.value)),
    ),
  );
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

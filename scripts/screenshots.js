// Renders 1280x800 store screenshots of the options page and the popup into store/screenshots/.
// Usage: npm run screenshots
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXT_DIR, launchChromium, sleep } from './lib/cdp.js';

const OUT = join(EXT_DIR, 'store', 'screenshots');
const WIDTH = 1280;
const HEIGHT = 800;

const SAMPLE_CONFIG = {
  whitelist: [
    { pattern: 'youtube.com', type: 'glob', query: { compare: false, significant: ['v'] } },
    { pattern: 'github.com/*/pull/*', type: 'glob' },
  ],
  blacklist: ['mail.google.com', { pattern: '/\\/checkout\\//', type: 'regex' }],
};

const browser = await launchChromium();
try {
  mkdirSync(OUT, { recursive: true });
  await browser.evaluate(
    browser.swSession,
    `Promise.all([
      chrome.storage.sync.set({ config: ${JSON.stringify(SAMPLE_CONFIG)} }),
      chrome.storage.local.set({ stats: { avoided: 42 } }),
    ])`,
  );

  async function shoot(name, path, { dark = false, prepare = '' } = {}) {
    const target = await browser.open(`chrome-extension://${browser.extId}/${path}`);
    const session = await browser.attach(target);
    await browser.cdp(
      'Emulation.setDeviceMetricsOverride',
      { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
      session,
    );
    await browser.cdp(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] },
      session,
    );
    await sleep(600);
    if (prepare) await browser.evaluate(session, prepare);
    await sleep(300);
    const { data } = await browser.cdp('Page.captureScreenshot', { format: 'png' }, session);
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    await browser.cdp('Target.closeTarget', { targetId: target });
    console.log(`store/screenshots/${name}.png`);
  }

  // The popup is 280px wide: center it on a neutral background for the 1280x800 frame.
  const centerPopup = (bg) => `
    document.documentElement.style.background = '${bg}';
    document.body.style.cssText += ';margin:200px auto;box-shadow:0 12px 40px rgba(0,0,0,.35);border-radius:10px;';
    document.getElementById('message').hidden = false;
    document.getElementById('message').textContent ||= chrome.i18n.getMessage('popupDedupeResult', ['2']);
  `;

  await shoot('1-options-light', 'options/options.html');
  await shoot('2-options-dark', 'options/options.html', { dark: true });
  await shoot('3-options-tester', 'options/options.html', {
    prepare: `
      const el = document.getElementById('testUrl');
      el.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&utm_source=share';
      el.dispatchEvent(new Event('input'));
      el.scrollIntoView({ block: 'center' });
    `,
  });
  await shoot('4-popup-light', 'popup/popup.html', { prepare: centerPopup('#e5e7eb') });
  await shoot('5-popup-dark', 'popup/popup.html', { dark: true, prepare: centerPopup('#111827') });
} finally {
  await browser.close();
}

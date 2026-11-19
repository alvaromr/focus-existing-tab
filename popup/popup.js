import { applyI18n, t } from '../src/chrome/i18n.js';
import { log } from '../src/lib/log.js';
import { onConfigChange, onStatsChange, updateConfig } from '../src/chrome/storage.js';
import { byId } from '../src/ui/dom.js';

const enabledBox = /** @type {HTMLInputElement} */ (byId('enabled'));
const dedupeButton = /** @type {HTMLButtonElement} */ (byId('dedupe'));

/**
 * Sends a message to the service worker and unwraps its `{ ok, result | error }` reply.
 * @param {string} type
 * @returns {Promise<unknown>} the handler's result, shaped by `type` (see MESSAGE_HANDLERS in background.js)
 */
function send(type) {
  return chrome.runtime.sendMessage({ type }).then((res) => {
    if (!res?.ok) throw new Error(res?.error || 'no response');
    return res.result;
  });
}

/** @typedef {{ config: import('../src/lib/config.js').Config, stats: import('../src/chrome/storage.js').Stats }} State */

/** @param {State} state */
function render({ config, stats }) {
  enabledBox.checked = config.enabled;
  byId('avoided').textContent = String(stats.avoided);
}

/** @param {string} text */
function showMessage(text) {
  const el = byId('message');
  el.textContent = text;
  el.hidden = false;
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const cmd = commands.find((c) => c.name === 'dedupe-all');
  byId('shortcut').textContent = cmd?.shortcut ? t('popupShortcut', [cmd.shortcut]) : t('popupNoShortcut');
}

applyI18n();
/** @type {Promise<State>} */ (send('getState')).then(render).catch((e) => showMessage(String(e)));
showShortcut().catch((cause) => log.warn('reading the keyboard shortcut', cause));
onConfigChange((config) => (enabledBox.checked = config.enabled));
onStatsChange((stats) => (byId('avoided').textContent = String(stats.avoided)));

enabledBox.addEventListener('change', () => updateConfig({ enabled: enabledBox.checked }));

dedupeButton.addEventListener('click', async () => {
  dedupeButton.disabled = true;
  try {
    const { closed } = /** @type {{ closed: number }} */ (await send('dedupeAll'));
    showMessage(t('popupDedupeResult', [String(closed)]));
  } catch (e) {
    showMessage(String(e));
  } finally {
    dedupeButton.disabled = false;
  }
});

byId('reset').addEventListener('click', () => send('resetStats').catch((e) => showMessage(String(e))));
byId('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

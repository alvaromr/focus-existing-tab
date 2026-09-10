import { applyI18n, t } from '../src/lib/i18n.js';
import { onConfigChange, onStatsChange, updateConfig } from '../src/lib/storage.js';

const $ = (id) => document.getElementById(id);
const enabledBox = /** @type {HTMLInputElement} */ ($('enabled'));
const dedupeButton = /** @type {HTMLButtonElement} */ ($('dedupe'));

function send(type) {
  return chrome.runtime.sendMessage({ type }).then((res) => {
    if (!res?.ok) throw new Error(res?.error || 'no response');
    return res.result;
  });
}

function render({ config, stats }) {
  enabledBox.checked = config.enabled;
  $('avoided').textContent = String(stats.avoided);
}

function showMessage(text) {
  const el = $('message');
  el.textContent = text;
  el.hidden = false;
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const cmd = commands.find((c) => c.name === 'dedupe-all');
  $('shortcut').textContent = cmd?.shortcut ? t('popupShortcut', [cmd.shortcut]) : t('popupNoShortcut');
}

applyI18n();
send('getState')
  .then(render)
  .catch((e) => showMessage(String(e)));
showShortcut().catch(() => {});
onConfigChange((config) => (enabledBox.checked = config.enabled));
onStatsChange((stats) => ($('avoided').textContent = String(stats.avoided)));

enabledBox.addEventListener('change', () => updateConfig({ enabled: enabledBox.checked }));

dedupeButton.addEventListener('click', async () => {
  dedupeButton.disabled = true;
  try {
    const { closed } = await send('dedupeAll');
    showMessage(t('popupDedupeResult', [String(closed)]));
  } catch (e) {
    showMessage(String(e));
  } finally {
    dedupeButton.disabled = false;
  }
});

$('reset').addEventListener('click', () => send('resetStats').catch((e) => showMessage(String(e))));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

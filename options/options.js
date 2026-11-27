import { DEFAULT_CONFIG, RANK_CRITERIA, createRule, normalizeConfig, parseList } from '../src/lib/config.js';
import { readConfigLink, savedConfigFragment } from '../src/lib/config-link.js';
import { analyzeUrl } from '../src/lib/matching.js';
import { loadConfig, saveConfig } from '../src/chrome/storage.js';
import { applyI18n, t } from '../src/chrome/i18n.js';
import { byId, one } from '../src/ui/dom.js';

/** @typedef {import('../src/lib/config.js').Config} Config */
/** @typedef {import('../src/lib/config.js').Rule} Rule */
/** @typedef {import('../src/lib/config.js').ConfigError} ConfigError */
/** @typedef {import('../src/lib/config.js').UntrustedObject} UntrustedObject */
/** @typedef {'whitelist' | 'blacklist'} ListName */

/** @type {ListName[]} */
const LISTS = ['whitelist', 'blacklist'];

/** @param {string} name */
const field = (name) => one(document, `[name="${name}"]`);
const rowTemplate = /** @type {HTMLTemplateElement} */ (byId('ruleRow'));
/** @param {string} list */
const tbody = (list) => one(document, `table[data-list="${list}"] tbody`);

// ---------- form <-> config ----------

/** @param {string} name @param {unknown} value */
function setField(name, value) {
  const el = field(name);
  if (el.type === 'checkbox') el.checked = /** @type {boolean} */ (value);
  else el.value = /** @type {string} */ (value);
}

/** @param {string} name */
function getField(name) {
  const el = field(name);
  return el.type === 'checkbox' ? el.checked : el.value;
}

/** @param {string} list @param {Rule} [rule] */
function addRuleRow(list, rule = createRule()) {
  const row = /** @type {HTMLTableRowElement} */ (one(rowTemplate.content, 'tr').cloneNode(true));
  applyI18n(row);
  one(row, '.r-enabled').checked = rule.enabled;
  one(row, '.r-pattern').value = rule.pattern;
  one(row, '.r-type').value = rule.type;
  one(row, '.r-compare').value = rule.query.compare == null ? '' : rule.query.compare ? 'yes' : 'no';
  one(row, '.r-ignored').value = rule.query.ignored?.join(', ') ?? '';
  one(row, '.r-significant').value = rule.query.significant?.join(', ') ?? '';
  one(row, '.r-delete').addEventListener('click', () => {
    row.remove();
    markDirty();
  });
  tbody(list).append(row);
  return row;
}

/** @param {ListName} list */
function readRules(list) {
  return [...tbody(list).children].map((row) => {
    const compare = one(row, '.r-compare').value;
    const ignored = one(row, '.r-ignored').value.trim();
    const significant = one(row, '.r-significant').value.trim();
    return {
      enabled: one(row, '.r-enabled').checked,
      pattern: one(row, '.r-pattern').value,
      type: one(row, '.r-type').value,
      query: {
        compare: compare === '' ? null : compare === 'yes',
        ignored: ignored === '' ? null : parseList(ignored),
        significant: significant === '' ? null : parseList(significant),
      },
    };
  });
}

// ---------- ranking list (ordered criteria with include/exclude) ----------

const rankingList = byId('ranking');
/** @param {string} name */
const rankLabelKey = (name) => `rank${name[0].toUpperCase()}${name.slice(1)}`;

/** @param {readonly string[]} ranking */
function fillRanking(ranking) {
  const order = [...ranking, ...RANK_CRITERIA.filter((c) => !ranking.includes(c))];
  rankingList.replaceChildren(
    ...order.map((name) => {
      const li = document.createElement('li');
      li.dataset.name = name;
      const label = document.createElement('label');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: ranking.includes(name) });
      label.append(box, ` ${t(rankLabelKey(name))}`);
      const up = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'icon',
        textContent: '↑',
        title: t('rankUp'),
      });
      const down = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'icon',
        textContent: '↓',
        title: t('rankDown'),
      });
      up.addEventListener('click', () => {
        li.previousElementSibling?.before(li);
        markDirty();
      });
      down.addEventListener('click', () => {
        li.nextElementSibling?.after(li);
        markDirty();
      });
      li.append(label, up, down);
      return li;
    }),
  );
}

function readRanking() {
  const items = /** @type {HTMLLIElement[]} */ ([...rankingList.children]);
  return items.filter((li) => one(li, 'input').checked).map((li) => li.dataset.name);
}

// Scalar settings map 1:1 to a form control named after their config path ("scope",
// "normalization.ignoreWww"…). Everything else (mode radios, ranking list, parameter lists,
// rule tables) has a dedicated widget below.
const SCALAR_FIELDS = [
  ...Object.entries(DEFAULT_CONFIG)
    .filter(([, v]) => typeof v === 'boolean' || typeof v === 'string')
    .map(([k]) => k),
  ...Object.keys(DEFAULT_CONFIG.normalization).map((k) => `normalization.${k}`),
  'query.compare',
  'query.orderMatters',
].filter((name) => name !== 'mode');

/** @param {UntrustedObject} obj @param {string} path @returns {unknown} */
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
/** @param {UntrustedObject} obj @param {string} path @param {unknown} value */
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = /** @type {string} */ (keys.pop());
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};

/** @param {Config} config */
function fillForm(config) {
  for (const name of SCALAR_FIELDS) setField(name, getPath(config, name));
  one(document, `[name="mode"][value="${config.mode}"]`).checked = true;
  fillRanking(config.ranking);
  setField('excludedGroups', config.excludedGroups.join('\n'));
  setField('query.ignored', config.query.ignored.join('\n'));
  setField('query.significant', config.query.significant.join('\n'));
  for (const list of LISTS) {
    tbody(list).replaceChildren();
    for (const rule of config[list]) addRuleRow(list, rule);
  }
}

/**
 * Raw (unvalidated) config as currently shown in the form.
 * @returns {UntrustedObject}
 */
function readForm() {
  /** @type {UntrustedObject} */
  const raw = {};
  for (const name of SCALAR_FIELDS) setPath(raw, name, getField(name));
  raw.mode = /** @type {HTMLInputElement | null} */ (document.querySelector('[name="mode"]:checked'))?.value;
  raw.ranking = readRanking();
  raw.excludedGroups = parseList(getField('excludedGroups'));
  raw.query.ignored = parseList(getField('query.ignored'));
  raw.query.significant = parseList(getField('query.significant'));
  raw.whitelist = readRules('whitelist');
  raw.blacklist = readRules('blacklist');
  return raw;
}

// ---------- validation & status ----------

/** @param {ConfigError} e */
function describeError(e) {
  const where = `${t(e.list === 'whitelist' ? 'secWhitelist' : 'secBlacklist')} #${e.index + 1}`;
  if (e.code === 'regex') return `${where}: ${t('errRegex', [String(e.pattern)])}`;
  if (e.code === 'empty') return `${where}: ${t('errEmptyPattern')}`;
  return `${where}: ${t('errInvalidRule')}`;
}

/** @param {ConfigError[]} errors */
function showErrors(errors) {
  const ul = byId('errors');
  ul.replaceChildren(
    ...errors.map((e) => Object.assign(document.createElement('li'), { textContent: describeError(e) })),
  );
  ul.hidden = errors.length === 0;
  for (const list of LISTS) {
    [...tbody(list).children].forEach((row, i) => {
      row.classList.toggle(
        'invalid',
        errors.some((e) => e.list === list && e.index === i),
      );
    });
  }
}

/** @param {string} text @param {string} [kind] */
function setStatus(text, kind = '') {
  const el = byId('status');
  el.textContent = text;
  el.className = `muted ${kind}`;
}

function markDirty() {
  setStatus(t('statusUnsaved'));
  runTest();
}

/** Validates the form; returns the config or null (errors are shown). */
function validate() {
  const { config, errors } = normalizeConfig(readForm());
  showErrors(errors);
  return errors.length ? null : config;
}

/** @param {unknown} error */
const messageOf = (error) => String(error instanceof Error ? error.message : error);

// ---------- URL tester ----------

/** @type {Record<string, string>} */
const REASONS = {
  disabled: 'reasonDisabled',
  internal: 'reasonInternal',
  blacklisted: 'reasonBlacklisted',
  'not-whitelisted': 'reasonNotWhitelisted',
  ok: 'reasonOk',
};

function runTest() {
  const url = one(document, '#testUrl').value.trim();
  const result = byId('testResult');
  if (!url) {
    result.hidden = true;
    return;
  }
  const { config } = normalizeConfig(readForm());
  const a = analyzeUrl(config, url);
  byId('testDecision').textContent = t(REASONS[a.reason]);
  byId('testRule').textContent = a.rule ? `${a.rule.pattern} (${a.rule.type})` : t('testNoRule');
  one(byId('testKey'), 'code').textContent = a.key ?? '—';
  result.hidden = false;
}

// ---------- actions ----------

async function save() {
  const config = validate();
  if (!config) {
    setStatus(t('statusFixErrors'), 'status-error');
    return;
  }
  try {
    await saveConfig(config);
    fillForm(config);
    setStatus(t('statusSaved'), 'status-ok');
  } catch (e) {
    setStatus(t('statusSaveError', [messageOf(e)]), 'status-error');
  }
}

function exportConfig() {
  const config = validate();
  if (!config) return;
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'focus-existing-tab-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Answers the configuration link the page was opened with: shows the saved configuration in the
// address, or applies the link all or nothing. A link is then dropped from the address so that a
// reload does not apply it again.
/** @param {Config} current */
async function applyConfigLink(current) {
  const { hash } = location;
  if (!hash) return;
  const answer = savedConfigFragment(hash, current);
  history.replaceState(null, '', `${location.pathname}${answer ?? ''}`);
  if (answer) return;
  try {
    const link = readConfigLink(hash, current);
    if (!link) return;
    if (link.unapplied.length) {
      setStatus(t('linkUnapplied', [link.unapplied.join(', ')]), 'status-error');
      return;
    }
    fillForm(link.config);
    await save();
  } catch (e) {
    setStatus(t('linkError', [messageOf(e)]), 'status-error');
  }
}

const MAX_IMPORT_BYTES = 1024 * 1024;

/** @param {File} file */
async function importConfig(file) {
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error(t('importTooLarge'));
    const { config, errors } = normalizeConfig(JSON.parse(await file.text()));
    fillForm(config);
    showErrors([]);
    const dropped = errors.length ? ` ${t('importDropped', [String(errors.length)])}` : '';
    setStatus(t('importLoaded') + dropped);
    runTest();
  } catch (e) {
    setStatus(t('importError', [messageOf(e)]), 'status-error');
  }
}

// ---------- contextual help ----------

// Every element with data-help="<i18n key>" gets a "?" button: native tooltip on hover,
// and click/Enter toggles the same text inline (keyboard and touch friendly).
function attachHelp() {
  for (const el of /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-help]')])) {
    const text = t(/** @type {string} */ (el.dataset.help)); // the selector guarantees it
    const btn = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'help',
      textContent: '?',
      title: text,
    });
    btn.setAttribute('aria-label', `${t('helpLabel')}: ${text}`);
    btn.setAttribute('aria-expanded', 'false');
    const note = Object.assign(document.createElement('p'), {
      className: 'help-text',
      textContent: text,
      hidden: true,
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      note.hidden = !note.hidden;
      btn.setAttribute('aria-expanded', String(!note.hidden));
    });
    // Button next to the title text; note below the row (or below the whole table for headers).
    const anchor = el.querySelector('legend') || (el.matches('.grid2 label') ? one(el, 'span') : el);
    anchor.append(' ', btn);
    (el.closest('table') || el).after(note);
  }
}

// ---------- init ----------

applyI18n();
attachHelp();
loadConfig().then((config) => {
  fillForm(config);
  showErrors([]);
  setStatus('');
  return applyConfigLink(config);
});
// A link opened in a tab that already shows the page changes only the fragment, without a reload.
window.addEventListener('hashchange', () => loadConfig().then(applyConfigLink));

/** @param {Event} e */
const onEdit = (e) => {
  const id = /** @type {HTMLElement} */ (e.target).id;
  if (id !== 'testUrl' && id !== 'importFile') markDirty();
};
const main = one(document, 'main');
main.addEventListener('input', onEdit);
main.addEventListener('change', onEdit);
for (const btn of /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('button.add')])) {
  btn.addEventListener('click', () => {
    one(addRuleRow(/** @type {string} */ (btn.dataset.list)), '.r-pattern').focus();
    markDirty();
  });
}
const importFile = one(document, '#importFile');
byId('save').addEventListener('click', save);
byId('export').addEventListener('click', exportConfig);
byId('import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  if (file) importConfig(file);
  importFile.value = '';
});
byId('reset').addEventListener('click', () => {
  fillForm(normalizeConfig(DEFAULT_CONFIG).config);
  showErrors([]);
  setStatus(t('statusResetPending'));
});
byId('testUrl').addEventListener('input', runTest);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});

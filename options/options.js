import { DEFAULT_CONFIG, RANK_CRITERIA, createRule, normalizeConfig, parseList } from '../src/lib/config.js';
import { analyzeUrl } from '../src/lib/matching.js';
import { loadConfig, saveConfig } from '../src/lib/storage.js';
import { applyI18n, t } from '../src/lib/i18n.js';

const $ = (id) => document.getElementById(id);
/** @param {ParentNode} root @param {string} selector @returns {HTMLInputElement} */
const input = (root, selector) => /** @type {HTMLInputElement} */ (root.querySelector(selector));
const field = (name) => input(document, `[name="${name}"]`);
const rowTemplate = /** @type {HTMLTemplateElement} */ ($('ruleRow'));
const tbody = (list) => document.querySelector(`table[data-list="${list}"] tbody`);

// ---------- form <-> config ----------

function setField(name, value) {
  const el = field(name);
  if (el.type === 'checkbox') el.checked = value;
  else el.value = value;
}

function getField(name) {
  const el = field(name);
  return el.type === 'checkbox' ? el.checked : el.value;
}

function addRuleRow(list, rule = createRule()) {
  const row = /** @type {HTMLTableRowElement} */ (rowTemplate.content.firstElementChild.cloneNode(true));
  applyI18n(row);
  input(row, '.r-enabled').checked = rule.enabled;
  input(row, '.r-pattern').value = rule.pattern;
  input(row, '.r-type').value = rule.type;
  input(row, '.r-compare').value = rule.query.compare == null ? '' : rule.query.compare ? 'yes' : 'no';
  input(row, '.r-ignored').value = rule.query.ignored?.join(', ') ?? '';
  input(row, '.r-significant').value = rule.query.significant?.join(', ') ?? '';
  input(row, '.r-delete').addEventListener('click', () => {
    row.remove();
    markDirty();
  });
  tbody(list).append(row);
  return row;
}

function readRules(list) {
  return [...tbody(list).children].map((row) => {
    const compare = input(row, '.r-compare').value;
    const ignored = input(row, '.r-ignored').value.trim();
    const significant = input(row, '.r-significant').value.trim();
    return {
      enabled: input(row, '.r-enabled').checked,
      pattern: input(row, '.r-pattern').value,
      type: input(row, '.r-type').value,
      query: {
        compare: compare === '' ? null : compare === 'yes',
        ignored: ignored === '' ? null : parseList(ignored),
        significant: significant === '' ? null : parseList(significant),
      },
    };
  });
}

// ---------- ranking list (ordered criteria with include/exclude) ----------

const rankingList = $('ranking');
const rankLabelKey = (name) => `rank${name[0].toUpperCase()}${name.slice(1)}`;

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
  return items.filter((li) => input(li, 'input').checked).map((li) => li.dataset.name);
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

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};

function fillForm(config) {
  for (const name of SCALAR_FIELDS) setField(name, getPath(config, name));
  input(document, `[name="mode"][value="${config.mode}"]`).checked = true;
  fillRanking(config.ranking);
  setField('query.ignored', config.query.ignored.join('\n'));
  setField('query.significant', config.query.significant.join('\n'));
  for (const list of ['whitelist', 'blacklist']) {
    tbody(list).replaceChildren();
    for (const rule of config[list]) addRuleRow(list, rule);
  }
}

/** Raw (unvalidated) config as currently shown in the form. */
function readForm() {
  const raw = {};
  for (const name of SCALAR_FIELDS) setPath(raw, name, getField(name));
  raw.mode = input(document, '[name="mode"]:checked')?.value;
  raw.ranking = readRanking();
  raw.query.ignored = parseList(getField('query.ignored'));
  raw.query.significant = parseList(getField('query.significant'));
  raw.whitelist = readRules('whitelist');
  raw.blacklist = readRules('blacklist');
  return raw;
}

// ---------- validation & status ----------

function describeError(e) {
  const where = `${t(e.list === 'whitelist' ? 'secWhitelist' : 'secBlacklist')} #${e.index + 1}`;
  if (e.code === 'regex') return `${where}: ${t('errRegex', [e.pattern])}`;
  if (e.code === 'empty') return `${where}: ${t('errEmptyPattern')}`;
  return `${where}: ${t('errInvalidRule')}`;
}

function showErrors(errors) {
  const ul = $('errors');
  ul.replaceChildren(
    ...errors.map((e) => Object.assign(document.createElement('li'), { textContent: describeError(e) })),
  );
  ul.hidden = errors.length === 0;
  for (const list of ['whitelist', 'blacklist']) {
    [...tbody(list).children].forEach((row, i) => {
      row.classList.toggle(
        'invalid',
        errors.some((e) => e.list === list && e.index === i),
      );
    });
  }
}

function setStatus(text, kind = '') {
  const el = $('status');
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

// ---------- URL tester ----------

const REASONS = {
  disabled: 'reasonDisabled',
  internal: 'reasonInternal',
  blacklisted: 'reasonBlacklisted',
  'not-whitelisted': 'reasonNotWhitelisted',
  ok: 'reasonOk',
};

function runTest() {
  const url = input(document, '#testUrl').value.trim();
  const result = $('testResult');
  if (!url) {
    result.hidden = true;
    return;
  }
  const { config } = normalizeConfig(readForm());
  const a = analyzeUrl(config, url);
  $('testDecision').textContent = t(REASONS[a.reason]);
  $('testRule').textContent = a.rule ? `${a.rule.pattern} (${a.rule.type})` : t('testNoRule');
  $('testKey').firstElementChild.textContent = a.key ?? '—';
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
    setStatus(t('statusSaveError', [String(e?.message || e)]), 'status-error');
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

const MAX_IMPORT_BYTES = 1024 * 1024;

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
    setStatus(t('importError', [String(e?.message || e)]), 'status-error');
  }
}

// ---------- contextual help ----------

// Every element with data-help="<i18n key>" gets a "?" button: native tooltip on hover,
// and click/Enter toggles the same text inline (keyboard and touch friendly).
function attachHelp() {
  for (const el of /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-help]')])) {
    const text = t(el.dataset.help);
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
    const anchor = el.querySelector('legend') || (el.matches('.grid2 label') ? el.querySelector('span') : el);
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
});

const onEdit = (e) => {
  if (e.target.id !== 'testUrl' && e.target.id !== 'importFile') markDirty();
};
document.querySelector('main').addEventListener('input', onEdit);
document.querySelector('main').addEventListener('change', onEdit);
for (const btn of /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('button.add')])) {
  btn.addEventListener('click', () => {
    input(addRuleRow(btn.dataset.list), '.r-pattern').focus();
    markDirty();
  });
}
const importFile = input(document, '#importFile');
$('save').addEventListener('click', save);
$('export').addEventListener('click', exportConfig);
$('import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  if (importFile.files[0]) importConfig(importFile.files[0]);
  importFile.value = '';
});
$('reset').addEventListener('click', () => {
  fillForm(normalizeConfig(DEFAULT_CONFIG).config);
  showErrors([]);
  setStatus(t('statusResetPending'));
});
$('testUrl').addEventListener('input', runTest);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});

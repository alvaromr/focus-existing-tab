import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chooseAction, countsAsAvoided, isReload } from '../src/lib/navigation-action.js';
import { normalizeConfig } from '../src/lib/config.js';

/** @param {object} [overrides] */
const cfg = (overrides) => normalizeConfig(overrides).config;
const plain = { id: 1, windowId: 1, pinned: false };
const pinned = { id: 2, windowId: 1, pinned: true };

test('opening the page the tab already shows is a reload, unless actOnReload is on', () => {
  assert.equal(isReload(cfg(), 'https://a.com/', 'https://a.com/'), true);
  assert.equal(isReload(cfg(), 'https://b.com/', 'https://a.com/'), false);
  assert.equal(isReload(cfg({ actOnReload: true }), 'https://a.com/', 'https://a.com/'), false);
});

test('a new tab is closed; a tab that had a page follows inTabNavigation', () => {
  assert.equal(chooseAction(cfg(), plain, true), 'close');
  for (const inTabNavigation of ['back', 'focus', 'close', 'ignore']) {
    assert.equal(chooseAction(cfg({ inTabNavigation }), plain, false), inTabNavigation);
  }
});

test('closing falls back to focusing when closeDuplicate is off or the tab may not be closed', () => {
  assert.equal(chooseAction(cfg({ closeDuplicate: false }), plain, true), 'focus');
  assert.equal(chooseAction(cfg({ closeDuplicate: false, inTabNavigation: 'close' }), plain, false), 'focus');
  assert.equal(chooseAction(cfg({ closeDuplicate: false, inTabNavigation: 'back' }), plain, false), 'back');
  assert.equal(chooseAction(cfg({ pinnedPolicy: 'protect' }), pinned, true), 'focus');
  assert.equal(chooseAction(cfg({ pinnedPolicy: 'normal' }), pinned, true), 'close');
});

test('every action counts as avoided; focus only counts when countFocusOnly is on', () => {
  for (const action of /** @type {const} */ (['close', 'back']))
    assert.equal(countsAsAvoided(cfg({ countFocusOnly: false }), action), true);
  assert.equal(countsAsAvoided(cfg({ countFocusOnly: true }), 'focus'), true);
  assert.equal(countsAsAvoided(cfg({ countFocusOnly: false }), 'focus'), false);
});

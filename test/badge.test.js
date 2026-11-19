import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeOf } from '../src/lib/badge.js';
import { normalizeConfig } from '../src/lib/config.js';

const cfg = (overrides) => normalizeConfig(overrides).config;

test('the badge shows the counter, capped at 9999+, and nothing at zero', () => {
  assert.equal(badgeOf(cfg(), 0).text, '');
  assert.equal(badgeOf(cfg(), 7).text, '7');
  assert.equal(badgeOf(cfg(), 9999).text, '9999');
  assert.equal(badgeOf(cfg(), 10000).text, '9999+');
});

test('the badge shows OFF in grey when disabled, and nothing when showBadge is off', () => {
  const on = badgeOf(cfg(), 3);
  const off = badgeOf(cfg({ enabled: false }), 3);
  assert.deepEqual(off, { text: 'OFF', color: '#6b7280' });
  assert.equal(on.color, '#2563eb');
  assert.equal(badgeOf(cfg({ showBadge: false }), 3).text, '');
});

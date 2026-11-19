import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { badgeOf } from '../src/lib/badge.js';
import { normalizeConfig } from '../src/lib/config.js';

const cfg = (overrides) => normalizeConfig(overrides).config;

// The light theme's tokens: the first :root block of src/ui/tokens.css (the dark one is nested).
const css = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
const lightRoot = /:root\s*{([^}]*)}/.exec(css)[1];
const token = (name) => new RegExp(`${name}:\\s*([^;]+);`).exec(lightRoot)[1].trim();

test('the badge shows the counter, capped at 9999+, and nothing at zero', () => {
  assert.equal(badgeOf(cfg(), 0).text, '');
  assert.equal(badgeOf(cfg(), 7).text, '7');
  assert.equal(badgeOf(cfg(), 9999).text, '9999');
  assert.equal(badgeOf(cfg(), 10000).text, '9999+');
});

test('the badge shows OFF when disabled, and nothing when showBadge is off', () => {
  assert.equal(badgeOf(cfg({ enabled: false }), 3).text, 'OFF');
  assert.equal(badgeOf(cfg({ showBadge: false }), 3).text, '');
});

test('the badge uses the light --accent when enabled and --muted when disabled, from tokens.css', () => {
  assert.equal(badgeOf(cfg(), 3).color, token('--accent'));
  assert.equal(badgeOf(cfg({ enabled: false }), 3).color, token('--muted'));
});

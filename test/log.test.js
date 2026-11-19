import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/lib/log.js';

test('warn and error write the context and the cause with the extension prefix', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const cause = new Error('No tab with id: 7');
  log.warn('closing the duplicate tab', cause);
  log.error('handling a navigation', cause);
  assert.deepEqual(warn.mock.calls[0].arguments, ['[Focus Existing Tab]', 'closing the duplicate tab:', cause]);
  assert.deepEqual(error.mock.calls[0].arguments, ['[Focus Existing Tab]', 'handling a navigation:', cause]);
});

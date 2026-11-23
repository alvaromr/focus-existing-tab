import { onTestFinished, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { log } from '../src/lib/log.js';

test('warn and error write the context and the cause with the extension prefix', () => {
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cause = new Error('No tab with id: 7');
  log.warn('closing the duplicate tab', cause);
  log.error('handling a navigation', cause);
  assert.deepEqual(warn.mock.calls[0], ['[Focus Existing Tab]', 'closing the duplicate tab:', cause]);
  assert.deepEqual(error.mock.calls[0], ['[Focus Existing Tab]', 'handling a navigation:', cause]);
});

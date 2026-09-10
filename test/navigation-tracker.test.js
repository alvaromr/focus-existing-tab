import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationTracker, SKIP_TTL_MS } from '../src/lib/navigation-tracker.js';

const A = 'https://a.com/';
const B = 'https://b.com/';

function tracker(startTime = 1000) {
  let time = startTime;
  const t = createNavigationTracker({ now: () => time });
  t.advance = (ms) => (time += ms);
  return t;
}

test('new tab: onBeforeNavigate reports wasNew and a blank previous URL', () => {
  const t = tracker();
  t.tabCreated({ id: 1, url: '' });
  assert.deepEqual(t.beforeNavigate(1, A), { wasNew: true, prevUrl: '' });
  assert.deepEqual(t.committed(1, A, 'typed'), {});
  t.settled(1);
  // The tab is no longer new once its first navigation committed.
  assert.deepEqual(t.beforeNavigate(1, B), { wasNew: false, prevUrl: A });
});

test('seeded tabs (service worker start) provide their previous URL', () => {
  const t = tracker();
  t.seed([{ id: 5, url: B }, { id: 6 }, { url: A }]);
  assert.deepEqual(t.beforeNavigate(5, A), { wasNew: false, prevUrl: B });
  assert.deepEqual(t.beforeNavigate(6, A), { wasNew: false, prevUrl: '' });
  t.tabCreated({ id: 5, url: '' });
  assert.equal(t.beforeNavigate(5, A).prevUrl, '');
});

test('redirect: committed URL differs from the one seen before -> check with the old previous URL', () => {
  const t = tracker();
  t.seed([{ id: 1, url: B }]);
  t.beforeNavigate(1, 'https://short.ly/x');
  assert.deepEqual(t.committed(1, A, 'link'), { check: { wasNew: false, prevUrl: B } });
});

test('navigation without onBeforeNavigate (prerender activation / restarted worker) is checked', () => {
  const t = tracker();
  t.seed([{ id: 1, url: B }]);
  assert.deepEqual(t.committed(1, A, 'typed'), { check: { wasNew: false, prevUrl: B } });
  t.seed([{ id: 2, url: '' }]);
  t.tabCreated({ id: 2, url: '' });
  assert.deepEqual(t.committed(2, A, 'link'), { check: { wasNew: true, prevUrl: '' } });
});

test('reloads are never re-checked at commit', () => {
  const t = tracker();
  t.seed([{ id: 1, url: A }]);
  assert.deepEqual(t.committed(1, A, 'reload'), {});
  t.beforeNavigate(1, A);
  assert.deepEqual(t.committed(1, A, 'reload'), {});
});

test('deferred goBack fires at commit and its own navigation is skipped until settled', () => {
  const t = tracker();
  t.seed([{ id: 1, url: B }]);
  t.beforeNavigate(1, A);
  assert.equal(t.scheduleGoBack(1, A, 'before'), 'later');
  assert.deepEqual(t.committed(1, A, 'typed'), { goBack: true });
  t.goBackIssued(1);
  assert.equal(t.shouldSkip(1), true);
  // The back navigation: onBeforeNavigate then onCommitted, both skipped, then settled clears it.
  t.beforeNavigate(1, B);
  assert.equal(t.shouldSkip(1), true);
  assert.deepEqual(t.committed(1, B, 'auto_subframe'), {});
  assert.equal(t.shouldSkip(1), true);
  t.settled(1);
  assert.equal(t.shouldSkip(1), false);
});

test('goBack runs immediately when the duplicate already committed (fast commit race)', () => {
  const t = tracker();
  t.seed([{ id: 1, url: B }]);
  t.beforeNavigate(1, A);
  t.committed(1, A, 'typed'); // commit arrived before the decision was taken
  assert.equal(t.scheduleGoBack(1, A, 'before'), 'now');
  assert.equal(t.scheduleGoBack(1, A, 'committed'), 'now');
  assert.deepEqual(t.committed(1, B, 'link'), { check: { wasNew: false, prevUrl: A } });
});

test('skip marker expires after the TTL and is dropped on goBack failure or error', () => {
  const t = tracker();
  t.goBackIssued(1);
  t.advance(SKIP_TTL_MS - 1);
  assert.equal(t.shouldSkip(1), true);
  t.advance(2);
  assert.equal(t.shouldSkip(1), false);
  t.goBackIssued(2);
  t.goBackFailed(2);
  assert.equal(t.shouldSkip(2), false);
  t.goBackIssued(3);
  t.errorOccurred(3);
  assert.equal(t.shouldSkip(3), false);
});

test('a failed navigation cancels a pending goBack', () => {
  const t = tracker();
  t.seed([{ id: 1, url: B }]);
  t.beforeNavigate(1, A);
  t.scheduleGoBack(1, A, 'before');
  t.errorOccurred(1);
  assert.deepEqual(t.committed(1, A, 'typed'), { check: { wasNew: false, prevUrl: B } });
});

test('tabRemoved forgets everything about the tab', () => {
  const t = tracker();
  t.tabCreated({ id: 1, url: '' });
  t.beforeNavigate(1, A);
  t.scheduleGoBack(1, A, 'before');
  t.goBackIssued(1);
  t.tabRemoved(1);
  assert.equal(t.shouldSkip(1), false);
  assert.deepEqual(t.beforeNavigate(1, A), { wasNew: false, prevUrl: undefined });
  assert.deepEqual(t.committed(1, A, 'typed'), {});
});

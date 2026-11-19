import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationTracker } from '../src/lib/navigation-tracker.js';

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

test('skip marker lasts 2 s and is dropped on goBack failure or error', () => {
  const t = tracker();
  t.goBackIssued(1);
  t.advance(1999);
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

test('a tab that started navigating later is never the original of an earlier navigation', () => {
  // Two new tabs open the same page; the service worker handles the first one only after the
  // second exists. The second is the duplicate, so it must not be matched by the first.
  const t = tracker(1000);
  t.tabCreated({ id: 1, url: '' });
  t.beforeNavigate(1, A, 1001);
  t.advance(500);
  t.tabCreated({ id: 2, url: '' });
  t.beforeNavigate(2, A, 1600);
  assert.equal(t.startOf(1), 1001);
  assert.equal(t.navigatedAfter(2, t.startOf(1)), true);
  assert.equal(t.navigatedAfter(1, t.startOf(2)), false);
  assert.equal(t.navigatedAfter(1, t.startOf(1)), false);
});

test('events of different APIs may arrive out of order: times decide, not arrival', () => {
  // Tab 2 is created (onCreated arrives at 1500) after tab 1 started navigating at 1001, but
  // tab 1's onBeforeNavigate reaches the worker only after tab 2's onCreated.
  const t = tracker(1000);
  t.tabCreated({ id: 1, url: '' });
  t.advance(500);
  t.tabCreated({ id: 2, url: '' });
  t.beforeNavigate(1, A, 1001);
  assert.equal(t.navigatedAfter(2, t.startOf(1)), true);
  assert.equal(t.navigatedAfter(1, t.startOf(2)), false);
});

test('seeded tabs count as the oldest; tabs whose events have not arrived yet as newer', () => {
  const t = tracker(1000);
  t.seed([{ id: 1, url: B }]);
  t.tabCreated({ id: 2, url: '' });
  t.beforeNavigate(2, A, 1000);
  const start = t.startOf(2);
  assert.equal(t.startOf(1), 0);
  assert.equal(t.navigatedAfter(1, start), false);
  // Tab 3 exists for chrome.tabs.query, but its onCreated has not reached the worker yet.
  assert.equal(t.navigatedAfter(3, start), true);
  t.tabRemoved(1);
  assert.equal(t.navigatedAfter(1, start), true);
});

test('a commit without onBeforeNavigate starts a navigation at its own time; with one, keeps it', () => {
  const t = tracker(1000);
  t.seed([{ id: 1, url: B }]);
  t.committed(1, A, 'link', 1200);
  assert.equal(t.startOf(1), 1200);
  t.beforeNavigate(3, A, 1300);
  t.committed(3, A, 'link', 1400);
  assert.equal(t.startOf(3), 1300);
});

test('without an event time, the tracker clock stands in', () => {
  const t = tracker(1000);
  t.beforeNavigate(1, A);
  assert.equal(t.startOf(1), 1000);
  t.advance(50);
  t.committed(2, A, 'link');
  assert.equal(t.startOf(2), 1050);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseSubject, subjectProblems } from '../scripts/lib/commit-subject.js';

test('a typed subject without scope passes, breaking marker included', () => {
  assert.deepEqual(subjectProblems('fix: keep the tab group'), []);
  assert.deepEqual(subjectProblems('feat!: drop Chrome 115'), []);
});

test('a scope in parentheses is refused with its own message, breaking marker or not', () => {
  for (const subject of ['fix(release): bump the version', 'chore(release): v1.1.0', 'feat(ui)!: new popup']) {
    const problems = subjectProblems(subject);
    assert.equal(problems.length, 1, subject);
    assert.match(problems[0], /no scope in parentheses/);
  }
});

test('an unknown type, a missing summary or a missing type is refused', () => {
  for (const subject of ['update: things', 'fix:', 'fix: ', 'Add a feature']) {
    assert.match(subjectProblems(subject).join(), /must look like "type: summary"/, subject);
  }
});

test('a subject over 72 characters is refused, and 72 pass', () => {
  const at = (/** @type {number} */ n) => `fix: ${'x'.repeat(n - 5)}`;
  assert.deepEqual(subjectProblems(at(72)), []);
  assert.deepEqual(subjectProblems(at(73)), ['the subject has 73 characters; the limit is 72']);
});

test('the release commit subject follows the rule', () => {
  assert.equal(releaseSubject('1.2.3'), 'chore: release v1.2.3');
  assert.deepEqual(subjectProblems(releaseSubject('10.20.30')), []);
});

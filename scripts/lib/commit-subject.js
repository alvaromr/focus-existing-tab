// The commit subject rule, shared by the commit-msg hook and the release script: Conventional
// Commits without a scope ("type: summary", never "type(scope): summary"), at most 72 characters.

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const SUBJECT = new RegExp(`^(${TYPES.join('|')})!?: \\S.*$`);
const MAX_SUBJECT = 72;

/**
 * What is wrong with a commit subject; empty when it follows the rule.
 * @param {string} subject the first line of the message
 * @returns {string[]}
 */
export function subjectProblems(subject) {
  const problems = [];
  if (/^\w+\(/.test(subject)) {
    problems.push('no scope in parentheses: write "type: summary", not "type(scope): summary"');
  } else if (!SUBJECT.test(subject)) {
    problems.push(`the subject must look like "type: summary", type one of ${TYPES.join(', ')}`);
  }
  if (subject.length > MAX_SUBJECT)
    problems.push(`the subject has ${subject.length} characters; the limit is ${MAX_SUBJECT}`);
  return problems;
}

/** @param {string} version x.y.z */
export const releaseSubject = (version) => `chore: v${version}`;

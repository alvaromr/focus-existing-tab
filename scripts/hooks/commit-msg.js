// commit-msg: enforces Conventional Commits with a subject of at most 72 characters.
import { readFileSync } from 'node:fs';

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?!?: \\S.*$`);
const MAX_SUBJECT = 72;

const subject = readFileSync(process.argv[2], 'utf8').split('\n')[0];
const problems = [];
if (!SUBJECT.test(subject))
  problems.push(`the subject must look like "type(scope): summary", type one of ${TYPES.join(', ')}`);
if (subject.length > MAX_SUBJECT)
  problems.push(`the subject has ${subject.length} characters; the limit is ${MAX_SUBJECT}`);
if (problems.length) {
  console.error(`commit-msg: "${subject}"\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

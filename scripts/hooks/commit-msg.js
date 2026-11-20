// commit-msg: enforces the commit subject rule of scripts/lib/commit-subject.js.
import { readFileSync } from 'node:fs';
import { subjectProblems } from '../lib/commit-subject.js';

const subject = readFileSync(process.argv[2], 'utf8').split('\n')[0];
const problems = subjectProblems(subject);
if (problems.length) {
  console.error(`commit-msg: "${subject}"\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

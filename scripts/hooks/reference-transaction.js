// reference-transaction: tags are immutable. Refuses moving a tag (`git tag -f`, `git update-ref`
// to another commit) and deleting one without naming its value (`git tag -d`, `git update-ref -d
// <tag>`). `git update-ref -d <tag> <value>` must stay allowed: `git pack-refs` (also run by
// `git gc`) deletes every loose tag that way once packed-refs holds it, and git reports both alike.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ZERO = /^0+$/;

if (process.argv[2] === 'prepared') {
  const refused = [];
  for (const line of readFileSync(0, 'utf8').split('\n')) {
    const [oldOid, newOid, ref] = line.split(' ');
    if (!ref?.startsWith('refs/tags/')) continue;
    if (ZERO.test(newOid)) {
      if (ZERO.test(oldOid)) refused.push(`${ref}: deleting a tag is refused (tags are immutable)`);
      continue;
    }
    const current = currentOid(ref);
    if (current && current !== newOid) refused.push(`${ref}: moving a tag is refused (tags are immutable)`);
  }
  if (refused.length) {
    console.error(`reference-transaction:\n- ${refused.join('\n- ')}`);
    process.exit(1);
  }
}

function currentOid(ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { encoding: 'utf8' }).trim();
  } catch (error) {
    // `rev-parse --verify --quiet` exits 1, printing nothing, when the ref does not exist yet.
    if (error.status === 1 && !error.stdout) return null;
    throw error;
  }
}

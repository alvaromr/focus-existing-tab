// pre-push: refuses moving or deleting a remote tag, then runs the heavy checks (`pnpm verify`).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ZERO = /^0+$/;

const refused = [];
for (const line of readFileSync(0, 'utf8').split('\n')) {
  const [, localOid, remoteRef, remoteOid] = line.split(' ');
  if (!remoteRef?.startsWith('refs/tags/') || ZERO.test(remoteOid)) continue;
  if (ZERO.test(localOid)) refused.push(`${remoteRef}: deleting a published tag is refused`);
  else if (localOid !== remoteOid) refused.push(`${remoteRef}: moving a published tag is refused`);
}
if (refused.length) {
  console.error(`pre-push:\n- ${refused.join('\n- ')}`);
  process.exit(1);
}
execFileSync('pnpm', ['verify'], { stdio: 'inherit' });

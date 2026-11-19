// pre-commit: runs the gate when something is staged. Installed by `pnpm install` (see the
// `prepare` script), which points core.hooksPath at .githooks/.
import { execFileSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
if (staged) execFileSync('pnpm', ['check'], { stdio: 'inherit' });

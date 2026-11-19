// pre-commit: when something is staged, scans the staged changes for secrets (the gate's own scan
// only sees committed history) and runs the gate. Installed by `pnpm install` (see the `prepare`
// script), which points core.hooksPath at .githooks/.
import { execFileSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
if (staged) {
  execFileSync('gitleaks', ['git', '--staged', '--no-banner', '--redact', '--log-level', 'warn', '.'], {
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['check'], { stdio: 'inherit' });
}

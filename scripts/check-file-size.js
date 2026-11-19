// Gate guard: fails when a tracked code file grows past MAX_LINES. A file that long usually holds
// more than one responsibility; split it by concern rather than raising the cap.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX_LINES = 400;
const CODE = /\.(js|mjs|css|html|sh)$/;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => CODE.test(f));
const tooLong = files
  .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n').length }))
  .filter(({ lines }) => lines > MAX_LINES);
if (tooLong.length) {
  console.error(
    `Files over ${MAX_LINES} lines:\n${tooLong.map(({ file, lines }) => `- ${file}: ${lines}`).join('\n')}`,
  );
  process.exit(1);
}

// Bumps the version (manifest.json is the source of truth, package.json mirrors it), moves the
// CHANGELOG "Unreleased" section under the new version, commits and tags.
// Usage: pnpm release patch|minor|major|<x.y.z>   (then: git push --follow-tags)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXT_DIR } from './lib/cdp.js';

const arg = process.argv[2];
if (!arg) throw new Error('usage: pnpm release patch|minor|major|<x.y.z>');

const git = (...args) => execFileSync('git', args, { cwd: EXT_DIR, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('working tree is not clean');

const manifestPath = join(EXT_DIR, 'manifest.json');
const packagePath = join(EXT_DIR, 'package.json');
const changelogPath = join(EXT_DIR, 'CHANGELOG.md');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

const [major, minor, patch] = manifest.version.split('.').map(Number);
const next =
  { patch: `${major}.${minor}.${patch + 1}`, minor: `${major}.${minor + 1}.0`, major: `${major + 1}.0.0` }[arg] ?? arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`invalid version: ${next}`);
if (next === manifest.version) throw new Error(`already at ${next}`);

manifest.version = next;
pkg.version = next;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const today = new Date().toISOString().slice(0, 10);
const repo = pkg.repository?.url?.replace(/\.git$/, '') || 'https://github.com/alvaromr/focus-existing-tab';
let changelog = readFileSync(changelogPath, 'utf8');
if (!/^## \[Unreleased\]\n+(?=### )/m.test(changelog)) throw new Error('CHANGELOG.md: the Unreleased section is empty');
changelog = changelog
  .replace(/^## \[Unreleased\]\n/m, `## [Unreleased]\n\n## [${next}] - ${today}\n`)
  .replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/releases/tag/v${next}`,
  );
writeFileSync(changelogPath, changelog);

git('add', 'manifest.json', 'package.json', 'CHANGELOG.md');
git('commit', '-m', `chore(release): v${next}`);
git('tag', '-a', `v${next}`, '-m', `v${next}`);
console.log(`v${next} committed and tagged. Publish with: git push --follow-tags`);

// Bumps the version (manifest.json is the source of truth, package.json mirrors it), moves the
// CHANGELOG "Unreleased" section under the new version, commits and tags.
// Usage: pnpm release patch|minor|major|<x.y.z>   (then: git push --follow-tags)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_DIR } from './lib/cdp.js';
import { releaseSubject } from './lib/commit-subject.js';

const arg = process.argv[2];
if (!arg) throw new Error('usage: pnpm release patch|minor|major|<x.y.z>');

const git = (/** @type {string[]} */ ...args) => execFileSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('working tree is not clean');
// Bump only once the release can no longer fail: the heavy checks and the packaged-zip smoke.
execFileSync('pnpm', ['verify'], { cwd: REPO_DIR, stdio: 'inherit' });
execFileSync('pnpm', ['smoke:package'], { cwd: REPO_DIR, stdio: 'inherit' });

const manifestPath = join(REPO_DIR, 'manifest.json');
const packagePath = join(REPO_DIR, 'package.json');
const changelogPath = join(REPO_DIR, 'CHANGELOG.md');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

const [major, minor, patch] = manifest.version.split('.').map(Number);
const next =
  { patch: `${major}.${minor}.${patch + 1}`, minor: `${major}.${minor + 1}.0`, major: `${major + 1}.0.0` }[arg] ?? arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`invalid version: ${next}`);
if (next === manifest.version) throw new Error(`already at ${next}`);

// Replace only the version line: re-serializing the JSON would undo Prettier's layout.
/** @param {string} path @param {string} current */
const bump = (path, current) => {
  const text = readFileSync(path, 'utf8');
  const line = `"version": "${current}"`;
  if (!text.includes(line)) throw new Error(`${path}: no ${line}`);
  writeFileSync(path, text.replace(line, `"version": "${next}"`));
};
bump(manifestPath, manifest.version);
bump(packagePath, pkg.version);

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
git('commit', '-m', releaseSubject(next));
git('tag', '-a', `v${next}`, '-m', `v${next}`);
console.log(`v${next} committed and tagged. Publish with: git push --follow-tags`);

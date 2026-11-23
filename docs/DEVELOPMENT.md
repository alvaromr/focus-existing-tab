# Development

Plain JavaScript with ES modules (Manifest V3), no build step. The extension has no dependencies;
`pnpm install` only brings development tooling.

## Requirements

- Node: the version in `.node-version`; the oldest supported is in `package.json` `engines`, set by
  the e2e runner's use of the global `WebSocket`.
- pnpm: the version in `package.json` `packageManager`. `pnpm-workspace.yaml` blocks dependency
  install scripts, makes every new version wait `minimumReleaseAge` and refuses trust downgrades;
  its comments give the reason for each setting, override and ignored advisory.
- `shellcheck` and `gitleaks` on the `PATH`, for `pnpm lint` and `pnpm guards` (CI installs gitleaks
  with `scripts/ci/install-gitleaks.sh`, pinned by version and checksum).
- For the e2e, a browser that honours `--load-extension`: Brave, Chromium or Chrome for Testing
  (branded Google Chrome ≥ 137 ignores it).

## Commands

```bash
pnpm install      # development tooling (ESLint, Prettier, TypeScript, @types/chrome, @types/node) and git hooks
pnpm check        # the gate: lint + typecheck + guards + coverage, the same as CI and the pre-commit hook
pnpm guards       # gitleaks over the git history, and the 400-line cap per code file
pnpm verify       # heavy checks run by the pre-push hook
pnpm fix          # ESLint --fix + Prettier --write, then the gate
pnpm audit        # dependency advisories
pnpm lint         # ESLint + Prettier --check + ShellCheck (needs `shellcheck` installed)
pnpm format       # Prettier --write
pnpm typecheck    # tsc --checkJs in strict mode (via JSDoc): the extension against the Chrome API
                  # types (jsconfig.json), tests and scripts against Node's too (jsconfig.tools.json)
pnpm test         # unit tests (native node --test runner)
pnpm coverage     # unit tests with the coverage thresholds (100%)
pnpm mutation     # Stryker over src/lib, scoped to what changed (see Tests); report in reports/mutation/
pnpm mutation --full  # every mutant, only when asked or for a stated reason
pnpm test:e2e     # real run in headless Chromium
pnpm screenshots  # regenerate store/screenshots/*.png (same browser as the e2e)
pnpm package      # dist/focus-existing-tab-<version>.zip
pnpm smoke:package  # builds the zip, unpacks it into a temporary directory and runs the e2e on it
pnpm icons        # regenerate icons/*.png
pnpm release      # bump version, changelog, commit and tag (see Releases)
```

## Layout

```
manifest.json
_locales/{en,es}/messages.json   UI strings (including the contextual help)
src/background.js                service worker: events, tab actions, badge, commands
src/lib/navigation-tracker.js    per-tab state between onBeforeNavigate/onCommitted (pure)
src/lib/normalize.js             URL normalization and comparison key
src/lib/matching.js              glob/regex, lists, decision to act
src/lib/config.js                defaults, typedefs, validation and import
src/lib/dedupe.js                choice of the existing tab and the deduplicate-all plan
src/lib/navigation-action.js     reload rule, action for the navigating tab, what counts as avoided
src/lib/badge.js                 badge text and colour
src/lib/log.js                   the one console writer
src/lib/glob.js                  minimal glob matcher
src/chrome/storage.js            chrome.storage (sync/local)
src/chrome/i18n.js               chrome.i18n strings for the pages
src/ui/tokens.css                design tokens shared by the options page and the popup
src/ui/dom.js                    DOM lookups for the pages; a missing element throws
options/                         options page
popup/                           popup
test/*.test.js                   unit tests
test/e2e/smoke.js                end-to-end test in headless Chromium
test/e2e/harness.js              e2e test server, browser, polling helpers and check log
scripts/lib/cdp.js               headless Chromium launcher + CDP client (e2e and screenshots)
scripts/lib/commit-subject.js    commit subject rule (commit-msg hook and release commit)
scripts/screenshots.js           1280×800 store screenshots
scripts/package.sh               builds the zip
scripts/smoke-package.sh         e2e against the unpacked zip
scripts/release-notes.sh         one version's changelog section, for the GitHub Release
scripts/hooks/                   git hooks (installed through .githooks/)
scripts/check-file-size.js       gate guard: 400-line cap per code file
scripts/ci/install-gitleaks.sh   pinned gitleaks for the CI runners
scripts/release.js               version bump, changelog, commit and tag
scripts/mutation.js              scoped mutation run (Stryker incremental, bounded)
scripts/make-icons.js            generates the PNG icons (no dependencies)
store/                           Web Store listing: copy, checklist and screenshots
docs/                            this documentation
```

All decision logic lives in `src/lib/*` without touching `chrome.*`, and coverage is measured over
it and the other modules the unit tests load (`scripts/lib/commit-subject.js`). `background.js`, `src/chrome/*`, `options.js` and `popup.js` depend on `chrome.*`: the
e2e covers them (without a metric) and the type check validates them against `@types/chrome`.

## Tests

- **Unit** (`test/*.test.js`): normalization, matching, configuration, tab selection and the
  navigation state machine (real sequences: new tab, redirect, activation without
  `onBeforeNavigate`, fast commit, deferred `goBack`, reload, error).
- **Mutation** (`pnpm mutation`): Stryker mutates `src/lib` and runs the unit suite per mutant; the
  run fails below a 100% score. An equivalent mutant (one no test can tell apart, such as a cache
  being skipped) is disabled in place with a `// Stryker disable` comment stating why.
  - Scoped by default (`scripts/mutation.js`): Stryker's incremental mode
    (`reports/stryker-incremental.json`) reuses the result of every mutant in unchanged source.
    Stryker's command runner cannot see test changes, so the script also re-runs the modules a
    unit test reaches (its imports, transitively) when that test, a module it imports or a file it
    reads changed (`reports/mutation-scope.json`).
  - Full run (every mutant, reason printed): with `pnpm mutation --full`, when there is no previous
    result (a fresh checkout or worktree), or when `stryker.config.json`, the Stryker version or
    the Node major changed. A release, the pre-push hook or a score are never a reason for one.
  - Bounded: half the cores (`--concurrency`), `nice -n 10`, one test file at a time per mutant
    (`--test-concurrency=1`), and a per-mutant timeout of about 13 times one test run (0.6 s ×
    `timeoutFactor` 10 + `timeoutMS` 2000).
- **E2E** (`test/e2e/smoke.js`): launches a headless browser with a temporary profile, loads the
  extension and checks its scenarios over the DevTools protocol (duplicate tab, redirect, in-tab
  navigation, reload, badge, popup, options, absence of errors). It finds Brave/Chromium in the
  usual locations; otherwise `CHROME=/path/to/binary`. `CHROME_ARGS` adds flags (CI passes
  `--no-sandbox`). Chrome for Testing: `pnpm dlx @puppeteer/browsers install chrome@stable`.

## CI

`.github/workflows/ci.yml` runs on every push and PR: `pnpm check` and `pnpm package` (uploading
the zip as an artifact) on the pinned Node, `pnpm check` again on the oldest Node that `engines`
accepts, and the e2e in the oldest Chrome that `minimum_chrome_version` accepts and in stable.

## Git hooks

`pnpm install` points `core.hooksPath` at `.githooks/`, whose one-line scripts call
`scripts/hooks/*.js`:

- `pre-commit`: when something is staged, gitleaks over the staged changes, then the gate.
- `commit-msg`: Conventional Commits without a scope in parentheses, subject of at most 72
  characters (the rule is in `scripts/lib/commit-subject.js`, shared with `pnpm release`).
- `pre-push`: refuses moving or deleting a published tag, then runs `pnpm verify`.
- `reference-transaction`: refuses moving or deleting a local tag. `git update-ref -d <tag> <value>`
  stays allowed because `git pack-refs` deletes loose tags that way.

## Manual test plan

With the extension loaded in developer mode:

1. **Duplicate new tab**: open `https://example.com/`. In a new tab type
   `https://www.example.com/?utm_source=x#top`. The first tab must be focused and the second closed;
   the badge shows `1`.
2. **Another window**: move the example.com tab to a second window and repeat. It must switch
   window and focus it.
3. **In-tab navigation**: in a tab showing another page, type `https://example.com/`. With the
   default setting the existing tab is focused and the originating tab goes back to its previous
   page. Switch the setting to "Only focus" or "Do nothing" and compare.
4. **Parameters**: open `https://example.com/?a=1` and then `https://example.com/?a=2`. Both must
   remain. Add `a` to "Ignored parameters", save and repeat: the second one closes.
5. **Blacklist**: add `example.com` to the blacklist, save, and open example.com twice: no action.
   Switch to "whitelist only" with an empty list: no action anywhere either.
6. **Pinned**: pin the example.com tab and open another example.com: the pinned one is focused and
   the new one closed. With "Ignore them completely" the new one stays.
7. **Focus only**: untick "Close the duplicate tab"; opening a duplicate focuses the existing tab
   but the new one stays open.
8. **Deduplicate all**: disable the extension from the popup (badge `OFF`), open example.com three
   times, enable it and click "Deduplicate all tabs" (or `Alt+Shift+D`): one remains and the popup
   reports the closed ones.
9. **URL tester**: in options, type a URL and check the decision, matched rule and key; form
   changes are reflected without saving.
10. **Import/export**: export the JSON, change something, import the file and save. Import a JSON
    with an invalid regex (`{"blacklist":[{"pattern":"(","type":"regex"}]}`) and check the warning.
11. **Internal URLs**: open `chrome://extensions` or `chrome://newtab` twice: never acts.
12. **Language**: with the browser in Spanish the UI shows up in Spanish.
13. **Priority**: open example.com in two windows and, from a third tab in the first window, type
    example.com: the tab in the same window is focused. Move "Is the active tab" to the top, save,
    activate the tab in the second window and repeat: now that one is focused.
14. **Groups**: put an example.com tab in a group and open example.com outside the group: the new
    one closes. With "Only tabs in the same group" it stays.
15. **Help**: click any "?" in options; the text unfolds under the option; click again to hide it.
16. **Excluded groups**: open example.com in a normal tab, then ask Claude Code to open
    example.com: its tab stays in its `Claude` group. Open example.com again yourself: the new
    tab focuses your first tab, never Claude's. Add your own group's title to "Excluded groups",
    save, and check its tabs are no longer deduplicated.

To debug the service worker: `chrome://extensions` → the extension → "Service worker". Errors are
logged to its console.

## Security

Review of the full code, last on 2026-11-19 (adds the `tabGroups` permission, read-only):

- **Surface**: no `content_scripts`, `host_permissions`, `externally_connectable`, network requests
  or remote code. The MV3 default CSP (`script-src 'self'`) applies to options and popup.
- **Messaging**: `runtime.onMessage` only receives messages from the extension's own context and
  dispatches by name through a closed table; any other `type` is ignored.
- **User input**: texts are rendered with `textContent`, never `innerHTML`. Imported configuration
  goes through `normalizeConfig` (drops unknown keys, types every field, removes invalid rules) and
  is rejected above 1 MB.
- **User regexes**: compiled over the user's own URLs; a pathological regex can only slow down their
  own navigations. The `g`/`y` flags are dropped.
- **Data**: URLs are only read in memory during a navigation. See [PRIVACY.md](../PRIVACY.md).
- **Supply chain**: pnpm with dependency scripts blocked, a 4-day `minimumReleaseAge` and
  `trustPolicy: no-downgrade`; the shipped extension includes no dependency at all.

## Versioning and releases

SemVer. `manifest.json` is the source of truth for the version and `package.json` mirrors it.
Distribution happens through GitHub Releases (a zip to load as an unpacked extension); it is not on
the Chrome Web Store.

1. Record changes under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) as you go.
2. With a clean tree and green CI: `pnpm release patch|minor|major` (or `x.y.z`). The script runs
   `pnpm verify` and `pnpm smoke:package`, then bumps the version in both files, dates the
   changelog section, commits `chore: vX.Y.Z` and creates the annotated tag `vX.Y.Z`.
3. `git push --follow-tags`. The `release.yml` workflow checks that the tag matches the manifest,
   runs `pnpm check` and `pnpm smoke:package`, and publishes the GitHub Release with the zip and
   the changelog notes (`scripts/release-notes.sh`).

Should it ever go to the Chrome Web Store: listing copy, permission justifications and checklist in
[store/listing.md](../store/listing.md); screenshots in `store/screenshots/` (`pnpm screenshots`);
it requires a paid developer account and a public privacy policy URL.

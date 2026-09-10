# Development

Plain JavaScript with ES modules (Manifest V3), no build step. The extension has no dependencies;
`pnpm install` only brings development tooling.

## Requirements

- Node 26 (`.node-version`; minimum 22 because the e2e runner uses the global `WebSocket`).
- pnpm 12 (`packageManager` in `package.json`). `pnpm-workspace.yaml` blocks dependency install
  scripts, requires every version to be at least 7 days old (`minimumReleaseAge`) and refuses trust
  downgrades (`trustPolicy: no-downgrade`).
- For the e2e, a browser that honours `--load-extension`: Brave, Chromium or Chrome for Testing
  (branded Google Chrome ≥ 137 ignores it).

## Commands

```bash
pnpm install      # development tooling (ESLint, Prettier, TypeScript, @types/chrome)
pnpm check        # lint + typecheck + coverage, the same as CI
pnpm lint         # ESLint + Prettier --check
pnpm format       # Prettier --write
pnpm typecheck    # tsc --checkJs against the Chrome API types (via JSDoc)
pnpm test         # unit tests (native node --test runner)
pnpm coverage     # unit tests with thresholds: 100% lines and functions, 95% branches
pnpm test:e2e     # real run in headless Chromium
pnpm screenshots  # regenerate store/screenshots/*.png (same browser as the e2e)
pnpm package      # dist/focus-existing-tab-<version>.zip
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
src/lib/storage.js               chrome.storage (sync/local)
src/lib/glob.js, i18n.js
options/                         options page
popup/                           popup
test/*.test.js                   unit tests
test/e2e/smoke.js                end-to-end test in headless Chromium
scripts/lib/cdp.js               headless Chromium launcher + CDP client (e2e and screenshots)
scripts/screenshots.js           1280×800 store screenshots
scripts/package.sh               builds the zip
scripts/release.js               version bump, changelog, commit and tag
scripts/make-icons.js            generates the PNG icons (no dependencies)
store/                           Web Store listing: copy, checklist and screenshots
docs/                            this documentation
```

All decision logic lives in `src/lib/*` without touching `chrome.*`, and that is where coverage is
measured. `background.js`, `storage.js`, `i18n.js`, `options.js` and `popup.js` depend on
`chrome.*`: the e2e covers them (without a metric) and the type check validates them against
`@types/chrome`.

## Tests

- **Unit** (`test/*.test.js`): normalization, matching, configuration, tab selection and the
  navigation state machine (real sequences: new tab, redirect, activation without
  `onBeforeNavigate`, fast commit, deferred `goBack`, reload, error).
- **E2E** (`test/e2e/smoke.js`): launches a headless browser with a temporary profile, loads the
  extension and checks 16 scenarios over the DevTools protocol (duplicate tab, redirect, in-tab
  navigation, reload, badge, popup, options, absence of errors). It finds Brave/Chromium in the
  usual locations; otherwise `CHROME=/path/to/binary`. `CHROME_ARGS` adds flags (CI passes
  `--no-sandbox`). Chrome for Testing: `pnpm dlx @puppeteer/browsers install chrome@stable`.

## CI

`.github/workflows/ci.yml` runs on every push and PR: `pnpm install --frozen-lockfile`,
`pnpm check`, the e2e with Chrome for Testing and `pnpm package`, uploading the zip as an artifact.

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

To debug the service worker: `chrome://extensions` → the extension → "Service worker". Errors are
logged to its console.

## Security

Review of the full 1.0.0 code:

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
- **Supply chain**: pnpm with dependency scripts blocked, a 7-day `minimumReleaseAge` and
  `trustPolicy: no-downgrade`; the shipped extension includes no dependency at all.

## Versioning and releases

SemVer. `manifest.json` is the source of truth for the version and `package.json` mirrors it.
Distribution happens through GitHub Releases (a zip to load as an unpacked extension); it is not on
the Chrome Web Store.

1. Record changes under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md) as you go.
2. With a clean tree and green CI: `pnpm release patch|minor|major` (or `x.y.z`). The script bumps
   the version in both files, dates the changelog section, commits `chore(release): vX.Y.Z` and
   creates the annotated tag `vX.Y.Z`.
3. `git push --follow-tags`. The `release.yml` workflow checks that the tag matches the manifest,
   runs `pnpm check`, packages and publishes the GitHub Release with the zip and the changelog notes.

Should it ever go to the Chrome Web Store: listing copy, permission justifications and checklist in
[store/listing.md](../store/listing.md); screenshots in `store/screenshots/` (`pnpm screenshots`);
it requires a paid developer account and a public privacy policy URL.

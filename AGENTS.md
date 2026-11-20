# Focus Existing Tab

Chrome MV3 extension that focuses the tab already showing a page instead of opening it twice. For
its users; distributed through GitHub Releases.

## Commands

All are `package.json` scripts; the full list with one line each is in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#commands).

- Gate: `pnpm check` (lint, type check, secret scan and file-size cap, unit tests at 100% coverage).
  Fix: `pnpm fix`.
- Before push: `pnpm verify` (gate, audit, mutation, e2e), run by the pre-push hook.
- Run: load the folder as an unpacked extension in `chrome://extensions`; build the zip with
  `pnpm package`; release with `pnpm release` (see docs/DEVELOPMENT.md, "Versioning and releases").

## Architecture

- `src/lib/`: the pure core (decisions, matching, normalization, configuration, navigation state).
  No browser or extension API; ESLint enforces it (`eslint.config.js`).
- `src/chrome/`: thin adapters over `chrome.*` (storage, i18n).
- `src/background.js`: the service worker; wires `chrome.*` events to the core.
- `options/`, `popup/`: the pages; `src/ui/tokens.css` holds their design tokens.
- Module map: docs/DEVELOPMENT.md, "Layout".

## Non-negotiables

- The gate passes before every commit; the hooks enforce it. — A red commit breaks bisect.
- Test first; 100% line, branch and function coverage on `src/lib`, and a 100% mutation score. — A
  rule no test pins can silently change.
- Never swallow an error: log it through `src/lib/log.js`. — Silent failures become wrong behaviour
  nobody looks for.
- Conventional Commits without a scope (`type: summary`, never `type(scope): summary`), subject of
  at most 72 characters (commit-msg hook). — Readable, uniform history.
- Tags are immutable (hooks refuse moving or deleting them). — A version names one artifact forever.
- Every change updates the docs, changelog, UI strings (both locales) and tests it affects, in the
  same commit. — The next change is planned from what the files say.
- English for code, docs and commits; UI copy in `_locales/`. — Shared language of the tools.
- No secrets or personal data in the repo. — History keeps everything.

## Decisions

Before changing a practice, read `docs/decisions/`.

## Where things live

- Behaviour and options: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
- Development, tests, CI, hooks, security review, manual test plan, releases:
  [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- Changes per version: [CHANGELOG.md](CHANGELOG.md). Privacy: [PRIVACY.md](PRIVACY.md).
  Vulnerability reports: [SECURITY.md](SECURITY.md).
- Web Store listing: [store/listing.md](store/listing.md).

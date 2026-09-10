# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-10

First release.

### Added

- Focus the existing tab and close the duplicate, catching the navigation in
  `webNavigation.onBeforeNavigate`; re-check of the final URL after redirects.
- In-tab navigation: go back, focus only, close or ignore.
- Whitelist and blacklist with glob and regex patterns; "everything except blacklist" or
  "whitelist only" modes.
- Global and per-rule query parameter comparison, with ignored and significant parameters.
- Configurable normalization: fragment, `www.`, scheme, trailing slash, port, host and path case,
  parameter order.
- Scope by window, tab groups, incognito and app windows; pinned tab policy; configurable priority
  when choosing the tab and tie-break by age.
- Popup with toggle, avoided-duplicates counter and "Deduplicate all tabs"; keyboard shortcuts;
  badge with counter or `OFF`.
- Options page with URL tester, contextual help and JSON import/export.
- UI in English and Spanish.

[Unreleased]: https://github.com/alvaromr/focus-existing-tab/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/alvaromr/focus-existing-tab/releases/tag/v1.0.0

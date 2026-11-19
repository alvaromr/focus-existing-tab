# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- "Excluded groups" option (`excludedGroups`): tab group titles (globs) whose tabs are never
  duplicates and never block others. Needs the new `tabGroups` permission to read group titles.
- "Leave grouped tabs alone" value for "Tab groups" (`groupPolicy: "exclude"`): tabs in any group
  are never duplicates and never block others; only ungrouped tabs are compared.

### Fixed

- Claude in Chrome no longer loses its tab group when it opens a page that is already open: its
  groups (`Claude`, `Claude (MCP)`, with or without a status prefix) are excluded by default.

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

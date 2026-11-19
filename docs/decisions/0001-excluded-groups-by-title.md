# 0001 — Exclude tab groups by title, with Claude in Chrome's groups by default

- **Date:** 2026-11-19
- **Decided by:** the owner, who asked for a general option configured by default instead of a
  Claude-only exception.

## Context

Claude in Chrome (the browser automation Claude Code uses) works in a tab group of its own. When it
navigated its tab to a page the user already had open, the extension closed that tab as a
duplicate, and Claude lost its group.

## Decision

The `excludedGroups` option lists tab group titles (case-insensitive globs). Tabs in a matching
group are never duplicates, never block opening the same page elsewhere, and "Deduplicate all"
skips them. The defaults match Claude in Chrome's groups: `Claude`, `Claude (MCP)` and either one
with a one-character status prefix (`⌛`, `🔔`, `✅`). The `exclude` value of `groupPolicy` applies
the same treatment to every grouped tab.

The titles come from Claude in Chrome 1.0.107's code and from a group it created in a real profile.

## Alternatives rejected

- **Asking Claude in Chrome which groups are its own:** it only accepts external messages from
  `claude.ai`.
- **Its stored group ids:** they live in its private `chrome.storage`, which other extensions cannot
  read.
- **The group colour:** it rotates between groups.
- **Detecting its debugger attachment (`chrome.debugger.getTargets`):** needs the `debugger`
  permission, whose install warning grants full page access, and it also fires when the user opens
  DevTools.
- **A Claude-only hardcoded check:** the first implementation; the owner preferred a general,
  user-editable option.

## Consequences

- A group of the user's own titled like Claude's is excluded too; emptying the list turns this off.
- If Claude in Chrome changes its titles, or a session names its group differently, the user adds
  the new title in the options; the code does not change.
- The extension needs the `tabGroups` permission to read group titles.

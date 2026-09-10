# Configuration and behaviour

Everything is set on the options page; every option has a "?" button with its explanation. This
document describes how the extension decides and the format of the exported configuration.

## How two URLs are compared

Every URL is turned into a **key** by applying the configured normalization. Two tabs show the same
page when their keys are equal. With the defaults:

```
https://www.example.com/page/?b=2&a=1&utm_source=x#section
→ http://example.com/page?a=1&b=2
```

"Significant" parameters are always compared, "ignored" ones never, and the rest according to
"Compare parameters by default" (or its per-rule override). Unless "Parameter order matters" is
on, parameters are sorted alphabetically.

## List patterns

| Type  | Pattern                   | Matches                                                                     |
| ----- | ------------------------- | --------------------------------------------------------------------------- |
| glob  | `example.com`             | `example.com` and any subdomain (`www.example.com`, `a.b.example.com`)      |
| glob  | `*.google.com`            | Any subdomain of google.com, but not `google.com`                           |
| glob  | `localhost:8080`          | With `:` it is compared against `host:port`; without it the port is ignored |
| glob  | `github.com/anthropics/*` | Full URL without scheme, anchored: `*` required for prefixes                |
| glob  | `https://a.com/*`         | If the pattern contains `://`, it is compared against the full URL          |
| regex | `^https://a\.com/\d+$`    | Regex over the full URL; `/body/flags` also accepted (e.g. `/a\.com/i`)     |

A glob without `/` is a domain pattern; with `/` it is a URL pattern. `*` matches anything
(including `/`), `?` one character. Internationalized hosts are written in punycode
(`xn--mnchen-3ya.de`), which is how the browser reports them.

## JSON format (export / import)

```json
{
  "version": 1,
  "enabled": true,
  "mode": "blacklist",
  "whitelist": [
    {
      "pattern": "youtube.com",
      "type": "glob",
      "enabled": true,
      "query": { "compare": false, "ignored": null, "significant": ["v"] }
    }
  ],
  "blacklist": [
    {
      "pattern": "bank.com",
      "type": "glob",
      "enabled": true,
      "query": { "compare": null, "ignored": null, "significant": null }
    }
  ],
  "closeDuplicate": true,
  "focusWindow": true,
  "inTabNavigation": "back",
  "scope": "all",
  "pinnedPolicy": "protect",
  "groupPolicy": "ignore",
  "incognitoPolicy": "separate",
  "windowTypes": "all",
  "ranking": ["window", "active", "pinned", "loaded"],
  "tieBreak": "oldest",
  "restoreMinimized": true,
  "actOnReload": false,
  "countFocusOnly": true,
  "showBadge": true,
  "normalization": {
    "ignoreFragment": true,
    "ignoreWww": true,
    "ignoreScheme": true,
    "ignoreTrailingSlash": true,
    "ignorePort": false,
    "caseInsensitiveHost": true,
    "caseInsensitivePath": false
  },
  "query": { "compare": true, "orderMatters": false, "ignored": ["utm_*", "fbclid", "gclid"], "significant": [] }
}
```

| Field             | Values                                                  | Meaning                                                                   |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `mode`            | `blacklist`, `whitelist`                                | Act on everything except the blacklist, or only on the whitelist          |
| `inTabNavigation` | `back`, `focus`, `close`, `ignore`                      | What to do when the duplicate URL opens in a tab that already had a page  |
| `scope`           | `all`, `window`                                         | Search every window or only the current one                               |
| `pinnedPolicy`    | `protect`, `ignore`, `normal`                           | Pinned tabs: never close / ignore / treat like any other                  |
| `groupPolicy`     | `ignore`, `same`                                        | Tab groups: no effect / same group only (ungrouped is a group of its own) |
| `incognitoPolicy` | `separate`, `shared`                                    | Never mix normal and incognito / compare across them                      |
| `windowTypes`     | `all`, `normal`                                         | Count app and popup windows (PWAs) or only regular windows                |
| `ranking`         | list of `group`, `window`, `active`, `pinned`, `loaded` | Ordered criteria to pick the tab to focus or keep                         |
| `tieBreak`        | `oldest`, `newest`                                      | Final tie-break                                                           |
| rule `query.*`    | `null` or a value                                       | `null` inherits the global setting                                        |

On import, unknown keys are dropped, invalid values fall back to defaults and invalid rules
(malformed regex, empty pattern) are removed with a warning. Files over 1 MB are rejected.
`chrome.storage.sync` allows 8 KB per item: with hundreds of rules saving fails and the options page
says so.

## Behaviour in detail

- **Whitelist in blacklist mode**: its rules restrict nothing, but their parameter settings apply to
  matching URLs. This customizes a site without switching modes.
- **Matched rule**: the first enabled rule that matches. Its parameter settings compute the key of
  both the new URL and the existing tabs (symmetric comparison).
- **Reloads**: reloading a tab (or typing its own URL) is not a duplicate even if another tab shows
  the page; "Also act when reloading" changes that.
- **In-tab navigation**: `back` by default (focus the existing tab and `tabs.goBack`). The duplicate
  page loads briefly because `goBack` only works after the commit; if the tab has no history to go
  back to, it keeps the loaded page.
- **Redirects**: the final URL is re-checked in `onCommitted`.
- **Tabs restored at startup**: the browser does not load them until activated, so they trigger no
  navigation. For a restored session with duplicates, use "Deduplicate all tabs".
- **Incognito**: only visible if you allow the extension in incognito. By default they never mix
  (`separate`); with `shared` a normal tab can focus an incognito one and vice versa.
- **App and popup windows**: their tabs count by default (`all`); with `normal` only regular
  windows are searched.
- **Other profiles**: the browser gives no access to other profiles' tabs; each profile runs its own
  instance.
- **Choosing the tab** when several match: criteria in `ranking` order (default same window >
  active > pinned > loaded) and `tieBreak`. When deduplicating everything, the "reference window"
  is the last focused one and the "same group" criterion never applies because there is no
  originating tab.
- **Groups**: with `ignore`, a tab inside a group and one outside are duplicates. With `same` only
  tabs in the same group are compared and "no group" counts as a group (a new ungrouped tab only
  matches ungrouped ones). To prefer the same group without excluding the rest, put the "same
  group" criterion first in the priority list. Closing the only tab of a group removes the group.
- **Deduplicate all** always closes duplicates (even when "Close the duplicate tab" is off),
  honouring lists, pinned policy and scope (window, groups, incognito, window types).
- **Case-insensitive host**: the browser's URL parser already lowercases the host; the option exists
  for completeness.
- **Port**: part of the key by default (`a.com:8080` ≠ `a.com`); `ignorePort` drops it. Default ports
  (80/443) are always removed by the parser.
- **Credentials in the URL** (`user:pass@host`): ignored in the key; URL patterns do see them.
- **Regex flags**: `g` and `y` are dropped because they make `test()` stateful.
- **Counter**: counts every action (close, go back and, unless `countFocusOnly` is off, focus only)
  and every tab closed by "Deduplicate all". Lives in `storage.local`.
- **Minimized windows**: restored when focusing (`restoreMinimized` turns it off).
- **Internal URLs**: only `http:` and `https:` are handled; `chrome://`, `about:`, extension pages,
  etc. are always ignored.
- **`minimum_chrome_version` 116**: conservative baseline; the APIs used exist since Chrome 91, but
  only recent versions have been tested.

# Privacy policy · Focus Existing Tab

Last updated: 2026-09-10

## Summary

Focus Existing Tab does not collect, store, transmit or sell any personal data. All processing
happens inside your browser.

## What data the extension touches

- **URLs of your tabs.** To know whether a page is already open, the extension reads the URLs of
  the open tabs at the moment of a navigation and compares them in memory. URLs are neither stored
  nor sent anywhere.
- **Your configuration.** Rules, normalization options and ignored parameters are saved with
  `chrome.storage.sync`, that is, in your browser profile and, if Chrome/Brave sync is on, in your
  Google/Brave account through the browser itself. The extension has no access to that account.
- **Avoided-duplicates counter.** An integer saved with `chrome.storage.local`.

## What it does NOT do

- No network requests: no servers, analytics, telemetry or crash reports.
- No code injected into web pages and no reading of their content (no `content_scripts` or
  `host_permissions`).
- No reading of browsing history or cookies.
- No remote code and no third-party libraries.

## Permissions

| Permission      | Reason                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| `tabs`          | Read the URLs of open tabs, activate a tab, close the duplicate and go back. |
| `webNavigation` | Detect every navigation before it loads so the extension can act in time.    |
| `storage`       | Save your configuration and the counter.                                     |

Chrome shows the "Read your browsing history" warning because of the `tabs` permission; it is the
generic warning that accompanies access to tab URLs. The extension never queries the history.

## Incognito mode

It only sees incognito tabs if you explicitly allow it at `chrome://extensions`. By default a normal
tab is never compared with an incognito one; you can change that in the options ("Incognito
tabs"). In no case do URLs leave the browser.

## Changes to this policy

Any change will be published in this file inside the project repository.

## Contact

Open an issue in the project repository.

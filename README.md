# UKVI Form Helper

A browser extension (Edge / Chrome, Manifest V3) that helps complete repetitive UKVI online forms:

- **Adviser details** are saved once and offered on every form.
- **Case data** exported from your case management system is imported (CSV or JSON) and offered on matching fields.
- **Form layouts** are remembered, so the second time you open a page the fields are already linked.
- **Defaults** for answers that aren't case data (e.g. "reason for applying") are learned from what you type, most-used first.

It never submits a form. It only fills fields you tick, and highlights each field when you hover its row.

## Privacy: nothing leaves the browser

- It lives in the browser **side panel**, so it stays open beside the form as you move between pages.
- Permissions: `storage`, `scripting`, `tabs` (to see the address of the page you're on), `sidePanel`. **No site access is granted up front.** The first time you use it on a site, the panel shows an **Allow on this site** button; the browser asks you once and that approval covers only that site. You can revoke it at `chrome://extensions` → Details → Site access.
- Nothing runs on a page until you've approved that site and opened the panel. No auto-running content scripts.
- No `fetch`, `XMLHttpRequest`, WebSocket, beacon, remote script/font/image or `eval` anywhere. The extension-page CSP sets `connect-src 'none'`.
- `node tests/privacy-check.js` fails if any of that changes. Run it after every edit and before giving the folder to IT.
- Data is stored in `chrome.storage.local` (this browser profile, **not encrypted** by the extension and not synced). Use the options page backup/clear buttons, and treat a backup file like a client file.
- A web page can of course see values once they're filled into its fields.

## Install (unpacked)

1. Edge: `edge://extensions` → Developer mode → **Load unpacked** → choose this folder (the one containing `manifest.json`). Chrome: `chrome://extensions`. Needs Chrome/Edge 114 or later. (If a browser has no side panel, it opens as a small pinned window instead.)
2. Pin the icon. If your organisation blocks unpacked extensions, give IT this folder and `tests/privacy-check.js`; it's plain JavaScript with no dependencies.

## Using it

1. **Options page** (right-click the icon → Extension options, or ⚙ in the panel).
   - *Adviser*: enter your details once.
   - *Case data*: choose or paste your export → check the column-name table → **Import**. Your column-name choices are remembered, so next month's export maps itself.
2. Open a UKVI form page → click the icon (or Alt+Shift+U) → on a new site click **Allow on this site** once. The panel follows you as the form moves from page to page, and when you switch tabs. For each field you get a row with a value, where it came from and a source dropdown (case item, adviser item, default, or skip).
   - **Green "saved"** = linked before. **Blue "default"** = learned answer. **Orange "guess"** = matched by wording only; not ticked until you tick it.
   - Fields that already contain something different are not ticked.
3. **Fill ticked fields.** Choices you made are saved automatically. Check every answer.
4. Finish the page yourself, then **Remember this page**: saves the layout and learns your typed answers for fields set to *Default*.

**Case template.** Each time you click *Remember this page* (with "Add to case template" ticked), every field linked to case data is added to one shared list of what clients need to provide, together with the forms that ask for it. Adviser data and learned defaults are left out because they aren't the client's. View or edit the list on the options page → *Case template*; an export for clients is planned.

Dates held as `YYYY-MM-DD` are split automatically into Day / Month / Year boxes or dropdowns, or written `dd/mm/yyyy` in a single box.

Case data is never turned into a default, so one client's details can't be offered to the next.

## Getting data in (and Copilot)

Import accepts CSV (comma, semicolon or tab) or JSON:

```json
{ "format": "ukvi-form-helper/1",
  "adviser": { "oisc_number": "N000000000" },
  "cases": [ { "id": "CASE-001", "data": { "given_names": "Alex", "family_name": "Sample", "dob": "1990-04-23" } } ] }
```

A plain array of flat records also works. Column/key names don't need to match: the options page maps them and remembers the mapping. The options page → *Backup & Copilot help* has two ready-made prompts for your approved Copilot:

- **A** reshapes a full export into the JSON above (use only if your policy allows pasting client data into Copilot).
- **B** sends *headings only* and returns a column mapping you can paste into the import box. No client data involved.

## Limits

- Top frame only (forms inside cross-origin iframes aren't reached).
- Fields hidden until a previous answer is given, or forms that change without reloading, appear after you click **Rescan**.
- Toggle buttons and switches (`aria-pressed`, `aria-checked`, `role=switch|checkbox|radio`) are supported. Other custom widgets that aren't real inputs (e.g. some autocompletes) aren't detected.
- Fuzzy matching is by wording; always review orange guesses.

## Tests

```
node tests/unit.js            # matching, CSV/JSON import, dates
node tests/privacy-check.js   # no network / remote code / extra permissions
node tests/panel.test.js      # real extension + side panel on a fake form (needs Playwright + Chromium)
node tests/extension.test.js  # loads the real unpacked extension, imports a CSV
node tools/make-icons.js      # regenerate icons
```

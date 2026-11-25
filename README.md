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
2. Open a UKVI form page → click the icon (or Alt+Shift+U) → on a new site click **Allow on this site** once. The panel follows you as the form moves from page to page, and when you switch tabs.
3. The panel opens in **Fill** (green). To change how a page is filled, click **Capture** at the top right: the panel turns **cream** and the page's setup can be edited. **Save** keeps the changes and **Cancel** drops them; both go back to Fill. A page that has never been saved opens straight in Capture. Settings (⚙) is at the bottom right, beside the Daniel Rourke Consulting logo.
   - **Capture** learns a form. Each field has a source dropdown (case item, adviser item, default or skip) and a box for its **default text**: what to put in next time. Typing in the box makes the field a *Default*. For case and adviser items, the box shows the current value, locked. In Capture, **Rescan** copies whatever you've typed on the page into the default boxes (fields linked to case or adviser data are left alone). **Save** saves the page: the layout, the sources and the default text (an empty default box takes what's typed on the page), and adds the case items to the templates ticked under *Save to*.
   - **Fill** uses what was captured. Each field has a tick box and the value about to go in, which you can change for this time only. The **Fill** button puts the ticked ones into the page. Check every answer. **Template** picks the case template you're following: case items that aren't in it (or in *Common to all forms*) show *not in template* and aren't ticked. The choice is kept, across pages and sessions, until you change it; with *Select a template* showing, no template is followed. The Case and Template dropdowns sit side by side above the list.
   - **Sections and pages.** Every UKVI form page sits in a section of the step bar at the top ("1. Start  2. Application  3. Finance …"), and has its own heading (e.g. *Register an email*) inside that section. Both are saved with the page. The section is read from UKVI's step bar (the step with class *current*, numbered by its `data-nav-position`); on other sites, a numbered list whose current step is marked by `aria-current`, an *active/current/selected* class or, failing those, bold text.
   - **Moving on.** As you move from page to page the earlier pages and sections fold away, leaving the open page and its section expanded. Options page → *Side panel* sets which fields the open page shows (*Show all*, the default; *Ready to fill*; *Needs attention*).
   - **Pages.** The list shows the saved pages of the chosen template (every saved page when no template is selected) as collapsible form sections in step order, each holding its pages in the order they were captured, with their heading, caption and field count. The open page is highlighted in gold, expanded and scrolled into view, and holds its fields (Fill or Capture rows); other pages list each field's source and the value it would fill. A page that hasn't been saved shows as a dashed box, with its heading, in its section (*This page* if it has no heading). Pages saved without a step bar go under *Other pages*. In the **template editor** (the page icon beside ⚙ at the bottom right; **Done** closes it) each page and section has a **bin** (it turns red; click again to confirm) that takes pages added in error out of the chosen template, or forget them entirely when no template is selected or when no other template uses them.
   - **Export** (in the template editor) downloads the chosen template's whole form as one HTML page: the sections in step order, each page's heading, and every question with its answer format (box, long box, Day / Month / Year, dropdown with its options, radio options, tick box), plus where the tool takes the answer from and any default text. Case and adviser values are never included. It is a working copy: tick, type and choose answers to work through the form; follow-up questions open under the answer that opens them, as on the real form. **Print** and **Clear answers** are at the top; nothing you type is saved. Pages saved before this version show up to 40 dropdown options; capture them again to get the full list.
   - **Follow-up questions** (ones that open only after a particular answer) are kept with the answer that opens them and shown indented under their question with that answer (e.g. *Yes*). Forms that mark the link the GOV.UK way are read even while the follow-up is hidden. For others, in Capture pick the answer on the page and click **Rescan**: any new question is recorded as opened by the answer you just changed. A follow-up that is hidden again stays listed (dashed) in Capture so saving keeps it; Fill only lists questions open on the page, and after **Fill** puts in an answer that opens follow-ups, the panel reads the page again so they can be filled too.
   - **Green "saved"** = linked before. **Blue "default"** = learned answer. **Orange "guess"** = matched by wording only. In Fill it's not ticked until you tick it; in Capture, Remember accepts it unless you set it to *Skip*.
   - In Fill, fields that already contain something different are not ticked.

**Case templates.** *Common to all forms* is a built-in template for client information every form needs; you can create more (for example one per commonly used form) in the side panel or on the options page → *Case templates*. When you capture a page, tick (under *Save to*) which templates its case items go into (one or several); the page remembers its choice. Each item records which forms ask for it. Adviser data and learned defaults are left out because they aren't the client's. An export for clients is planned.

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
node tests/panel.test.js      # real extension + side panel on a fake form, both modes (needs Playwright + Chromium;
                              #   CHROMIUM_PATH=...\msedge.exe runs both browser tests in Edge instead)
node tests/extension.test.js  # loads the real unpacked extension, imports a CSV
node tools/make-icons.js      # regenerate icons
```

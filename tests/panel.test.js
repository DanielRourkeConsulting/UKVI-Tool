// Loads the real extension (manifest copy with localhost pre-approved, standing in for the user's one-time
// "Allow on this site"), serves a fake form over http, and drives the side panel page.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), assert = require('assert');
const src = path.join(__dirname, '..');
(async () => {
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'ukvi-ext-'));
  fs.cpSync(src, ext, { recursive: true, filter: (f) => !/node_modules|\.git(\/|$)|tests/.test(f) });
  const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')); m.host_permissions = ['http://localhost/*']; fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(path.join(__dirname, /ukvi-step/.test(q.url) ? 'ukvi-step.html' : /followup/.test(q.url) ? 'followup.html' : 'form.html'))); }).listen(0);
  const url = 'http://localhost:' + server.address().port + '/apply/12345678/form';
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ukvi-p-')), { headless: false, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--headless=new', '--disable-extensions-except=' + ext, '--load-extension=' + ext, '--no-sandbox'] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = sw.url().split('/')[2];
  const U = require('../lib.js'); const db = U.defaultDb();
  db.adviser = { oisc_number: 'N123', adviser_email: 'adv@example.org' };
  db.cases = { C1: { data: { given_names: 'Alex', family_name: 'Sample', dob: '1990-04-23', nationality: 'Examplestan', passport_number: 'P123', receives_benefits: 'Yes', dependants: 'No' } } };
  db.currentCase = 'C1'; db.mappings = { 'receives benefits': 'case:receives_benefits', 'do you have dependants': 'case:dependants' };
  await sw.evaluate((d) => chrome.storage.local.set({ db: d }), db);
  const errors = [];
  const form = await ctx.newPage(); form.on('pageerror', (e) => errors.push(e.message)); await form.goto(url);
  const panel = await ctx.newPage(); panel.on('pageerror', (e) => errors.push(e.message)); panel.on('console', (x) => x.type() === 'error' && errors.push(x.text()));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const refresh = async () => { await form.bringToFront(); await panel.evaluate(() => window.__ukviTest.refresh()); await panel.waitForTimeout(400); };
  const rowsOf = () => panel.evaluate(() => [...document.querySelectorAll('.row')].map((r) => { const cb = r.querySelector('input[type=checkbox]'); return { lab: r.querySelector('.lab').textContent, chip: r.querySelector('.chip').textContent, val: r.querySelector('.ctl input').value, on: cb ? cb.checked : null }; }));
  const modeIs = () => panel.evaluate(() => ({ mode: document.body.dataset.mode, fill: getComputedStyle(document.getElementById('btn-fill')).display !== 'none', remember: getComputedStyle(document.getElementById('btn-remember')).display !== 'none', bg: getComputedStyle(document.getElementById('list')).backgroundColor }));
  await refresh();
  // Nothing captured yet, so the panel opens in Capture: no fill button, no tick boxes.
  const cap = await modeIs();
  assert.deepStrictEqual([cap.mode, cap.fill, cap.remember], ['capture', false, true]);
  assert.ok((await rowsOf()).every((r) => r.on === null), 'no tick boxes in Capture');
  // Cancel goes back to Fill without saving.
  await panel.click('#btn-cancel'); await panel.waitForTimeout(300);
  const fil = await modeIs();
  assert.deepStrictEqual([fil.mode, fil.fill, fil.remember], ['fill', true, false]);
  assert.notStrictEqual(cap.bg, fil.bg, 'each mode has its own background');
  let rows = await rowsOf(); console.log(rows.map((r) => JSON.stringify(r)).join('\n'));
  const get = (rs, s) => rs.find((r) => r.lab.startsWith(s));
  assert.ok(!rows.some((r) => /password/i.test(r.lab)), 'password/hidden skipped');
  assert.deepStrictEqual([get(rows, 'First name').chip, get(rows, 'First name').val, get(rows, 'First name').on], ['guess – check', 'Alex', false]);
  // Tick everything with a value, then fill.
  await panel.evaluate(() => { document.querySelectorAll('.row').forEach((r) => { const cb = r.querySelector('input[type=checkbox]'); if (r.querySelector('.ctl input').value && !cb.checked) cb.click(); }); document.getElementById('btn-fill').click(); });
  await panel.waitForTimeout(900);
  const v = await form.evaluate(() => ({ gn: gn.value, fn: fn.value, d: d.value, m: m.value, y: y.value, nat: nat.value, ppn: ppn.value, oisc: oisc.value, re: re.value, sw: sw.getAttribute('aria-checked'), dy: dy.getAttribute('aria-pressed'), dn: dn.getAttribute('aria-pressed') }));
  console.log(v);
  assert.deepStrictEqual(v, { gn: 'Alex', fn: 'Sample', d: '23', m: '04', y: '1990', nat: 'Examplestan', ppn: 'P123', oisc: 'N123', re: 'adv@example.org', sw: 'true', dy: 'false', dn: 'true' });
  const st = () => sw.evaluate(() => chrome.storage.local.get('db')).then((x) => x.db);
  assert.ok(Object.keys((await st()).mappings).length >= 9, 'mappings persisted on fill');
  // Capture a default: text typed in the panel's box wins over what is on the page.
  await panel.click('#btn-capture'); await panel.waitForTimeout(300);
  assert.strictEqual((await modeIs()).mode, 'capture', 'Capture button opens Capture');
  await form.fill('#reason', 'typed on the page');
  // Rescan in Capture takes what's typed on the page as the default (but never for case items).
  await form.fill('#gn', 'Someone');
  await form.bringToFront(); await panel.click('#btn-rescan'); await panel.waitForTimeout(500);
  const reasonBox = panel.locator('.row', { hasText: 'Reason' }).locator('.ctl input');
  assert.strictEqual(await reasonBox.inputValue(), 'typed on the page', 'Rescan picks up the page value');
  assert.strictEqual(await panel.locator('.row', { hasText: 'Reason' }).locator('.ctl select').inputValue(), 'default');
  assert.strictEqual(await panel.locator('.row', { hasText: 'First name' }).locator('.ctl select').inputValue(), 'case:given_names', 'case items are left alone');
  await form.fill('#gn', 'Alex');
  await reasonBox.fill('Fee waiver – destitution');
  assert.strictEqual(await panel.locator('.row', { hasText: 'Reason' }).locator('.ctl select').inputValue(), 'default', 'typing default text sets the source to Default');
  await panel.evaluate(() => document.getElementById('btn-remember').click()); await panel.waitForTimeout(600);
  const s2 = await st();
  assert.strictEqual(s2.defaults['reason for applying'][0].v, 'Fee waiver – destitution');
  assert.strictEqual((await modeIs()).mode, 'fill', 'Save goes back to Fill');
  assert.strictEqual(Object.keys(s2.templates).length, 1);
  const tpl = s2.caseTemplates.common.items; assert.ok(tpl.given_names && tpl.dob && tpl.passport_number, 'case items added to the case template');
  assert.ok(!tpl.oisc_number && !tpl.adviser_email, 'adviser data is not part of the client template');
  assert.strictEqual(Object.keys(tpl.given_names.forms).length, 1);
  assert.ok(!JSON.stringify(s2.defaults).includes('Alex'), 'case data never stored as a default');
  // Create a second template in the panel, tick both, remember again: items land in both.
  await panel.click('#btn-capture'); await panel.waitForTimeout(300);
  await panel.fill('#tpl-new-name', 'Fee waiver'); await panel.click('#btn-tpl-new'); await panel.waitForTimeout(300);
  await panel.evaluate(() => document.getElementById('btn-remember').click()); await panel.waitForTimeout(600);
  const s3 = await st();
  assert.ok(s3.caseTemplates.fee_waiver.items.given_names && s3.caseTemplates.common.items.given_names, 'saved to both selected templates');
  const said = await panel.locator('#status').innerText();
  assert.match(said, /^Saved: 14 fields, (\d+ defaults?, )?\d+ case items to Common to all forms, Fee waiver\.$/, 'compact save message: ' + said);
  assert.ok(!/\b0 /.test(said), 'no zero counts');
  assert.deepStrictEqual(Object.values(s3.pageTemplates)[0], ['common', 'fee_waiver'], 'page remembers its templates');
  // "Next page / next client": back in Fill, reload the form, panel follows by itself (no click on the icon).
  assert.strictEqual((await modeIs()).mode, 'fill');
  // Cancel throws away edits made in Capture.
  await panel.click('#btn-capture'); await panel.waitForTimeout(300);
  await panel.locator('.row', { hasText: 'Reason' }).locator('.ctl input').fill('not kept');
  await panel.click('#btn-cancel'); await panel.waitForTimeout(300);
  assert.strictEqual(await panel.locator('.row', { hasText: 'Reason' }).locator('.ctl input').inputValue(), 'Fee waiver – destitution', 'Cancel drops changes');
  await form.reload(); await panel.waitForTimeout(1200);
  rows = await rowsOf();
  assert.deepStrictEqual([get(rows, 'Reason').chip, get(rows, 'Reason').val, get(rows, 'Reason').on], ['default', 'Fee waiver – destitution', true]);
  assert.strictEqual(get(rows, 'First name').chip, 'saved');
  // Fill follows a chosen template; the choice is kept across pages until changed.
  await panel.selectOption('#fill-tpl', 'fee_waiver'); await panel.waitForTimeout(300);
  assert.strictEqual((await st()).prefs.fillTemplate, 'fee_waiver');
  await sw.evaluate(async () => { const { db } = await chrome.storage.local.get('db'); delete db.caseTemplates.common.items.passport_number; delete db.caseTemplates.fee_waiver.items.passport_number; await chrome.storage.local.set({ db }); });
  await form.reload(); await panel.waitForTimeout(1200);
  assert.strictEqual(await panel.locator('#fill-tpl').inputValue(), 'fee_waiver', 'template choice remembered');
  rows = await rowsOf();
  assert.deepStrictEqual([get(rows, 'Passport number').chip, get(rows, 'Passport number').on], ['not in template', false], 'items outside the template are not ticked');
  assert.strictEqual(get(rows, 'First name').on, true);
  await panel.selectOption('#fill-tpl', ''); await panel.waitForTimeout(300);
  assert.strictEqual(get(await rowsOf(), 'Passport number').on, true, '"any" ticks it again');
  // Saved pages: the page header and caption were captured; each page is a collapsible section that can be deleted.
  const page1 = Object.values((await st()).templates)[0];
  assert.deepStrictEqual([page1.title, page1.caption, page1.section], ['Applicant details', 'Section 1 of 3', { num: 2, name: 'Application' }], 'heading, caption and the bold step from the step bar');
  assert.ok(page1.created <= page1.updated, 'capture order kept');
  assert.strictEqual(await panel.locator('details.page').count(), 1);
  assert.strictEqual(await panel.locator('details.section').count(), 1, 'pages sit inside their form section');
  assert.match(await panel.locator('details.section > summary').innerText(), /2[\s\S]*Application[\s\S]*1 page/);
  assert.ok(await panel.locator('details.section.here').evaluate((d) => d.open), 'the open page\'s section is expanded');
  assert.ok(await panel.locator('details.page.here').evaluate((d) => d.open), 'the open page is expanded');
  assert.match(await panel.locator('details.page summary').innerText(), /Applicant details[\s\S]*Section 1 of 3/);
  assert.ok(await panel.locator('details.page.here .row', { hasText: 'Reason' }).count(), 'the open page holds its fields');
  assert.strictEqual(await panel.locator('.bin').count(), 0, 'no delete bins outside the template editor');
  // The template editor (icon beside settings) has the bins.
  await panel.click('#btn-edit'); await panel.waitForTimeout(300);
  assert.ok(await panel.locator('details.page .pf', { hasText: 'Reason' }).count(), 'the editor lists the fields of each page');
  // Export: the whole form as one read-only HTML page.
  const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('#btn-export')]);
  const exported = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(dl.suggestedFilename(), /^all-saved-pages-ukvi-form\.html$/);
  assert.ok(/Application[\s\S]*Applicant details[\s\S]*Reason for applying/.test(exported), 'export has the section, page and questions');
  assert.ok(exported.includes('class="date"') && exported.includes('type="radio"'), 'date and option formats shown');
  if (process.env.EXPORT_OUT) fs.copyFileSync(await dl.path(), process.env.EXPORT_OUT);
  await panel.locator('details.page summary').click(); await panel.waitForTimeout(100);
  assert.ok(!(await panel.locator('details.page').evaluate((d) => d.open)), 'collapses');
  await panel.locator('details.page summary').click();
  await panel.locator('details.page > summary .bin').click();
  assert.ok(await panel.locator('details.page > summary .bin.armed').count(), 'first click only arms');
  assert.strictEqual(Object.keys((await st()).templates).length, 1);
  await panel.locator('details.page > summary .bin').click(); await panel.waitForTimeout(300);
  const s4 = await st();
  assert.strictEqual(Object.keys(s4.templates).length, 0, 'page forgotten');
  assert.ok(!s4.caseTemplates.common.items.given_names, 'its case items leave the templates');
  await panel.click('#btn-done'); await panel.waitForTimeout(300);
  // Not saved any more, so the open page is a "This page" placeholder in its section.
  assert.strictEqual(await panel.locator('details.page').count(), 1);
  assert.match(await panel.locator('details.page.placeholder.here > summary').innerText(), /Applicant details/);
  assert.match(await panel.locator('details.section.here > summary').innerText(), /2[\s\S]*Application/);
  // A real UKVI step bar: the number is in data-nav-position, the current step has class "current".
  await form.goto(url.replace('/form', '/ukvi-step')); await refresh();
  assert.match(await panel.locator('details.section.here > summary').innerText(), /^\s*1\s+Start\b/, 'section 1. Start from the UKVI step bar');
  assert.ok(!/current step/.test(await panel.locator('details.section.here > summary').innerText()), 'screen-reader text left out');
  assert.match(await panel.locator('details.page.here.placeholder > summary').innerText(), /Register an email/, 'unsaved page shows its heading inside its section');
  // Save it, move on to another page: the earlier section folds away, the new page's section opens.
  await panel.evaluate(() => document.getElementById('btn-remember').click()); await panel.waitForTimeout(600);
  await form.goto(url); await refresh();
  assert.ok(!(await panel.locator('details.section', { hasText: 'Start' }).evaluate((d) => d.open)), 'earlier section collapses');
  assert.ok(await panel.locator('details.section.here').evaluate((d) => d.open), 'the new page\'s section is open');
  // The field filter is a setting on the options page (Show all by default).
  const all = await panel.locator('.row').count();
  const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
  assert.strictEqual(await opts.locator('#pref-filter').inputValue(), 'all', 'Show all by default');
  await opts.click('[data-tab=panel]'); await opts.selectOption('#pref-filter', 'ready'); await opts.waitForTimeout(300); await opts.close();
  await refresh();
  const ready = await panel.locator('.row').count();
  assert.ok(ready < all, 'Ready to fill hides fields not ready (' + ready + ' of ' + all + ')');
  await sw.evaluate(async () => { const { db } = await chrome.storage.local.get('db'); db.prefs.filter = 'all'; await chrome.storage.local.set({ db }); });

  // Follow-up questions. A new page opens in Capture.
  const rowOf = (s) => panel.locator('.row').filter({ has: panel.locator('.lab', { hasText: s }) });
  await form.goto(url.replace('/form', '/followup')); await refresh();
  assert.strictEqual((await modeIs()).mode, 'capture');
  // Marked the GOV.UK way: read while still hidden, listed under its answer.
  assert.strictEqual(await rowOf('full name').count(), 1, 'hidden follow-up read from the page');
  assert.ok(await rowOf('full name').evaluate((r) => r.classList.contains('follow') && r.classList.contains('unseen')));
  assert.strictEqual((await rowOf('full name').locator('.if').innerText()).trim(), 'Yes');
  // Not marked: picking Yes and Rescan finds the new question and records which answer opened it.
  assert.strictEqual(await rowOf('Give details').count(), 0);
  await form.check('#rf-y'); await form.bringToFront(); await panel.click('#btn-rescan'); await panel.waitForTimeout(500);
  assert.strictEqual(await rowOf('Give details').count(), 1, 'question opened by an answer appears');
  assert.strictEqual((await rowOf('Give details').locator('.if').innerText()).trim(), 'Yes');
  assert.ok((await rowOf('Give details').locator('.if').getAttribute('title')).includes('Have you been refused a visa?'));
  // Back to No: the question hides on the page but stays listed in Capture, so saving keeps it.
  await form.check('#rf-n'); await form.bringToFront(); await panel.click('#btn-rescan'); await panel.waitForTimeout(500);
  assert.ok(await rowOf('Give details').evaluate((r) => r.classList.contains('unseen')), 'kept while hidden');
  if (process.env.SHOT_DIR) { await panel.setViewportSize({ width: 380, height: 760 }); await rowOf('Do you have a sponsor').first().scrollIntoViewIfNeeded(); await panel.screenshot({ path: path.join(process.env.SHOT_DIR, 'capture-followups.png') }); }
  const order = await panel.locator('details.page.here .row .lab').allInnerTexts();
  assert.ok(order.findIndex((t) => /Give details/.test(t)) === order.findIndex((t) => /refused a visa/.test(t)) + 1, 'listed right after its question');
  await panel.evaluate(() => document.getElementById('btn-remember').click()); await panel.waitForTimeout(600);
  const fu = Object.values((await st()).templates).find((p) => p.title === 'Your sponsor');
  const showIf = (s) => fu.fields.find((f) => f.label.includes(s)).showIf;
  assert.strictEqual(showIf('full name').a, 'Yes'); assert.strictEqual(showIf('Give details').a, 'Yes');
  assert.ok(/sponsor/.test(showIf('full name').fp) && /refused/.test(showIf('Give details').fp), 'saved with the question that opens them');
  // Fill shows only questions open on the page.
  assert.strictEqual((await modeIs()).mode, 'fill');
  assert.strictEqual(await rowOf('Give details').count(), 0, 'hidden follow-up not offered in Fill');
  // Export: a working copy; the follow-up opens when its answer is chosen.
  await panel.click('#btn-edit'); await panel.waitForTimeout(300);
  assert.ok(await panel.locator('details.page.here .pf.follow', { hasText: 'Give details' }).count(), 'editor marks follow-ups');
  const [dl2] = await Promise.all([panel.waitForEvent('download'), panel.click('#btn-export')]);
  const xpFile = path.join(os.tmpdir(), 'ukvi-export-test.html'); fs.copyFileSync(await dl2.path(), xpFile);
  const xp = await ctx.newPage(); await xp.goto('file:///' + xpFile.replace(/\\/g, '/'));
  const det = xp.locator('label', { hasText: 'Give details' });
  assert.ok(!(await det.isVisible()), 'follow-up closed at first');
  await xp.locator('fieldset', { hasText: 'Have you been refused a visa?' }).locator('label', { hasText: 'Yes' }).click();
  assert.ok(await det.isVisible(), 'opens when Yes is chosen');
  await xp.locator('fieldset', { hasText: 'Have you been refused a visa?' }).locator('label', { hasText: 'No' }).click();
  assert.ok(!(await det.isVisible()), 'closes again on No');
  if (process.env.EXPORT_OUT) fs.copyFileSync(await dl2.path(), process.env.EXPORT_OUT);
  await xp.close(); await panel.click('#btn-done');
  assert.deepStrictEqual(errors, [], errors.join('; '));
  console.log('side panel test passed'); await ctx.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

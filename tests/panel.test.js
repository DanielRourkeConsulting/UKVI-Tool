// Loads the real extension (manifest copy with localhost pre-approved, standing in for the user's one-time
// "Allow on this site"), serves a fake form over http, and drives the side panel page.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), assert = require('assert');
const src = path.join(__dirname, '..');
(async () => {
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'ukvi-ext-'));
  fs.cpSync(src, ext, { recursive: true, filter: (f) => !/node_modules|\.git(\/|$)|tests/.test(f) });
  const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')); m.host_permissions = ['http://localhost/*']; fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(path.join(__dirname, 'form.html'))); }).listen(0);
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
  await panel.click('#mode-fill'); await panel.waitForTimeout(300);
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
  await panel.click('#mode-capture'); await panel.waitForTimeout(300);
  await form.fill('#reason', 'typed on the page');
  const reasonBox = panel.locator('.row', { hasText: 'Reason' }).locator('.ctl input');
  await reasonBox.fill('Fee waiver – destitution');
  assert.strictEqual(await panel.locator('.row', { hasText: 'Reason' }).locator('.ctl select').inputValue(), 'default', 'typing default text sets the source to Default');
  await panel.evaluate(() => document.getElementById('btn-remember').click()); await panel.waitForTimeout(600);
  const s2 = await st();
  assert.strictEqual(s2.defaults['reason for applying'][0].v, 'Fee waiver – destitution');
  assert.strictEqual(s2.prefs.mode, 'capture', 'mode is remembered');
  assert.strictEqual(Object.keys(s2.templates).length, 1);
  const tpl = s2.caseTemplates.common.items; assert.ok(tpl.given_names && tpl.dob && tpl.passport_number, 'case items added to the case template');
  assert.ok(!tpl.oisc_number && !tpl.adviser_email, 'adviser data is not part of the client template');
  assert.strictEqual(Object.keys(tpl.given_names.forms).length, 1);
  assert.ok(!JSON.stringify(s2.defaults).includes('Alex'), 'case data never stored as a default');
  // Create a second template in the panel, tick both, remember again: items land in both.
  await panel.fill('#tpl-new-name', 'Fee waiver'); await panel.click('#btn-tpl-new'); await panel.waitForTimeout(300);
  await panel.evaluate(() => document.getElementById('btn-remember').click()); await panel.waitForTimeout(600);
  const s3 = await st();
  assert.ok(s3.caseTemplates.fee_waiver.items.given_names && s3.caseTemplates.common.items.given_names, 'saved to both selected templates');
  assert.deepStrictEqual(Object.values(s3.pageTemplates)[0], ['common', 'fee_waiver'], 'page remembers its templates');
  // "Next page / next client": back in Fill, reload the form, panel follows by itself (no click on the icon).
  await panel.click('#mode-fill'); await panel.waitForTimeout(300);
  await form.reload(); await panel.waitForTimeout(1200);
  rows = await rowsOf();
  assert.deepStrictEqual([get(rows, 'Reason').chip, get(rows, 'Reason').val, get(rows, 'Reason').on], ['default', 'Fee waiver – destitution', true]);
  assert.strictEqual(get(rows, 'First name').chip, 'saved');
  assert.deepStrictEqual(errors, [], errors.join('; '));
  console.log('side panel test passed'); await ctx.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Runs the real lib.js + content.js in Chromium on a fake form, with chrome.storage stubbed in memory.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const stub = `window.__store={};window.chrome={storage:{local:{get:async k=>({[k]:window.__store[k]}),set:async o=>{Object.assign(window.__store,JSON.parse(JSON.stringify(o)))}}},runtime:{sendMessage:async()=>{}}};`;
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(__dirname, 'form.html'));
  await page.evaluate(stub);
  const U = require('../lib.js');
  const db = U.defaultDb();
  db.adviser = { oisc_number: 'N123', adviser_email: 'adv@example.org' };
  db.cases = { C1: { data: { given_names: 'Alex', family_name: 'Sample', dob: '1990-04-23', nationality: 'Examplestan', passport_number: 'P123', receives_benefits: 'Yes', dependants: 'No' } } };
  db.mappings = { 'receives benefits': 'case:receives_benefits', 'do you have dependants': 'case:dependants' };
  db.currentCase = 'C1';
  await page.evaluate((d) => { window.__store.db = d; }, db);
  const inject = async () => { await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'lib.js'), 'utf8') }); await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'content.js'), 'utf8') }); };
  // Scripts added with addScriptTag run in the page world, so the stub is visible just the same.
  await inject();
  const state = () => page.evaluate(() => ({ db: window.__store.db }));
  // Panel is in a closed shadow root: drive it through the exposed api and the DOM instead.
  await page.waitForTimeout(300);
  const host = await page.$('#ukvi-form-helper-host'); assert.ok(host, 'panel host exists');
  assert.strictEqual(await page.evaluate(() => document.getElementById('hid') && 1), 1);
  // Closed shadow root: use a test hook via a patched attachShadow before injection on a fresh page.
  await page.reload(); await page.evaluate(stub); await page.evaluate((d) => { window.__store.db = d; }, db);
  await page.evaluate(() => { const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (i) { const r = o.call(this, Object.assign({}, i, { mode: 'open' })); return r; }; });
  await inject(); await page.waitForTimeout(300);
  const rows = await page.evaluate(() => { const sr = document.getElementById('ukvi-form-helper-host').shadowRoot; return [...sr.querySelectorAll('.row')].map((r) => ({ lab: r.querySelector('.lab').textContent, chip: r.querySelector('.chip').textContent, val: r.querySelector('.ctl input').value, on: r.querySelector('input[type=checkbox]').checked })); });
  console.log(rows.map((r) => JSON.stringify(r)).join('\n'));
  assert.ok(!rows.some((r) => /password|hid/i.test(r.lab)), 'password/hidden skipped');
  const get = (s) => rows.find((r) => r.lab.startsWith(s));
  assert.strictEqual(get('First name').chip, 'guess – check');
  assert.strictEqual(get('First name').val, 'Alex');
  assert.strictEqual(get('First name').on, false, 'guesses are not pre-ticked');
  // Tick the guesses and fill.
  await page.evaluate(() => { const sr = document.getElementById('ukvi-form-helper-host').shadowRoot; sr.querySelectorAll('.row').forEach((r) => { const cb = r.querySelector('input[type=checkbox]'); const v = r.querySelector('.ctl input').value; if (v && !cb.checked) cb.click(); }); [...sr.querySelectorAll('footer button')].find((b) => /Fill/.test(b.textContent)).click(); });
  await page.waitForTimeout(300);
  const v = await page.evaluate(() => ({ gn: gn.value, fn: fn.value, d: d.value, m: m.value, y: y.value, nat: nat.value, ppn: ppn.value, oisc: oisc.value, re: re.value, pw: pw.value }));
  console.log(v);
  assert.deepStrictEqual([v.gn, v.fn, v.d, v.m, v.y, v.nat, v.ppn], ['Alex', 'Sample', '23', '04', '1990', 'Examplestan', 'P123']);
  assert.strictEqual(v.oisc, 'N123', 'adviser fieldset OISC');
  assert.strictEqual(v.re, 'adv@example.org', 'adviser email in representative fieldset');
  const tg = await page.evaluate(() => ({ sw: sw.getAttribute('aria-checked'), dy: dy.getAttribute('aria-pressed'), dn: dn.getAttribute('aria-pressed') }));
  console.log(tg);
  assert.deepStrictEqual(tg, { sw: 'true', dy: 'false', dn: 'true' }, 'toggle switch and button group filled');
  const s1 = (await state()).db; assert.ok(Object.keys(s1.mappings).length >= 7, 'mappings persisted on fill');
  // Learn a default: user types a reason, marks it Default, Remember.
  await page.fill('#reason', 'Fee waiver – destitution');
  await page.evaluate(() => { const sr = document.getElementById('ukvi-form-helper-host').shadowRoot; const row = [...sr.querySelectorAll('.row')].find((r) => r.querySelector('.lab').textContent.startsWith('Reason')); const sel = row.querySelector('.ctl select'); sel.value = 'default'; sel.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { const sr = document.getElementById('ukvi-form-helper-host').shadowRoot; [...sr.querySelectorAll('footer button')].find((b) => /Remember/.test(b.textContent)).click(); });
  await page.waitForTimeout(300);
  const s2 = (await state()).db;
  assert.strictEqual(s2.defaults['reason for applying'][0].v, 'Fee waiver – destitution');
  assert.strictEqual(Object.keys(s2.templates).length, 1);
  assert.ok(!JSON.stringify(s2.defaults).includes('Alex'), 'case data never stored as a default');
  // Next case: reload, blank form -> default reason is offered, ticked.
  await page.reload(); await page.evaluate(stub); await page.evaluate((d) => { window.__store.db = d; }, s2);
  await page.evaluate(() => { const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (i) { return o.call(this, Object.assign({}, i, { mode: 'open' })); }; });
  await inject(); await page.waitForTimeout(300);
  const again = await page.evaluate(() => { const sr = document.getElementById('ukvi-form-helper-host').shadowRoot; return [...sr.querySelectorAll('.row')].map((r) => ({ lab: r.querySelector('.lab').textContent, chip: r.querySelector('.chip').textContent, val: r.querySelector('.ctl input').value, on: r.querySelector('input[type=checkbox]').checked })); });
  const reason = again.find((r) => r.lab.startsWith('Reason')); assert.deepStrictEqual([reason.chip, reason.val, reason.on], ['default', 'Fee waiver – destitution', true]);
  assert.strictEqual(again.find((r) => r.lab.startsWith('First name')).chip, 'saved');
  assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join('; '));
  console.log('panel test passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

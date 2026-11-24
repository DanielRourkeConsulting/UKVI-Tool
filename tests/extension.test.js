// Loads the unpacked extension in Chromium, imports a CSV through the options page, checks storage.
const { chromium } = require('playwright'); const path = require('path'), os = require('os'), fs = require('fs'), assert = require('assert');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ukvi-'));
  const ext = path.join(__dirname, '..');
  const ctx = await chromium.launchPersistentContext(dir, { headless: false, args: ['--headless=new', '--disable-extensions-except=' + ext, '--load-extension=' + ext, '--no-sandbox'] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = sw.url().split('/')[2];
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.fill('#paste', 'Case Ref,Forename,Surname,DOB,Passport No,Post Code\nC1,Alex,Sample,23/04/1990,123,AB1 2CD\nC2,Bo,Test,01/02/1985,456,CD3 4EF\n');
  await page.click('#btn-read');
  await page.waitForSelector('#preview:not([hidden])');
  const rows = await page.$$eval('#map-table tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
  console.log(rows.join('\n'));
  await page.click('#btn-import'); await page.waitForTimeout(300);
  const db = (await sw.evaluate(() => chrome.storage.local.get('db'))).db;
  assert.strictEqual(Object.keys(db.cases).length, 2);
  assert.strictEqual(db.cases.C1.data.dob, '1990-04-23'); assert.strictEqual(db.cases.C1.data.given_names, 'Alex');
  assert.strictEqual(db.importMaps['Forename'], 'given_names');
  assert.strictEqual(db.currentCase, 'C1');
  // Injection via the same API the toolbar button uses.
  const form = await ctx.newPage(); await form.goto('file://' + path.join(__dirname, 'form.html'));
  assert.deepStrictEqual(errs, [], errs.join('; '));
  console.log('extension test passed, extension id', id); await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });

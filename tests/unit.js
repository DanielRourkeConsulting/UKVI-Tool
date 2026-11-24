const assert = require('assert');
const U = require('../lib.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('dates', () => {
  assert.strictEqual(U.parseDate('23/04/1990'), '1990-04-23');
  assert.strictEqual(U.parseDate('1990-4-3'), '1990-04-03');
  assert.strictEqual(U.parseDate('3 April 1990'), '1990-04-03');
  assert.strictEqual(U.parseDate('31/02/1990'), null);
  assert.strictEqual(U.parseDate('hello'), null);
  assert.strictEqual(U.ukDate('1990-04-23'), '23/04/1990');
});
t('csv quotes, delimiters, BOM', () => {
  const r = U.csvParse('﻿a;b\n"x;1";"he said ""hi"""\n');
  assert.deepStrictEqual(r, [['a', 'b'], ['x;1', 'he said "hi"']]);
});
t('csv import maps awkward headings', () => {
  const db = U.defaultDb();
  const p = U.parseImport('Case Ref,Forename,Surname,DOB,Passport No,Post Code,Mobile\nC1,Alex,Sample,23/04/1990,123,AB1 2CD,0777\n');
  const res = U.resolveKeys(Object.keys(p.cases[0].raw), 'case', db);
  assert.strictEqual(res['Forename'].key, 'given_names');
  assert.strictEqual(res['Surname'].key, 'family_name');
  assert.strictEqual(res['DOB'].key, 'dob');
  assert.strictEqual(res['Post Code'].key, 'postcode');
  assert.strictEqual(res['Passport No'].key, 'passport_number');
  assert.strictEqual(res['Mobile'].key, 'phone');
  const d = U.convertRecord(p.cases[0].raw, res, 'case');
  assert.strictEqual(d.dob, '1990-04-23'); assert.strictEqual(p.cases[0].id, 'C1');
});
t('learned import maps win', () => {
  const db = U.defaultDb(); db.importMaps['Client Surname'] = 'family_name';
  assert.strictEqual(U.resolveKeys(['client surname'], 'case', db)['client surname'].how, 'learned');
});
t('json shapes', () => {
  assert.strictEqual(U.parseImport('{"cases":[{"id":"A","data":{"given_names":"X"}}],"adviser":{"oisc_number":"N1"}}').adviser.oisc_number, 'N1');
  assert.strictEqual(U.parseImport('[{"ref":"R1","address":{"line1":"1 St"}}]').cases[0].raw.address_line1, '1 St');
  assert.ok(U.parseImport('{"importMaps":{"a":"b"}}').importMaps);
  assert.throws(() => U.parseImport('{bad'));
});
t('field label matching', () => {
  const db = U.defaultDb(); const E = U.entries(db, 'case').concat(U.entries(db, 'adviser'));
  const best = (l, p) => U.bestMatch(l, E, p).entry.key;
  assert.strictEqual(best('First name'), 'given_names');
  assert.strictEqual(best('Family name or surname'), 'family_name');
  assert.strictEqual(best('Date of birth › Day', true), 'dob');
  assert.strictEqual(best('Email address'), 'email');
  assert.strictEqual(best('Your representative\'s email address'), 'adviser_email');
  assert.strictEqual(best('Town or city'), 'town');
  assert.strictEqual(best('Country of birth'), 'country_of_birth');
  assert.strictEqual(best('OISC registration number'), 'oisc_number');
  assert.ok(U.bestMatch('Partner\'s date of birth', E).score < 0.75, 'partner dob must not be a confident guess');
  assert.ok(U.bestMatch('How many bedrooms', E).score < 0.75);
});
t('option picking', () => {
  const o = [{ text: 'Please select', value: '' }, { text: 'Yes', value: 'y' }, { text: 'No', value: 'n' }, { text: 'April', value: '4' }];
  assert.strictEqual(U.pickOption(o, ['true']), 1);
  assert.strictEqual(U.pickOption(o, ['04', '4']), 3);
  assert.strictEqual(U.pickOption(o, ['Apr']), 3);
  assert.strictEqual(U.pickOption(o, ['zzz']), -1);
});
t('defaults counting', () => {
  const db = U.defaultDb(); U.addDefault(db, 'f', 'A'); U.addDefault(db, 'f', 'B'); U.addDefault(db, 'f', 'B');
  assert.strictEqual(U.refValue('default', db, 'f'), 'B');
});
t('template id ignores long ids', () => {
  assert.strictEqual(U.templateId('https://x.gov.uk/apply/12345678/step?x=1', 'Your Name!'), 'x.gov.uk/apply/*/step#your name');
});
t('case template accumulates items across forms', () => {
  const db = U.defaultDb();
  assert.strictEqual(U.addToTemplate(db, 'f1', 'Form one', [{ key: 'dob', fieldLabel: 'Date of birth day' }, { key: 'dob', fieldLabel: 'Date of birth month' }, { key: 'nino', fieldLabel: 'NI' }]), 2);
  assert.strictEqual(U.addToTemplate(db, 'f2', 'Form two', [{ key: 'dob', fieldLabel: 'Birth date' }]), 0);
  assert.deepStrictEqual(Object.keys(db.caseTemplate.items.dob.forms), ['f1', 'f2']);
  assert.strictEqual(db.caseTemplate.items.dob.label, 'Date of birth');
  U.removeFormFromTemplate(db, 'f1');
  assert.ok(!db.caseTemplate.items.nino && db.caseTemplate.items.dob);
});
console.log(n + ' tests passed');

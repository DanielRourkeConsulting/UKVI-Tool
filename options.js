/* UKVI Form Helper – options page. Local only: no network calls anywhere in this extension. */
(async function () {
  'use strict';
  const U = window.UKVI;
  const $ = (s) => document.querySelector(s);
  let db = await U.load();
  let pending = null; // parsed import awaiting confirmation

  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && e.append(c));
    return e;
  };
  const say = (sel, text, cls) => { const m = $(sel); m.textContent = text; m.className = 'msg ' + (cls || ''); };
  const persist = async () => { await U.save(db); };
  // Side panel: which fields the open page shows (Show all unless changed).
  $('#pref-filter').value = db.prefs.filter || 'all';
  $('#pref-filter').addEventListener('change', async (e) => { db = await U.load(); db.prefs.filter = e.target.value; await persist(); });
  const download = (name, text, type) => {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove();
  };

  // ---------- Tabs ----------
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== 'tab-' + b.dataset.tab; });
    if (b.dataset.tab === 'learned') renderLearned();
    if (b.dataset.tab === 'template') renderTemplate();
  }));

  function fillKeyLists() {
    ['case', 'adviser'].forEach((k) => {
      const dl = $('#keys-' + k); dl.textContent = '';
      U.entries(db, k).forEach((e) => dl.append(el('option', { value: e.key, label: e.label })));
    });
  }

  // ---------- Import ----------
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#paste').value = await f.text();
    readImport();
  });
  $('#btn-read').addEventListener('click', readImport);
  $('#btn-cancel').addEventListener('click', () => { pending = null; $('#preview').hidden = true; say('#import-msg', ''); });

  function readImport() {
    try {
      const parsed = U.parseImport($('#paste').value);
      if (parsed.importMaps && !parsed.cases.length && !parsed.adviser) {
        Object.assign(db.importMaps, parsed.importMaps);
        persist().then(() => { say('#import-msg', 'Saved ' + Object.keys(parsed.importMaps).length + ' column-name mappings. Now import your export file.', 'ok'); });
        return;
      }
      const caseKeys = new Set(); parsed.cases.forEach((c) => Object.keys(c.raw).forEach((k) => caseKeys.add(k)));
      const resolved = U.resolveKeys([...caseKeys], 'case', db, parsed.importMaps);
      const advResolved = parsed.adviser ? U.resolveKeys(Object.keys(parsed.adviser), 'adviser', db, parsed.importMaps) : null;
      pending = { parsed, resolved, advResolved };
      renderPreview();
      say('#import-msg', '');
    } catch (err) { pending = null; $('#preview').hidden = true; say('#import-msg', err.message, 'err'); }
  }

  function renderPreview() {
    const { parsed, resolved, advResolved } = pending;
    $('#preview').hidden = false;
    $('#preview-title').textContent = parsed.cases.length + ' case' + (parsed.cases.length === 1 ? '' : 's') + ' found' + (parsed.adviser ? ' + adviser details' : '') + ' (' + parsed.kind.toUpperCase() + ')';
    const tb = $('#map-table tbody'); tb.textContent = '';
    const addRows = (map, sample, kind, heading) => {
      if (heading) tb.append(el('tr', {}, el('td', { colspan: 4, text: heading })));
      for (const [raw, r] of Object.entries(map)) {
        const ex = sample(raw);
        const inp = el('input', { type: 'text', list: 'keys-' + kind, value: r.key, 'aria-label': 'Item name for ' + raw });
        inp.addEventListener('input', () => { r.key = U.slug(inp.value) || ''; r.how = 'learned'; });
        tb.append(el('tr', {}, el('td', { text: raw }), el('td', { class: 'ex', text: ex, title: ex }), el('td', {}, inp), el('td', {}, el('span', { class: 'how ' + r.how, text: { learned: 'remembered', known: 'standard', guess: 'guessed – check', new: 'new item' }[r.how] }))));
      }
    };
    addRows(resolved, (raw) => { const c = parsed.cases.find((x) => x.raw[raw] !== undefined); return c ? c.raw[raw] : ''; }, 'case');
    if (advResolved) addRows(advResolved, (raw) => parsed.adviser[raw] || '', 'adviser', 'Adviser details');
  }

  $('#btn-import').addEventListener('click', async () => {
    if (!pending) return;
    const { parsed, resolved, advResolved } = pending;
    if ($('#replace').checked) { db.cases = {}; db.currentCase = null; }
    parsed.cases.forEach((c) => {
      const data = U.convertRecord(c.raw, resolved, 'case');
      const prev = db.cases[c.id];
      db.cases[c.id] = { label: c.label || (prev && prev.label) || '', data: Object.assign({}, prev ? prev.data : {}, data), imported: Date.now() };
    });
    if (parsed.adviser && advResolved) Object.assign(db.adviser, U.convertRecord(parsed.adviser, advResolved, 'adviser'));
    // Remember how each column was named so the next export maps by itself.
    [resolved, advResolved].forEach((m) => m && Object.entries(m).forEach(([raw, r]) => { if (r.key) db.importMaps[raw] = r.key; }));
    if (!db.currentCase && parsed.cases.length) db.currentCase = parsed.cases[0].id;
    await persist();
    const n = parsed.cases.length;
    pending = null; $('#preview').hidden = true; $('#paste').value = ''; $('#file').value = '';
    say('#import-msg', 'Imported ' + n + ' case' + (n === 1 ? '' : 's') + '. Column names remembered for next time.', 'ok');
    refreshAll();
  });

  // ---------- Cases ----------
  function renderCases() {
    const sel = $('#case-select'); sel.textContent = '';
    const ids = Object.keys(db.cases);
    if (!ids.length) sel.append(el('option', { value: '', text: '— no cases saved —' }));
    ids.forEach((id) => sel.append(el('option', { value: id, text: U.caseLabel(db.cases[id], id) + (id === db.currentCase ? '  ✓ in use' : ''), selected: id === (sel.dataset.sel || db.currentCase) })));
    renderCaseEditor();
  }
  $('#case-select').addEventListener('change', (e) => { e.target.dataset.sel = e.target.value; renderCaseEditor(); });
  $('#btn-use').addEventListener('click', async () => { const id = $('#case-select').value; if (!id) return; db.currentCase = id; await persist(); renderCases(); });
  $('#btn-del-case').addEventListener('click', async () => {
    const id = $('#case-select').value; if (!id || !confirm('Delete this case from the helper? (Your case management system is not touched.)')) return;
    delete db.cases[id]; if (db.currentCase === id) db.currentCase = Object.keys(db.cases)[0] || null;
    $('#case-select').dataset.sel = ''; await persist(); refreshAll();
  });

  function kvEditor(container, obj, kind, onSave) {
    container.textContent = '';
    const rows = Object.entries(obj).map(([k, v]) => ({ k, v }));
    const draw = () => {
      container.textContent = '';
      rows.forEach((r, i) => {
        const k = el('input', { type: 'text', list: 'keys-' + kind, value: r.k, 'aria-label': 'Item name' });
        const v = el('input', { type: 'text', value: r.v, 'aria-label': 'Value' });
        k.addEventListener('input', () => { r.k = U.slug(k.value); }); v.addEventListener('input', () => { r.v = v.value; });
        container.append(el('div', { class: 'kv' }, k, v, el('button', { class: 'danger', text: '✕', title: 'Remove', onclick: () => { rows.splice(i, 1); draw(); } })));
      });
      container.append(el('div', { class: 'row' },
        el('button', { text: '+ Add item', onclick: () => { rows.push({ k: '', v: '' }); draw(); } }),
        el('button', { class: 'primary', text: 'Save', onclick: () => { const o = {}; rows.forEach((r) => { if (r.k && String(r.v).trim() !== '') o[r.k] = String(r.v).trim(); }); onSave(o); } })));
    };
    draw();
  }
  function renderCaseEditor() {
    const id = $('#case-select').value, box = $('#case-editor');
    if (!id || !db.cases[id]) { box.textContent = ''; return; }
    kvEditor(box, db.cases[id].data, 'case', async (o) => { db.cases[id].data = o; await persist(); fillKeyLists(); renderCases(); });
  }
  function renderAdviser() {
    kvEditor($('#adviser-editor'), db.adviser, 'adviser', async (o) => { db.adviser = o; await persist(); fillKeyLists(); });
  }

  // ---------- Learned ----------
  function listWith(sel, items, empty) {
    const box = $(sel); box.textContent = '';
    if (!items.length) { box.append(el('p', { text: empty })); return; }
    items.forEach((it) => box.append(el('div', { class: 'item' }, el('span', { class: 'grow' }, it.content), el('button', { class: 'danger', text: 'Remove', onclick: it.remove }))));
  }
  function renderLearned() {
    listWith('#tmpl-list', Object.entries(db.templates).sort((a, b) => b[1].updated - a[1].updated).map(([id, t]) => ({
      content: [el('b', { text: t.title || id }), ' ', el('span', { class: 'pill', text: t.fields.length + ' fields' }), ' ', el('small', { text: t.url + ' · ' + new Date(t.updated).toLocaleDateString('en-GB') })],
      remove: async () => { delete db.templates[id]; delete db.tmplMappings[id]; U.removeFormFromTemplates(db, id); await persist(); renderLearned(); }
    })), 'No forms remembered yet. Open a form, click the extension icon, then Capture in Capture mode.');
    listWith('#map-list', Object.entries(db.mappings).sort().map(([fp, ref]) => ({
      content: [fp, ' → ', el('span', { class: 'pill', text: U.refLabel(ref, db) })],
      remove: async () => { delete db.mappings[fp]; Object.values(db.tmplMappings).forEach((m) => delete m[fp]); await persist(); renderLearned(); }
    })), 'None yet.');
    listWith('#def-list', Object.entries(db.defaults).sort().map(([fp, list]) => ({
      content: [fp, ': ', list.map((d) => el('span', { class: 'pill', text: d.v + ' ×' + d.n }))],
      remove: async () => { delete db.defaults[fp]; await persist(); renderLearned(); }
    })), 'None yet.');
    listWith('#imp-list', Object.entries(db.importMaps).sort().map(([raw, key]) => ({
      content: [raw, ' → ', el('span', { class: 'pill', text: key })],
      remove: async () => { delete db.importMaps[raw]; await persist(); renderLearned(); }
    })), 'None yet.');
  }

  // ---------- Case templates ----------
  let tplSel = 'common';
  function renderTemplate() {
    const sel = $('#tpl-select'); sel.textContent = '';
    if (!db.caseTemplates[tplSel]) tplSel = 'common';
    Object.entries(db.caseTemplates).forEach(([id, t]) => sel.append(el('option', { value: id, selected: id === tplSel, text: t.name + ' (' + Object.keys(t.items).length + ' items)' })));
    $('#btn-tpl-delete').disabled = !!db.caseTemplates[tplSel].builtin;
    const t = db.caseTemplates[tplSel];
    const common = db.caseTemplates.common.items;
    const items = Object.entries(t.items).sort((a, b) => a[1].label.localeCompare(b[1].label));
    listWith('#tpl-list', items.map(([key, it]) => {
      const forms = Object.entries(it.forms);
      return {
        content: [el('b', { text: it.label }), ' ', el('small', { text: key }), ' ',
          tplSel !== 'common' && common[key] ? el('span', { class: 'pill', text: 'also in Common' }) : null, ' ',
          forms.length ? forms.map(([pid, f]) => el('span', { class: 'pill', title: f.fields.join(', '), text: f.title })) : el('span', { class: 'pill', text: 'added by hand' })],
        remove: async () => { delete t.items[key]; await persist(); renderTemplate(); }
      };
    }), 'Nothing in this template yet. Open a form in the side panel, link its fields to case data, tick this template and click Capture.');
  }
  $('#tpl-select').addEventListener('change', (e) => { tplSel = e.target.value; renderTemplate(); });
  $('#btn-tpl-create').addEventListener('click', async () => {
    const id = U.newTemplate(db, $('#tpl-new-name').value); if (!id) return;
    tplSel = id; $('#tpl-new-name').value = ''; await persist(); renderTemplate();
  });
  $('#btn-tpl-rename').addEventListener('click', async () => {
    const name = prompt('New name for this template:', db.caseTemplates[tplSel].name); if (!name || !name.trim()) return;
    db.caseTemplates[tplSel].name = name.trim(); await persist(); renderTemplate();
  });
  $('#btn-tpl-delete').addEventListener('click', async () => {
    if (db.caseTemplates[tplSel].builtin || !confirm('Delete this template? (Remembered form layouts are not affected.)')) return;
    delete db.caseTemplates[tplSel]; Object.keys(db.pageTemplates).forEach((p) => { db.pageTemplates[p] = db.pageTemplates[p].filter((x) => x !== tplSel); });
    db.prefs.lastTemplates = (db.prefs.lastTemplates || []).filter((x) => x !== tplSel); tplSel = 'common'; await persist(); renderTemplate();
  });
  $('#btn-tpl-add').addEventListener('click', async () => {
    const key = U.slug($('#tpl-key').value); if (!key) return;
    const e = U.entries(db, 'case').find((x) => x.key === key), t = db.caseTemplates[tplSel];
    t.items[key] = t.items[key] || { label: e ? e.label : U.humanise(key), forms: {} };
    t.items[key].manual = true;
    $('#tpl-key').value = ''; await persist(); renderTemplate();
  });

  // ---------- Backup ----------
  $('#btn-export').addEventListener('click', () => download('ukvi-form-helper-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ ukviHelperBackup: 1, db }, null, 2)));
  $('#btn-restore').addEventListener('click', async () => {
    const f = $('#restore-file').files[0]; if (!f) return say('#backup-msg', 'Choose a backup file first.', 'err');
    try {
      const j = JSON.parse(await f.text());
      if (!j.ukviHelperBackup || !j.db) throw new Error('This is not a UKVI Form Helper backup.');
      if (!confirm('Replace everything currently saved with this backup?')) return;
      db = U.ensureTemplates(Object.assign(U.defaultDb(), j.db)); await persist(); refreshAll(); say('#backup-msg', 'Restored.', 'ok');
    } catch (e) { say('#backup-msg', e.message, 'err'); }
  });
  $('#btn-wipe-cases').addEventListener('click', async () => { if (!confirm('Delete all saved case data?')) return; db.cases = {}; db.currentCase = null; await persist(); refreshAll(); say('#backup-msg', 'Case data deleted.', 'ok'); });
  $('#btn-wipe-all').addEventListener('click', async () => { if (!confirm('Delete everything the helper has saved?')) return; db = U.defaultDb(); await persist(); refreshAll(); say('#backup-msg', 'Everything deleted.', 'ok'); });

  // ---------- Copilot prompts and samples ----------
  const caseKeys = U.vocab.filter((v) => v.kind === 'case').map((v) => '  ' + v.key + '  – ' + v.label + (v.type === 'date' ? ' (date)' : '')).join('\n');
  const advKeys = U.vocab.filter((v) => v.kind === 'adviser').map((v) => '  ' + v.key + '  – ' + v.label).join('\n');
  $('#prompt-a').value =
`I am reformatting an export from our case management system so I can import it into a local browser tool. Convert the data below into ONE JSON object in exactly this shape and output only the JSON:

{"format":"ukvi-form-helper/1","cases":[{"id":"<unique case reference>","data":{"<key>":"<value>", ...}}]}

Rules:
- One entry in "cases" per client/case. Use the case reference as "id".
- Use these keys where they fit (leave out any you have no data for; never invent values). You may add extra keys in lower_snake_case for other useful items.
${caseKeys}
- Dates must be YYYY-MM-DD.
- If a name is held as one field, split it into given_names and family_name where it is clear; otherwise use full_name.
- Join multi-line addresses into address_line1, address_line2, town, county, postcode, country.
- Copy values exactly as they appear. No explanations, only the JSON.

DATA:
<paste the export here>`;
  $('#prompt-b').value =
`Below are the column headings from a case management export (headings only, no client data). Map each heading to the best matching key from my list, or to a new lower_snake_case key if none fits. Output only JSON like {"importMaps":{"<heading>":"<key>", ...}}.

Keys:
${caseKeys}

HEADINGS:
<paste the heading row here>`;
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const t = $('#' + b.dataset.copy); t.select(); try { await navigator.clipboard.writeText(t.value); b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = 'Copy prompt ' + b.dataset.copy.slice(-1).toUpperCase()), 1500); } catch (e) { document.execCommand('copy'); }
  }));
  const SAMPLE = {
    format: 'ukvi-form-helper/1',
    adviser: { adviser_name: 'Sam Example', adviser_organisation: 'Example Advice Centre', oisc_number: 'N000000000', adviser_email: 'sam@example.org', adviser_phone: '01234 567890', adviser_postcode: 'AB1 2CD' },
    cases: [{ id: 'CASE-001', data: { given_names: 'Alex', family_name: 'Sample', dob: '1990-04-23', nationality: 'Examplestan', passport_number: '123456789', email: 'alex@example.org', address_line1: '1 Test Street', town: 'Testtown', postcode: 'TE1 1ST' } }]
  };
  $('#btn-sample-json').addEventListener('click', () => download('ukvi-helper-sample.json', JSON.stringify(SAMPLE, null, 2)));
  $('#btn-sample-csv').addEventListener('click', () => download('ukvi-helper-sample.csv', 'Case Ref,Forename,Surname,DOB,Nationality,Passport No,Email,Address 1,City,Post Code\nCASE-001,Alex,Sample,23/04/1990,Examplestan,123456789,alex@example.org,1 Test Street,Testtown,TE1 1ST\n', 'text/csv'));

  function refreshAll() { fillKeyLists(); renderCases(); renderAdviser(); }
  refreshAll();
})();

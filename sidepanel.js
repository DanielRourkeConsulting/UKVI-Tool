/* UKVI Form Helper – side panel. Shows suggestions for the form in the active tab and tells the page-side
   agent what to fill. Everything stays in this browser. No network calls. */
(async function () {
  'use strict';
  const U = window.UKVI;
  const $ = (s) => document.querySelector(s);
  let selTpl = new Set(['common']), db, tab = null, rows = [], overrides = new Map(), filter = 'all', tid = '', heading = '', msg = '', originPattern = '', timer = null;
  // Two modes: 'capture' (learn this form's layout and the default text for each field) and 'fill' (put answers in).
  let mode = '', caption = '', section = null;
  const sectionText = (s) => (s ? s.num + '. ' + s.name : '');
  // Two views: 'page' (the fields on the open page) and 'saved' (every saved page of the template, in capture order).
  let view = 'page', armed = '', openPages = new Set();
  function showView() {
    document.body.dataset.view = view;
    document.querySelectorAll('.views button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === view)));
  }

  // ---------- Mode ----------
  function showMode() {
    document.body.dataset.mode = mode;
    document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  }
  async function setMode(m) {
    if (m === mode) return;
    mode = m; msg = ''; showMode();
    const d = await U.load(); d.prefs.mode = m; await U.save(d);
    if (db) db.prefs.mode = m;
    if (rows.length || view === 'saved') render();
  }
  function setView(v) {
    if (v === view) return;
    view = v; armed = ''; msg = '';
    if (v === 'saved') {
      const here = (db && db.templates[tid]) || {};
      openPages = new Set(tid ? [tid, 'sec:' + secKey(here.section || section)] : []);
    }
    showView(); if (db) render();
  }

  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && e.append(c));
    return e;
  };

  // ---------- Talking to the page ----------
  async function activeTab() {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [t] = await chrome.tabs.query({ active: true, windowId: w.id });
    return t || null;
  }
  const originOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin + '/*' : ''; } catch (e) { return ''; } };
  const ask = (m) => chrome.tabs.sendMessage(tab.id, Object.assign({ to: 'agent' }, m));

  async function scanPage() {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib.js', 'agent.js'] });
    return ask({ type: 'scan' });
  }

  function showState(html, button) {
    rows = []; $('#list').textContent = ''; $('#summary').textContent = '';
    const box = el('div', { class: 'empty' }, ...html);
    if (button) box.append(el('br'), button);
    $('#list').append(box);
  }

  // ---------- Building rows ----------
  function buildRows(res) {
    heading = res.heading; caption = res.caption || ''; section = res.section || null;
    const nt = U.templateId(res.href, res.heading);
    if (nt !== tid) overrides.clear();
    tid = nt;
    if (nt !== lastTid) { selTpl = new Set((db.pageTemplates[tid] || db.prefs.lastTemplates || ['common']).filter((id) => db.caseTemplates[id])); lastTid = nt; }
    const tm = db.tmplMappings[tid] || {};
    const entries = U.entries(db, 'case').concat(U.entries(db, 'adviser'));
    // Fill follows one case template: case items outside it (and outside Common) aren't ticked.
    const ft = db.caseTemplates[db.prefs.fillTemplate];
    const inTpl = ft ? new Set(Object.keys(ft.items).concat(Object.keys(db.caseTemplates.common.items))) : null;
    rows = res.fields.map((f) => {
      const cur = f.cur;
      const r = { f, fp: f.fp, cur, origin: 'none', ref: 'none', value: '', include: false, status: '' };
      const ov = overrides.get(f.fp);
      let ref = tm[f.fp] !== undefined ? tm[f.fp] : db.mappings[f.fp];
      if (ov) { ref = ov.ref; r.origin = 'edited'; }
      else if (ref !== undefined) r.origin = ref === 'default' ? 'default' : ref === 'none' ? 'none' : 'saved';
      else if (db.defaults[f.fp] && db.defaults[f.fp].length) { ref = 'default'; r.origin = 'default'; }
      else {
        const m = U.bestMatch(f.display, entries, !!f.part);
        if (m && m.score >= 0.75) { ref = m.entry.kind + ':' + m.entry.key; r.origin = 'guess'; } else ref = 'none';
      }
      r.ref = ref;
      r.value = ov && ov.value !== undefined ? ov.value : U.refValue(ref, db, f.fp);
      r.include = r.value !== '' && ['saved', 'default', 'edited'].includes(r.origin) && (cur === '' || (f.kind === 'checkbox' && cur === 'no') || cur === r.value);
      r.outside = !!inTpl && ref.startsWith('case:') && !inTpl.has(ref.slice(5));
      if (r.outside && !ov) r.include = false;
      return r;
    });
  }

  // In Capture the adviser sets every source on purpose, so a guess left in place is accepted; in Fill only a ticked one is.
  const skipPersist = (r) => (r.origin === 'guess' && !r.include && mode !== 'capture') || (r.origin === 'none' && !overrides.has(r.fp));
  async function persistMappings() {
    const tm = (db.tmplMappings[tid] = db.tmplMappings[tid] || {});
    for (const r of rows) { if (skipPersist(r)) continue; tm[r.fp] = r.ref; if (r.ref !== 'none') db.mappings[r.fp] = r.ref; }
    await U.save(db);
  }

  // ---------- Drawing ----------
  function fillCaseSelect() {
    const sel = $('#case-sel'); sel.textContent = '';
    sel.append(el('option', { value: '', text: Object.keys(db.cases).length ? '— none selected —' : '— no cases imported —' }));
    Object.entries(db.cases).forEach(([id, c]) => sel.append(el('option', { value: id, text: U.caseLabel(c, id), selected: id === db.currentCase })));
  }
  let lastTid = '', lastScan = null;
  function fillTplSelect() {
    const sel = $('#fill-tpl'); sel.textContent = '';
    if (db.prefs.fillTemplate && !db.caseTemplates[db.prefs.fillTemplate]) db.prefs.fillTemplate = '';
    sel.append(el('option', { value: '', text: '— any —' }));
    Object.entries(db.caseTemplates).forEach(([id, t]) => sel.append(el('option', { value: id, text: t.name, selected: id === db.prefs.fillTemplate })));
  }
  function renderTpls() {
    const box = $('#tpl-chips'); box.textContent = '';
    Object.entries(db.caseTemplates).forEach(([id, t]) => {
      const cb = el('input', { type: 'checkbox', checked: selTpl.has(id) });
      cb.addEventListener('change', () => { cb.checked ? selTpl.add(id) : selTpl.delete(id); });
      box.append(el('label', {}, cb, t.name));
    });
  }
  const chipText = { saved: 'saved', edited: 'edited', default: 'default', guess: 'guess – check', none: 'no source' };

  function sourceSelect(r) {
    const s = el('select', { 'aria-label': 'Where this value comes from' });
    s.append(el('option', { value: 'none', text: 'Skip this field' }), el('option', { value: 'default', text: 'Default (learn from what I type)' }));
    ['case', 'adviser'].forEach((kind) => {
      const g = el('optgroup', { label: kind === 'case' ? 'Case data' : 'Adviser data' });
      U.entries(db, kind).forEach((e) => g.append(el('option', { value: kind + ':' + e.key, text: e.label })));
      s.append(g);
    });
    s.value = r.ref;
    s.addEventListener('change', () => {
      const typed = (overrides.get(r.fp) || {}).value;
      r.ref = s.value; r.origin = 'edited';
      r.value = r.ref === 'default' && typed ? typed : U.refValue(r.ref, db, r.fp); r.include = r.value !== '';
      overrides.set(r.fp, r.ref === 'default' && typed ? { ref: r.ref, value: typed } : { ref: r.ref }); render();
    });
    return s;
  }

  // ---------- Saved pages: form sections (from the step bar), each holding its pages in capture order ----------
  function savedPages() {
    const ft = db.prefs.fillTemplate;
    return Object.entries(db.templates)
      .filter(([pid]) => !ft || (db.pageTemplates[pid] || []).includes(ft))
      .sort((a, b) => (a[1].created || a[1].updated || 0) - (b[1].created || b[1].updated || 0));
  }
  function renderSaved() {
    const list = $('#list'); list.textContent = '';
    renderTpls();
    const pages = savedPages();
    $('#summary').textContent = pages.length + ' page' + (pages.length === 1 ? '' : 's');
    $('#status').textContent = msg;
    if (!pages.length) { list.append(el('div', { class: 'empty', text: 'No pages saved yet.' })); return; }
    // Group the pages by form section (from the step bar), sections in step order, pages in capture order.
    const groups = new Map();
    pages.forEach(([pid, p]) => {
      const k = secKey(p.section);
      if (!groups.has(k)) groups.set(k, { sec: p.section || null, pages: [] });
      groups.get(k).pages.push([pid, p]);
    });
    const order = [...groups.entries()].sort((a, b) => (a[1].sec ? a[1].sec.num : 999) - (b[1].sec ? b[1].sec.num : 999));
    if (order.length === 1 && !order[0][1].sec) { order[0][1].pages.forEach(([pid, p], i) => list.append(pageBox(pid, p, i))); return; }
    order.forEach(([k, g]) => {
      const here = g.pages.some(([pid]) => pid === tid), ok = 'sec:' + k;
      const del = armButton(ok, 'Delete section', async () => { db = await U.load(); g.pages.forEach(([pid]) => removePage(pid)); await afterDelete(g.pages.map(([pid]) => pid), g.sec ? sectionText(g.sec) : 'Other pages'); });
      const d = el('details', { class: 'section' + (here ? ' here' : ''), open: openPages.has(ok) },
        el('summary', {}, el('span', { class: 'pnum', text: g.sec ? String(g.sec.num) : '·' }),
          el('span', { class: 'ptitle', text: g.sec ? g.sec.name : 'Other pages' }),
          el('span', { class: 'pcount', text: g.pages.length + ' page' + (g.pages.length === 1 ? '' : 's') })),
        el('div', { class: 'spages' }, g.pages.map(([pid, p], i) => pageBox(pid, p, i))),
        el('div', { class: 'pdel' }, del));
      d.addEventListener('toggle', () => { d.open ? openPages.add(ok) : openPages.delete(ok); });
      list.append(d);
    });
  }
  // Sections are matched by step number (the step's wording can change, e.g. a "Completed" tag).
  const secKey = (s) => (s ? 'n' + s.num : 'none');
  // A Delete button that needs a second click ("Confirm delete") to act.
  function armButton(key, label, act) {
    const b = el('button', { class: 'danger' + (armed === key ? ' armed' : ''), text: armed === key ? 'Confirm delete' : label });
    b.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); if (armed !== key) { armed = key; renderSaved(); return; } armed = ''; await act(); });
    return b;
  }
  function pageBox(pid, p, i) {
      const tm = db.tmplMappings[pid] || {};
      const fields = el('div', { class: 'pfields' });
      (p.fields || []).forEach((f) => {
        const ref = tm[f.fp] !== undefined ? tm[f.fp] : (db.mappings[f.fp] || 'none');
        const val = U.refValue(ref, db, f.fp);
        fields.append(el('div', { class: 'pf' + (ref === 'none' ? ' skip' : '') },
          el('span', { class: 'pf-lab', text: f.label }),
          el('span', { class: 'pf-src', text: U.refLabel(ref, db) }),
          el('span', { class: 'pf-val', text: val || '—' })));
      });
      const del = armButton(pid, 'Delete page', async () => { db = await U.load(); const t = (db.templates[pid] || {}).title || pid; removePage(pid); await afterDelete([pid], t); });
      const d = el('details', { class: 'page' + (pid === tid ? ' here' : ''), open: openPages.has(pid) },
        el('summary', {}, el('span', { class: 'pnum', text: String(i + 1) }),
          el('span', { class: 'ptitle' }, p.title || pid, p.caption ? el('small', { text: p.caption }) : null),
          el('span', { class: 'pcount', text: String((p.fields || []).length) })),
        fields, el('div', { class: 'pdel' }, del));
      d.addEventListener('toggle', () => { d.open ? openPages.add(pid) : openPages.delete(pid); if (!d.open && armed === pid) { armed = ''; renderSaved(); } });
      return d;
  }
  // With a template chosen, Delete takes the page out of that template (it is forgotten once no template uses it);
  // with "any", the page is forgotten everywhere. Works on the db just loaded; afterDelete saves.
  function removePage(pid) {
    const ft = db.prefs.fillTemplate;
    if (ft && (db.pageTemplates[pid] || []).filter((x) => x !== ft).length) U.removeFormFromTemplate(db, ft, pid);
    else U.forgetPage(db, pid);
  }
  async function afterDelete(pids, title) {
    await U.save(db);
    if (pids.includes(tid)) { lastTid = ''; overrides.clear(); if (lastScan) buildRows(lastScan); }
    msg = 'Deleted “' + title + '”.'; renderSaved();
  }

  function render() {
    if (view === 'saved') return renderSaved();
    const list = $('#list'); list.textContent = '';
    const ready = rows.filter((r) => r.include).length;
    renderTpls();
    $('#summary').textContent = mode === 'fill' ? ready + '/' + rows.length + ' ready' : rows.length + ' fields';
    const over = [sectionText(section), caption].filter(Boolean).join(' · ');
    if (heading) list.append(el('div', { class: 'pagehead' }, over ? el('small', { text: over }) : null, heading));
    if (!rows.length) { list.append(el('div', { class: 'empty', text: 'No fillable fields found on this page.' })); $('#status').textContent = msg; return; }
    const vis = rows.filter((r) => filter === 'all' || (filter === 'ready' ? r.include : (r.origin === 'guess' || r.origin === 'none' || (r.value === '' && r.ref !== 'none'))));
    const capture = mode === 'capture';
    vis.forEach((r) => {
      const cb = capture ? null : el('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Fill this field' });
      if (cb) cb.addEventListener('change', () => { r.include = cb.checked; row.classList.toggle('off', !r.include); });
      // Capture: the box holds the default text for next time (case and adviser items show their value, locked).
      // Fill: the box holds the value about to go in, which can be changed for this time only.
      const fromData = r.ref.startsWith('case:') || r.ref.startsWith('adviser:');
      const inp = el('input', { type: 'text', 'aria-label': capture ? 'Default text' : 'Value to fill',
        placeholder: capture ? (fromData ? '' : 'default text') : (r.f.kind === 'checkbox' ? 'yes / no' : 'value'),
        disabled: capture && fromData });
      inp.value = r.value;
      const dlId = 'dl' + r.f.id;
      if (r.f.options.length) inp.setAttribute('list', dlId);
      const out = !capture && r.outside;
      const chip = el('span', { class: 'chip ' + (out ? 'outside' : r.origin), text: out ? 'not in template' : chipText[r.origin] });
      inp.addEventListener('input', () => {
        if (capture && r.ref !== 'default') { r.ref = 'default'; r.origin = 'edited'; chip.className = 'chip edited'; chip.textContent = chipText.edited; sel.value = 'default'; }
        r.value = inp.value; r.include = inp.value !== ''; if (cb) cb.checked = r.include; overrides.set(r.fp, { ref: r.ref, value: inp.value });
      });
      const sel = capture ? sourceSelect(r) : null;
      const row = el('div', { class: 'row ' + (r.include || capture ? '' : 'off') + ' ' + (r.origin === 'guess' ? 'guess' : '') + ' ' + r.status },
        el('div', { class: 'top' }, cb, el('div', { class: 'lab' }, r.f.label, r.f.group ? el('small', { text: r.f.group }) : null), chip),
        el('div', { class: 'ctl' }, inp, sel));
      if (r.f.options.length) { const dl = el('datalist', { id: dlId }); r.f.options.slice(0, 200).forEach((o) => dl.append(el('option', { value: o.text }))); row.append(dl); }
      row.addEventListener('mouseenter', () => ask({ type: 'flash', id: r.f.id, on: true }).catch(() => {}));
      row.addEventListener('mouseleave', () => ask({ type: 'flash', id: r.f.id, on: false }).catch(() => {}));
      list.append(row);
    });
    $('#status').textContent = msg;
  }

  // ---------- Refresh (tab changed, page loaded, Rescan) ----------
  async function refresh() {
    db = await U.load(); fillCaseSelect(); fillTplSelect();
    if (!mode) { mode = db.prefs.mode || (Object.keys(db.templates).length ? 'fill' : 'capture'); showMode(); }
    tab = await activeTab();
    originPattern = tab && tab.url ? originOf(tab.url) : '';
    if (!originPattern) { showState([el('p', { text: 'Open a UKVI form page in this window.' })]); return; }
    let allowed = false;
    try { allowed = await chrome.permissions.contains({ origins: [originPattern] }); } catch (e) { /* ignore */ }
    if (!allowed) {
      const host = new URL(tab.url).host;
      showState([el('p', {}, 'The helper isn\'t allowed on ', el('code', { text: host }), ' yet.'), el('p', { text: 'Approve it once for this site only. It then fills in forms here without any further clicks.' })],
        el('button', { class: 'p', text: 'Allow on ' + host, onclick: async () => { try { if (await chrome.permissions.request({ origins: [originPattern] })) refresh(); } catch (e) { msg = e.message; } } }));
      return;
    }
    try { lastScan = await scanPage(); buildRows(lastScan); msg = ''; render(); }
    catch (e) { showState([el('p', { text: 'Couldn\'t read this page.' }), el('p', { text: String(e.message || e) })]); }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };

  // ---------- Buttons ----------
  async function doFill() {
    const items = rows.filter((r) => r.include && r.value !== '').map((r) => ({ id: r.f.id, value: r.value }));
    rows.forEach((r) => { r.status = ''; });
    let ok = 0, bad = 0;
    try {
      const res = await ask({ type: 'apply', items });
      res.forEach((x) => { const r = rows.find((q) => q.f.id === x.id); if (x.status === 'filled') { ok++; r.status = 'ok'; if (r.origin === 'guess') r.origin = 'saved'; } else { bad++; r.status = 'nomatch'; } });
    } catch (e) { msg = 'Couldn\'t reach the page: ' + e.message; render(); return; }
    db = await U.load(); await persistMappings();
    msg = 'Filled ' + ok + (bad ? ' · ' + bad + ' had no matching option (red)' : '') + '. Check every answer before you continue.';
    render();
  }

  async function doRemember() {
    db = await U.load();
    let fresh; try { fresh = await scanPage(); } catch (e) { msg = 'Couldn\'t read the page: ' + e.message; render(); return; }
    const curByFp = {}; fresh.fields.forEach((f) => { curByFp[f.fp] = f.cur; });
    const tm = (db.tmplMappings[tid] = db.tmplMappings[tid] || {});
    let learned = 0;
    for (const r of rows) {
      if (skipPersist(r)) continue;
      tm[r.fp] = r.ref;
      if (r.ref !== 'none') db.mappings[r.fp] = r.ref;
      // The default text in the panel's box wins; an empty box takes what is typed on the page.
      if (r.ref === 'default') { const typed = r.value || curByFp[r.fp]; if (typed && typed !== 'no') { U.addDefault(db, r.fp, typed); learned++; } }
    }
    const before = db.templates[tid] || {};
    db.templates[tid] = { title: fresh.heading || heading, caption: fresh.caption || '', section: fresh.section || null, url: fresh.url, created: before.created || before.updated || Date.now(), updated: Date.now(),
      fields: rows.map((r) => ({ fp: r.fp, label: r.f.display, kind: r.f.kind, part: r.f.part || '', options: r.f.options.slice(0, 40).map((o) => o.text) })) };
    // Case-data items this page needs go into the common case template (adviser data and defaults are ours, not the client's).
    let tplMsg = '';
    const chosen = [...selTpl].filter((id) => db.caseTemplates[id]);
    db.pageTemplates[tid] = chosen; db.prefs.lastTemplates = chosen;
    const uses = rows.filter((r) => !skipPersist(r) && r.ref.startsWith('case:')).map((r) => ({ key: r.ref.slice(5), fieldLabel: r.f.display }));
    chosen.forEach((id) => U.addToTemplate(db, id, tid, heading || tid, uses));
    tplMsg = chosen.length ? ' ' + uses.length + ' case item' + (uses.length === 1 ? '' : 's') + ' saved to: ' + chosen.map((id) => db.caseTemplates[id].name).join(', ') + '.' : ' No template ticked, so no case items were added to a template.';
    await U.save(db); overrides.clear();
    lastScan = fresh; fillTplSelect(); buildRows(fresh);
    msg = 'Saved this page layout (' + rows.length + ' fields) and ' + learned + ' default value' + (learned === 1 ? '' : 's') + '.' + tplMsg; render();
  }

  $('#btn-fill').addEventListener('click', doFill);
  $('#btn-remember').addEventListener('click', doRemember);
  $('#btn-tpl-new').addEventListener('click', async () => {
    const inp = $('#tpl-new-name'); db = await U.load();
    const id = U.newTemplate(db, inp.value); if (!id) return;
    await U.save(db); selTpl.add(id); inp.value = ''; renderTpls();
  });
  // Rescan in Capture: whatever the adviser has typed on the page becomes that field's default text
  // (not for case or adviser items: client data is never a default). The Capture button saves it.
  function adoptPageValues() {
    let n = 0;
    for (const r of rows) {
      if (r.ref.startsWith('case:') || r.ref.startsWith('adviser:')) continue;
      const v = r.cur;
      if (!v || (r.f.kind === 'checkbox' && v === 'no') || (r.ref === 'default' && v === r.value)) continue;
      r.ref = 'default'; r.origin = 'edited'; r.value = v; r.include = true;
      overrides.set(r.fp, { ref: 'default', value: v }); n++;
    }
    return n;
  }
  $('#btn-rescan').addEventListener('click', async () => {
    await refresh();
    if (mode !== 'capture' || !rows.length) return;
    const n = adoptPageValues();
    msg = n ? n + ' default' + (n === 1 ? '' : 's') + ' taken from the page.' : '';
    render();
  });
  document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  showView();
  $('#btn-opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#filter').addEventListener('change', (e) => { filter = e.target.value; render(); });
  // The template being followed is kept until the adviser picks another.
  $('#fill-tpl').addEventListener('change', async (e) => {
    const d = await U.load(); d.prefs.fillTemplate = e.target.value; await U.save(d);
    db.prefs.fillTemplate = e.target.value;
    armed = ''; if (lastScan) buildRows(lastScan); if (lastScan || view === 'saved') render();
  });
  $('#case-sel').addEventListener('change', async (e) => { db.currentCase = e.target.value || null; await U.save(db); refresh(); });

  chrome.tabs.onActivated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((id, info) => { if (tab && id === tab.id && info.status === 'complete') schedule(); });
  chrome.windows.onFocusChanged.addListener(schedule);
  chrome.permissions.onAdded.addListener(schedule);
  window.__ukviTest = { refresh, setMode, state: () => ({ rows, tid, mode }) };
  refresh();
})();

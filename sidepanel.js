/* UKVI Form Helper – side panel. Shows suggestions for the form in the active tab and tells the page-side
   agent what to fill. Everything stays in this browser. No network calls. */
(async function () {
  'use strict';
  const U = window.UKVI;
  const $ = (s) => document.querySelector(s);
  let selTpl = new Set(['common']), db, tab = null, rows = [], overrides = new Map(), tid = '', heading = '', msg = '', originPattern = '', timer = null;
  // Fill is the normal state. Capture (learn this form's layout and the default text for each field) is opened per page with
  // the Capture button and closed by Save or Cancel; a page that has never been saved opens in Capture by itself.
  let mode = 'fill', modeTid = null, caption = '', section = null;
  const sectionText = (s) => (s ? s.num + '. ' + s.name : '');
  // The list shows every saved page of the template by form section; the open page is highlighted and holds its fields.
  let armed = '', openPages = new Set(), openedFor = null;
  // The template editor (icon next to settings) lists the saved pages with bins to delete them; the normal list has none.
  let editing = false;
  function setEditing(on) {
    editing = on; armed = ''; msg = '';
    document.body.dataset.view = on ? 'editor' : '';
    $('#btn-edit').setAttribute('aria-pressed', String(on));
    if (db) render();
  }

  // ---------- Mode ----------
  function showMode() {
    document.body.dataset.mode = mode;
    document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  }
  async function setMode(m) {
    if (m === mode) return;
    mode = m; msg = ''; showMode();
    if (rows.length) render();
  }
  // Cancel: drop what was changed in Capture and go back to Fill.
  function cancelCapture() {
    overrides.clear(); mode = 'fill'; msg = ''; showMode();
    if (lastScan) buildRows(lastScan);
    if (rows.length) render();
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
    rows = []; $('#list').textContent = '';
    const box = el('div', { class: 'empty' }, ...html);
    if (button) box.append(el('br'), button);
    $('#list').append(box);
  }

  // ---------- Every field seen on this page, follow-up questions included ----------
  // A page's fields are the ones saved for it plus every one seen since it opened, in page order. A field that
  // appears after an answer changed (pick "Yes", Rescan) is recorded as a follow-up opened by that answer; one that
  // is hidden now stays listed (Capture only) so saving doesn't lose it.
  let known = { tid: null, scanned: false, order: [], byFp: new Map(), cur: new Map() };
  const fromSaved = (sf) => ({ id: null, kind: sf.kind, inputType: sf.inputType || '', group: sf.group || '', display: sf.label, fp: sf.fp, part: sf.part || '',
    label: sf.label.includes(' › ') ? sf.label.slice(sf.label.lastIndexOf(' › ') + 3) : sf.label,
    options: (sf.options || []).map((t) => ({ text: t })), cur: '', showIf: sf.showIf || null, hidden: true });
  function mergeKnown(res, nt) {
    if (known.tid !== nt) {
      known = { tid: nt, scanned: false, order: [], byFp: new Map(), cur: new Map() };
      ((db.templates[nt] || {}).fields || []).forEach((sf) => { known.order.push(sf.fp); known.byFp.set(sf.fp, fromSaved(sf)); });
    }
    const vis = res.fields;
    const changed = known.scanned ? vis.filter((f) => (f.kind === 'radio' || f.kind === 'checkbox') && known.cur.has(f.fp) && known.cur.get(f.fp) !== f.cur && f.cur && f.cur !== 'no') : [];
    vis.forEach((f, i) => {
      const old = known.byFp.get(f.fp);
      if (!old) {
        if (!f.showIf && changed.length) {
          const before = changed.filter((c) => vis.indexOf(c) < i);
          const c = before.length ? before[before.length - 1] : changed[changed.length - 1];
          f.showIf = { fp: c.fp, a: c.cur };
        }
        const prev = i ? known.order.indexOf(vis[i - 1].fp) : -1;
        known.order.splice(prev + 1, 0, f.fp);
      } else if (!f.showIf && old.showIf) f.showIf = old.showIf;
      known.byFp.set(f.fp, f); known.cur.set(f.fp, f.cur);
    });
    known.scanned = true;
    const here = new Map(vis.map((f) => [f.fp, f]));
    return known.order.map((fp) => here.get(fp) || Object.assign({}, known.byFp.get(fp), { id: null, cur: '', hidden: true }));
  }

  // ---------- Building rows ----------
  function buildRows(res) {
    heading = res.heading; caption = res.caption || ''; section = res.section || null;
    const nt = U.templateId(res.href, res.heading);
    const fields = mergeKnown(res, nt);
    if (nt !== tid) overrides.clear();
    tid = nt;
    if (nt !== lastTid) { selTpl = new Set((db.pageTemplates[tid] || db.prefs.lastTemplates || ['common']).filter((id) => db.caseTemplates[id])); lastTid = nt; }
    const tm = db.tmplMappings[tid] || {};
    const entries = U.entries(db, 'case').concat(U.entries(db, 'adviser'));
    // Fill follows one case template: case items outside it (and outside Common) aren't ticked.
    const ft = db.caseTemplates[db.prefs.fillTemplate];
    const inTpl = ft ? new Set(Object.keys(ft.items).concat(Object.keys(db.caseTemplates.common.items))) : null;
    rows = fields.map((f) => {
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
    sel.append(el('option', { value: '', text: Object.keys(db.cases).length ? 'Select a case' : 'No cases imported' }));
    Object.entries(db.cases).forEach(([id, c]) => sel.append(el('option', { value: id, text: U.caseLabel(c, id), selected: id === db.currentCase })));
  }
  let lastTid = '', lastScan = null;
  function fillTplSelect() {
    const sel = $('#fill-tpl'); sel.textContent = '';
    if (db.prefs.fillTemplate && !db.caseTemplates[db.prefs.fillTemplate]) db.prefs.fillTemplate = '';
    sel.append(el('option', { value: '', text: 'Select a template' }));
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
  function render() {
    const list = $('#list'); list.textContent = '';
    renderTpls();
    $('#status').textContent = msg;
    // Moving to a new page opens it and its section, and closes everything else.
    if (tid !== openedFor) {
      openedFor = tid; armed = ''; openPages = new Set([tid, 'sec:' + secKey(section)]); // earlier pages and sections fold away
      requestAnimationFrame(() => { const h = document.querySelector('details.page.here'); if (h) h.scrollIntoView({ block: 'start' }); });
    }
    const pages = savedPages();
    // The open page, if it isn't saved (in this template), is a dashed box in its section (titled "This page" if it has no heading).
    if (!editing && tid && !pages.some(([pid]) => pid === tid)) pages.push([tid, { title: heading || 'This page', caption, section, live: true }]);
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
          el('span', { class: 'pcount', text: g.pages.length + ' page' + (g.pages.length === 1 ? '' : 's') }),
          editing ? del : null),
        el('div', { class: 'spages' }, g.pages.map(([pid, p], i) => pageBox(pid, p, i))));
      d.addEventListener('toggle', () => { d.open ? openPages.add(ok) : openPages.delete(ok); });
      list.append(d);
    });
  }
  // Sections are matched by step number (the step's wording can change, e.g. a "Completed" tag).
  const secKey = (s) => (s ? 'n' + s.num : 'none');
  // A small bin that needs a second click to act: the first turns it red.
  const BIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M3.8 4l.7 9.5h7l.7-9.5M6.5 6.5v4.8M9.5 6.5v4.8"/></svg>';
  function armButton(key, label, act) {
    const on = armed === key, b = el('button', { class: 'bin' + (on ? ' armed' : ''), title: on ? label + ': click again to confirm' : label, 'aria-label': on ? 'Confirm: ' + label : label });
    b.innerHTML = BIN;
    b.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); if (armed !== key) { armed = key; render(); return; } armed = ''; await act(); });
    return b;
  }
  function pageBox(pid, p, i) {
      const tm = db.tmplMappings[pid] || {};
      const here = pid === tid;
      const fields = el('div', { class: here ? 'pfields live' : 'pfields' });
      if (here && !editing) liveRows(fields);
      else (p.fields || []).forEach((f) => {
        const ref = tm[f.fp] !== undefined ? tm[f.fp] : (db.mappings[f.fp] || 'none');
        const val = U.refValue(ref, db, f.fp);
        fields.append(el('div', { class: 'pf' + (ref === 'none' ? ' skip' : '') + (f.showIf ? ' follow' : '') },
          el('span', { class: 'pf-lab' }, ifTag(f.showIf, p.fields), f.label),
          el('span', { class: 'pf-src', text: U.refLabel(ref, db) }),
          el('span', { class: 'pf-val', text: val || '—' })));
      });
      const del = armButton(pid, 'Delete page', async () => { db = await U.load(); const t = (db.templates[pid] || {}).title || pid; removePage(pid); await afterDelete([pid], t); });
      const d = el('details', { class: 'page' + (here ? ' here' : '') + (p.live ? ' placeholder' : ''), open: openPages.has(pid) },
        el('summary', {}, el('span', { class: 'pnum', text: String(i + 1) }),
          el('span', { class: 'ptitle' }, p.title || pid, p.caption ? el('small', { text: p.caption }) : null),
          el('span', { class: 'pcount', text: String(here && !editing ? rows.length : (p.fields || []).length) }),
          editing ? del : null),
        fields);
      d.addEventListener('toggle', () => { d.open ? openPages.add(pid) : openPages.delete(pid); if (!d.open && armed === pid) { armed = ''; render(); } });
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
    msg = 'Deleted “' + title + '”.'; render();
  }

  // "↳ Yes": this question opens when that answer is given to the question named in its tooltip.
  function ifTag(s, fields) {
    if (!s) return null;
    const q = (fields || rows.map((r) => ({ fp: r.fp, label: r.f.display }))).find((x) => x.fp === s.fp);
    return el('span', { class: 'if', text: s.a, title: 'Opens when ' + (q ? '“' + q.label + '”' : 'the question above') + ' is answered “' + s.a + '”' });
  }
  // The open page's fields: Fill rows (tick + value) or Capture rows (default text + source).
  function liveRows(list) {
    if (!rows.length) { list.append(el('div', { class: 'none', text: 'No fillable fields found on this page.' })); return; }
    const filter = db.prefs.filter || 'all'; // set on the options page
    const capture = mode === 'capture';
    // Follow-up questions that are hidden right now are listed in Capture (to set them up) but not in Fill.
    const vis = rows.filter((r) => (capture || !r.f.hidden)).filter((r) => filter === 'all' || (filter === 'ready' ? r.include : (r.origin === 'guess' || r.origin === 'none' || (r.value === '' && r.ref !== 'none'))));
    vis.forEach((r, ri) => {
      const cb = capture ? null : el('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Fill this field' });
      if (cb) cb.addEventListener('change', () => { r.include = cb.checked; row.classList.toggle('off', !r.include); });
      // Capture: the box holds the default text for next time (case and adviser items show their value, locked).
      // Fill: the box holds the value about to go in, which can be changed for this time only.
      const fromData = r.ref.startsWith('case:') || r.ref.startsWith('adviser:');
      const inp = el('input', { type: 'text', 'aria-label': capture ? 'Default text' : 'Value to fill',
        placeholder: capture ? (fromData ? '' : 'default text') : (r.f.kind === 'checkbox' ? 'yes / no' : 'value'),
        disabled: capture && fromData });
      inp.value = r.value;
      const dlId = 'dl' + ri;
      if (r.f.options.length) inp.setAttribute('list', dlId);
      const out = !capture && r.outside;
      const chip = el('span', { class: 'chip ' + (out ? 'outside' : r.origin), text: out ? 'not in template' : chipText[r.origin] });
      inp.addEventListener('input', () => {
        if (capture && r.ref !== 'default') { r.ref = 'default'; r.origin = 'edited'; chip.className = 'chip edited'; chip.textContent = chipText.edited; sel.value = 'default'; }
        r.value = inp.value; r.include = inp.value !== ''; if (cb) cb.checked = r.include; overrides.set(r.fp, { ref: r.ref, value: inp.value });
      });
      const sel = capture ? sourceSelect(r) : null;
      const row = el('div', { class: 'row ' + (r.include || capture ? '' : 'off') + ' ' + (r.origin === 'guess' ? 'guess' : '') + ' ' + r.status + (r.f.showIf ? ' follow' : '') + (r.f.hidden ? ' unseen' : '') },
        el('div', { class: 'top' }, cb, el('div', { class: 'lab' }, ifTag(r.f.showIf), r.f.label, r.f.group ? el('small', { text: r.f.group }) : null), chip),
        el('div', { class: 'ctl' }, inp, sel));
      if (r.f.options.length) { const dl = el('datalist', { id: dlId }); r.f.options.slice(0, 200).forEach((o) => dl.append(el('option', { value: o.text }))); row.append(dl); }
      if (r.f.id != null) row.addEventListener('mouseenter', () => ask({ type: 'flash', id: r.f.id, on: true }).catch(() => {}));
      if (r.f.id != null) row.addEventListener('mouseleave', () => ask({ type: 'flash', id: r.f.id, on: false }).catch(() => {}));
      list.append(row);
    });
  }

  // ---------- Refresh (tab changed, page loaded, Rescan) ----------
  async function refresh() {
    db = await U.load(); fillCaseSelect(); fillTplSelect();
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
    try {
      lastScan = await scanPage(); buildRows(lastScan); msg = '';
      // A different page: Fill if it has been saved, Capture if not. The same page (Rescan, reload) keeps its state.
      if (tid !== modeTid) { modeTid = tid; mode = db.templates[tid] ? 'fill' : 'capture'; showMode(); }
      render();
    }
    catch (e) { showState([el('p', { text: 'Couldn\'t read this page.' }), el('p', { text: String(e.message || e) })]); }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); };

  // ---------- Buttons ----------
  async function doFill() {
    const items = rows.filter((r) => r.include && r.value !== '' && !r.f.hidden).map((r) => ({ id: r.f.id, value: r.value }));
    rows.forEach((r) => { r.status = ''; });
    let ok = 0, bad = 0;
    try {
      const res = await ask({ type: 'apply', items });
      res.forEach((x) => { const r = rows.find((q) => q.f.id === x.id); if (x.status === 'filled') { ok++; r.status = 'ok'; if (r.origin === 'guess') r.origin = 'saved'; } else { bad++; r.status = 'nomatch'; } });
    } catch (e) { msg = 'Couldn\'t reach the page: ' + e.message; render(); return; }
    db = await U.load(); await persistMappings();
    msg = 'Filled ' + ok + (bad ? ' · ' + bad + ' had no matching option (red)' : '') + '. Check every answer before you continue.';
    // An answer just filled may have opened follow-up questions: read the page again so they show up to fill.
    const opened = rows.some((r) => r.f.hidden && r.f.showIf && items.length);
    if (opened) { const m = msg; await refresh(); const n = rows.filter((r) => r.f.showIf && !r.f.hidden).length; msg = m + (n ? ' Follow-up questions now open: ' + n + '.' : ''); }
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
      fields: rows.map((r) => ({ fp: r.fp, label: r.f.display, group: r.f.group || '', kind: r.f.kind, inputType: r.f.inputType || '', part: r.f.part || '', showIf: r.f.showIf || null, options: r.f.options.slice(0, 300).map((o) => o.text) })) };
    // Case-data items this page needs go into the common case template (adviser data and defaults are ours, not the client's).
    const chosen = [...selTpl].filter((id) => db.caseTemplates[id]);
    db.pageTemplates[tid] = chosen; db.prefs.lastTemplates = chosen;
    const uses = rows.filter((r) => !skipPersist(r) && r.ref.startsWith('case:')).map((r) => ({ key: r.ref.slice(5), fieldLabel: r.f.display }));
    chosen.forEach((id) => U.addToTemplate(db, id, tid, heading || tid, uses));
    await U.save(db); overrides.clear();
    lastScan = fresh; fillTplSelect(); mode = 'fill'; showMode(); buildRows(fresh);
    // "Saved: 14 fields, 1 default, 3 case items to Fee waiver." Parts that would be 0 are left out.
    const n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
    const parts = [rows.length && n(rows.length, 'field'), learned && n(learned, 'default'),
      uses.length && n(uses.length, 'case item') + (chosen.length ? ' to ' + chosen.map((id) => db.caseTemplates[id].name).join(', ') : ' (no template ticked)')].filter(Boolean);
    msg = 'Saved' + (parts.length ? ': ' + parts.join(', ') : '') + '.'; render();
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
  // A click anywhere else puts an armed bin back.
  document.addEventListener('click', (e) => { if (armed && !e.target.closest('.bin')) { armed = ''; render(); } });
  $('#btn-edit').addEventListener('click', () => setEditing(!editing));
  $('#btn-done').addEventListener('click', () => setEditing(false));
  // Export: the chosen template's pages as one read-only copy of the form (questions, formats, options), downloaded as HTML.
  $('#btn-export').addEventListener('click', async () => {
    db = await U.load();
    const pages = savedPages(), ft = db.caseTemplates[db.prefs.fillTemplate];
    if (!pages.length) return;
    const title = (ft ? ft.name : 'All saved pages') + ' – UKVI form';
    const a = el('a', { href: URL.createObjectURL(new Blob([U.formExport(db, title, pages)], { type: 'text/html' })), download: U.slug(title.replace(' – ', ' ')).replace(/_+/g, '-') + '.html' });
    document.body.append(a); a.click(); a.remove();
    msg = 'Exported ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + '.'; $('#status').textContent = msg;
  });
  $('#btn-capture').addEventListener('click', () => setMode('capture'));
  $('#btn-cancel').addEventListener('click', cancelCapture);
  showMode();
  $('#btn-opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
  // The template being followed is kept until the adviser picks another.
  $('#fill-tpl').addEventListener('change', async (e) => {
    const d = await U.load(); d.prefs.fillTemplate = e.target.value; await U.save(d);
    db.prefs.fillTemplate = e.target.value;
    armed = ''; if (lastScan) buildRows(lastScan); if (lastScan) render();
  });
  $('#case-sel').addEventListener('change', async (e) => { db.currentCase = e.target.value || null; await U.save(db); refresh(); });

  chrome.tabs.onActivated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((id, info) => { if (tab && id === tab.id && info.status === 'complete') schedule(); });
  chrome.windows.onFocusChanged.addListener(schedule);
  chrome.permissions.onAdded.addListener(schedule);
  window.__ukviTest = { refresh, setMode, state: () => ({ rows, tid, mode }) };
  refresh();
})();

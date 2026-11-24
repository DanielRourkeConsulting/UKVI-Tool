/* UKVI Form Helper – side panel. Shows suggestions for the form in the active tab and tells the page-side
   agent what to fill. Everything stays in this browser. No network calls. */
(async function () {
  'use strict';
  const U = window.UKVI;
  const $ = (s) => document.querySelector(s);
  let selTpl = new Set(['common']), db, tab = null, rows = [], overrides = new Map(), filter = 'all', tid = '', heading = '', msg = '', originPattern = '', timer = null;

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
    heading = res.heading;
    const nt = U.templateId(res.href, res.heading);
    if (nt !== tid) overrides.clear();
    tid = nt;
    if (nt !== lastTid) { selTpl = new Set((db.pageTemplates[tid] || db.prefs.lastTemplates || ['common']).filter((id) => db.caseTemplates[id])); lastTid = nt; }
    const tm = db.tmplMappings[tid] || {};
    const entries = U.entries(db, 'case').concat(U.entries(db, 'adviser'));
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
      return r;
    });
  }

  const skipPersist = (r) => (r.origin === 'guess' && !r.include) || (r.origin === 'none' && !overrides.has(r.fp));
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
  let lastTid = '';
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
      r.ref = s.value; r.origin = 'edited'; r.value = U.refValue(r.ref, db, r.fp); r.include = r.value !== '';
      overrides.set(r.fp, { ref: r.ref }); render();
    });
    return s;
  }

  function render() {
    const list = $('#list'); list.textContent = '';
    const ready = rows.filter((r) => r.include).length;
    renderTpls();
    $('#summary').textContent = rows.length + ' fields · ' + ready + ' ready';
    if (!rows.length) { list.append(el('div', { class: 'empty', text: 'No fillable fields found on this page.' })); $('#status').textContent = msg; return; }
    const vis = rows.filter((r) => filter === 'all' || (filter === 'ready' ? r.include : (r.origin === 'guess' || r.origin === 'none' || (r.value === '' && r.ref !== 'none'))));
    vis.forEach((r) => {
      const cb = el('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Fill this field' });
      cb.addEventListener('change', () => { r.include = cb.checked; row.classList.toggle('off', !r.include); });
      const inp = el('input', { type: 'text', 'aria-label': 'Value to fill', placeholder: r.f.kind === 'checkbox' ? 'yes / no' : 'value' });
      inp.value = r.value;
      const dlId = 'dl' + r.f.id;
      if (r.f.options.length) inp.setAttribute('list', dlId);
      inp.addEventListener('input', () => { r.value = inp.value; r.include = inp.value !== ''; cb.checked = r.include; overrides.set(r.fp, { ref: r.ref, value: inp.value }); });
      const row = el('div', { class: 'row ' + (r.include ? '' : 'off') + ' ' + (r.origin === 'guess' ? 'guess' : '') + ' ' + r.status },
        el('div', { class: 'top' }, cb, el('div', { class: 'lab' }, r.f.label, r.f.group ? el('small', { text: r.f.group }) : null), el('span', { class: 'chip ' + r.origin, text: chipText[r.origin] })),
        el('div', { class: 'ctl' }, inp, sourceSelect(r)));
      if (r.f.options.length) { const dl = el('datalist', { id: dlId }); r.f.options.slice(0, 200).forEach((o) => dl.append(el('option', { value: o.text }))); row.append(dl); }
      row.addEventListener('mouseenter', () => ask({ type: 'flash', id: r.f.id, on: true }).catch(() => {}));
      row.addEventListener('mouseleave', () => ask({ type: 'flash', id: r.f.id, on: false }).catch(() => {}));
      list.append(row);
    });
    $('#status').textContent = msg;
  }

  // ---------- Refresh (tab changed, page loaded, Rescan) ----------
  async function refresh() {
    db = await U.load(); fillCaseSelect();
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
    try { buildRows(await scanPage()); msg = ''; render(); }
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
      if (r.ref === 'default') { const typed = curByFp[r.fp] || r.value; if (typed && typed !== 'no') { U.addDefault(db, r.fp, typed); learned++; } }
    }
    db.templates[tid] = { title: heading, url: fresh.url, updated: Date.now(),
      fields: rows.map((r) => ({ fp: r.fp, label: r.f.display, kind: r.f.kind, part: r.f.part || '', options: r.f.options.slice(0, 40).map((o) => o.text) })) };
    // Case-data items this page needs go into the common case template (adviser data and defaults are ours, not the client's).
    let tplMsg = '';
    const chosen = [...selTpl].filter((id) => db.caseTemplates[id]);
    db.pageTemplates[tid] = chosen; db.prefs.lastTemplates = chosen;
    const uses = rows.filter((r) => !skipPersist(r) && r.ref.startsWith('case:')).map((r) => ({ key: r.ref.slice(5), fieldLabel: r.f.display }));
    chosen.forEach((id) => U.addToTemplate(db, id, tid, heading || tid, uses));
    tplMsg = chosen.length ? ' ' + uses.length + ' case item' + (uses.length === 1 ? '' : 's') + ' saved to: ' + chosen.map((id) => db.caseTemplates[id].name).join(', ') + '.' : ' No template ticked, so no case items were added to a template.';
    await U.save(db); overrides.clear();
    buildRows(fresh);
    msg = 'Saved this page layout (' + rows.length + ' fields) and ' + learned + ' default value' + (learned === 1 ? '' : 's') + '.' + tplMsg; render();
  }

  $('#btn-fill').addEventListener('click', doFill);
  $('#btn-remember').addEventListener('click', doRemember);
  $('#btn-tpl-new').addEventListener('click', async () => {
    const inp = $('#tpl-new-name'); db = await U.load();
    const id = U.newTemplate(db, inp.value); if (!id) return;
    await U.save(db); selTpl.add(id); inp.value = ''; renderTpls();
  });
  $('#btn-rescan').addEventListener('click', refresh);
  $('#btn-opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#filter').addEventListener('change', (e) => { filter = e.target.value; render(); });
  $('#case-sel').addEventListener('change', async (e) => { db.currentCase = e.target.value || null; await U.save(db); refresh(); });

  chrome.tabs.onActivated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((id, info) => { if (tab && id === tab.id && info.status === 'complete') schedule(); });
  chrome.windows.onFocusChanged.addListener(schedule);
  chrome.permissions.onAdded.addListener(schedule);
  window.__ukviTest = { refresh, state: () => ({ rows, tid }) };
  refresh();
})();

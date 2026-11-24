/* UKVI Form Helper – the panel injected into the page when you click the toolbar icon.
   Reads the form fields on the page, suggests values from your saved data, fills the ones you tick,
   and remembers the layout. It never submits anything and never sends data anywhere. */
(function () {
  'use strict';
  if (window.__ukviHelper) { window.__ukviHelper.toggle(); return; }
  const U = window.UKVI;

  // ---------- Reading the page ----------
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').replace(/\(?\boptional\b\)?/ig, '').replace(/\s*\*\s*$/, '').trim();
  const txt = (node) => {
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll('input,select,textarea,script,style,option').forEach((n) => n.remove());
    return clean(c.textContent);
  };
  const shown = (el) => {
    if (el.getClientRects().length) return true;
    const l = el.labels && el.labels[0];
    return !!(l && l.getClientRects().length);
  };
  function precedingText(el) {
    let n = el;
    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
      const s = n.previousElementSibling;
      if (s && !s.matches('input,select,textarea,script,style')) { const t = txt(s); if (t && t.length < 120) return t; }
    }
    return '';
  }
  function ownLabel(el) {
    let t = '';
    const lb = el.getAttribute('aria-labelledby');
    if (lb) t = lb.split(/\s+/).map((id) => txt(document.getElementById(id))).join(' ');
    if (!clean(t) && el.labels && el.labels.length) t = txt(el.labels[0]);
    if (!clean(t)) t = el.getAttribute('aria-label') || '';
    if (!clean(t)) { const l = el.closest('label'); if (l) t = txt(l); }
    if (!clean(t)) t = el.getAttribute('placeholder') || el.getAttribute('title') || '';
    if (!clean(t)) t = precedingText(el);
    if (!clean(t)) t = U.humanise(el.name || el.id || el.type || 'field');
    return clean(t);
  }
  function groupOf(el) {
    const fs = el.closest('fieldset');
    if (fs) { const lg = fs.querySelector(':scope > legend'); if (lg) return txt(lg); }
    const g = el.closest('[role=group],[role=radiogroup]');
    if (g) {
      const lb = g.getAttribute('aria-labelledby');
      if (lb) return clean(lb.split(/\s+/).map((id) => txt(document.getElementById(id))).join(' '));
      if (g.getAttribute('aria-label')) return clean(g.getAttribute('aria-label'));
    }
    return '';
  }
  function partOf(el, label) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (/bday-day|\bday$/.test(ac)) return 'day';
    if (/bday-month/.test(ac)) return 'month';
    if (/bday-year/.test(ac)) return 'year';
    const toks = U.norm(label).split(' ');
    const last = toks[toks.length - 1];
    if (['day', 'month', 'year'].includes(last) && toks.length <= 3) return last;
    return '';
  }

  function scan() {
    const out = [], seenRadio = new Set(), seenFp = {};
    for (const el of document.querySelectorAll('input,select,textarea')) {
      const type = (el.type || '').toLowerCase();
      if (el.tagName === 'INPUT' && ['hidden', 'password', 'submit', 'button', 'reset', 'image', 'file', 'search', 'range', 'color'].includes(type)) continue;
      if (el.disabled || el.readOnly || !shown(el)) continue;
      let f;
      if (type === 'radio') {
        const key = (el.form ? [...document.forms].indexOf(el.form) : -1) + '|' + el.name;
        if (el.name && seenRadio.has(key)) continue;
        seenRadio.add(key);
        const els = el.name ? [...document.querySelectorAll('input[type=radio]')].filter((r) => r.name === el.name && r.form === el.form && !r.disabled) : [el];
        f = { kind: 'radio', els, el: els[0], label: groupOf(el) || U.humanise(el.name), group: '', options: els.map((r) => ({ text: ownLabel(r), value: r.value, el: r })) };
      } else if (type === 'checkbox') {
        f = { kind: 'checkbox', el, els: [el], label: ownLabel(el), group: groupOf(el) };
      } else if (el.tagName === 'SELECT') {
        f = { kind: 'select', el, els: [el], label: ownLabel(el), group: groupOf(el),
          options: [...el.options].slice(0, 400).map((o) => ({ text: o.text.trim(), value: o.value })) };
      } else {
        f = { kind: 'text', inputType: type || 'text', el, els: [el], label: ownLabel(el), group: groupOf(el) };
      }
      if (f.group && U.norm(f.group) === U.norm(f.label)) f.group = '';
      f.part = f.kind === 'text' || f.kind === 'select' ? partOf(el, f.label) : '';
      f.display = f.group ? f.group + ' › ' + f.label : f.label;
      let fp = U.norm(f.display);
      if (seenFp[fp]) { seenFp[fp]++; fp += ' #' + seenFp[fp]; } else seenFp[fp] = 1;
      f.fp = fp;
      out.push(f);
    }
    return out;
  }

  function current(f) {
    if (f.kind === 'radio') { const o = f.options.find((x) => x.el.checked); return o ? o.text : ''; }
    if (f.kind === 'checkbox') return f.el.checked ? 'yes' : 'no';
    if (f.kind === 'select') { const o = f.el.selectedOptions[0]; return o && o.value !== '' ? o.text.trim() : ''; }
    return f.el.value || '';
  }

  // ---------- Writing to the page ----------
  function setNative(el, v) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
  }
  const fire = (el) => { ['input', 'change', 'blur'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true }))); };

  // What to type for this field given the stored value (handles dates split into day / month / year).
  function candidatesFor(f, value) {
    const iso = U.parseDate(value);
    if (iso && f.part) {
      const n = U.datePart(iso, f.part);
      if (f.part === 'month') return [String(n).padStart(2, '0'), String(n), U.MONTH_NAMES[n - 1], U.MONTH_NAMES[n - 1].slice(0, 3)];
      if (f.part === 'day') return [String(n).padStart(2, '0'), String(n)];
      return [String(n)];
    }
    if (iso && f.kind === 'text') return [f.inputType === 'date' ? iso : U.ukDate(iso)];
    return [value];
  }

  function applyValue(f, value) {
    const c = candidatesFor(f, value);
    if (f.kind === 'text') { setNative(f.el, c[0]); fire(f.el); return 'filled'; }
    if (f.kind === 'checkbox') { const want = U.isTruthy(value); if (f.el.checked !== want) f.el.click(); return 'filled'; }
    if (f.kind === 'select') {
      const i = U.pickOption(f.options, c);
      if (i < 0) return 'nomatch';
      setNative(f.el, f.options[i].value); f.el.selectedIndex = i; fire(f.el); return 'filled';
    }
    if (f.kind === 'radio') {
      const i = U.pickOption(f.options, c);
      if (i < 0) return 'nomatch';
      if (!f.options[i].el.checked) f.options[i].el.click();
      return 'filled';
    }
    return 'skipped';
  }

  // ---------- State ----------
  let db, rows = [], overrides = new Map(), filter = 'all', tid = '', msg = '';

  function pageHeading() { const h = document.querySelector('h1'); return h ? txt(h) : document.title; }

  function buildRows() {
    tid = U.templateId(location.href, pageHeading());
    const tm = db.tmplMappings[tid] || {};
    const caseEntries = U.entries(db, 'case'), advEntries = U.entries(db, 'adviser');
    rows = scan().map((f) => {
      const cur = current(f);
      const r = { f, fp: f.fp, cur, origin: 'none', ref: 'none', value: '', include: false, status: '' };
      const ov = overrides.get(f.fp);
      let ref = tm[f.fp] !== undefined ? tm[f.fp] : db.mappings[f.fp];
      if (ov) { ref = ov.ref; r.origin = 'edited'; }
      else if (ref !== undefined) r.origin = ref === 'default' ? 'default' : ref === 'none' ? 'none' : 'saved';
      else if (db.defaults[f.fp] && db.defaults[f.fp].length) { ref = 'default'; r.origin = 'default'; }
      else {
        const m = U.bestMatch(f.display, caseEntries.concat(advEntries), !!f.part);
        if (m && m.score >= 0.75) { ref = m.entry.kind + ':' + m.entry.key; r.origin = 'guess'; }
        else ref = 'none';
      }
      r.ref = ref;
      r.value = ov && ov.value !== undefined ? ov.value : U.refValue(ref, db, f.fp);
      r.include = r.value !== '' && (r.origin === 'saved' || r.origin === 'default' || r.origin === 'edited') && (cur === '' || cur === r.value);
      return r;
    });
  }

  async function persistMappings() {
    const tm = (db.tmplMappings[tid] = db.tmplMappings[tid] || {});
    for (const r of rows) {
      if ((r.origin === 'guess' && !r.include) || (r.origin === 'none' && !overrides.has(r.fp))) continue;
      tm[r.fp] = r.ref;
      if (r.ref !== 'none') db.mappings[r.fp] = r.ref;
    }
    await U.save(db);
  }

  // ---------- Panel UI (closed shadow root so the page can't read it) ----------
  let host, shadow, listEl, statusEl, caseSel, summaryEl;
  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c != null && e.append(c));
    return e;
  };
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,Segoe UI,Arial,sans-serif}
.panel{position:fixed;top:0;right:0;width:400px;max-width:100vw;height:100vh;background:#fff;color:#1d1d1b;border-left:3px solid #1d70b8;box-shadow:-4px 0 18px rgba(0,0,0,.25);display:flex;flex-direction:column;font-size:13px;line-height:1.35}
.panel.left{right:auto;left:0;border-left:0;border-right:3px solid #1d70b8}
header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#1d70b8;color:#fff}
header b{flex:1;font-size:14px}
header button{background:transparent;border:1px solid #fff8;color:#fff;border-radius:3px;cursor:pointer;padding:2px 7px}
.bar{display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid #ddd;flex-wrap:wrap}
.bar select{flex:1;min-width:0}
.sum{padding:4px 10px;color:#505a5f;border-bottom:1px solid #eee;display:flex;gap:8px;align-items:center}
.sum span{flex:1}
.list{flex:1;overflow:auto;padding:6px 8px}
.row{border:1px solid #ddd;border-radius:4px;padding:6px 8px;margin-bottom:6px;background:#fff}
.row.off{background:#f7f7f7}
.row.guess{border-color:#f47738;background:#fff8f0}
.row.nomatch{border-color:#d4351c}
.row.ok{border-color:#00703c}
.top{display:flex;gap:6px;align-items:flex-start}
.top input[type=checkbox]{margin-top:3px}
.lab{flex:1;font-weight:600;word-break:break-word}
.lab small{display:block;font-weight:400;color:#505a5f}
.chip{font-size:11px;padding:1px 6px;border-radius:9px;background:#e5e5e5;white-space:nowrap}
.chip.saved,.chip.edited{background:#cce2d8}.chip.default{background:#d2e2f1}.chip.guess{background:#fcd6c3}
.ctl{display:flex;gap:6px;margin-top:5px}
.ctl input,.ctl select{flex:1;min-width:0;padding:3px 5px;border:1px solid #999;border-radius:3px;font-size:12px}
.ctl select{flex:0 0 46%}
footer{padding:8px 10px;border-top:1px solid #ddd;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
button.p{background:#00703c;color:#fff;border:0;border-radius:3px;padding:7px 12px;cursor:pointer;font-weight:600}
button.s{background:#fff;color:#1d70b8;border:1px solid #1d70b8;border-radius:3px;padding:6px 10px;cursor:pointer}
.status{flex-basis:100%;color:#505a5f;min-height:16px}
.empty{padding:20px;color:#505a5f;text-align:center}
a.lnk{color:#fff;font-size:12px}
`;

  function build() {
    host = document.createElement('div'); host.id = 'ukvi-form-helper-host';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;right:0;';
    shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); shadow.adoptedStyleSheets = [sheet];
    caseSel = el('select', { onchange: async () => { db.currentCase = caseSel.value || null; await U.save(db); rescan(); } });
    summaryEl = el('span');
    listEl = el('div', { class: 'list' });
    statusEl = el('div', { class: 'status' });
    const filterSel = el('select', { onchange: () => { filter = filterSel.value; render(); } },
      el('option', { value: 'all', text: 'Show all' }), el('option', { value: 'ready', text: 'Ready to fill' }), el('option', { value: 'attention', text: 'Needs attention' }));
    const panel = el('div', { class: 'panel' },
      el('header', {}, el('b', { text: 'UKVI Form Helper' }),
        el('button', { title: 'Move to the other side', onclick: () => panel.classList.toggle('left') }, '⇄'),
        el('button', { title: 'Open data settings', onclick: () => chrome.runtime.sendMessage({ type: 'options' }).catch(() => {}) }, '⚙'),
        el('button', { title: 'Close (Esc)', onclick: () => api.hide() }, '✕')),
      el('div', { class: 'bar' }, el('span', { text: 'Case:' }), caseSel),
      el('div', { class: 'sum' }, summaryEl, filterSel),
      listEl,
      el('footer', {},
        el('button', { class: 'p', onclick: doFill, text: 'Fill ticked fields' }),
        el('button', { class: 's', onclick: doRemember, title: 'Save the layout, your field choices and the values currently typed on the page as defaults', text: 'Remember this page' }),
        el('button', { class: 's', onclick: rescan, text: 'Rescan' }),
        statusEl));
    shadow.append(panel);
    document.documentElement.append(host);
    host.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hide(); });
  }

  function fillCaseSelect() {
    caseSel.textContent = '';
    caseSel.append(el('option', { value: '', text: Object.keys(db.cases).length ? '— none selected —' : '— no cases imported —' }));
    Object.entries(db.cases).forEach(([id, c]) => caseSel.append(el('option', { value: id, text: U.caseLabel(c, id), selected: id === db.currentCase })));
  }

  function chip(r) {
    const t = { saved: 'saved', edited: 'edited', default: 'default', guess: 'guess – check', none: 'no source' }[r.origin];
    return el('span', { class: 'chip ' + r.origin, text: t });
  }

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
      r.ref = s.value; r.origin = 'edited';
      r.value = U.refValue(r.ref, db, r.fp);
      r.include = r.value !== '';
      overrides.set(r.fp, { ref: r.ref });
      render();
    });
    return s;
  }

  function valueInput(r, i) {
    const inp = el('input', { type: 'text', value: r.value, 'aria-label': 'Value to fill', placeholder: r.f.kind === 'checkbox' ? 'yes / no' : 'value' });
    inp.value = r.value;
    const opts = r.f.options || [];
    if (opts.length) { const id = 'dl' + i; inp.setAttribute('list', id); }
    inp.addEventListener('input', () => { r.value = inp.value; r.include = inp.value !== ''; overrides.set(r.fp, { ref: r.ref, value: inp.value }); });
    return inp;
  }

  function flash(f, on) {
    const t = f.el;
    if (on) { t.__ukviOutline = t.style.outline; t.style.outline = '3px solid #f47738'; t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else t.style.outline = t.__ukviOutline || '';
  }

  function render() {
    listEl.textContent = '';
    const ready = rows.filter((r) => r.include).length;
    summaryEl.textContent = rows.length + ' fields · ' + ready + ' ready';
    const vis = rows.filter((r) => filter === 'all' || (filter === 'ready' ? r.include : (r.origin === 'guess' || r.origin === 'none' || (r.value === '' && r.ref !== 'none'))));
    if (!rows.length) { listEl.append(el('div', { class: 'empty', text: 'No fillable fields found on this page.' })); return; }
    vis.forEach((r) => {
      const i = rows.indexOf(r);
      const cb = el('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Fill this field' });
      cb.addEventListener('change', () => { r.include = cb.checked; row.classList.toggle('off', !r.include); });
      const row = el('div', { class: 'row ' + (r.include ? '' : 'off') + ' ' + (r.origin === 'guess' ? 'guess' : '') + ' ' + r.status },
        el('div', { class: 'top' }, cb,
          el('div', { class: 'lab' }, r.f.label, r.f.group ? el('small', { text: r.f.group }) : null),
          chip(r)),
        el('div', { class: 'ctl' }, valueInput(r, i), sourceSelect(r)));
      if (r.f.options && r.f.options.length) {
        const dl = el('datalist', { id: 'dl' + i }); r.f.options.slice(0, 200).forEach((o) => dl.append(el('option', { value: o.text })));
        row.append(dl);
      }
      row.addEventListener('mouseenter', () => flash(r.f, true));
      row.addEventListener('mouseleave', () => flash(r.f, false));
      listEl.append(row);
    });
    statusEl.textContent = msg;
  }

  async function rescan() { db = await U.load(); fillCaseSelect(); buildRows(); msg = ''; render(); }

  async function doFill() {
    let ok = 0, bad = 0;
    for (const r of rows) {
      r.status = '';
      if (!r.include || r.value === '') continue;
      const res = applyValue(r.f, r.value);
      if (res === 'filled') { ok++; r.status = 'ok'; if (r.origin === 'guess') r.origin = 'saved'; } else { bad++; r.status = 'nomatch'; }
    }
    db = await U.load(); await persistMappings();
    msg = 'Filled ' + ok + (bad ? ' · ' + bad + ' had no matching option (red)' : '') + '. Check every answer before you continue.';
    render();
  }

  async function doRemember() {
    db = await U.load();
    const tm = (db.tmplMappings[tid] = db.tmplMappings[tid] || {});
    let learned = 0;
    for (const r of rows) {
      if ((r.origin === 'guess' && !r.include) || (r.origin === 'none' && !overrides.has(r.fp))) continue;
      tm[r.fp] = r.ref;
      if (r.ref !== 'none') db.mappings[r.fp] = r.ref;
      if (r.ref === 'default') {
        const typed = current(r.f) || r.value;
        if (typed && typed !== 'no') { U.addDefault(db, r.fp, typed); learned++; }
      }
    }
    db.templates[tid] = {
      title: pageHeading(), url: location.origin + location.pathname, updated: Date.now(),
      fields: rows.map((r) => ({ fp: r.fp, label: r.f.display, kind: r.f.kind, part: r.f.part || '', options: (r.f.options || []).slice(0, 40).map((o) => o.text) }))
    };
    await U.save(db);
    overrides.clear();
    buildRows(); msg = 'Saved this page layout (' + rows.length + ' fields) and ' + learned + ' default value' + (learned === 1 ? '' : 's') + '.'; render();
  }

  // ---------- Show / hide ----------
  const api = {
    async show() { if (!host) build(); host.style.display = ''; document.addEventListener('keydown', escHandler, true); await rescan(); },
    hide() { if (host) host.style.display = 'none'; document.removeEventListener('keydown', escHandler, true); },
    toggle() { return host && host.style.display !== 'none' ? api.hide() : api.show(); }
  };
  const escHandler = (e) => { if (e.key === 'Escape') api.hide(); };
  window.__ukviHelper = api;
  api.show();
})();

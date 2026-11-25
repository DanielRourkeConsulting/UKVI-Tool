/* UKVI Form Helper – page-side agent. Injected (only after you approve the site) to read the form fields
   on the page and fill the ones the side panel asks for. It has no interface of its own, never submits
   anything and never sends data anywhere except back to the side panel in this same browser. */
(function () {
  'use strict';
  if (window.__ukviAgent) return;
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

  // Custom toggle controls (buttons / divs with aria-pressed, aria-checked, role=switch|checkbox|radio).
  const TOGGLE_SEL = '[role=switch],[role=checkbox],[role=radio],button[aria-pressed],[aria-checked]';
  const isOn = (el) => (el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true');
  function toggleText(el, asOption) {
    const lb = el.getAttribute('aria-labelledby');
    let t = lb ? lb.split(/\s+/).map((id) => txt(document.getElementById(id))).join(' ') : '';
    if (!clean(t)) t = el.getAttribute('aria-label') || '';
    if (!clean(t)) { const x = txt(el); if (x && x.length < 80 && (asOption || !/^(on|off|yes|no)$/i.test(x))) t = x; }
    if (!clean(t)) { const l = el.closest('label'); if (l) t = txt(l); }
    if (!clean(t)) t = precedingText(el) || precedingText(el.parentElement || el);
    return clean(t) || U.humanise(el.id || 'toggle');
  }
  function toggleFields(toggles) {
    const buckets = new Map();
    toggles.forEach((el) => { const g = el.closest('fieldset,[role=radiogroup],[role=group]') || el.parentElement; if (!buckets.has(g)) buckets.set(g, []); buckets.get(g).push(el); });
    const out = [];
    buckets.forEach((els, g) => {
      if (els.length >= 2) {
        const label = groupOf(els[0]) || precedingText(g) || 'Choose one';
        out.push({ kind: 'radio', els, el: els[0], label, group: '', options: els.map((e) => ({ text: toggleText(e, true), value: e.value || '', el: e })) });
      } else {
        out.push({ kind: 'checkbox', el: els[0], els, label: toggleText(els[0]), group: groupOf(els[0]) });
      }
    });
    return out;
  }

  function scan() {
    const out = [], seenRadio = new Set(), seenFp = {};
    const toggles = [], seenEl = new Set();
    for (const el of document.querySelectorAll('input,select,textarea,' + TOGGLE_SEL)) {
      if (seenEl.has(el)) continue; seenEl.add(el);
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) { if (el.getClientRects().length && !el.disabled && el.getAttribute('aria-disabled') !== 'true') toggles.push(el); continue; }
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
      out.push(f);
    }
    out.push(...toggleFields(toggles));
    // Final tidy of every field: group/label overlap, date part, display name, stable fingerprint.
    out.forEach((f) => {
      if (f.group && U.norm(f.group) === U.norm(f.label)) f.group = '';
      f.part = f.kind === 'text' || f.kind === 'select' ? partOf(f.el, f.label) : '';
      f.display = f.group ? f.group + ' › ' + f.label : f.label;
      let fp = U.norm(f.display);
      if (seenFp[fp]) { seenFp[fp]++; fp += ' #' + seenFp[fp]; } else seenFp[fp] = 1;
      f.fp = fp;
    });
    return out;
  }

  function current(f) {
    if (f.kind === 'radio') { const o = f.options.find((x) => isOn(x.el)); return o ? o.text : ''; }
    if (f.kind === 'checkbox') return isOn(f.el) ? 'yes' : 'no';
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Click a checkbox / radio / toggle button and make sure it really changed; try harder if not.
  async function press(el, want) {
    if (isOn(el) === want) return true;
    el.click(); await sleep(80);
    if (isOn(el) === want) return true;
    const lab = el.labels && el.labels[0];
    if (lab) { lab.click(); await sleep(80); if (isOn(el) === want) return true; }
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    await sleep(80);
    if (isOn(el) === want) return true;
    if (!el.matches('input')) {
      for (const t of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: ' ', code: 'Space', bubbles: true }));
      await sleep(80);
    }
    return isOn(el) === want;
  }

  async function applyValue(f, value) {
    const c = candidatesFor(f, value);
    if (f.kind === 'text') { setNative(f.el, c[0]); fire(f.el); return 'filled'; }
    if (f.kind === 'checkbox') return (await press(f.el, U.isTruthy(value))) ? 'filled' : 'nomatch';
    if (f.kind === 'select') {
      const i = U.pickOption(f.options, c);
      if (i < 0) return 'nomatch';
      setNative(f.el, f.options[i].value); f.el.selectedIndex = i; fire(f.el); return 'filled';
    }
    if (f.kind === 'radio') {
      const i = U.pickOption(f.options, c);
      if (i < 0) return 'nomatch';
      return (await press(f.options[i].el, true)) ? 'filled' : 'nomatch';
    }
    return 'skipped';
  }


  // ---------- Talking to the side panel ----------
  let fields = [];
  const pageHeading = () => { const h = document.querySelector('h1'); return h ? txt(h) : document.title; };
  // The section the page belongs to, from the numbered step bar at the top of UKVI forms
  // ("1. Start  2. Application  3. Finance ..."): the step that is marked current, or failing that, the bold one.
  const stepRe = /^\s*\d{1,2}\s*[.):]?\s+\S/;
  const curClass = /(^|[\s_-])(active|current|selected)($|[\s_-])/i; // not "inactive"
  const marked = (e) => (e.hasAttribute('aria-current') && e.getAttribute('aria-current') !== 'false') || e.getAttribute('aria-selected') === 'true' || curClass.test(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '');
  const isCurrent = (li) => marked(li) || [...li.querySelectorAll('*')].some(marked);
  // Text a sighted user sees (drops "visually hidden" screen-reader extras such as " - current step").
  const seen = (node) => { const c = node.cloneNode(true); c.querySelectorAll('.visuallyhidden, .govuk-visually-hidden, .sr-only').forEach((n) => n.remove()); return txt(c); };
  function pageSection() {
    // UKVI's own step bar: <li class="current"><a data-nav-position="1 of 7: ">Start</a></li>. The number is in the
    // attribute (drawn by CSS), not the text, and on narrow windows only the current step is shown.
    const navs = [...document.querySelectorAll('[data-nav-position]')].filter((a) => /^\s*\d{1,2}\s+of\s+\d/.test(a.getAttribute('data-nav-position')));
    if (navs.length >= 2) {
      const cur = navs.find((a) => isCurrent(a.closest('li') || a) || /current step/i.test(a.textContent));
      if (cur) return { num: parseInt(cur.getAttribute('data-nav-position'), 10), name: seen(cur).slice(0, 80) };
    }
    const lists = [...document.querySelectorAll('ol, ul, [role=tablist]')].filter((l) => l.getClientRects().length);
    for (const l of lists) {
      const items = [...l.children].filter((c) => c.getClientRects().length);
      if (items.length < 3 || items.filter((c) => stepRe.test(txt(c))).length < items.length * 0.6) continue;
      let cur = items.find(isCurrent);
      if (!cur) {
        const w = items.map((c) => { const a = c.querySelector('a, span, button') || c; return parseInt(getComputedStyle(a).fontWeight, 10) || 400; });
        const max = Math.max(...w);
        if (w.filter((x) => x === max).length === 1 && max > Math.min(...w)) cur = items[w.indexOf(max)];
      }
      if (cur) { const t = seen(cur), m = t.match(/^\s*(\d{1,2})\s*[.):]?\s+(.*)$/); return m ? { num: +m[1], name: m[2].slice(0, 80) } : null; }
    }
    return null;
  }
  // The small section caption GOV.UK pages show above the heading (e.g. "Section 2 of 6: Your details").
  const pageCaption = () => {
    const c = document.querySelector('.govuk-caption-xl, .govuk-caption-l, .govuk-caption-m');
    return c ? txt(c).slice(0, 120) : '';
  };
  const describe = (f, id) => ({ id, kind: f.kind, inputType: f.inputType || '', label: f.label, group: f.group, part: f.part, display: f.display, fp: f.fp,
    options: (f.options || []).map((o) => ({ text: o.text })), cur: current(f) });

  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !m || m.to !== 'agent') return;
    if (m.type === 'scan') {
      fields = scan();
      reply({ url: location.origin + location.pathname, href: location.href, heading: pageHeading(), caption: pageCaption(), section: pageSection(), fields: fields.map(describe) });
    } else if (m.type === 'apply') {
      (async () => {
        const out = [];
        for (const it of m.items) {
          const f = fields[it.id];
          out.push({ id: it.id, status: f ? await applyValue(f, it.value) : 'gone' });
        }
        reply(out);
      })();
      return true;
    } else if (m.type === 'flash') {
      const f = fields[m.id];
      if (f) {
        const t = f.el;
        if (m.on) { t.__ukviOutline = t.style.outline; t.style.outline = '3px solid #E9A843'; t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        else t.style.outline = t.__ukviOutline || '';
      }
      reply(true);
    }
  });
  window.__ukviAgent = true;
})();

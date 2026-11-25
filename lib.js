/* UKVI Form Helper – shared logic (used by the page panel and the options page).
   Pure functions + chrome.storage.local. No network access of any kind. */
(function (root) {
  'use strict';
  if (root.UKVI) return;
  const U = {};

  // ---- Text normalising and fuzzy matching ----
  const STOP = new Set(['the', 'of', 'your', 'you', 'a', 'an', 'is', 'are', 'what', 'do', 'does', 'doe', 'please', 'enter',
    'in', 'on', 'for', 'to', 'and', 'or', 'if', 'any', 'as', 'at', 'by', 'with', 'this', 'that', 'have', 'has', 'been',
    'was', 'were', 'will', 'be', 'it', 's', 'their', 'his', 'her', 'e', 'g', 'eg', 'optional', 'required', 'must',
    'should', 'can', 'provide', 'legal', 'as', 'shown', 'exactly', 'select', 'choose']);
  const SYN = {
    surname: 'family', last: 'family', family: 'family', forename: 'given', first: 'given', given: 'given', christian: 'given',
    mobile: 'phone', telephone: 'phone', tel: 'phone', phone: 'phone', zip: 'postcode', gender: 'sex',
    citizenship: 'nationality', born: 'birth', advisor: 'adviser', representative: 'adviser', agent: 'adviser',
    solicitor: 'adviser', organization: 'organisation', company: 'organisation', firm: 'organisation', town: 'city',
    postal: 'post', no: 'number', num: 'number', nr: 'number', ref: 'reference'
  };
  const EXPAND = { dob: ['date', 'birth'] };
  const PARTS = new Set(['day', 'month', 'year']);
  const CONTEXT_WORDS = new Set(['partner', 'spouse', 'child', 'children', 'son', 'daughter', 'sponsor', 'father', 'mother',
    'parent', 'dependant', 'dependent', 'employer', 'previous', 'former', 'other', 'relative', 'witness', 'wife', 'husband']);

  U.norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  U.slug = (s) => U.norm(s).replace(/ /g, '_');
  U.humanise = (key) => { const t = String(key || '').replace(/[_\-.]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

  U.tokens = (s, dropParts) => {
    s = String(s || '').toLowerCase()
      .replace(/\be[\s-]?mail\b/g, 'email').replace(/\bpost[\s-]?code\b/g, 'postcode').replace(/\bpostal code\b/g, 'postcode')
      .replace(/\bline\s*(\d)\b/g, 'line$1');
    const out = [];
    for (let w of U.norm(s).split(' ')) {
      if (!w) continue;
      if (dropParts && PARTS.has(w)) continue;
      if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
      if (STOP.has(w)) continue;
      if (EXPAND[w]) { out.push(...EXPAND[w]); continue; }
      out.push(SYN[w] || w);
    }
    return Array.from(new Set(out));
  };

  // ---- Starter vocabulary (the names the tool uses for data items) ----
  const V = (kind, key, label, aliases, type) => ({ kind, key, label, aliases: aliases || [], type: type || 'text' });
  U.vocab = [
    V('case', 'given_names', 'Given names', ['first name', 'forenames', 'first names', 'christian names']),
    V('case', 'family_name', 'Family name', ['surname', 'last name']),
    V('case', 'full_name', 'Full name', ['name', 'applicant name', 'client name']),
    V('case', 'title', 'Title', ['salutation']),
    V('case', 'sex', 'Sex', ['gender']),
    V('case', 'dob', 'Date of birth', ['birth date', 'dob'], 'date'),
    V('case', 'place_of_birth', 'Place of birth', ['town of birth', 'city of birth', 'birth place', 'town or city of birth']),
    V('case', 'country_of_birth', 'Country of birth', []),
    V('case', 'nationality', 'Nationality', ['citizenship', 'country of nationality']),
    V('case', 'marital_status', 'Marital status', ['relationship status']),
    V('case', 'passport_number', 'Passport number', ['travel document number', 'passport or travel document number', 'document number']),
    V('case', 'passport_issue_date', 'Passport issue date', ['date of issue', 'date issued', 'passport date of issue'], 'date'),
    V('case', 'passport_expiry_date', 'Passport expiry date', ['date of expiry', 'expiry date', 'passport valid until'], 'date'),
    V('case', 'passport_issuing_authority', 'Passport issuing authority', ['issued by', 'place of issue', 'issuing authority', 'country of issue']),
    V('case', 'home_office_ref', 'Home Office reference', ['home office reference number', 'ho ref', 'file reference']),
    V('case', 'ukvi_ref', 'UKVI reference (UAN)', ['unique application number', 'uan', 'ukvi account number', 'application reference']),
    V('case', 'gwf_ref', 'GWF reference', ['global web form reference', 'gwf number']),
    V('case', 'nino', 'National Insurance number', ['ni number', 'nino']),
    V('case', 'email', 'Email', ['email address']),
    V('case', 'phone', 'Phone', ['telephone number', 'phone number', 'contact number', 'mobile number']),
    V('case', 'address_line1', 'Address line 1', ['house number and street', 'building and street', 'street address', 'address 1']),
    V('case', 'address_line2', 'Address line 2', ['address 2']),
    V('case', 'town', 'Town or city', ['city']),
    V('case', 'county', 'County', ['region', 'state or province']),
    V('case', 'postcode', 'Postcode', ['post code', 'zip code']),
    V('case', 'country', 'Country', []),
    V('case', 'date_entered_uk', 'Date entered UK', ['date of arrival in the uk', 'date you arrived in the uk'], 'date'),
    V('case', 'immigration_status', 'Immigration status', ['current immigration status', 'leave type']),
    V('case', 'case_ref', 'Internal case reference', ['file number', 'matter number', 'client reference', 'case reference']),
    V('adviser', 'adviser_name', 'Adviser name', ['name of adviser', 'adviser full name']),
    V('adviser', 'adviser_given_names', 'Adviser given names', ['adviser first name']),
    V('adviser', 'adviser_family_name', 'Adviser family name', ['adviser surname', 'adviser last name']),
    V('adviser', 'adviser_job_title', 'Adviser job title', ['adviser role', 'adviser position']),
    V('adviser', 'adviser_organisation', 'Organisation', ['adviser organisation', 'organisation name', 'adviser company name']),
    V('adviser', 'oisc_number', 'OISC number', ['oisc registration number', 'oisc reference', 'adviser registration number']),
    V('adviser', 'adviser_email', 'Adviser email', ['adviser email address']),
    V('adviser', 'adviser_phone', 'Adviser phone', ['adviser telephone number', 'adviser contact number']),
    V('adviser', 'adviser_address_line1', 'Adviser address line 1', ['adviser building and street']),
    V('adviser', 'adviser_address_line2', 'Adviser address line 2', []),
    V('adviser', 'adviser_town', 'Adviser town or city', ['adviser city']),
    V('adviser', 'adviser_postcode', 'Adviser postcode', ['adviser post code']),
    V('adviser', 'adviser_country', 'Adviser country', [])
  ];
  const vocabByKey = {};
  U.vocab.forEach((v) => { vocabByKey[v.kind + ':' + v.key] = v; v._c = [v.label].concat(v.aliases).map((a) => U.tokens(a)).filter((t) => t.length); });

  // All selectable entries for a kind: the vocabulary plus any extra keys found in saved data.
  U.entries = (db, kind) => {
    const out = U.vocab.filter((v) => v.kind === kind).map((v) => ({ kind, key: v.key, label: v.label, type: v.type, v }));
    const known = new Set(out.map((e) => e.key));
    const extra = new Set();
    if (kind === 'adviser') Object.keys(db.adviser || {}).forEach((k) => extra.add(k));
    else Object.values(db.cases || {}).forEach((c) => Object.keys(c.data || {}).forEach((k) => extra.add(k)));
    extra.forEach((k) => { if (!known.has(k)) out.push({ kind, key: k, label: U.humanise(k), type: 'text', v: null }); });
    return out;
  };

  const entryTokens = (e) => (e.v ? e.v._c : [U.tokens(e.label)].filter((t) => t.length));

  U.score = (A, B, entryKind) => {
    if (!A.length || !B.length) return 0;
    const setB = new Set(B); let inter = 0;
    A.forEach((t) => { if (setB.has(t)) inter++; });
    if (!inter) return 0;
    let s = 0.75 * (inter / B.length) + 0.25 * (inter / A.length);
    const hasCtx = A.some((t) => CONTEXT_WORDS.has(t)) && !B.some((t) => CONTEXT_WORDS.has(t));
    if (hasCtx) s *= 0.4;
    if (entryKind === 'case' && A.includes('adviser')) s *= 0.4;
    return s;
  };

  // Best vocabulary/data-key match for a label. Returns {entry, score} or null.
  U.bestMatch = (label, entries, dropParts) => {
    const A = U.tokens(label, dropParts);
    let best = null;
    for (const e of entries) {
      for (const B of entryTokens(e)) {
        const s = U.score(A, B, e.kind);
        if (!best || s > best.score) best = { entry: e, score: s };
      }
    }
    return best;
  };

  // ---- Dates ----
  const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  U.MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => (n < 10 ? '0' : '') + n;
  U.parseDate = (s) => {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    let d, m, y, x;
    if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s))) { y = +x[1]; m = +x[2]; d = +x[3]; }
    else if ((x = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T].*)?$/.exec(s))) { d = +x[1]; m = +x[2]; y = +x[3]; }
    else if ((x = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s))) { d = +x[1]; m = MONTHS[x[2].toLowerCase()]; y = +x[3]; }
    else return null;
    if (!m || m < 1 || m > 12 || d < 1 || y < 1000) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  };
  U.ukDate = (iso) => { const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return x ? x[3] + '/' + x[2] + '/' + x[1] : iso; };
  U.datePart = (iso, part) => {
    const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!x) return null;
    return part === 'day' ? +x[3] : part === 'month' ? +x[2] : +x[1];
  };

  // ---- CSV ----
  U.csvParse = (text) => {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  };

  // ---- Import (JSON or CSV exported from the case management system) ----
  const ID_KEYS = ['id', 'case_id', 'case_ref', 'caseref', 'reference', 'ref', 'file_number', 'matter_number'];
  const flatten = (o, prefix, out) => {
    out = out || {};
    for (const [k, v] of Object.entries(o || {})) {
      const key = prefix ? prefix + '_' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else if (Array.isArray(v)) out[key] = v.join(', ');
      else if (v !== null && v !== undefined && String(v).trim() !== '') out[key] = String(v).trim();
    }
    return out;
  };
  const toRecord = (rec, idx) => {
    let data, id, label;
    if (rec && typeof rec.data === 'object' && rec.data) { data = flatten(rec.data); id = rec.id; label = rec.label; }
    else { data = flatten(rec); }
    if (!id) for (const k of Object.keys(data)) if (ID_KEYS.includes(U.slug(k))) { id = data[k]; break; }
    return { id: id ? String(id) : 'row' + (idx + 1), label: label || '', raw: data };
  };
  U.parseImport = (text) => {
    const t = String(text || '').trim();
    if (!t) throw new Error('Nothing to import.');
    const res = { kind: '', cases: [], adviser: null, importMaps: null };
    if (/^[\[{]/.test(t)) {
      res.kind = 'json';
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('That is not valid JSON: ' + e.message); }
      let list;
      if (Array.isArray(j)) list = j;
      else if (j && typeof j === 'object' && (j.cases || j.adviser || j.importMaps)) {
        list = Array.isArray(j.cases) ? j.cases : [];
        if (j.adviser) res.adviser = flatten(j.adviser);
        if (j.importMaps && typeof j.importMaps === 'object') res.importMaps = j.importMaps;
      } else list = [j];
      res.cases = list.map(toRecord);
    } else {
      res.kind = 'csv';
      const rows = U.csvParse(t);
      if (rows.length < 2) throw new Error('A CSV needs a header row and at least one data row.');
      const headers = rows[0].map((h) => h.trim());
      res.cases = rows.slice(1).map((r, i) => {
        const o = {}; headers.forEach((h, c) => { if (h && r[c] !== undefined && String(r[c]).trim() !== '') o[h] = String(r[c]).trim(); });
        return toRecord(o, i);
      });
    }
    return res;
  };

  // Decide which data key each incoming column/field name becomes.
  // how: 'learned' (you mapped it before) | 'known' (matches a standard item) | 'guess' | 'new'
  U.resolveKeys = (rawKeys, kind, db, extraMaps) => {
    const entries = U.entries(db, kind), out = {};
    const maps = Object.assign({}, db.importMaps || {}, extraMaps || {});
    for (const raw of rawKeys) {
      const n = U.norm(raw);
      const learned = Object.entries(maps).find(([k]) => U.norm(k) === n);
      if (learned) { out[raw] = { key: learned[1], how: 'learned' }; continue; }
      const direct = entries.find((e) => e.key === U.slug(raw) || U.norm(e.label) === n);
      if (direct) { out[raw] = { key: direct.key, how: 'known' }; continue; }
      const m = U.bestMatch(raw, entries.filter((e) => e.v));
      if (m && m.score >= 0.85) out[raw] = { key: m.entry.key, how: 'guess' };
      else out[raw] = { key: U.slug(raw), how: 'new' };
    }
    return out;
  };

  U.convertRecord = (raw, resolved, kind) => {
    const data = {};
    for (const [rk, v] of Object.entries(raw)) {
      const r = resolved[rk]; if (!r || !r.key) continue;
      const vocab = vocabByKey[kind + ':' + r.key];
      let val = v;
      const iso = U.parseDate(v);
      if (iso && ((vocab && vocab.type === 'date') || /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}$/.test(String(v).trim()))) val = iso;
      data[r.key] = val;
    }
    return data;
  };

  U.caseLabel = (c, id) => {
    const d = c.data || {};
    const nm = d.family_name ? (d.family_name + (d.given_names ? ', ' + d.given_names : '')) : (d.full_name || '');
    return c.label || nm || id;
  };

  // ---- Stored data ----
  U.defaultDb = () => ({ version: 1, caseTemplates: { common: { name: 'Common to all forms', builtin: true, items: {} } }, pageTemplates: {}, prefs: { lastTemplates: ['common'] }, adviser: {}, cases: {}, currentCase: null, mappings: {}, tmplMappings: {}, defaults: {}, templates: {}, importMaps: {} });
  U.load = async () => { const r = await chrome.storage.local.get('db'); return U.ensureTemplates(Object.assign(U.defaultDb(), (r && r.db) || {})); };
  U.save = async (db) => { await chrome.storage.local.set({ db }); };

  // Turn a mapping reference ('case:dob' | 'adviser:oisc_number' | 'default' | 'none') into a value.
  U.refValue = (ref, db, fp) => {
    if (!ref || ref === 'none') return '';
    if (ref === 'default') { const d = (db.defaults || {})[fp]; return d && d.length ? d[0].v : ''; }
    const i = ref.indexOf(':'), kind = ref.slice(0, i), key = ref.slice(i + 1);
    if (kind === 'adviser') return (db.adviser || {})[key] || '';
    const c = (db.cases || {})[db.currentCase];
    return (c && c.data && c.data[key]) || '';
  };
  U.refLabel = (ref, db) => {
    if (ref === 'default') return 'Default';
    if (!ref || ref === 'none') return 'Skip';
    const i = ref.indexOf(':'), kind = ref.slice(0, i), key = ref.slice(i + 1);
    const e = U.entries(db, kind).find((x) => x.key === key);
    return (kind === 'adviser' ? 'Adviser: ' : 'Case: ') + (e ? e.label : U.humanise(key));
  };
  // ---- Form export: the saved pages of a template as one working copy of the form, in form order ----
  // Sections in step order, pages in capture order, each question with real answer boxes and options to try out.
  // A follow-up question sits under the answer that opens it and appears only when that answer is chosen.
  // Shows where the tool's answer comes from and learned default text, but never case or adviser values.
  U.formExport = (db, title, pages) => {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const prompt = /^\s*(-+\s*)?((please\s+)?(select|choose)\b.*|-+)\s*$/i;
    const opts = (f) => (f.options || []).filter((o) => o && !prompt.test(o));
    const groupOf = (f) => f.group != null && f.group !== '' ? f.group : (f.label.includes(' › ') ? f.label.slice(0, f.label.lastIndexOf(' › ')) : '');
    const own = (f) => f.label.includes(' › ') ? f.label.slice(f.label.lastIndexOf(' › ') + 3) : f.label;
    const shownLabel = (f, byFp) => { const par = f.showIf && byFp.get(f.showIf.fp); return par && groupOf(f) && U.norm(groupOf(f)) === U.norm(par.fs[0].label) ? own(f) : f.label; };
    const isPart = (f) => ['day', 'month', 'year'].includes(f.part);
    const source = (pid, f) => {
      const tm = db.tmplMappings[pid] || {};
      const ref = tm[f.fp] !== undefined ? tm[f.fp] : (db.mappings[f.fp] || 'none');
      if (ref === 'none') return '';
      if (ref === 'default') { const d = (db.defaults || {})[f.fp]; return d && d.length ? 'Default: ' + d[0].v : 'Default'; }
      return U.refLabel(ref, db);
    };
    let qn = 0;
    function page(pid, p) {
      // Questions: one per field, Day / Month / Year runs joined into one date question.
      const fs = p.fields || [], qs = [];
      for (let i = 0; i < fs.length; i++) {
        const run = [fs[i]];
        if (isPart(fs[i])) while (i + 1 < fs.length && isPart(fs[i + 1]) && groupOf(fs[i + 1]) === groupOf(fs[i]) && !run.some((x) => x.part === fs[i + 1].part)) run.push(fs[++i]);
        qs.push({ fs: run, name: 'q' + (++qn), kids: [] });
      }
      const byFp = new Map(); qs.forEach((q) => q.fs.forEach((f) => byFp.set(f.fp, q)));
      const top = [];
      qs.forEach((q) => { const s = q.fs[0].showIf, par = s && byFp.get(s.fp); if (par && par !== q) par.kids.push(q); else top.push(q); });
      const tag = (f) => { const s = source(pid, f); return s ? '<span class="src">' + esc(s) + '</span>' : ''; };
      function render(q) {
        const f = q.fs[0], id = q.name;
        let html;
        if (q.fs.length > 1) {
          html = '<fieldset class="q"><legend class="ql">' + esc(groupOf(f)) + tag(f) + '</legend><div class="date">' +
            q.fs.map((p, k) => '<label><span>' + esc(own(p)) + '</span><input class="' + (p.part === 'year' ? 'yr' : 'dm') + '" name="' + id + '_' + k + '" inputmode="numeric"></label>').join('') + '</div></fieldset>';
        } else if (f.kind === 'checkbox') {
          html = '<div class="q"><label class="opt"><input type="checkbox" name="' + id + '" value="yes">' + esc(f.label) + tag(f) + '</label></div>';
        } else if (f.kind === 'radio') {
          html = '<fieldset class="q"><legend class="ql">' + esc(f.label) + tag(f) + '</legend><div class="opts">' +
            opts(f).map((o) => '<label class="opt"><input type="radio" name="' + id + '" value="' + esc(o) + '">' + esc(o) + '</label>').join('') + '</div></fieldset>';
        } else if (f.kind === 'select') {
          const o = opts(f);
          html = '<div class="q"><label class="ql" for="' + id + '">' + esc(f.label) + tag(f) + '</label><select id="' + id + '" name="' + id + '"><option value=""></option>' +
            o.map((x) => '<option>' + esc(x) + '</option>').join('') + '</select>' + (o.length > 12 ? '<details class="all"><summary>' + o.length + ' options</summary><ul class="list cols">' + o.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></details>' : '') + '</div>';
        } else {
          const t = f.inputType === 'textarea' ? '<textarea id="' + id + '" name="' + id + '" rows="4"></textarea>'
            : '<input id="' + id + '" name="' + id + '" type="' + (/^(email|tel|number|date)$/.test(f.inputType || '') ? f.inputType + '" class="mid' : 'text') + '">';
          html = '<div class="q"><label class="ql" for="' + id + '">' + esc(shownLabel(f, byFp)) + tag(f) + '</label>' + t + '</div>';
        }
        // Follow-ups: grouped by the answer that opens them, shown under this question.
        const byAns = new Map(); q.kids.forEach((k) => { const a = k.fs[0].showIf.a; if (!byAns.has(a)) byAns.set(a, []); byAns.get(a).push(k); });
        byAns.forEach((ks, a) => { html += '<div class="cond" data-if="' + id + '" data-a="' + esc(a) + '"><div class="when">' + esc(a) + '</div>' + ks.map(render).join('') + '</div>'; });
        return html;
      }
      return top.map(render).join('');
    }
    const groups = new Map();
    pages.forEach(([pid, p]) => { const k = p.section ? 'n' + p.section.num : 'none'; if (!groups.has(k)) groups.set(k, { sec: p.section || null, pages: [] }); groups.get(k).pages.push([pid, p]); });
    const order = [...groups.values()].sort((a, b) => (a.sec ? a.sec.num : 999) - (b.sec ? b.sec.num : 999));
    let n = 0;
    const toc = order.map((g) => '<li><b>' + esc(g.sec ? g.sec.num + '. ' + g.sec.name : 'Other pages') + '</b><ol>' + g.pages.map(([, p]) => '<li><a href="#p' + (++n) + '">' + esc(p.title || 'Page') + '</a></li>').join('') + '</ol></li>').join('');
    n = 0;
    const body = order.map((g) => '<section><h2><span class="num">' + esc(g.sec ? g.sec.num : '·') + '</span>' + esc(g.sec ? g.sec.name : 'Other pages') + '</h2>' +
      g.pages.map(([pid, p]) => '<article id="p' + (++n) + '">' + (p.caption ? '<div class="cap">' + esc(p.caption) + '</div>' : '') + '<h3>' + esc(p.title || 'Page') + '</h3>' + page(pid, p) + '</article>').join('') + '</section>').join('');
    const css = `body{font:16px/1.45 system-ui,"Segoe UI",Arial,sans-serif;color:#0b0c0c;max-width:760px;margin:0 auto;padding:32px 20px 60px}
h1{font-size:2rem;margin:0 0 4px}.sub{color:#505a5f;margin:0 0 24px}nav{border:1px solid #b1b4b6;padding:12px 20px;margin-bottom:32px}
nav ol{margin:4px 0 10px;padding-left:22px}nav>ol{padding-left:0;list-style:none}a{color:#1d70b8}
h2{font-size:1.5rem;margin:40px 0 16px;padding-bottom:8px;border-bottom:4px solid #1D3B2F;display:flex;gap:12px;align-items:center}
.num{display:inline-grid;place-items:center;min-width:34px;height:34px;border-radius:6px;background:#1D3B2F;color:#E9A843;font-size:1.1rem}
article{border-left:4px solid #E9A843;padding:4px 0 4px 18px;margin:0 0 28px}
.cap{color:#505a5f}h3{font-size:1.35rem;margin:2px 0 14px}
fieldset{border:0;padding:0;margin:0;min-width:0}.q{margin:0 0 22px;break-inside:avoid}.ql{display:block;font-weight:700;margin-bottom:6px;padding:0}
.src{display:inline-block;margin-left:8px;font-weight:400;font-size:.8rem;color:#505a5f;background:#f3f2f1;border-radius:10px;padding:1px 8px;vertical-align:1px}
input[type=text],input[type=email],input[type=tel],input[type=number],input[type=date],input:not([type]),select,textarea{font:inherit;border:2px solid #0b0c0c;padding:5px 6px;width:100%;max-width:440px;box-sizing:border-box}
input.mid,select{max-width:300px}textarea{max-width:none}input.dm{width:56px}input.yr{width:84px}
input:focus,select:focus,textarea:focus{outline:3px solid #E9A843;outline-offset:0}
.date{display:flex;gap:16px}.date span{display:block;font-size:.9rem}
.opts{display:grid;gap:8px}.opt{display:flex;gap:10px;align-items:center;cursor:pointer}
.opt input{width:26px;height:26px;margin:0;accent-color:#1D3B2F;flex:none}
.cond{margin:6px 0 18px 12px;padding:8px 0 2px 20px;border-left:4px solid #b1b4b6}
.when{display:inline-block;margin-bottom:10px;font-size:.8rem;font-weight:700;color:#1D3B2F;background:#f8ede0;border-radius:10px;padding:1px 9px}
.when::before{content:"";display:inline-block;width:8px;height:8px;margin:0 5px 0 1px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;border-bottom-left-radius:3px;vertical-align:2px}
.all{margin-top:6px;color:#505a5f;font-size:.9rem}.list{margin:6px 0 0;padding-left:20px}.list.cols{columns:3}
.tools{display:flex;gap:10px;margin:0 0 20px}.tools button{font:inherit;font-weight:700;border:0;border-radius:4px;padding:6px 14px;background:#1D3B2F;color:#E9A843;cursor:pointer}
.tools button+button{background:#f3f2f1;color:#0b0c0c}
@media print{body{padding:0}.tools,nav{display:none}}`;
    const js = `(function(){function ans(c){return[...document.getElementsByName(c.dataset.if)].some(function(i){return(i.type==='radio'||i.type==='checkbox')?i.checked&&i.value===c.dataset.a:i.value===c.dataset.a})}
function upd(){document.querySelectorAll('.cond').forEach(function(c){c.hidden=!ans(c)})}
document.addEventListener('change',upd);document.addEventListener('input',upd);
document.getElementById('clear').addEventListener('click',function(){document.querySelectorAll('input,select,textarea').forEach(function(i){if(i.type==='radio'||i.type==='checkbox')i.checked=false;else i.value=''});upd()});
document.getElementById('print').addEventListener('click',function(){window.print()});upd()})();`;
    return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body>' +
      '<h1>' + esc(title) + '</h1><p class="sub">' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + ' · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '</p>' +
      '<div class="tools"><button id="print" type="button">Print</button><button id="clear" type="button">Clear answers</button></div>' +
      '<nav><ol>' + toc + '</ol></nav><form onsubmit="return false">' + body + '</form><script>' + js + '<\/script></body></html>';
  };
  U.addDefault = (db, fp, value) => {
    value = String(value || '').trim(); if (!value) return;
    const list = (db.defaults[fp] = db.defaults[fp] || []);
    const hit = list.find((x) => x.v === value);
    if (hit) { hit.n++; hit.t = Date.now(); } else list.push({ v: value, n: 1, t: Date.now() });
    list.sort((a, b) => b.n - a.n || b.t - a.t);
    if (list.length > 6) list.length = 6;
  };

  // ---- Case templates: named lists of the client information a set of forms needs ----
  // db.caseTemplates[id] = { name, builtin?, items: { [key]: { label, forms: { [pageId]: { title, fields: [] } }, manual? } } }
  // "common" is the built-in one for values shared by all forms.
  U.ensureTemplates = (db) => {
    db.caseTemplates = db.caseTemplates || {};
    if (!db.caseTemplates.common) db.caseTemplates = Object.assign({ common: { name: 'Common to all forms', builtin: true, items: {} } }, db.caseTemplates);
    db.caseTemplates.common.builtin = true;
    if (db.caseTemplate && db.caseTemplate.items) { // v0.3 single template -> common
      Object.entries(db.caseTemplate.items).forEach(([k, it]) => { if (!db.caseTemplates.common.items[k]) db.caseTemplates.common.items[k] = it; });
    }
    delete db.caseTemplate;
    Object.values(db.caseTemplates).forEach((t) => { t.items = t.items || {}; });
    db.pageTemplates = db.pageTemplates || {};
    db.prefs = Object.assign({ lastTemplates: ['common'] }, db.prefs);
    return db;
  };
  U.newTemplate = (db, name) => {
    name = String(name || '').trim(); if (!name) return null;
    let id = U.slug(name) || 'template', n = 2, base = id;
    while (db.caseTemplates[id]) id = base + '_' + n++;
    db.caseTemplates[id] = { name, items: {} };
    return id;
  };
  U.addToTemplate = (db, templateId, pageId, title, uses) => {
    const t = db.caseTemplates[templateId]; if (!t) return 0;
    let added = 0;
    uses.forEach(({ key, fieldLabel }) => {
      if (!t.items[key]) { const e = U.entries(db, 'case').find((x) => x.key === key); t.items[key] = { label: e ? e.label : U.humanise(key), forms: {} }; added++; }
      const f = (t.items[key].forms[pageId] = t.items[key].forms[pageId] || { title, fields: [] });
      f.title = title; if (!f.fields.includes(fieldLabel)) f.fields.push(fieldLabel);
    });
    return added;
  };
  // Take one page out of one case template (the page stays saved for its other templates).
  U.removeFormFromTemplate = (db, templateId, pageId) => {
    const t = db.caseTemplates[templateId];
    if (t) Object.entries(t.items).forEach(([k, it]) => { delete it.forms[pageId]; if (!Object.keys(it.forms).length && !it.manual) delete t.items[k]; });
    if (db.pageTemplates[pageId]) db.pageTemplates[pageId] = db.pageTemplates[pageId].filter((x) => x !== templateId);
  };
  // Forget a saved page everywhere: its layout, its field links and its place in every template.
  U.forgetPage = (db, pageId) => { delete db.templates[pageId]; delete db.tmplMappings[pageId]; U.removeFormFromTemplates(db, pageId); };
  U.removeFormFromTemplates = (db, pageId) => {
    Object.values(db.caseTemplates).forEach((t) => Object.entries(t.items).forEach(([k, it]) => {
      delete it.forms[pageId]; if (!Object.keys(it.forms).length && !it.manual) delete t.items[k];
    }));
    delete db.pageTemplates[pageId];
  };

  // Identify a form page: host + path (long ids replaced) + main heading.
  U.templateId = (url, heading) => {
    let u; try { u = new URL(url); } catch (e) { return String(url).slice(0, 200); }
    const path = u.pathname.split('/').map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d{4,}$/.test(seg) ? '*' : seg)).join('/');
    return (u.host + path + '#' + U.norm(heading).slice(0, 80)).slice(0, 300);
  };

  // ---- Option matching used when filling dropdowns and radio buttons ----
  const boolWord = (v) => { const n = U.norm(v); return /^(y|yes|true|1|checked|on)$/.test(n) ? 'yes' : /^(n|no|false|0|unchecked|off)$/.test(n) ? 'no' : null; };
  U.isTruthy = (v) => boolWord(v) === 'yes';
  U.pickOption = (opts, candidates) => {
    const texts = opts.map((o) => U.norm(o.text)), vals = opts.map((o) => U.norm(o.value));
    const cands = [];
    candidates.forEach((c) => { cands.push(U.norm(c)); const b = boolWord(c); if (b) cands.push(b); });
    for (const c of cands) { if (!c) continue; let i = texts.indexOf(c); if (i < 0) i = vals.indexOf(c); if (i >= 0) return i; }
    for (const c of cands) {
      if (c.length < 3) continue;
      let i = texts.findIndex((t) => t && t.startsWith(c)); if (i >= 0) return i;
      i = texts.findIndex((t) => t.length >= 3 && (t.includes(c) || c.includes(t))); if (i >= 0) return i;
    }
    return -1;
  };

  root.UKVI = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);

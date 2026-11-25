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

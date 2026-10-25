'use strict';
// Video-Zentrale – Oberfläche (ohne Framework)

const CATEGORIES = [['20', 'Gaming'], ['24', 'Unterhaltung'], ['22', 'Menschen & Blogs'], ['23', 'Comedy'],
  ['26', 'Praktische Tipps & Styling'], ['27', 'Bildung'], ['28', 'Wissenschaft & Technik'], ['17', 'Sport'],
  ['10', 'Musik'], ['1', 'Film & Animation'], ['2', 'Autos & Fahrzeuge'], ['19', 'Reisen & Events']];
const TABS = [
  ['posten', '📱 Zum Posten'],
  ['coach', '💡 Coach'],
  ['zahlen', '📈 Zahlen'],
  ['geschnitten', 'Zur Freigabe'],
  ['eingang', 'Eingang (roh)'],
  ['hochgeladen', 'Hochgeladen'],
  ['rohvideos', 'Rohvideos'],
  ['bibliothek', '📚 Bibliothek'],
  ['papierkorb', '🗑 Papierkorb'],
  ['einstellungen', 'Einstellungen'],
];

const INBOXES = ['eingang', 'eingang-profi'];
const inTab = (v, tab) => v.folder === tab || (tab === 'eingang' && v.folder === 'eingang-profi');
const FOLDER_NAMES = { papierkorb: 'Papierkorb', eingang: 'Eingang (roh)', 'eingang-profi': 'Eingang Profi (LinkedIn)', geschnitten: 'Zur Freigabe', hochgeladen: 'Hochgeladen', rohvideos: 'Rohvideos (Originale)' };
const S = { videos: [], busy: false, tab: 'geschnitten', search: '', channel: '', openId: null, settings: null, version: '',
  topic: '', month: '', group: (() => { try { return !!localStorage.getItem('vz-group'); } catch { return false; } })(), sel: new Set(), selMode: false, selTab: '',
  sort: (() => { try { return localStorage.getItem('vz-sort') || ''; } catch { return ''; } })() };
try { S.channel = localStorage.getItem('vz-channel') || ''; } catch { /* egal */ }
const app = document.getElementById('app');

// ---------- Hilfen ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

async function api(method, url, body, raw) {
  const opt = { method, headers: { 'X-Zentrale': '1' } };
  if (raw) { opt.body = raw; } else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/password')) { start(); throw new Error(j.error || 'Bitte anmelden.'); }
  if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
  return j;
}

let toastTimer;
function toast(text, bad) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 7000 : 3500);
}

const fmtDur = (s) => {
  if (!s) return '';
  s = Math.round(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
};
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2).replace('.', ',') + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mio.' : n >= 1e4 ? Math.round(n / 1e3) + ' Tsd.' : String(n || 0);
const fmtDate = (d) => d ? new Date(d).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '';
const isVertical = (v) => v.width && v.height && v.height > v.width;
const imgUrl = (v) => `/api/videos/${v.id}/image?v=${v.imageVersion || 0}`;

function copy(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => toast('Kopiert.'));
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
  ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast('Kopiert.'); } catch { toast('Kopieren nicht möglich – bitte markieren.', true); }
  ta.remove();
}

function hashtags(tags) {
  return String(tags || '').split(',').map((t) => t.trim().replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).map((t) => '#' + t).join(' ');
}

const profilesList = () => S.settings?.profiles || [];
const profileOf = (id) => profilesList().find((p) => p.id === id) || null;
// Kanal, in den das Video geht: eigene Wahl oder Vorschlag.
const channelOf = (v) => profileOf(v.channel) || profileOf(v.suggestion?.id);
const isPro = (p) => p?.type === 'linkedin'; // nur Download, professioneller Stil

function channelBadge(v) {
  const p = channelOf(v);
  if (!p) return null;
  const auto = !v.channel;
  const b = h('span', { class: 'chip channel' + (auto ? ' auto' : ''), title: auto ? 'Vorschlag – ' + (v.suggestion?.reason || '') : 'Kanal' },
    h('span', { class: 'dot' }), p.name, auto ? ' ?' : '');
  b.firstChild.style.background = p.color;
  b.style.borderColor = p.color;
  return b;
}

// Viral-Potenzial (Claude-Einschätzung 1–10)
function viralChip(v, big) {
  const x = v.viral;
  if (!x?.score) return null;
  const cls = x.score >= 8 ? 'hot' : x.score >= 5 ? 'warm' : 'cool';
  return h('span', { class: `chip viral ${cls}${big ? ' big' : ''}`, title: `Viral-Potenzial ${x.score}/10 – ${x.why || ''}${x.tip ? '\nTipp: ' + x.tip : ''}` },
    (x.score >= 8 ? '🔥 ' : x.score >= 5 ? '📈 ' : '') + x.score + '/10');
}

function stateChip(label, s) {
  const st = s?.state || 'none';
  if (st === 'none') return h('span', { class: 'chip' }, label + ': –');
  if (st === 'queued') return h('span', { class: 'chip run' }, label + ': wartet');
  if (st === 'uploading') return h('span', { class: 'chip run', title: s.note || '' }, `${label}: ${String(s.progress || 0).replace('.', ',')} %` + (s.note ? ' ⚠' : ''));
  if (st === 'processing') return h('span', { class: 'chip run' }, label + ': verarbeitet');
  if (st === 'error') return h('span', { class: 'chip bad', title: s.error || '' }, label + ': Fehler');
  if (st === 'unconfirmed') return h('span', { class: 'chip bad', title: s.note || '' }, label + ': unbestätigt');
  return h('span', { class: 'chip ok' }, label + ' ✓');
}

// ---------- Anmeldung ----------
async function start() {
  stopPolling();
  const s = await fetch('/api/session').then((r) => r.json());
  S.version = s.version;
  if (s.loggedIn) return boot();
  const err = h('div', { class: 'err' });
  const pw = h('input', { type: 'password', autocomplete: s.setup ? 'new-password' : 'current-password', placeholder: 'Passwort' });
  const pw2 = s.setup ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Passwort wiederholen' }) : null;
  const submit = async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      if (s.setup) {
        if (pw.value !== pw2.value) throw new Error('Passwörter stimmen nicht überein.');
        await api('POST', '/api/setup', { password: pw.value });
      } else await api('POST', '/api/login', { password: pw.value });
      boot();
    } catch (x) { err.textContent = x.message; }
  };
  app.replaceChildren(h('form', { class: 'login', onsubmit: submit },
    h('img', { src: 'icon.svg', width: 44, height: 44, alt: '' }),
    h('h1', {}, APP_NAME),
    h('p', { class: 'hint' }, s.setup ? 'Erster Start: lege ein Passwort fest (mind. 8 Zeichen).' : 'Bitte anmelden.'),
    pw, pw2 && h('div', { style: { height: '8px' } }), pw2,
    h('div', { style: { height: '12px' } }),
    h('button', { class: 'btn primary', type: 'submit' }, s.setup ? 'Passwort festlegen' : 'Anmelden'), err));
  pw.focus();
}

async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.has('tiktok')) {
    const r = q.get('tiktok');
    history.replaceState(null, '', '/' + location.hash);
    if (r === 'ok') toast('TikTok verbunden' + (q.get('kanal') ? ' für „' + q.get('kanal') + '“.' : '.')); else toast('TikTok: ' + r, true);
  }
  readHash();
  await Promise.all([refresh(), loadSettings(), loadVersion(), loadCaptionStyles()]);
  render();
  maybeShowChangelog();
  startPolling();
  bindDrop();
}

// ---------- Version & Was ist neu ----------
const APP_NAME = 'Micha\u2019s Video-Zentrale';
document.title = APP_NAME;
// Als App installierbar (Startbildschirm); Service Worker nur über https bzw. localhost
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
const isApp = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function installHint() {
  if (isApp()) return null;
  if (installPrompt) return h('button', { class: 'btn big primary', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; } }, '📲 Als App installieren');
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return h('p', { class: 'hint' }, ios ? '📲 Als App: unten auf „Teilen“ tippen → „Zum Home-Bildschirm“.' : '📲 Als App: im Browser-Menü (⋮) „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.');
}
async function loadVersion() { try { S.version = await api('GET', '/api/version'); } catch { S.version = null; } }
function versionText() {
  const v = S.version;
  if (!v) return '';
  return 'v' + v.version + (v.build ? ' · Build ' + v.build : '') + (v.date ? ' · ' + new Date(v.date).toLocaleDateString('de-DE') : '');
}
function versionChip() {
  const v = S.version;
  if (!v) return null;
  const upd = v.updateAvailable;
  return h('button', { class: 'vchip' + (upd ? ' upd' : ''), onclick: () => showChangelog(),
    title: upd ? `Update ${v.latest.version} verfügbar – in Unraid: Docker → „Check for Updates“ → „apply update“` : versionText() + (v.commit ? ' · ' + v.commit : '') },
    upd ? '⬆ Update ' + v.latest.version : 'v' + v.version);
}
function showChangelog(since) {
  const v = S.version;
  if (!v) return;
  const list = since ? v.changelog.filter((c) => newerVersion(c.version, since)) : v.changelog;
  const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) modal.remove(); } },
    h('div', { class: 'sheet narrow' },
      h('button', { class: 'close', onclick: () => modal.remove(), title: 'Schließen' }, '×'),
      h('h2', {}, since ? '🎉 Was ist neu' : 'Versionen'),
      h('p', { class: 'hint' }, APP_NAME + ' ' + versionText() + (v.commit ? ' · ' + v.commit : '')),
      v.updateAvailable ? h('p', { class: 'upd-text' }, `⬆ Version ${v.latest.version} ist verfügbar. In Unraid: Docker → „Check for Updates“ → „apply update“.`) : null,
      ...list.map((c) => h('div', { class: 'cl' }, h('b', {}, 'Version ' + c.version), h('span', { class: 'hint' }, ' · ' + c.date),
        h('ul', {}, c.items.map((i) => h('li', {}, i))))),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => modal.remove() }, 'OK'))));
  document.body.append(modal);
}
function newerVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
// Nach einem Update einmal zeigen, was neu ist (je Browser gemerkt)
function maybeShowChangelog() {
  const v = S.version;
  if (!v) return;
  let seen = '';
  try { seen = localStorage.getItem('vz-version') || ''; localStorage.setItem('vz-version', v.version); } catch { return; }
  if (seen && newerVersion(v.version, seen)) showChangelog(seen);
}

// ---------- Navigation ----------
function readHash() {
  const [tab, id] = location.hash.slice(1).split('/');
  if (tab === 'video' && id) S.openId = id;
  else { S.openId = null; S.tab = TABS.some((t) => t[0] === tab) ? tab : 'geschnitten'; }
}
window.addEventListener('hashchange', () => { readHash(); render(); });

function go(hash) { location.hash = hash === 'eingang-profi' ? 'eingang' : hash; }

// ---------- Daten ----------
async function refresh() {
  const j = await api('GET', '/api/videos');
  S.videos = j.videos.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  S.busy = j.busy;
}

let pollTimer = null;
function startPolling() {
  stopPolling();
  const tick = async () => {
    try {
      await refresh();
      if (S.openId) updateDetail(); else if (S.tab !== 'einstellungen') renderMain();
      updateCounts();
    } catch { /* still */ }
    const active = S.busy || S.videos.some((v) => ['queued', 'uploading', 'processing'].includes(v.yt?.state) || ['queued', 'uploading', 'processing'].includes(v.tt?.state)
      || ['queued', 'running'].includes(v.ai?.state) || ['queued', 'running'].includes(v.cut?.state) || ['queued', 'running'].includes(v.revise?.state));
    pollTimer = setTimeout(tick, active ? 2000 : 15000);
  };
  pollTimer = setTimeout(tick, 2000);
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

// ---------- Darstellung ----------
let mainEl, countEls = {};
function render() {
  countEls = {};
  const tabs = h('nav', { class: 'tabs' }, TABS.map(([id, label]) => {
    const c = ['einstellungen', 'coach', 'bibliothek', 'zahlen'].includes(id) ? null : h('span', { class: 'count' });
    if (c) countEls[id] = c;
    return h('button', { class: 'tab' + (S.tab === id && !S.openId ? ' on' : ''), onclick: () => go(id) }, label, c);
  }));
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'video/*,image/*,.json', class: 'hidden',
    onchange: (e) => { uploadFiles([...e.target.files]); e.target.value = ''; } });
  mainEl = h('main');
  // Handy/Tablet hochkant: Leiste unten mit den wichtigsten Bereichen, Rest unter „Mehr“
  const BOTTOM = [['posten', '📱', 'Posten'], ['geschnitten', '✅', 'Freigabe'], ['eingang', '📥', 'Eingang'], ['coach', '💡', 'Coach']];
  const bottom = h('nav', { class: 'bottomnav' }, BOTTOM.map(([id, icon, label]) => {
    const c = id === 'coach' ? null : h('span', { class: 'bcount' });
    if (c) countEls['b-' + id] = c;
    return h('button', { class: 'bn' + (S.tab === id && !S.openId ? ' on' : ''), onclick: () => go(id) }, h('span', { class: 'bi' }, icon, c), h('span', {}, label));
  }), h('button', { class: 'bn' + (['bibliothek', 'zahlen', 'hochgeladen', 'rohvideos', 'papierkorb', 'einstellungen'].includes(S.tab) && !S.openId ? ' on' : ''), onclick: () => moreSheet(fileInput) },
    h('span', { class: 'bi' }, '☰'), h('span', {}, 'Mehr')));
  app.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), h('span', { class: 'bname' }, APP_NAME)),
      tabs, h('div', { class: 'spacer' }),
      versionChip(),
      h('button', { class: 'btn upl-btn', onclick: () => fileInput.click(), title: 'Videos, Titelbilder oder .json hochladen' }, '⤒', h('span', { class: 'lbl' }, ' Hochladen')), fileInput),
    activityBar(), mainEl, bottom);
  updateCounts();
  renderMain();
  document.querySelector('.modal')?.remove();
  detail?.cleanup(); detail = null;
  if (S.openId) openDetail(S.openId);
}

function updateCounts() {
  for (const [key, el] of Object.entries(countEls)) {
    const id = key.replace(/^b-/, '');
    const n = id === 'posten' ? toPost().length : S.videos.filter((v) => inTab(v, id) && !v.missing).length;
    el.textContent = key.startsWith('b-') ? (n ? String(n) : '') : n;
  }
}

// „Mehr“ auf dem Handy: übrige Bereiche + Hochladen
function moreSheet(fileInput) {
  const close = () => modal.remove();
  const item = (id, label) => h('button', { class: 'btn big', onclick: () => { close(); go(id); } }, label);
  const modal = h('div', { class: 'modal sheetmodal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet narrow more' },
      h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'),
      h('h2', {}, 'Mehr'),
      item('bibliothek', '📚 Bibliothek'), item('zahlen', '📈 Zahlen'), item('hochgeladen', '📦 Hochgeladen (Archiv)'), item('rohvideos', '🎞 Rohvideos'), item('papierkorb', '🗑 Papierkorb'), item('einstellungen', '⚙ Einstellungen'),
      h('button', { class: 'btn big', onclick: () => { close(); fileInput.click(); } }, '⤒ Video/Bild hochladen'),
      installHint(),
      h('p', { class: 'hint' }, APP_NAME + ' ' + versionText())));
  document.body.append(modal);
}

function renderMain() {
  if (!mainEl) return;
  if (S.tab === 'einstellungen') return renderSettings();
  if (S.tab === 'posten') return renderPosting();
  if (S.tab === 'coach') return renderCoach();
  if (S.tab === 'bibliothek') return renderLibrary();
  if (S.tab === 'zahlen') return renderStats();
  const q = S.search.toLowerCase();
  if (S.selTab !== S.tab) { S.sel = new Set(); S.selMode = false; S.selTab = S.tab; }
  const inTabList = S.videos.filter((v) => inTab(v, S.tab) && !v.missing);
  const list = S.videos.filter((v) => inTab(v, S.tab) && (!q || (v.title + ' ' + v.file + ' ' + v.tags + ' ' + (v.topic || '')).toLowerCase().includes(q))
    && (!S.channel || channelOf(v)?.id === S.channel) && (!S.topic || v.topic === S.topic) && (!S.month || monthOf(v) === S.month));
  const setChannel = (id) => { S.channel = id; try { localStorage.setItem('vz-channel', id); } catch { /* egal */ } renderMain(); };
  const filter = profilesList().length > 1 ? h('div', { class: 'filter' },
    h('button', { class: 'btn small' + (!S.channel ? ' on' : ''), onclick: () => setChannel('') }, 'Alle Kanäle'),
    profilesList().map((p) => {
      const b = h('button', { class: 'btn small' + (S.channel === p.id ? ' on' : ''), onclick: () => setChannel(p.id) }, h('span', { class: 'dot' }), p.name);
      b.firstChild.style.background = p.color;
      return b;
    })) : null;
  const missing = S.videos.filter((v) => v.missing && inTab(v, S.tab));
  const keepFocus = document.activeElement?.id === 'search';
  const search = h('input', { id: 'search', type: 'search', placeholder: 'Suchen …', value: S.search,
    oninput: (e) => { S.search = e.target.value; renderMain(); } });
  const hints = {
    geschnitten: 'Geschnittene Videos – prüfen, Titel & Titelbild anpassen, dann für YouTube/TikTok freigeben.',
    eingang: 'Rohaufnahmen vom OBS-Sortierer – werden automatisch geschnitten (Langfassung + Shorts → „Zur Freigabe“).',
    hochgeladen: 'Archiv: Videos, die auf YouTube und TikTok sind.',
    rohvideos: 'Originale, aus denen die Zentrale geschnitten hat. Hier aufräumen, wenn Platz knapp wird.',
    papierkorb: `Gelöschte Videos – im Video „Wiederherstellen“ oder „Endgültig löschen“. ${S.settings?.settings?.trashDays ? `Wird nach ${S.settings.settings.trashDays} Tagen automatisch geleert.` : ''}`,
  };
  const emptyTrash = S.tab === 'papierkorb' && list.some((v) => !v.missing) ? h('button', { class: 'btn small danger', onclick: async () => {
    const n = list.filter((v) => !v.missing).length;
    if (!confirm(`Papierkorb leeren?\n\n${n} Video(s) werden endgültig gelöscht – samt Titelbild und Texten. Das lässt sich nicht rückgängig machen.`)) return;
    try { const r = await api('POST', '/api/trash/empty'); toast(`${r.deleted} Video(s) endgültig gelöscht.`); await refresh(); renderMain(); updateCounts(); } catch (x) { toast(x.message, true); }
  } }, '🗑 Papierkorb leeren') : null;
  // Thema/Monat-Filter (aus Claudes Spiel/Thema bzw. Aufnahmedatum) und Gruppieren nach Aufnahme
  const topics = [...new Set(inTabList.map((v) => v.topic).filter(Boolean))].sort();
  const months = [...new Set(inTabList.map(monthOf))].sort().reverse();
  const topicSel = topics.length ? h('select', { class: 'small', onchange: (e) => { S.topic = e.target.value; renderMain(); } },
    h('option', { value: '' }, 'Alle Themen'), topics.map((t) => h('option', { value: t, selected: S.topic === t }, t))) : null;
  const monthSel = months.length > 1 ? h('select', { class: 'small', onchange: (e) => { S.month = e.target.value; renderMain(); } },
    h('option', { value: '' }, 'Alle Monate'), months.map((m) => h('option', { value: m, selected: S.month === m }, fmtMonth(m)))) : null;
  const groupBtn = ['geschnitten', 'hochgeladen', 'papierkorb'].includes(S.tab) ? h('button', { class: 'btn small' + (S.group ? ' on' : ''), title: 'Videos einer Aufnahme zusammen zeigen',
    onclick: () => { S.group = !S.group; try { localStorage.setItem('vz-group', S.group ? '1' : ''); } catch { /* egal */ } renderMain(); } }, '🗂 Nach Aufnahme') : null;
  const selBtn = h('button', { class: 'btn small' + (S.selMode ? ' on' : ''), onclick: () => { S.selMode = !S.selMode; if (!S.selMode) S.sel.clear(); renderMain(); } }, S.selMode ? '✕ Auswahl beenden' : '☑ Auswählen');
  // Sortierung: in der Freigabe standardmäßig nach Viral-Punkten (beste zuerst), sonst neueste zuerst
  const sortKey = S.sort || (S.tab === 'geschnitten' ? 'viral' : 'neu');
  const score = (v) => v.viral?.score || 0;
  const time = (v) => v.mtime || Date.parse(v.createdAt) || 0;
  const shown = list.filter((v) => !v.missing).sort(sortKey === 'viral' ? (a, b) => score(b) - score(a) || time(b) - time(a)
    : sortKey === 'zahlen' ? (a, b) => (b.perf?.yt?.views || 0) + (b.perf?.tt?.views || 0) - (a.perf?.yt?.views || 0) - (a.perf?.tt?.views || 0) || time(b) - time(a)
      : (a, b) => time(b) - time(a));
  const sortSel = ['geschnitten', 'hochgeladen'].includes(S.tab) ? h('select', { class: 'small', title: 'Sortierung', onchange: (e) => { S.sort = e.target.value; try { localStorage.setItem('vz-sort', S.sort); } catch { /* egal */ } renderMain(); } },
    [['viral', '🔥 Viral-Punkte'], ['neu', '🕒 Neueste'], ['zahlen', '👁 Aufrufe']].map(([k, n]) => h('option', { value: k, selected: sortKey === k }, n))) : null;
  // Doppelte: ältere Fassungen, zu denen es schon eine neuere (überarbeitete) gibt
  const dupes = S.tab === 'geschnitten' ? shown.filter((v) => S.videos.some((x) => x.folder === 'geschnitten' && !x.missing && x.id !== v.id
    && (x.revisionRoot || x.id) === (v.revisionRoot || v.id) && String(x.createdAt || '') > String(v.createdAt || ''))
    && !['done', 'uploading', 'queued', 'processing'].includes(v.yt?.state) && !['done', 'uploading', 'queued', 'processing'].includes(v.tt?.state) && v.li?.state !== 'done').length : 0;
  const trailerBtn = ['geschnitten', 'hochgeladen'].includes(S.tab) ? h('button', { class: 'btn small', title: 'Highlight-Video / Kanal-Trailer aus den besten Momenten aller Videos', onclick: trailerDialog }, '🎬 Trailer') : null;
  const dupeBtn = dupes ? h('button', { class: 'btn small', title: 'Ältere Fassungen, zu denen es schon eine überarbeitete gibt, in den Papierkorb', onclick: dedupe }, `🧹 Doppelte aufräumen (${dupes})`) : null;
  let grid;
  if (S.group) {
    const groups = new Map();
    for (const v of shown) { const k = v.source?.rawId || v.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
    grid = h('div', {}, [...groups.entries()].map(([rawId, vs]) => {
      const raw = S.videos.find((x) => x.id === rawId && !x.source);
      const name = raw ? (raw.topic ? raw.topic + ' · ' : '') + fmtDate(raw.mtime) : vs[0].source?.rawFile || 'Einzelne Videos';
      return h('div', { class: 'vgroup' }, h('div', { class: 'vgroup-head' }, h('b', {}, '🎬 ' + name),
        h('span', { class: 'hint' }, `${vs.length} Video${vs.length === 1 ? '' : 's'}`),
        raw ? h('a', { href: '#video/' + raw.id, class: 'hint' }, 'Rohvideo öffnen') : null),
        h('div', { class: 'grid' }, vs.map(card)));
    }));
  } else grid = h('div', { class: 'grid' }, shown.map(card));
  // Leiste für die Mehrfachauswahl
  const selBar = S.selMode ? h('div', { class: 'selbar' },
    h('b', {}, `${S.sel.size} ausgewählt`),
    h('button', { class: 'btn small', onclick: () => { shown.forEach((v) => S.sel.add(v.id)); renderMain(); } }, 'Alle'),
    h('button', { class: 'btn small', onclick: () => { S.sel.clear(); renderMain(); } }, 'Keine'),
    h('div', { style: { flex: '1' } }),
    S.tab === 'papierkorb' ? [
      h('button', { class: 'btn small', disabled: !S.sel.size, onclick: () => bulk('restore') }, '↩ Wiederherstellen'),
      h('button', { class: 'btn small danger', disabled: !S.sel.size, onclick: () => bulk('delete') }, '✕ Endgültig löschen'),
    ] : [
      S.tab === 'geschnitten' ? h('button', { class: 'btn small primary', disabled: !S.sel.size, title: 'Aus dem Rohvideo neu schneiden – mit Tonfall-/Chat-Signalen, Bildaufbau, Prüfung und Viral-Tipps (je Video ein KI-Aufruf)',
        onclick: () => bulk('revise') }, '🔁 Mit neuen Erkenntnissen überarbeiten') : null,
      h('button', { class: 'btn small danger', disabled: !S.sel.size, onclick: () => bulk('trash') }, '🗑 In den Papierkorb')]) : null;
  mainEl.replaceChildren(...[
    h('div', { class: 'bar' }, search, filter, topicSel, monthSel, sortSel, groupBtn, selBtn, dupeBtn, trailerBtn, h('span', { class: 'hint' }, hints[S.tab]),
      h('div', { style: { flex: '1' } }), emptyTrash,
      h('button', { class: 'btn small ghost', onclick: async () => { await api('POST', '/api/scan'); await refresh(); renderMain(); updateCounts(); toast('Ordner neu eingelesen.'); } }, '↻ Ordner prüfen')),
    selBar,
    list.some((v) => !v.missing) ? grid : h('div', { class: 'empty' },
      h('b', {}, q ? 'Nichts gefunden.' : 'Noch keine Videos hier.'),
      S.tab === 'geschnitten' ? 'Geschnittene Videos in den Ordner „geschnitten“ legen oder hierher ziehen (Video + gleichnamiges .jpg/.png als Titelbild).' : ''),
    missing.length ? h('div', { class: 'section' }, h('h3', {}, 'Nicht mehr gefunden'),
      h('p', { class: 'hint' }, 'Diese Dateien wurden außerhalb der Zentrale verschoben oder gelöscht.'),
      missing.map((v) => h('div', { class: 'row' }, h('span', {}, v.file),
        h('button', { class: 'btn small', onclick: async () => { await api('POST', `/api/videos/${v.id}/forget`); await refresh(); renderMain(); } }, 'Eintrag entfernen')))) : null].filter(Boolean));
  if (keepFocus) { const s = document.getElementById('search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

const monthOf = (v) => { const d = new Date(v.mtime || Date.parse(v.createdAt) || Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtMonth = (m) => { const [y, mo] = m.split('-'); return ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][Number(mo) - 1] + ' ' + y; };

// Mehrere Videos auf einmal (in den Papierkorb / wiederherstellen / endgültig löschen)
async function bulk(action) {
  const ids = [...S.sel];
  if (!ids.length) return;
  let wish = '';
  if (action === 'revise') {
    wish = prompt(`${ids.length} Video(s) mit den neuen Erkenntnissen neu schneiden (Tonfall, Lacher, Twitch-Chat, Facecam-Bildaufbau, Prüfung, Viral-Tipps)?\n\n`
      + 'Optional ein gemeinsamer Wunsch (leer lassen = die KI entscheidet). Jede neue Fassung erscheint als v2 daneben; je Video ein KI-Aufruf (bei Claude kostenpflichtig, lokal kostenlos).', '');
    if (wish === null) return;
    try {
      const r = await api('POST', '/api/videos/bulk', { action, ids, wish });
      toast(`${r.done} Video(s) werden überarbeitet.` + (r.skipped.length ? ` Übersprungen: ${r.skipped.slice(0, 2).join('; ')}${r.skipped.length > 2 ? ' …' : ''}` : ''), !!r.skipped.length);
      S.sel.clear(); S.selMode = false;
      await refresh(); renderMain(); updateCounts(); pollActivity(); startPolling();
    } catch (x) { toast(x.message, true); }
    return;
  }
  const text = { trash: `${ids.length} Video(s) in den Papierkorb legen?\n\nDu kannst sie dort wiederherstellen.`, restore: `${ids.length} Video(s) wiederherstellen?`,
    delete: `${ids.length} Video(s) endgültig löschen?\n\nVideo, Titelbild und Texte werden vom Server entfernt. Das lässt sich nicht rückgängig machen.` }[action];
  if (!confirm(text)) return;
  try {
    const r = await api('POST', '/api/videos/bulk', { action, ids });
    toast(`${r.done} erledigt.` + (r.skipped.length ? ` Übersprungen (wird gerade bearbeitet/hochgeladen): ${r.skipped.slice(0, 3).join(', ')}${r.skipped.length > 3 ? ' …' : ''}` : ''), !!r.skipped.length);
    S.sel.clear(); S.selMode = false;
    await refresh(); renderMain(); updateCounts();
  } catch (x) { toast(x.message, true); }
}

// Doppelte aufräumen: ältere Fassungen (wenn es schon eine überarbeitete gibt) in den Papierkorb
async function dedupe() {
  try {
    const r = await api('POST', '/api/videos/dedupe', { dryRun: true });
    if (!r.items.length) { toast('Keine doppelten Fassungen gefunden.'); return; }
    const lines = r.items.slice(0, 12).map((x) => `• ${x.title || x.file}${x.viralOld ? ` (🔥${x.viralOld})` : ''} → ersetzt durch ${x.newer}${x.viralNew ? ` (🔥${x.viralNew})` : ''}`).join('\n');
    if (!confirm(`${r.items.length} ältere Fassung(en) in den Papierkorb legen?\n\n${lines}${r.items.length > 12 ? '\n…' : ''}\n\nDu kannst sie im Papierkorb wiederherstellen.`)) return;
    const d = await api('POST', '/api/videos/dedupe', {});
    toast(`${d.moved} in den Papierkorb gelegt.` + (d.skipped.length ? ` Übersprungen (wird gerade hochgeladen/überarbeitet): ${d.skipped.length}` : ''), !!d.skipped.length);
    await refresh(); renderMain(); updateCounts();
  } catch (x) { toast(x.message, true); }
}

// Gibt es zu diesem Video eine neuere Fassung (v2, v3 …), die nicht im Papierkorb liegt? → „v2“ usw.
function hasNewer(v) {
  const n = S.videos.filter((x) => x.revisionOf === v.id && x.folder !== 'papierkorb' && !x.missing);
  return n.length ? n.map((x) => / (v\d+)\.[^.]+$/.exec(x.file)?.[1] || 'neu').join(', ') : '';
}
function card(v) {
  const thumb = h('span', { class: 'thumb' });
  if (v.hasImage) thumb.style.backgroundImage = `url("${imgUrl(v)}")`;
  else thumb.append(h('span', { class: 'ph' }, v.duration == null ? 'wird eingelesen …' : 'kein Bild'));
  if (v.duration) thumb.append(h('span', { class: 'dur' }, fmtDur(v.duration)));
  if (isVertical(v)) thumb.append(h('span', { class: 'fmt' }, 'Hochformat'));
  const running = ['uploading'].includes(v.yt?.state) ? v.yt : ['uploading'].includes(v.tt?.state) ? v.tt : null;
  const picked = S.selMode && S.sel.has(v.id);
  if (S.selMode) thumb.append(h('span', { class: 'pick' + (picked ? ' on' : '') }, picked ? '✓' : ''));
  return h('button', { class: 'card' + (picked ? ' picked' : ''), onclick: () => {
    if (!S.selMode) return go('video/' + v.id);
    if (S.sel.has(v.id)) S.sel.delete(v.id); else S.sel.add(v.id);
    renderMain();
  } }, thumb,
    h('div', { class: 'body' },
      h('div', { class: 'title' }, v.title || v.file),
      h('div', { class: 'meta' }, fmtDate(v.mtime), ' · ', fmtSize(v.size)),
      h('div', { class: 'chips' }, channelBadge(v),
        ['queued', 'running'].includes(v.ai?.state) ? h('span', { class: 'chip run' }, '✨ KI schreibt …') : null,
        v.cut?.state === 'queued' ? h('span', { class: 'chip run', title: v.cut.waitPc ? 'Wartet, bis du die Grafikkarte des PCs freigibst (Einstellungen → Rechenhelfer oder Desktop-Verknüpfung). „Jetzt schneiden“ im Video schneidet sofort ohne PC-Analyse.' : '' },
          v.cut.waitPc && !v.cut.now ? '🔒 wartet auf PC-Freigabe' : S.settings?.cut?.window?.enabled && !S.settings?.cut?.windowOpen && !v.cut.now
          ? `🌙 schneidet ab ${S.settings.cut.window.from} Uhr` : '✂ wartet auf Schnitt') : null,
        v.cut?.state === 'running' ? h('span', { class: 'chip run', title: v.cut.step }, `✂ ${v.cut.step || 'schneidet'} ${v.cut.progress ? v.cut.progress + ' %' : ''}`) : null,
        v.cut?.state === 'error' ? h('span', { class: 'chip bad', title: v.cut.error }, '✂ Fehler') : null,
        v.cut?.state === 'done' ? h('span', { class: 'chip ok' }, `✂ ${v.cut.outputs?.length || 0} Videos`) : null,
        v.folder === 'eingang-profi' ? h('span', { class: 'chip li' }, 'Profi') : null,
        viralChip(v),
        v.qc ? h('span', { class: 'chip ' + (v.qc.ok ? 'ok' : 'bad'), title: v.qc.ok ? 'Render-Prüfung bestanden' + (v.qc.score ? ` (${v.qc.score}/10)` : '') : 'Prüfung: ' + (v.qc.issues || []).join('; ') }, v.qc.ok ? '✔ geprüft' : '⚠ Prüfung') : null,
        v.perf?.yt || v.perf?.tt ? h('span', { class: 'chip', title: [v.perf.yt ? `YouTube: ${v.perf.yt.views} Aufrufe${v.perf.yt.avgPercent ? `, ${Math.round(v.perf.yt.avgPercent)} % angesehen` : ''}` : '', v.perf.tt ? `TikTok: ${v.perf.tt.views} Aufrufe` : ''].filter(Boolean).join(' · ') },
          '👁 ' + fmtNum((v.perf.yt?.views || 0) + (v.perf.tt?.views || 0))) : null,
        v.revisionOf ? h('span', { class: 'chip ver', title: 'Überarbeitete Fassung' + (v.revisionWish ? ': ' + v.revisionWish : '') }, '🔁 ' + (/ v(\d+)\.[^.]+$/.exec(v.file)?.[0].replace(/\.[^.]+$/, '').trim() || 'neu') + (v.revisionKept ? ' ✓' : '')) : null,
        hasNewer(v) ? h('span', { class: 'chip', title: 'Es gibt eine überarbeitete Fassung' }, '↳ hat ' + hasNewer(v)) : null,
        ['queued', 'running'].includes(v.revise?.state) ? h('span', { class: 'chip run' }, '🔁 wird überarbeitet') : null,
        v.folder === 'papierkorb' ? h('span', { class: 'chip bad' }, '🗑 ' + fmtDate(v.trash?.at)) : null,
        ...(isPro(channelOf(v)) ? [stateChip('LinkedIn', v.li)] : [stateChip('YouTube', v.yt), stateChip('TikTok', v.tt)])),
      running ? h('div', { class: 'bar-progress' }, h('i', { style: { width: (running.progress || 0) + '%' } })) : null));
}

// ---------- 📈 Zahlen ----------
async function renderStats() {
  const st = await api('GET', '/api/stats').catch((e) => ({ error: e.message }));
  if (S.tab !== 'zahlen') return;
  if (st.error) { mainEl.replaceChildren(h('div', { class: 'empty' }, st.error)); return; }
  const row = (x, i) => h('a', { class: 'statrow', href: '#video/' + x.id },
    h('span', { class: 'rank' }, String(i + 1)),
    h('span', { class: 'st-title' }, x.title),
    h('span', { class: 'chip ' + (x.rel >= 1.5 ? 'ok' : x.rel < 0.6 ? 'bad' : '') }, `${String(x.rel).replace('.', ',')}×`),
    h('span', { class: 'hint' }, [x.yt ? `YT ${fmtNum(x.yt.views)}` : '', x.tt ? `TT ${fmtNum(x.tt.views)}` : '', x.pct ? `${Math.round(x.pct)} % gesehen` : '', x.viral ? `🔥${x.viral}` : ''].filter(Boolean).join(' · ')));
  const chBox = (c) => h('div', { class: 'box' },
    h('h3', {}, h('span', { class: 'dot', style: { background: c.color } }), ' ', c.name, h('span', { class: 'hint' }, ` · ${c.count} Video${c.count === 1 ? '' : 's'} mit Zahlen`)),
    !c.count ? h('p', { class: 'hint' }, 'Noch keine Zahlen – sobald Videos hochgeladen sind und YouTube/TikTok verbunden ist, kommen sie hier an (alle 6 Stunden).') : [
      c.corr != null ? h('p', { class: 'hint' }, `Trefferquote der Viral-Einschätzung der KI: ${c.corr >= 0.5 ? 'gut' : c.corr >= 0.2 ? 'mittel' : 'schwach'} (Rangkorrelation ${String(c.corr).replace('.', ',')})`) : null,
      h('b', {}, '🏆 Lief am besten'), h('div', { class: 'statlist' }, c.top.map(row)),
      c.count > 10 ? [h('b', {}, '📉 Lief am schwächsten'), h('div', { class: 'statlist' }, c.flop.map(row))] : null,
      h('p', { class: 'hint' }, '„2×“ = doppelt so viele Aufrufe wie üblich auf diesem Kanal. Ab 6 Videos mit Zahlen bekommt die KI die besten und schwächsten als Beispiele für den nächsten Schnitt.')]);
  const errs = Object.entries(st.errors || {});
  const tw = st.twitch;
  mainEl.replaceChildren(...[
    h('div', { class: 'bar' }, h('h2', { class: 'h2' }, '📈 Zahlen'),
      h('span', { class: 'hint' }, st.lastRun ? 'Stand ' + fmtDate(st.lastRun) : 'Noch nicht abgerufen.'),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/stats/refresh'); toast('Zahlen werden abgerufen …'); setTimeout(renderStats, 4000); } }, st.running ? '↻ läuft …' : '↻ Jetzt abrufen')),
    errs.length ? h('div', { class: 'section' }, errs.map(([k, m]) => h('p', { class: 'err' }, `${k}: ${m}`))) : null,
    h('div', { class: 'settings' }, st.channels.filter((c) => c.count || !c.id.includes('linkedin')).map(chBox),
      tw ? h('div', { class: 'box' }, h('h3', {}, '🟣 Twitch – letzte Streams'),
        h('div', { class: 'statlist' }, (tw.streams || []).slice(0, 10).map((x) => h('div', { class: 'statrow' },
          h('span', { class: 'st-title' }, (x.title || 'Stream') + (x.game ? ' · ' + x.game : '')),
          h('span', { class: 'hint' }, [fmtDate(x.startedAt), x.messages ? `💬 ${fmtNum(x.messages)} Chat` : '', x.vodId ? 'VOD ✓' : ''].filter(Boolean).join(' · ')))))) : null)].filter(Boolean));
}

// ---------- 💡 Coach ----------
async function renderCoach() {
  const all = await api('GET', '/api/coach').catch(() => ({}));
  if (S.tab !== 'coach') return;
  const box = (p) => {
    const c = all[p.id];
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Die KI schaut sich deine Videos an … (ca. 30 s)';
      try { await api('POST', '/api/coach', { profileId: p.id }); renderCoach(); } catch (x) { toast(x.message, true); btn.disabled = false; btn.textContent = c ? '↻ Neue Tipps holen' : '💡 Tipps holen'; }
    } }, c ? '↻ Neue Tipps holen' : '💡 Tipps holen');
    const head = h('h3', {}, h('span', { class: 'dot', style: { background: p.color } }), ' ', p.name);
    if (!c) return h('div', { class: 'box coach' }, head, h('p', { class: 'hint' }, 'Die KI schaut sich deine letzten Videos dieses Kanals an und gibt dir persönliche Tipps und Ideen (mit Claude ein paar Cent, lokal kostenlos).'), btn);
    return h('div', { class: 'box coach' }, head,
      h('p', { class: 'hint' }, `Stand ${fmtDate(c.at)} · aus ${c.videos} Videos`),
      h('p', {}, c.summary),
      c.strengths?.length ? [h('b', {}, '✅ Das läuft schon gut'), h('ul', {}, c.strengths.map((x) => h('li', {}, x)))] : null,
      h('b', {}, '💡 Tipps für mehr Reichweite'),
      h('ol', { class: 'ctips' }, (c.tips || []).map((t) => h('li', {}, h('b', {}, t.title), h('div', {}, t.text)))),
      c.ideas?.length ? [h('b', {}, '🎬 Ideen für nächste Videos'), h('ul', {}, c.ideas.map((x) => h('li', {}, x)))] : null,
      h('div', { class: 'row', style: { marginTop: '8px' } }, btn));
  };
  mainEl.replaceChildren(h('div', { class: 'posting' },
    h('h2', { class: 'h2' }, '💡 Dein Coach'),
    h('p', { class: 'hint' }, 'Persönliche Tipps aus deinen letzten Videos – Einstieg, Rhythmus, Themen, Aufnahme, Titel. Aufrufzahlen kennt die KI (noch) nicht, nur Inhalte und Einschätzungen. Die Tipps je Video stehen im Video unter „Viral-Potenzial“.'),
    ...profilesList().map(box)));
}

// ---------- Zum Posten (Handy) ----------
// Was noch von Hand gepostet werden muss: TikTok-Entwürfe (Text fehlt, TikTok nimmt ihn nicht an) und LinkedIn-Videos.
const ttText = (v) => (v.tiktok || ((v.title || '') + ' ' + hashtags(v.tags || '')).trim()).trim();
const liText = (v) => { const t = hashtags(v.tags || ''); return ((v.description || '').trim() + (t ? '\n\n' + t : '')).trim(); };
function toPost() {
  return S.videos.filter((v) => !v.missing && v.folder !== 'papierkorb' && (
    (['done', 'unconfirmed', 'processing'].includes(v.tt?.state) && !v.tt.manual && !v.tt.posted && v.tt.mode !== 'direct')
    || (isPro(channelOf(v)) && v.folder === 'geschnitten' && v.li?.state !== 'done')))
    .sort((a, b) => String(b.tt?.at || b.mtime || '').localeCompare(String(a.tt?.at || a.mtime || '')));
}
function renderPosting() {
  const list = toPost();
  const item = (v) => {
    const pro = isPro(channelOf(v));
    const ch = channelOf(v);
    const thumb = h('div', { class: 'pthumb' + (isVertical(v) ? ' vert' : '') });
    if (v.hasImage) thumb.style.backgroundImage = `url("${imgUrl(v)}")`;
    const done = async (path, body, msg) => {
      try { await api('POST', `/api/videos/${v.id}/${path}`, body); await refresh(); renderMain(); updateCounts(); toast(msg); } catch (x) { toast(x.message, true); }
    };
    const steps = pro
      ? [h('a', { class: 'btn big', href: `/api/videos/${v.id}/file?download=1`, download: '' }, '⤓ 1. Video speichern'),
         h('button', { class: 'btn big primary', onclick: () => copy(liText(v)) }, '⧉ 2. Beitrag kopieren'),
         h('a', { class: 'btn big', href: 'https://www.linkedin.com/feed/?shareActive=true', target: '_blank', rel: 'noopener' }, '↗ 3. LinkedIn öffnen'),
         h('button', { class: 'btn big ok', onclick: () => done('linkedin', { url: '' }, 'Als gepostet markiert.') }, '✓ Gepostet')]
      : [h('button', { class: 'btn big primary', onclick: () => copy(ttText(v)) }, '⧉ 1. TikTok-Text kopieren'),
         h('div', { class: 'hint' }, '2. TikTok-App → Posteingang → „Dein Video von Zentrale ist bereit“ → Text einfügen → posten.'),
         h('button', { class: 'btn big ok', onclick: () => done('tiktok-posted', {}, 'Als gepostet markiert.') }, '✓ Gepostet')];
    const txt = pro ? liText(v) : ttText(v);
    return h('div', { class: 'post' },
      h('div', { class: 'phead' }, thumb, h('div', {},
        h('div', { class: 'ptitle' }, v.title || v.file),
        h('div', { class: 'chips' }, h('span', { class: 'chip', style: { borderColor: ch?.color || '' } }, (pro ? 'LinkedIn' : 'TikTok') + ' · ' + (ch?.name || '')),
          !pro && v.tt?.state === 'processing' ? h('span', { class: 'chip run' }, 'TikTok verarbeitet noch') : null,
          !pro && v.tt?.state === 'unconfirmed' ? h('span', { class: 'chip bad' }, 'Zustellung unbestätigt') : null))),
      h('div', { class: 'ptext' }, txt || h('i', {}, 'Noch kein Text – im Video eintragen.')),
      h('div', { class: 'psteps' }, steps),
      h('a', { class: 'hint', href: '#video/' + v.id }, 'Video öffnen / Text ändern'));
  };
  mainEl.replaceChildren(h('div', { class: 'posting' },
    h('h2', { class: 'h2' }, '📱 Zum Posten'),
    h('p', { class: 'hint' }, 'Hier steht, was du noch selbst posten musst: TikTok-Entwürfe (TikTok übernimmt den Text nicht) und LinkedIn-Videos. Tipp: Die Zentrale als App auf den Handy-Startbildschirm legen.'),
    list.length ? list.map(item) : h('div', { class: 'empty' }, h('b', {}, 'Alles gepostet. 🎉'), 'Neue Videos erscheinen hier, sobald du sie an TikTok sendest oder für LinkedIn freigibst.')));
}

// ---------- Detailansicht ----------
let detail = null; // { id, refs }
function openDetail(id) {
  detail?.cleanup(); detail = null;
  const v = S.videos.find((x) => x.id === id);
  document.querySelector('.modal')?.remove();
  if (!v) { detail = null; return; }
  const close = () => { go(v.folder); };
  const f = {};
  const labels = {};
  const field = (key, label, max, opts = {}) => {
    const len = h('span', { class: 'len' });
    const el = h(opts.area ? 'textarea' : 'input', { value: v[key] || '', rows: opts.rows, placeholder: opts.placeholder || '' });
    const upd = () => { len.textContent = el.value.length + ' / ' + max; len.classList.toggle('over', el.value.length > max); dirty(); };
    el.addEventListener('input', upd);
    f[key] = el;
    const l = h('label', {}, label, len);
    labels[key] = l;
    upd(); saveBtn.disabled = true;
    return [l, el];
  };
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => saveFields() }, 'Speichern');
  const dirty = () => { saveBtn.disabled = false; };
  const cat = h('select', { onchange: dirty }, h('option', { value: '' }, 'Vorgabe des Kanals'),
    CATEGORIES.map(([id, n]) => h('option', { value: id, selected: String(v.category) === id }, n)));
  f.category = cat;
  const chan = h('select', { onchange: () => { dirty(); chanInfo(); updateDetail(); } });
  const chanReason = h('div', { class: 'hint' });
  const chanInfo = () => {
    const auto = profileOf(v.suggestion?.id);
    const cur = chan.options.length ? chan.value : (v.channel || '');
    chan.replaceChildren(h('option', { value: '' }, 'Automatisch' + (auto && !v.channel ? ': ' + auto.name : '')),
      ...profilesList().map((p) => h('option', { value: p.id }, p.name)));
    chan.value = cur;
    const p = chan.value ? profileOf(chan.value) : auto;
    const why = !chan.value ? 'Vorschlag (' + (v.suggestion?.reason || '–') + ')' : v.channelFrom === 'json' && chan.value === v.channel ? 'aus der .json' : 'von dir gewählt';
    chanReason.textContent = isPro(p) ? `→ LinkedIn: nur Download, du postest selbst · ${why}` : p ? `→ YouTube ${p.youtube.channel ? '„' + p.youtube.channel.title + '“' : '(nicht verbunden)'} · TikTok ${p.tiktok.user?.name ? '„' + p.tiktok.user.name + '“' : p.tiktok.connected ? 'verbunden' : '(nicht verbunden)'} · ${why}` : '';
    chan.style.borderColor = p?.color || '';
  };
  chanInfo();
  f.channel = chan;

  async function saveFields(silent) {
    const body = {};
    for (const k of ['title', 'description', 'tags', 'tiktok', 'note', 'category', 'channel']) body[k] = f[k].value;
    const nv = await api('PUT', '/api/videos/' + v.id, body);
    Object.assign(v, nv);
    chanInfo(); updateDetail();
    saveBtn.disabled = true;
    if (!silent) toast('Gespeichert.');
  }
  const ensureSaved = async () => { if (!saveBtn.disabled) await saveFields(true); };

  const player = h('video', { src: `/api/videos/${v.id}/file?v=${Math.round(v.mtime || 0)}`, controls: true, preload: 'metadata', playsinline: true });
  const cover = h('div', { class: 'cover' });
  const setCover = () => { cover.style.backgroundImage = v.hasImage ? `url("${imgUrl(v)}")` : 'none'; };
  setCover();
  const imgInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'hidden', onchange: async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/image`, undefined, file)); setCover(); toast('Titelbild gespeichert.'); }
    catch (x) { toast(x.message, true); }
  } });
  const grabFrame = async () => {
    if (!player.videoWidth) return toast('Video erst laden/abspielen.', true);
    const c = document.createElement('canvas');
    const scale = Math.min(1, 1920 / Math.max(player.videoWidth, player.videoHeight));
    c.width = Math.round(player.videoWidth * scale); c.height = Math.round(player.videoHeight * scale);
    c.getContext('2d').drawImage(player, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/image`, undefined, blob)); setCover(); toast('Standbild als Titelbild übernommen.'); }
    catch (x) { toast(x.message, true); }
  };

  const folderEl = h('div', { class: 'meta' });
  const cutBox = h('div');
  const transcriptBox = h('div');
  const ytBox = h('div', { class: 'section' });
  const ttBox = h('div', { class: 'section' });
  const moveBox = h('div', { class: 'row' });
  const genBox = h('div', { class: 'section gen-thumbs' });

  const reviseBox = h('div');
  const mirrorBox = h('div', { class: 'mirrorbox' });
  const left = h('div', {}, player,
    h('div', { class: 'coverbox' }, cover, h('div', { class: 'acts' },
      h('b', {}, 'Titelbild'),
      h('button', { class: 'btn small', onclick: grabFrame }, '📷 Aktuelles Videobild nehmen'),
      h('button', { class: 'btn small', onclick: () => imgInput.click() }, '⤒ Bild hochladen'),
      v.hasImage ? h('a', { class: 'btn small ghost', href: imgUrl(v) + '&download=1', download: '' }, '⤓ Titelbild herunterladen') : null,
      h('span', { class: 'hint' }, 'YouTube: 1280 × 720, max. 2 MB (wird automatisch angepasst).'), imgInput,
      coverFrameSel(v))),
    h('div', { class: 'meta', style: { marginTop: '10px' } },
      v.file, ' · ', fmtSize(v.size), v.width ? ` · ${v.width} × ${v.height}` : '', v.duration ? ' · ' + fmtDur(v.duration) : ''),
    mirrorBox,
    genBox, reviseBox,
    h('div', { style: { marginTop: '10px' } }, moveBox), cutBox, transcriptBox);

  const aiBox = h('div', { class: 'section ai' });
  const right = h('div', {},
    aiBox,
    h('label', {}, 'Kanal'), chan, chanReason,
    field('title', 'Titel (YouTube)', 100),
    field('description', 'Beschreibung (YouTube)', 5000, { area: true, rows: 6 }),
    h('div', { class: 'two' },
      h('div', {}, field('tags', 'Tags (mit Komma getrennt)', 500, { placeholder: 'leer = Vorgabe des Kanals' })),
      h('div', {}, h('label', {}, 'Kategorie'), cat)),
    h('div', { class: 'tt-part' }, field('tiktok', 'TikTok-Text (zum Einfügen in der App)', 2200, { area: true, rows: 3, placeholder: 'leer = Titel + Hashtags aus den Tags' }),
    h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn small', onclick: () => { f.tiktok.value = (f.title.value + ' ' + hashtags(f.tags.value)).trim(); f.tiktok.dispatchEvent(new Event('input')); } }, 'Aus Titel + Tags erzeugen'),
      h('button', { class: 'btn small', onclick: () => copy(f.tiktok.value || (f.title.value + ' ' + hashtags(f.tags.value)).trim()) }, '⧉ Kopieren'))),
    field('note', 'Notiz (nur für dich)', 2000, { area: true, rows: 2 }),
    h('div', { class: 'row', style: { marginTop: '12px' } }, saveBtn),
    ytBox, ttBox);

  const workBox = h('div', { class: 'workbox', hidden: true });
  const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet' },
      h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'),
      h('h2', {}, v.title || v.file),
      folderEl, workBox,
      h('div', { class: 'detail' }, left, right)));
  document.body.append(modal);
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal input:focus, .modal textarea:focus')) close(); };
  document.addEventListener('keydown', onKey);
  const setField = (k, val) => { f[k].value = val; f[k].dispatchEvent(new Event('input')); };
  const setCoverFromFrame = async (n) => {
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/ai-frame/${n}/cover`)); setCover(); toast('Titelbild übernommen.'); }
    catch (x) { toast(x.message, true); }
  };
  // LinkedIn-Kanal: Felder anders beschriften, TikTok/Kategorie ausblenden
  const applyMode = (pro) => {
    const set = (k, t) => { if (labels[k]) labels[k].firstChild.textContent = t; };
    set('title', pro ? 'Titel des Videos (LinkedIn)' : 'Titel (YouTube)');
    set('description', pro ? 'LinkedIn-Beitrag (Ich-Form)' : 'Beschreibung (YouTube)');
    set('tags', pro ? 'Hashtags (mit Komma getrennt, ohne #)' : 'Tags (mit Komma getrennt)');
    right.querySelector('.tt-part').style.display = pro ? 'none' : '';
    cat.parentElement.style.display = pro ? 'none' : '';
  };
  detail = { id, workBox, cutBox, transcriptBox, v, ytBox, ttBox, moveBox, folderEl, ensureSaved, chanInfo, chan, aiBox, genBox, reviseBox, mirrorBox, player, f, applyMode, setField, setCover, setCoverFromFrame, isDirty: () => !saveBtn.disabled, markClean: () => { saveBtn.disabled = true; }, cleanup: () => document.removeEventListener('keydown', onKey) };
  updateDetail(); drawWork(); pollActivity();
}

// LinkedIn: kein Upload – Video/Titelbild herunterladen, Beitrag kopieren, als gepostet markieren
function linkedinBox(box, v) {
  const s = v.li || { state: 'none' };
  const f = detail.f;
  const postText = () => { const tags = hashtags(f.tags.value); return (f.description.value.trim() + (tags ? '\n\n' + tags : '')).trim(); };
  const mark = async (undo) => {
    try {
      let url = '';
      if (!undo) { url = prompt('Als auf LinkedIn gepostet markieren.\nLink zum Beitrag (optional):', s.url || ''); if (url === null) return; }
      await detail.ensureSaved();
      Object.assign(v, await api('POST', `/api/videos/${v.id}/linkedin`, { undo: !!undo, url }));
      await refresh(); updateDetail(); updateCounts();
    } catch (x) { toast(x.message, true); }
  };
  const kids = [h('h3', {}, h('span', { class: 'dot', style: { background: '#0a66c2' } }), 'LinkedIn', h('span', { class: 'meta' }, ' → als Person (Ich-Form) · Upload machst du selbst')),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: `/api/videos/${v.id}/file?download=1`, download: v.file.split('/').pop() }, '⤓ Video herunterladen'),
      v.hasImage ? h('a', { class: 'btn', href: imgUrl(v) + '&download=1', download: '' }, '⤓ Titelbild') : null,
      h('button', { class: 'btn', onclick: async () => { await detail.ensureSaved().catch(() => {}); copy(postText()); toast('Beitrag mit Hashtags kopiert.'); } }, '⧉ Beitrag kopieren')),
    h('p', { class: 'hint' }, 'Auf linkedin.com → „Beitrag beginnen“ → Video hinzufügen → Text einfügen. Das Titelbild kannst du dort unter „Miniaturansicht“ hochladen. Untertitel sind eingebrannt (LinkedIn läuft meist ohne Ton).')];
  if (s.state === 'done') kids.push(h('div', { class: 'status ok-text' }, '✓ Auf LinkedIn gepostet ', fmtDate(s.at), s.url ? [' · ', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'Beitrag öffnen')] : null),
    h('button', { class: 'btn small ghost', onclick: () => mark(true) }, 'Markierung zurücknehmen'));
  else kids.push(h('button', { class: 'btn small', onclick: () => mark(false) }, '✓ Als gepostet markieren'));
  box.replaceChildren(...kids.filter(Boolean));
}

// Was TikTok selbst zum Upload meldet (+ Knopf zum erneuten Abfragen)
const TT_STATUS = { PROCESSING_UPLOAD: 'wird bei TikTok noch verarbeitet', PROCESSING_DOWNLOAD: 'wird bei TikTok noch verarbeitet',
  SEND_TO_USER_INBOX: 'an deinen TikTok-Posteingang zugestellt', PUBLISH_COMPLETE: 'veröffentlicht', FAILED: 'fehlgeschlagen', leer: 'keine Angabe von TikTok' };
function ttStatusLine(v, s) {
  if (!s.publishId) return null;
  const btn = h('button', { class: 'btn small ghost', onclick: async () => {
    btn.disabled = true;
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/tiktok-status`)); await refresh(); updateDetail(); }
    catch (x) { toast(x.message, true); btn.disabled = false; }
  } }, '↻ TikTok-Status abfragen');
  return h('div', { class: 'hint' }, 'TikTok meldet: ', h('b', {}, s.tikStatus ? `${TT_STATUS[s.tikStatus] || s.tikStatus} (${s.tikStatus})` : 'noch nichts'),
    s.tikReason ? ' · Grund: ' + s.tikReason : '', s.lastCheckError ? ' · Abfrage-Fehler: ' + s.lastCheckError : '',
    s.checkedAt ? ' · ' + fmtDate(s.checkedAt) : '', ' ', btn);
}

// Direkt auf TikTok posten – Aufbau nach den TikTok Content Sharing Guidelines:
// Kontoinfo live, Vorschau, Titel bearbeitbar, Sichtbarkeit ohne Vorauswahl, Interaktionen (aus, gesperrte deaktiviert),
// Kennzeichnung kommerzieller Inhalte, Zustimmung zur Musiknutzung, Hinweis zur Verarbeitungszeit.
const PRIVACY_NAMES = { PUBLIC_TO_EVERYONE: 'Öffentlich (alle)', MUTUAL_FOLLOW_FRIENDS: 'Freunde', FOLLOWER_OF_CREATOR: 'Follower', SELF_ONLY: 'Nur ich' };
async function tiktokPostDialog(v) {
  let info;
  try { info = await api('GET', `/api/videos/${v.id}/tiktok-creator`); } catch (x) { return toast(x.message, true); }
  const close = () => modal.remove();
  const tooLong = info.maxDuration && v.duration > info.maxDuration;
  const title = h('textarea', { rows: 4, maxlength: 2200, value: ttText(v) });
  const privacy = h('select', {}, h('option', { value: '', disabled: true, selected: true }, 'Bitte wählen …'),
    info.privacyOptions.map((o) => h('option', { value: o }, PRIVACY_NAMES[o] || o)));
  const tog = (disabled) => h('input', { type: 'checkbox', disabled: !!disabled });
  const cComment = tog(info.commentDisabled), cDuet = tog(info.duetDisabled), cStitch = tog(info.stitchDisabled);
  const disclose = h('input', { type: 'checkbox' }), own = h('input', { type: 'checkbox' }), branded = h('input', { type: 'checkbox' });
  const discloseBox = h('div', { class: 'disc' });
  const declaration = h('p', { class: 'hint' });
  const label = h('p', { class: 'hint' });
  const btn = h('button', { class: 'btn primary big' }, 'Auf TikTok posten');
  const why = h('div', { class: 'hint err' });
  const update = () => {
    discloseBox.style.display = disclose.checked ? '' : 'none';
    const bc = disclose.checked && branded.checked, bo = disclose.checked && own.checked;
    // Markeninhalte dürfen nicht privat sein
    for (const o of privacy.options) if (o.value === 'SELF_ONLY') { o.disabled = bc; o.title = bc ? 'Markeninhalte können nicht privat sein.' : ''; }
    if (bc && privacy.value === 'SELF_ONLY') privacy.value = '';
    label.textContent = bc ? 'Dein Video wird als „Bezahlte Partnerschaft“ gekennzeichnet.' : bo ? 'Dein Video wird als „Werbeinhalt“ gekennzeichnet.' : '';
    declaration.replaceChildren('Mit dem Posten stimmst du ',
      ...(bc ? [h('a', { href: 'https://www.tiktok.com/legal/page/global/bc-policy/en', target: '_blank', rel: 'noopener' }, 'TikToks Richtlinie für Markeninhalte'), ' und '] : []),
      h('a', { href: 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en', target: '_blank', rel: 'noopener' }, 'TikToks Bestätigung zur Musiknutzung'), ' zu.');
    const problem = tooLong ? `Das Video ist länger als bei diesem Konto erlaubt (${info.maxDuration} s).`
      : !privacy.value ? 'Bitte eine Sichtbarkeit wählen.'
      : disclose.checked && !own.checked && !branded.checked ? 'Du musst angeben, ob dein Inhalt für dich selbst, für Dritte oder für beides wirbt.' : '';
    btn.disabled = !!problem; why.textContent = problem;
  };
  for (const el of [privacy, disclose, own, branded]) el.addEventListener('change', update);
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Wird gesendet …';
    try {
      Object.assign(v, await api('POST', `/api/videos/${v.id}/upload/tiktok`, { direct: { title: title.value, privacy: privacy.value,
        allowComment: cComment.checked, allowDuet: cDuet.checked, allowStitch: cStitch.checked,
        disclose: disclose.checked, brandOrganic: own.checked, brandContent: branded.checked } }));
      close(); S.busy = true; updateDetail(); startPolling();
      toast('Wird hochgeladen. Nach dem Hochladen kann es ein paar Minuten dauern, bis das Video auf deinem Profil erscheint.');
    } catch (x) { toast(x.message, true); btn.textContent = 'Auf TikTok posten'; update(); }
  };
  const preview = h('video', { src: `/api/videos/${v.id}/file`, controls: true, preload: 'metadata', playsinline: true, class: 'ttprev' });
  const avatar = h('div', { class: 'ttavatar' }); if (info.avatar) avatar.style.backgroundImage = `url("${info.avatar}")`;
  const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet narrow' },
      h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'),
      h('h2', {}, 'Auf TikTok posten'),
      h('div', { class: 'ttwho' }, avatar, h('div', {}, h('b', {}, info.nickname || info.username), h('div', { class: 'hint' }, 'Wird gepostet auf: @' + info.username))),
      preview,
      tooLong ? h('div', { class: 'status err' }, `Dieses Konto erlaubt höchstens ${info.maxDuration} Sekunden.`) : null,
      h('label', {}, 'Titel'), title,
      h('label', {}, 'Wer darf das Video sehen?'), privacy,
      h('label', {}, 'Erlauben'),
      h('div', { class: 'row' },
        h('label', { class: 'check', title: info.commentDisabled ? 'In deiner TikTok-App ausgeschaltet' : '' }, cComment, 'Kommentare'),
        h('label', { class: 'check', title: info.duetDisabled ? 'In deiner TikTok-App ausgeschaltet' : '' }, cDuet, 'Duett'),
        h('label', { class: 'check', title: info.stitchDisabled ? 'In deiner TikTok-App ausgeschaltet' : '' }, cStitch, 'Stitch')),
      h('label', { class: 'check', style: { marginTop: '10px' } }, disclose, 'Inhalt offenlegen (Werbung / kommerzieller Inhalt)'),
      h('p', { class: 'hint' }, 'Einschalten, wenn das Video für dich selbst, eine Marke, ein Produkt oder eine Dienstleistung wirbt.'),
      discloseBox,
      label, declaration, why, btn));
  discloseBox.append(
    h('label', { class: 'check' }, own, 'Deine Marke – du wirbst für dich selbst oder dein eigenes Unternehmen'),
    h('label', { class: 'check' }, branded, 'Markeninhalt – du wirbst für eine andere Marke oder einen Dritten'));
  document.body.append(modal);
  update();
}

function platformBox(box, v, key, label, color) {
  const s = v[key] || { state: 'none' };
  const platform = key === 'yt' ? 'youtube' : 'tiktok';
  const target = profileOf(detail.chan.value) || channelOf(v);
  const conn = target?.[platform]?.connected;
  const account = key === 'yt' ? target?.youtube.channel?.title : target?.tiktok.user?.name;
  const kids = [h('h3', {}, h('span', { class: 'dot', style: { background: color } }), label,
    target ? h('span', { class: 'meta' }, ' → ' + target.name + (account && account !== target.name ? ' (' + account + ')' : '')) : null)];
  const doUpload = async () => {
    try {
      await detail.ensureSaved();
      const t = channelOf(v);
      const acc = key === 'yt' ? t?.youtube.channel?.title : t?.tiktok.user?.name;
      const where = `Kanal „${t?.name}“` + (acc && acc !== t?.name ? ` (${key === 'yt' ? 'YouTube' : 'TikTok'}: ${acc})` : '');
      if (key === 'yt' && !confirm(`Video jetzt als PRIVAT auf YouTube hochladen?\n${where}\n\nÖffentlich stellst du es danach in YouTube Studio.`)) return;
      if (key === 'tt' && !confirm(`Video jetzt als Entwurf an TikTok senden?\n${where}\n\nVeröffentlichen (Text, Sichtbarkeit) machst du danach in der TikTok-App.`)) return;
      Object.assign(v, await api('POST', `/api/videos/${v.id}/upload/${platform}`));
      S.busy = true; updateDetail(); startPolling();
    } catch (x) { toast(x.message, true); }
  };
  const markDone = async () => {
    const url = prompt('Als erledigt markieren (z. B. selbst hochgeladen).\nLink zum Video (optional):', s.url || '');
    if (url === null) return;
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/done/${platform}`, { url })); await refresh(); updateDetail(); } catch (x) { toast(x.message, true); }
  };
  const btnClass = key === 'yt' ? 'btn yt' : 'btn tt';
  const upLabel = key === 'yt' ? '▲ Auf YouTube hochladen (privat)' : '▲ Als Entwurf an TikTok';
  if (s.state === 'none') {
    kids.push(h('div', { class: 'status' }, 'Noch nicht hochgeladen.'));
  } else if (s.state === 'queued') {
    kids.push(h('div', { class: 'status' }, 'Wartet auf den Upload …'),
      h('button', { class: 'btn small', onclick: async () => { try { Object.assign(v, await api('POST', `/api/videos/${v.id}/cancel/${platform}`)); updateDetail(); } catch (x) { toast(x.message, true); } } }, 'Abbrechen'));
  } else if (s.state === 'uploading') {
    kids.push(h('div', { class: 'status' }, `Wird hochgeladen … ${String(s.progress || 0).replace('.', ',')} %` + (s.note ? ` · ⚠ ${s.note}` : '')),
      h('div', { class: 'bar-progress' }, h('i', { style: { width: (s.progress || 0) + '%' } })));
  } else if (s.state === 'processing') {
    kids.push(h('div', { class: 'status' }, 'Hochgeladen – TikTok verarbeitet das Video …'), ttStatusLine(v, s));
  } else if (s.state === 'unconfirmed') {
    kids.push(h('div', { class: 'status err' }, s.note || 'TikTok hat die Zustellung nicht bestätigt.'), ttStatusLine(v, s));
  } else if (s.state === 'error') {
    kids.push(h('div', { class: 'status err' }, s.error || 'Fehler'));
  } else if (s.state === 'done') {
    if (key === 'yt') {
      kids.push(h('div', { class: 'status ok-text' }, s.manual ? '✓ Als erledigt markiert ' : `✓ Hochgeladen (${s.privacy === 'public' ? 'öffentlich' : 'privat'}) `,
        s.profileName ? 'auf „' + (s.channelTitle || s.profileName) + '“ ' : '', fmtDate(s.at)));
      // Titelbild: eindeutig anzeigen, ob YouTube es angenommen hat
      const vert = s.vertical ?? (v.height > v.width);
      if (s.thumbError) kids.push(h('div', { class: 'status err' }, s.thumbError));
      else if (s.thumbAt) kids.push(h('div', { class: 'status ok-text' }, '✓ Titelbild an YouTube übermittelt (' + fmtDate(s.thumbAt) + ')'),
        vert ? h('div', { class: 'hint' }, 'Short: YouTube zeigt bei Shorts eigene Titelbilder oft nicht an. In der YouTube-App: Short öffnen → Bearbeiten → Titelbild/Cover wählen.') : null,
        vert && v.hasImage ? h('a', { class: 'btn small', href: imgUrl(v) + '&download=1', download: '' }, '⤓ Titelbild fürs Handy herunterladen') : null);
      else if (s.thumbNone) kids.push(h('div', { class: 'hint' }, 'Ohne Titelbild hochgeladen – Titelbild wählen und „Titelbild auf YouTube aktualisieren“ klicken.'));
      else if (!s.manual) kids.push(h('div', { class: 'hint' }, 'Titelbild-Status unbekannt (Upload vor Version 1.9.3) – bei Bedarf „Titelbild auf YouTube aktualisieren“ klicken.'));
      const chId = s.channelId || profileOf(s.profileId)?.youtube?.channel?.id || '';
      const chName = s.channelTitle || s.profileName || '';
      kids.push(h('div', { class: 'row' },
        s.studio ? h('a', { class: 'btn small', href: s.studio, target: '_blank', rel: 'noopener' }, 'In YouTube Studio öffnen → veröffentlichen') : null,
        chId ? h('a', { class: 'btn small ghost', href: `https://studio.youtube.com/channel/${chId}/videos/upload`, target: '_blank', rel: 'noopener',
          title: 'Öffnet die Videoliste des richtigen Kanals in YouTube Studio' }, 'Videos von „' + chName + '“ in Studio') : null,
        s.url ? h('a', { class: 'btn small ghost', href: s.url, target: '_blank', rel: 'noopener' }, 'Ansehen') : null),
        s.studio && chName ? h('div', { class: 'hint' }, `Zeigt Studio „Ein Fehler ist aufgetreten“? Dann ist dort ein anderer Kanal aktiv: oben rechts aufs Profilbild → „Konto wechseln“ → „${chName}“ wählen und den Link erneut öffnen.`) : null);
    } else {
      const direct = s.mode === 'direct';
      kids.push(h('div', { class: 'status ok-text' }, s.manual ? '✓ Als erledigt markiert ' : direct ? '✓ Auf TikTok veröffentlicht ' : '✓ Im TikTok-Posteingang ', s.profileName ? 'von „' + s.profileName + '“ ' : '', fmtDate(s.at)),
        s.manual || direct ? null : h('div', { class: 'status' }, s.note || 'Öffne die TikTok-App → Posteingang → Benachrichtigungen → Meldung antippen → Text einfügen → Posten.'),
        direct ? h('div', { class: 'hint' }, 'Es kann ein paar Minuten dauern, bis das Video auf deinem Profil erscheint.') : null,
        s.manual ? null : ttStatusLine(v, s),
        s.url ? h('a', { class: 'btn small ghost', href: s.url, target: '_blank', rel: 'noopener' }, 'Ansehen') : null);
    }
  }
  const actions = h('div', { class: 'row', style: { marginTop: '8px' } });
  if (['none', 'error', 'done'].includes(s.state)) {
    if (!conn) actions.append(h('span', { class: 'hint' }, `${label} ist für „${target?.name || '–'}“ nicht verbunden – `), h('a', { href: '#einstellungen' }, 'Einstellungen'));
    else {
      actions.append(h('button', { class: btnClass, onclick: doUpload }, s.state === 'done' ? upLabel.replace('▲', '↻ Erneut:') : s.state === 'error' ? '↻ Erneut versuchen' : upLabel));
      if (key === 'tt' && S.settings?.tiktok?.directPost) actions.append(h('button', { class: 'btn small primary', onclick: async () => { await detail.ensureSaved().catch(() => {}); tiktokPostDialog(v); } }, '▶ Direkt auf TikTok posten …'));
    }
    if (s.state !== 'done') actions.append(h('button', { class: 'btn small ghost', onclick: markDone }, 'Schon erledigt'));
  }
  if (key === 'tt' && isVertical(v) === false && v.width) kids.push(h('div', { class: 'hint' }, 'Hinweis: Querformat – auf TikTok wirkt Hochformat (9:16) besser.'));
  box.replaceChildren(...[...kids, actions].filter(Boolean));
}

// KI-Titelbilder: 1–3 Vorschläge, jederzeit (auch nachträglich), Klick = als Titelbild übernehmen
function renderGenThumbs(box, v) {
  const fal = S.settings?.fal;
  const gens = (v.thumbVariants || []).filter((t) => t.gen);
  const vertical = v.height > v.width;
  if (!fal?.configured) { box.replaceChildren(h('p', { class: 'hint' }, '✨ KI-Titelbilder: erst unter Einstellungen → Titelbilder & Fotos den fal.ai-Schlüssel eintragen.')); return; }
  const idea = v.ai?.aiThumb?.text || v.ai?.thumbnailText || '';
  const text = h('input', { value: box.dataset.text ?? idea, placeholder: 'Text auf dem Bild (leer = Vorschlag bzw. Titel)', maxlength: 40,
    oninput: () => { box.dataset.text = text.value; } });
  const count = h('select', {}, [1, 2, 3].map((n) => h('option', { value: n, selected: Number(box.dataset.count || 3) === n }, n + (n === 1 ? ' Bild' : ' Bilder'))));
  count.addEventListener('change', () => { box.dataset.count = count.value; });
  const go = h('button', { class: 'btn small primary', onclick: async () => {
    const n = Number(count.value);
    go.disabled = true; go.textContent = `✨ KI malt ${n} … (ca. ${n > 2 ? '20–40' : '10–20'} s)`;
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/aithumbs`, { count: n, text: text.value })); await refresh(); updateDetail(true);
      toast(n > 1 ? `${n} KI-Titelbilder fertig – eins anklicken zum Übernehmen.` : 'KI-Titelbild fertig – anklicken zum Übernehmen.'); }
    catch (x) { toast(x.message, true); go.disabled = false; go.textContent = '✨ Erzeugen'; }
  } }, gens.length ? '✨ Neue erzeugen' : '✨ Erzeugen');
  const pick = async (t) => {
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/variant/${t.k}/cover`)); detail?.setCover(); renderGenThumbs(box, v);
      toast(v.yt?.id ? 'Titelbild übernommen – mit „Auf YouTube aktualisieren“ auch dort ändern.' : 'Titelbild übernommen.'); }
    catch (x) { toast(x.message, true); }
  };
  const ytBtn = v.yt?.id ? h('button', { class: 'btn small', onclick: async (e) => {
    e.target.disabled = true;
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/youtube-thumb`)); toast('Titelbild auf YouTube aktualisiert.'); renderGenThumbs(box, v); return; }
    catch (x) { toast(x.message, true); }
    e.target.disabled = false;
  } }, '⤒ Titelbild auf YouTube aktualisieren') : null;
  box.replaceChildren(...[
    h('b', {}, '✨ KI-Titelbilder ', h('span', { class: 'hint' }, `(${vertical ? 'Hochformat-Cover 9:16' : '16:9'}, ca. 4 Cent je Bild)`)),
    h('div', { class: 'row gen-row' }, text, count, go),
    gens.length ? h('div', { class: 'variants gen-list' + (vertical ? ' vertical' : '') }, gens.map((t) => {
      const b = h('button', { class: 'variant', title: (t.text || 'ohne Text') + (t.photo ? ' · Foto: ' + t.photo : '') + ' – als Titelbild nehmen', onclick: () => pick(t) });
      b.style.backgroundImage = `url("/api/videos/${v.id}/variant/${t.k}?t=${v.thumbVariantsAt || 0}")`;
      return h('div', { class: 'vwrap' }, b, h('a', { class: 'btn small ghost', href: `/api/videos/${v.id}/variant/${t.k}?download=1&t=${v.thumbVariantsAt || 0}`, download: '' }, '⤓'));
    })) : h('p', { class: 'hint' }, 'Aus deinem Foto, einem Standbild und dem Text malt die KI fertige Titelbilder – mehrere zur Auswahl.'),
    v.ai?.aiThumbError ? h('div', { class: 'status err' }, v.ai.aiThumbError) : null,
    ytBtn ? h('div', { class: 'row', style: { marginTop: '6px' } }, ytBtn, v.yt?.thumbAt ? h('span', { class: 'hint' }, '✓ zuletzt ' + fmtDate(v.yt.thumbAt)) : null) : null,
  ].filter(Boolean));
}

// Render-Prüfung + echte Zahlen + Bildaufbau des fertigen Clips
function renderQc(v) {
  const q = v.qc, pf = v.perf, e = v.edit || {};
  if (!q && !pf && !e.layout) return null;
  const lay = e.layout ? { cam: 'Facecam oben + Spiel', crop: 'Ausschnitt um die Action', blur: 'ganzes Bild + Blur-Hintergrund' }[e.layout.mode] : '';
  return h('div', { class: 'section' },
    q ? h('div', { class: 'row' }, h('b', {}, 'Prüfung'), h('span', { class: 'chip ' + (q.ok ? 'ok' : 'bad') }, q.ok ? '✔ bestanden' : '⚠ Mängel'),
      q.score ? h('span', { class: 'hint' }, `Handwerk ${q.score}/10`) : null, q.lufs != null ? h('span', { class: 'hint' }, `Lautheit ${String(q.lufs).replace('.', ',')} LUFS`) : null) : null,
    q?.issues?.length ? h('ul', { class: 'vtips' }, q.issues.map((x) => h('li', {}, x))) : null,
    q && !q.ok && q.fixWish ? h('div', { class: 'hint' }, '💡 Vorschlag für die Überarbeitung: ' + q.fixWish) : null,
    lay ? h('div', { class: 'hint' }, '🖼 Bildaufbau: ' + lay + (e.layout.cam ? ` (Facecam ${e.layout.cam.refined ? 'am Rahmen ausgerichtet' : 'geschätzt'})` : '')) : null,
    e.signals?.length ? h('div', { class: 'hint' }, '📡 Signale: ' + e.signals.join(' · ')) : null,
    pf ? h('div', { class: 'row' }, h('b', {}, 'Zahlen'),
      pf.yt ? h('span', { class: 'chip' }, `YouTube 👁 ${fmtNum(pf.yt.views)} · 👍 ${fmtNum(pf.yt.likes)}` + (pf.yt.avgPercent ? ` · ${Math.round(pf.yt.avgPercent)} % angesehen` : '')) : null,
      pf.tt ? h('span', { class: 'chip' }, `TikTok 👁 ${fmtNum(pf.tt.views)} · ❤ ${fmtNum(pf.tt.likes)} · ↗ ${fmtNum(pf.tt.shares || 0)}`) : null,
      h('span', { class: 'hint' }, 'Stand ' + fmtDate((pf.yt || pf.tt).at))) : null);
}
function renderViral(v) {
  const x = v.viral;
  if (!x?.score) return null;
  return h('div', { class: 'section viralbox' }, h('div', { class: 'row' }, h('b', {}, 'Viral-Potenzial'), viralChip(v, true),
    h('span', { class: 'hint' }, x.by === 'Schnitt' ? '(Einschätzung beim Schnitt)' : '(Einschätzung der KI)')),
    x.why ? h('div', {}, x.why) : null, x.tip ? h('div', {}, h('b', {}, '💡 ' + x.tip)) : null,
    (x.hook || x.edit || x.packaging || x.nextTime) ? h('ul', { class: 'vtips' },
      x.hook ? h('li', {}, h('b', {}, 'Einstieg: '), x.hook) : null,
      x.edit ? h('li', {}, h('b', {}, 'Schnitt: '), x.edit) : null,
      x.packaging ? h('li', {}, h('b', {}, 'Titel/Bild: '), x.packaging) : null,
      x.nextTime ? h('li', {}, h('b', {}, 'Nächstes Mal beim Aufnehmen: '), x.nextTime) : null) : null,
    tipsAction(v));
}
// Knopf „Tipps umsetzen“: schneidet nach den Viral-Tipps neu (Überarbeitung als v2)
function tipsAction(v) {
  const x = v.viral || {};
  if (v.canRevise === undefined || !(x.hook || x.edit || x.tip)) return null;
  const st = v.revise?.state;
  if (st === 'queued' || st === 'running') return h('p', { class: 'hint' }, '⚡ Wird gerade nach den Tipps neu geschnitten …');
  if (v.revise?.newId && v.tipsApplied && /^Viral-Tipps/.test(v.revise.wish || '')) return h('p', { class: 'ok-text' }, '⚡ Tipps umgesetzt: ', h('a', { href: '#video/' + v.revise.newId }, v.revise.newFile || 'neue Fassung öffnen'));
  if (v.canRevise !== true) return null;
  return h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small primary', onclick: async () => {
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/apply-tips`)); await refresh(); updateDetail(true); pollActivity(); startPolling(); toast('Die KI schneidet nach den Tipps neu – die neue Fassung erscheint als v2.'); }
    catch (e) { toast(e.message, true); }
  } }, '⚡ Tipps umsetzen (neu schneiden)'), h('span', { class: 'hint' }, 'als v2 zum Vergleichen'));
}

function renderAi(box, v) {
  const a = v.ai || {};
  const conf = S.settings?.ai?.usable ?? S.settings?.ai?.configured;
  const hint = h('input', { placeholder: 'Hinweis für die KI (optional), z. B. „Thema: 1v3 in Runde 5“' });
  const ask = h('button', { class: 'btn primary', disabled: !conf || ['queued', 'running'].includes(a.state), onclick: async () => {
    try { await detail.ensureSaved(); Object.assign(v, await api('POST', `/api/videos/${v.id}/ai`, { extra: hint.value })); await refresh(); updateDetail(); startPolling(); setTimeout(pollActivity, 1200); }
    catch (x) { toast(x.message, true); }
  } }, a.titles ? '✨ Neuen Vorschlag holen' : '✨ KI-Vorschlag holen');
  const kids = [h('h3', {}, '✨ KI-Vorschlag')];
  if (!conf) kids.push(h('div', { class: 'hint' }, 'Gerade ist keine KI erreichbar' + (S.settings?.ai?.whyNot ? ': ' + S.settings.ai.whyNot : '') + ' – ', h('a', { href: '#einstellungen', onclick: () => setTimeout(() => document.getElementById('s-lokal')?.scrollIntoView({ behavior: 'smooth' }), 400) }, 'Einstellungen → Lokale KI'), '.'));
  if (a.state === 'queued' || a.state === 'running') kids.push(h('div', { class: 'status' }, 'Die KI schaut sich das Video an und schreibt … (mit Claude ca. 20–60 s, lokal evtl. einige Minuten)'));
  if (a.state === 'error') kids.push(h('div', { class: 'status err' }, a.error || 'Fehler'));
  if (a.titles?.length) {
    const d = detail;
    kids.push(
      h('div', { class: 'meta' }, a.summary, a.game ? ' · ' + a.game : '', a.applied ? ' · automatisch übernommen' : '', a.engine ? ' · erstellt von: ' + a.engine : ''),
      h('div', { class: 'ai-titles' }, h('b', {}, 'Titel – anklicken zum Übernehmen:'),
        a.titles.map((t) => h('button', { class: 'btn small ai-pick', onclick: () => d.setField('title', t) }, t))),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => d.setField('description', a.description) }, 'Beschreibung übernehmen'),
        h('button', { class: 'btn small', onclick: () => d.setField('tags', a.tags.join(', ')) }, 'Tags übernehmen'),
        h('button', { class: 'btn small', onclick: () => d.setField('tiktok', a.tiktok) }, 'TikTok-Text übernehmen'),
        h('button', { class: 'btn small primary', onclick: () => {
          d.setField('title', a.titles[0]); d.setField('description', a.description); d.setField('tags', a.tags.join(', ')); d.setField('tiktok', a.tiktok);
          if (a.channel && !d.chan.value) { d.chan.value = a.channel; d.chan.dispatchEvent(new Event('change')); }
          toast('Übernommen – noch speichern.');
        } }, 'Alles übernehmen')),
      v.thumbVariants?.some((t) => !t.gen) ? h('div', {}, h('b', { class: 'meta' }, 'Titelbild-Varianten – anklicken zum Übernehmen:'),
        h('div', { class: 'variants' }, v.thumbVariants.filter((t) => !t.gen).map((t) => {
          const b = h('button', { class: 'variant', title: (t.ai ? 'KI-Aufwertung' : t.text + (t.photo ? ' · ' + t.photo : '')) + ' – als Titelbild nehmen',
            onclick: async () => { try { Object.assign(v, await api('POST', `/api/videos/${v.id}/variant/${t.k}/cover`)); d.setCover(); toast('Titelbild übernommen.'); } catch (x) { toast(x.message, true); } } });
          b.style.backgroundImage = `url("/api/videos/${v.id}/variant/${t.k}?t=${v.thumbVariantsAt || 0}")`;
          const wrap = h('div', { class: 'vwrap' + (t.gen ? ' gen' : '') }, b, t.ai ? h('span', { class: 'chip ok' }, t.gen ? '✨ KI-Titelbild' : '✨ KI-Aufwertung') : null);
          if (!t.ai && S.settings?.fal?.configured) wrap.append(h('button', { class: 'btn small ghost', title: 'Mit fal.ai aufwerten (kostet Guthaben)', onclick: async (e) => {
            e.target.disabled = true; e.target.textContent = '✨ wird aufgewertet …';
            try { Object.assign(v, await api('POST', `/api/videos/${v.id}/variant/${t.k}/boost`)); await refresh(); updateDetail(true); toast('KI-Variante fertig.'); }
            catch (x) { toast(x.message, true); e.target.disabled = false; e.target.textContent = '✨ KI-Aufwertung'; }
          } }, '✨ KI-Aufwertung'));
          return wrap;
        })),
        h('div', { class: 'row' },
          h('button', { class: 'btn small ghost', onclick: async () => { try { Object.assign(v, await api('POST', `/api/videos/${v.id}/variants`)); await refresh(); updateDetail(true); toast('Neu erzeugt.'); } catch (x) { toast(x.message, true); } } }, '↻ Varianten neu bauen (z. B. nach neuen Fotos)')),
        ) : null,
      a.frames?.length ? h('details', {}, h('summary', { class: 'meta' }, 'Standbilder – die KI empfiehlt Bild ' + a.thumbnailFrame + (a.thumbnailText ? ', Text: „' + a.thumbnailText + '“' : '') + ':'),
        h('div', { class: 'frames' }, a.frames.map((n) => {
          const b = h('button', { class: 'frame' + (n === a.thumbnailFrame ? ' best' : ''), title: 'Als Titelbild nehmen', onclick: () => d.setCoverFromFrame(n) });
          b.style.backgroundImage = `url("/api/videos/${v.id}/ai-frame/${n}?t=${encodeURIComponent(a.at)}")`;
          return b;
        }))) : null,
      h('div', { class: 'hint' }, 'Vorschlag vom ' + fmtDate(a.at) + (a.cost ? ' · ca. ' + a.cost.toFixed(3).replace('.', ',') + ' $' : '')));
  }
  if (conf) kids.push(h('div', { class: 'row', style: { marginTop: '8px' } }, hint, ask));
  add(box, ...kids.filter(Boolean)); // add() filtert null
}

// Was soll geschnitten werden? Je Video einstellbar, dazu ein Wunsch in Worten für die KI.
function cutPlanForm(v, c) {
  const p = v.plan || {};
  const pro = isPro(channelOf(v));
  const long = h('input', { type: 'checkbox', checked: p.long !== false });
  const shorts = h('select', {}, [0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => h('option', { value: n, selected: (p.shorts ?? 3) === n }, n === 0 ? 'keine' : String(n))));
  const summary = h('select', {}, [[0, 'keine'], [60, '1 Minute'], [120, '2 Minuten'], [180, '3 Minuten'], [300, '5 Minuten'], [480, '8 Minuten'], [600, '10 Minuten']]
    .map(([n, t]) => h('option', { value: n, selected: (p.summary || 0) === n }, t)));
  const wish = h('textarea', { rows: 2, maxlength: 500, value: p.wish || '',
    placeholder: pro ? 'z. B. „nur den Teil, wo ich die Tasse presse“ oder „Fokus auf das Ergebnis“' : 'z. B. „nur den Bosskampf“, „die lustigsten Momente mit Max“, „ohne das Menü am Anfang“' });
  const plan = () => ({ long: long.checked, shorts: Number(shorts.value), summary: Number(summary.value), wish: wish.value });
  const go = async () => {
    const pl = plan();
    if (!pl.long && !pl.shorts && !pl.summary) return toast('Bitte mindestens eins auswählen.', true);
    if (c?.state === 'done' && !confirm('Nochmal schneiden? Es entstehen zusätzliche Videos unter „Zur Freigabe“.')) return;
    try { await api('POST', `/api/videos/${v.id}/cut`, { force: true, plan: pl }); await refresh(); updateDetail(true); startPolling(); } catch (x) { toast(x.message, true); }
  };
  return h('div', { class: 'cutplan' },
    h('b', {}, 'Was soll entstehen?'),
    h('label', { class: 'check' }, long, 'Langfassung (ganzes Video, ruhige Stellen raus)'),
    h('div', { class: 'two' },
      h('div', {}, h('label', {}, pro ? 'LinkedIn-Clips (4:5)' : 'Shorts / Clips (Hochformat)'), shorts),
      h('div', {}, h('label', {}, 'Kurzfassung (beste Stellen am Stück)'), summary)),
    h('label', {}, 'Dein Wunsch an die KI (optional)'), wish,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      c?.state === 'queued'
        ? h('button', { class: 'btn', onclick: async () => { try { Object.assign(v, await api('POST', `/api/videos/${v.id}/cutplan`, plan())); toast('Gemerkt – wird beim Schnitt so gemacht.'); } catch (x) { toast(x.message, true); } } }, 'Plan merken')
        : null,
      h('button', { class: 'btn primary', onclick: go }, c?.state === 'done' ? '↻ So nochmal schneiden' : c?.state === 'queued' ? '✂ Jetzt so schneiden' : '✂ So schneiden')));
}

function renderCut(box, v) {
  const c = v.cut;
  const kids = [];
  if (v.source?.rawFile) {
    const raw = S.videos.find((x) => x.id === v.source.rawId);
    kids.push(h('div', { class: 'meta' }, '✂ Automatisch geschnitten aus ', raw ? h('a', { href: '#video/' + raw.id }, v.source.rawFile) : v.source.rawFile,
      v.source.kind === 'short' ? ' (Short)' : v.source.kind === 'summary' ? ' (Kurzfassung)' : ' (Langfassung)'));
  }
  if ([...INBOXES, 'rohvideos'].includes(v.folder)) {
    const sec = h('div', { class: 'section' }, h('h3', {}, '✂ Automatischer Schnitt'));
    if (!c) add(sec, h('div', { class: 'status' }, 'Noch nicht geschnitten.'));
    else if (c.state === 'queued' && c.waitPc && !c.now) add(sec, h('div', { class: 'status' }, '🔒 Wartet auf die PC-Analyse – gib die Grafikkarte frei (Einstellungen → Rechenhelfer oder Desktop-Verknüpfung). '
      + `Spätestens ${fmtDate(new Date(Date.parse(c.waitSince) + (S.settings?.helper?.waitHours || 12) * 3600_000))} wird ohne geschnitten; „Jetzt so schneiden“ schneidet sofort ohne.`));
    else if (c.state === 'queued') add(sec, h('div', { class: 'status' }, 'Wartet – es wird immer nur ein Video gleichzeitig geschnitten.'));
    else if (c.state === 'running') add(sec, h('div', { class: 'status' }, (c.step || 'Läuft') + ' …' + (c.progress ? ' ' + c.progress + ' %' : '')),
      h('div', { class: 'bar-progress' }, h('i', { style: { width: (c.progress || 0) + '%' } })));
    else if (c.state === 'error') add(sec, h('div', { class: 'status err' }, c.error || 'Fehler'));
    else if (c.state === 'done') {
      add(sec, h('div', { class: 'status ok-text' }, `✓ ${fmtDate(c.at)}: ${c.outputs?.length || 0} Videos erzeugt` + (c.removed ? `, ${fmtDur(c.removed)} ruhige Abschnitte entfernt` : '')),
        h('div', { class: 'row' }, (c.outputs || []).map((id) => { const o = S.videos.find((x) => x.id === id); return o ? h('a', { class: 'btn small', href: '#video/' + id }, o.title || o.file) : null; })));
    }
    if (c?.warning) add(sec, h('div', { class: 'hint' }, 'Hinweis: ' + c.warning));
    if (c?.signals) add(sec, h('div', { class: 'hint' }, '📡 Signale beim Schnitt: ' + [c.voiceTrack === 'pc' ? 'Stimme vom PC getrennt (Demucs)' : c.voiceTrack ? `Stimme aus Spur ${c.voiceTrack}` : 'Mischspur (keine eigene Stimmspur)',
      c.signals.events ? `${c.signals.events} Geräusch-Marker (Lachen …)` : '', c.signals.twitch ? `${c.signals.twitch} Twitch-Signale` : '', c.signals.scout ? `${c.signals.scout} Momente aus der KI-Durchsicht` : '', c.signals.pc ? `${c.signals.pc} Signale vom PC (Geräusche/Spieltexte)` : ''].filter(Boolean).join(' · ')));
    if (v.analyse?.at) add(sec, h('div', { class: 'hint' }, `🖥 PC-Analyse ${fmtDate(v.analyse.at)}: ${v.analyse.events} Geräusche, ${v.analyse.ocr} Texte${v.analyse.voice ? ', Stimme getrennt' : ''}${v.analyse.took ? ` (${Math.round(v.analyse.took)} s)` : ''}`));
    else if (v.analyse?.error) add(sec, h('div', { class: 'hint' }, '🖥 PC-Analyse ging nicht: ' + v.analyse.error));
    const tws = S.settings?.twitch?.streams || [];
    if (tws.length || v.twitch) {
      const sel = h('select', { class: 'small', onchange: async (e) => {
        const val = e.target.value;
        try { Object.assign(v, await api('POST', `/api/videos/${v.id}/twitch`, val === 'none' ? { none: true } : val ? { streamId: val, offset: 0 } : {})); toast('Gespeichert – gilt beim nächsten Schnitt/Überarbeiten.'); }
        catch (x) { toast(x.message, true); }
      } }, h('option', { value: '' }, 'automatisch zuordnen'), h('option', { value: 'none', selected: !!v.twitch?.none }, 'kein Twitch-Stream'),
      tws.map((x) => h('option', { value: x.id, selected: v.twitch?.streamId === x.id }, `${fmtDate(x.startedAt)} · ${x.title || 'Stream'}${x.messages ? ` (💬 ${x.messages})` : ''}`)));
      add(sec, h('div', { class: 'row' }, h('span', { class: 'hint' }, '🟣 Twitch-Stream:'), sel,
        v.twitch?.streamId ? h('span', { class: 'hint' }, (v.twitch.manual ? 'von Hand' : v.twitch.guessed ? 'vermutet (Länge/Datum)' : 'erkannt') + (v.twitch.offset ? `, Versatz ${Math.round(v.twitch.offset)} s` : '')) : null));
    }
    if (!c || ['done', 'error', 'queued'].includes(c.state)) add(sec, cutPlanForm(v, c));
    kids.push(sec);
  }
  box.replaceChildren(...kids);
}

function renderTranscript(box, v) {
  if (!v.hasTranscript) { box.replaceChildren(); return; }
  const det = h('details', { class: 'section transcript' }, h('summary', {}, '🗣 Gesprochener Text (Whisper)'));
  det.addEventListener('toggle', async () => {
    if (!det.open || det.dataset.loaded) return;
    det.dataset.loaded = '1';
    try {
      const t = await api('GET', `/api/videos/${v.id}/transcript`);
      const body = t.segments?.length
        ? h('div', { class: 'tlines' }, t.segments.map((x) => h('div', {}, h('button', { class: 'time', onclick: () => { const p = document.querySelector('.modal video'); if (p) { p.currentTime = x.s; p.play().catch(() => {}); } } }, fmtDur(x.s) || '0:00'), ' ', x.t)))
        : h('p', {}, t.text || 'Kein Text erkannt.');
      add(det, body, h('button', { class: 'btn small', onclick: () => copy(t.text || '') }, '⧉ Text kopieren'));
    } catch (x) { add(det, h('p', { class: 'err' }, x.message)); }
  });
  box.replaceChildren(det);
}

function updateDetail(force) {
  if (!detail) return;
  const v = S.videos.find((x) => x.id === detail.id);
  if (!v) return;
  const cutSig = JSON.stringify([v.cut, v.folder, v.hasTranscript]);
  if (force || cutSig !== detail.cutSig) { detail.cutSig = cutSig; renderCut(detail.cutBox, v); }
  if (v.hasTranscript !== detail.hasTranscript) { detail.hasTranscript = v.hasTranscript; renderTranscript(detail.transcriptBox, v); }
  const revSig = JSON.stringify([v.revise, v.edit, v.revisionOf, v.revisionKept, v.canRevise, v.folder]);
  if (force || revSig !== detail.revSig) { detail.revSig = revSig; renderRevise(detail.reviseBox, v); }
  const mirSig = JSON.stringify([v.rerender, v.mirror, v.canMirror, v.mirrorSiblings, v.mtime]);
  if (force || mirSig !== detail.mirSig) {
    // neu gerechnet → Video neu laden (gleiche Adresse, neue Datei)
    if (detail.mirSig && v.rerender?.state === 'done' && JSON.parse(detail.mirSig)[0]?.state !== 'done') detail.player.src = `/api/videos/${v.id}/file?v=${Math.round(v.mtime || Date.now())}`;
    detail.mirSig = mirSig; renderMirror(detail.mirrorBox, v);
  }
  const aiChanged = force === true || JSON.stringify([v.ai || null, v.thumbVariantsAt || 0, v.revise || null, v.viral || null, v.qc || null, v.perf || null]) !== detail.aiSeen;
  if (aiChanged) {
    detail.aiSeen = JSON.stringify([v.ai || null, v.thumbVariantsAt || 0, v.revise || null, v.viral || null, v.qc || null, v.perf || null]);
    Object.assign(detail.v, { revise: v.revise, tipsApplied: v.tipsApplied, canRevise: v.canRevise });
    // Vorschlag wurde serverseitig übernommen und hier ist nichts ungespeichert → Felder auffrischen
    if (v.ai?.applied && v.ai?.state === 'done' && !detail.isDirty()) {
      for (const k of ['title', 'description', 'tags', 'tiktok']) detail.f[k].value = v[k] || '';
      for (const k of ['title', 'description', 'tags', 'tiktok']) detail.f[k].dispatchEvent(new Event('input'));
      detail.markClean();
      detail.v.title = v.title;
    }
    Object.assign(detail.v, { ai: v.ai, suggestion: v.suggestion, hasImage: v.hasImage, imageVersion: v.imageVersion, image: v.image,
      thumbVariants: v.thumbVariants, thumbVariantsAt: v.thumbVariantsAt });
    detail.setCover(); detail.chanInfo();
    detail.aiBox.replaceChildren(); Object.assign(detail.v, { viral: v.viral, qc: v.qc, perf: v.perf, edit: v.edit });
    const vb = renderViral(detail.v); if (vb) detail.aiBox.append(vb);
    const qb = renderQc(detail.v); if (qb) detail.aiBox.append(qb);
    renderAi(detail.aiBox, detail.v);
    renderGenThumbs(detail.genBox, detail.v);
  }
  // Felder nicht überschreiben, nur Status-Teile
  Object.assign(detail.v, { yt: v.yt, tt: v.tt, li: v.li, folder: v.folder, file: v.file, hasImage: v.hasImage, imageVersion: v.imageVersion });
  if (!detail.chan.value && v.suggestion?.id !== detail.v.suggestion?.id) { detail.v.suggestion = v.suggestion; detail.chanInfo(); }
  const target = profileOf(detail.chan.value) || channelOf(detail.v);
  detail.applyMode(isPro(target));
  if (isPro(target)) { linkedinBox(detail.ytBox, detail.v); detail.ttBox.replaceChildren(); }
  else {
    platformBox(detail.ytBox, detail.v, 'yt', 'YouTube', 'var(--yt)');
    platformBox(detail.ttBox, detail.v, 'tt', 'TikTok', 'var(--tt)');
  }
  const mv = async (folder, msg) => {
    try { await detail.ensureSaved(); await api('POST', `/api/videos/${v.id}/move`, { folder }); await refresh(); toast(msg); go(folder); }
    catch (x) { toast(x.message, true); }
  };
  detail.folderEl.textContent = 'Ordner: ' + FOLDER_NAMES[v.folder] + (v.folder === 'hochgeladen' ? ' (Archiv)' : '');
  const b = [];
  if (INBOXES.includes(v.folder)) b.push(h('button', { class: 'btn', onclick: () => mv('geschnitten', 'Zur Freigabe verschoben.') }, '→ Zur Freigabe (ohne Schnitt)'));
  if (v.folder === 'geschnitten') {
    b.push(h('button', { class: 'btn', onclick: () => mv('hochgeladen', 'Ins Archiv verschoben.') }, '✓ Fertig – ins Archiv'));
    b.push(h('button', { class: 'btn ghost', onclick: () => mv('eingang', 'Zurück in den Eingang.') }, '← Zurück in den Eingang'));
  }
  if (v.folder === 'hochgeladen') b.push(h('button', { class: 'btn ghost', onclick: () => mv('geschnitten', 'Zurück zur Freigabe.') }, '← Zurück zur Freigabe'));
  if (v.folder === 'papierkorb') {
    b.push(h('button', { class: 'btn primary', onclick: async () => {
      try { Object.assign(v, await api('POST', `/api/videos/${v.id}/restore`)); await refresh(); updateCounts(); toast('Wiederhergestellt (' + FOLDER_NAMES[v.folder] + ').'); go(v.folder); }
      catch (x) { toast(x.message, true); }
    } }, '↩ Wiederherstellen'));
    b.push(h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm(`„${v.title || v.file}“ endgültig löschen?\n\nVideo, Titelbild und Texte werden vom Server entfernt. Das lässt sich nicht rückgängig machen.`)) return;
      try { await api('DELETE', `/api/videos/${v.id}`); await refresh(); updateCounts(); toast('Endgültig gelöscht.'); go('papierkorb'); }
      catch (x) { toast(x.message, true); }
    } }, '✕ Endgültig löschen'));
  } else {
    b.push(h('button', { class: 'btn ghost danger', onclick: async () => {
      const where = v.yt?.id || v.li?.state === 'done' || v.tt?.state === 'done' ? '\n\nHinweis: Auf YouTube/TikTok/LinkedIn bleibt das Video bestehen – dort bei Bedarf selbst löschen.' : '';
      if (!confirm(`„${v.title || v.file}“ in den Papierkorb legen?\n\nDu kannst es dort wiederherstellen.${where}`)) return;
      try { await detail.ensureSaved().catch(() => {}); await api('POST', `/api/videos/${v.id}/trash`); await refresh(); updateCounts(); toast('In den Papierkorb gelegt.'); go(v.folder); }
      catch (x) { toast(x.message, true); }
    } }, '🗑 Löschen'));
  }
  detail.moveBox.replaceChildren(...b);
}

// ---------- Hochladen in die Zentrale ----------
function bindDrop() {
  if (bindDrop.done) return; bindDrop.done = true;
  let overlay = null, depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; if (!overlay) { overlay = h('div', { class: 'drop' }, S.tab === 'eingang' ? 'Loslassen → Eingang' : 'Loslassen → Zur Freigabe'); document.body.append(overlay); } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; overlay?.remove(); overlay = null; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; overlay?.remove(); overlay = null; uploadFiles([...e.dataTransfer.files]); });
}

let uploadsEl = null;
function uploadFiles(files) {
  const folder = S.tab === 'eingang' ? 'eingang' : 'geschnitten';
  // Begleitdateien (Bild/.json) nach den Videos, damit sie dem Video zugeordnet werden.
  files.sort((a, b) => (/\.(jpe?g|png|webp|json)$/i.test(a.name) ? 1 : 0) - (/\.(jpe?g|png|webp|json)$/i.test(b.name) ? 1 : 0));
  if (!uploadsEl) { uploadsEl = h('div', { class: 'uploads' }); document.body.append(uploadsEl); }
  let chain = Promise.resolve();
  for (const file of files) {
    const bar = h('i', { style: { width: '0%' } });
    const label = h('div', {}, file.name);
    const item = h('div', { class: 'upl' }, label, h('div', { class: 'bar-progress' }, bar));
    uploadsEl.append(item);
    const isVideo = /\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name);
    chain = chain.then(() => (isVideo && file.size > CHUNK_UP ? uploadChunked(file, folder, bar, label, item) : uploadWhole(file, folder, bar, label, item)));
  }
  chain.then(async () => { await api('POST', '/api/scan').catch(() => {}); await refresh(); renderMain(); updateCounts(); });
}

// Ein Stück (oder eine kleine Datei) per XHR schicken → Promise mit { status, json }
function xhrPost(url, body, onProgress) {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('X-Zentrale', '1');
    x.timeout = 10 * 60 * 1000;   // ein Stück darf höchstens 10 Min. dauern, sonst neu versuchen
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { } resolve({ status: x.status, json: j }); };
    x.onerror = () => resolve({ status: 0, json: { error: 'Verbindung abgebrochen' } });
    x.ontimeout = () => resolve({ status: 0, json: { error: 'Zeitüberschreitung' } });
    x.send(body);
  });
}
const uploadDone = (label, item, name) => { label.textContent = '✓ ' + name; setTimeout(() => item.remove(), 3000); };
const uploadFail = (label, item, name, msg) => { label.textContent = '✗ ' + name + ': ' + msg; item.style.borderColor = 'var(--bad)'; setTimeout(() => item.remove(), 15000); };
async function uploadWhole(file, folder, bar, label, item) {
  const r = await xhrPost(`/api/upload?folder=${folder}&name=${encodeURIComponent(file.name)}`, file, (n) => { bar.style.width = (n / file.size * 100) + '%'; });
  if (r.status === 200) uploadDone(label, item, file.name); else uploadFail(label, item, file.name, r.json.error || r.status || 'Verbindung abgebrochen');
}
// Große Videos in 32-MB-Stücken: jedes Stück einzeln, bei Fehler bis zu 10 Versuche, Fortsetzen am Stand des Servers.
const CHUNK_UP = 32 * 1024 * 1024;
let uploadsRunning = 0;
window.addEventListener('beforeunload', (e) => { if (uploadsRunning) { e.preventDefault(); e.returnValue = ''; } });
async function uploadChunked(file, folder, bar, label, item) {
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const base = `/api/upload/chunk?id=${id}&folder=${folder}&name=${encodeURIComponent(file.name)}&total=${file.size}`;
  const mb = (n) => Math.round(n / 1048576).toLocaleString('de-DE');
  let offset = 0, tries = 0; const t0 = Date.now();
  uploadsRunning++;
  try {
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_UP, file.size);
      const show = (n) => {
        const done = offset + n, sec = (Date.now() - t0) / 1000, speed = done / Math.max(1, sec);
        bar.style.width = (done / file.size * 100) + '%';
        label.textContent = `${file.name} · ${Math.floor(done / file.size * 100)} % (${mb(done)} von ${mb(file.size)} MB` +
          (sec > 3 ? `, ${(speed / 1048576).toFixed(1).replace('.', ',')} MB/s, noch ca. ${Math.max(1, Math.ceil((file.size - done) / speed / 60))} Min.)` : ')') +
          (tries ? ` · Versuch ${tries + 1}` : '');
      };
      const r = await xhrPost(`${base}&offset=${offset}`, file.slice(offset, end), show);
      if (r.status === 200) { offset = r.json.size; tries = 0; show(0); if (r.json.done) break; continue; }
      if (r.status === 409 && Number.isFinite(r.json.size)) { offset = r.json.size; continue; }   // Server hat schon mehr/weniger → dort weiter
      if (r.status >= 400 && r.status < 500) throw new Error(r.json.error || 'abgelehnt (' + r.status + ')');
      if (++tries > 10) throw new Error((r.json.error || 'Fehler ' + r.status) + ' – nach 10 Versuchen aufgegeben bei ' + Math.floor(offset / file.size * 100) + ' %');
      await new Promise((res) => setTimeout(res, Math.min(30000, 2000 * tries)));
      const st = await fetch(`${base}`, { headers: { 'X-Zentrale': '1' } }).then((x) => x.json()).catch(() => null);
      if (st && Number.isFinite(st.size)) offset = st.size;
    }
    uploadDone(label, item, file.name);
  } catch (e) { uploadFail(label, item, file.name, e.message); }
  finally { uploadsRunning--; }
}

// ---------- Schnitt-Infos + Überarbeiten (Shorts) ----------
const REVISE_CHIPS = ['Hook stärker – mit dem Höhepunkt einsteigen', 'Kürzer und schneller', 'Länger, mehr Vorgeschichte', 'Anderes Ende – nach der Pointe aufhören',
  'Ohne Musik', 'Andere Stelle aus dem Video nehmen', 'Weniger Schnitte, ruhiger', 'Mehr Effekte (Emojis, Sounds)', 'Weniger Effekte', 'Ohne Effekte'];
const REVISE_CHIPS_LONG = ['Intro raus (Lobby, Ladebildschirm, Menü, Warten)', 'Langweilige Stellen raus', 'Nur die besten Stellen – deutlich kürzer',
  'Teaser mit dem Höhepunkt am Anfang', 'Weniger Pausen (schneller)', 'Outro/Ende kürzen', 'Ohne Musik', 'Mit Musik'];
// Text-Vorlagen (vom Server einmal geladen)
const CAP = { styles: [], looks: [] };
async function loadCaptionStyles() { try { Object.assign(CAP, await api('GET', '/api/caption-styles')); } catch { /* egal */ } }
// Galerie: alle Untertitel-Stile als bewegte Vorschau; onPick(styleId, hookLook)
function styleGallery(onPick, current = {}) {
  const close = () => modal.remove();
  let look = current.hookLook && current.hookLook !== 'auto' ? current.hookLook : 'kasten';
  const grid = h('div', { class: 'stylegrid' });
  const fill = () => grid.replaceChildren(...CAP.styles.map((x) => h('button', { class: 'stylecard' + (current.style === x.id ? ' sel' : ''), onclick: () => { onPick(x.id, look); close(); } },
    h('div', { class: 'stylethumb', style: { backgroundImage: `url("/api/caption-preview/${x.id}?look=${look}&poster=1")` } },
      h('video', { src: `/api/caption-preview/${x.id}?look=${look}`, autoplay: true, muted: true, loop: true, playsinline: true, preload: 'auto', onplaying: (e) => e.target.classList.add('on') })),
    h('b', {}, x.name), h('span', { class: 'hint' }, x.desc))));
  const looks = h('div', { class: 'chips' }, h('span', { class: 'hint' }, 'Hook-Look:'), CAP.looks.map((x) => h('button', { class: 'chip-btn' + (x.id === look ? ' on' : ''), onclick: (e) => {
    look = x.id; for (const b of looks.querySelectorAll('.chip-btn')) b.classList.toggle('on', b === e.currentTarget); fill();
  } }, x.name)));
  fill();
  const modal = h('div', { class: 'modal sheetmodal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet wide' }, h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'), h('h2', {}, '🔤 Text-Vorlagen'),
      h('p', { class: 'hint' }, 'Antippen zum Auswählen. Die Vorschau zeigt Untertitel und Hook-Text (Schlüsselwörter wie „3“ und „Gegner“ werden hervorgehoben).'), looks, grid));
  document.body.append(modal);
}

// ✏️ Eingeblendete Texte eines Shorts: ansehen, ändern, von der KI neu schreiben lassen → mit gleichem Schnitt neu rechnen
async function textsEditor(v) {
  let cur;
  try { cur = await api('GET', `/api/videos/${v.id}/texts`); } catch (x) { return toast(x.message, true); }
  const close = () => modal.remove();
  const hookIn = cur.hook != null ? h('input', { value: cur.hook, maxlength: 60, placeholder: 'leer = kein Hook-Text' }) : null;
  const KIND = { freeze: '⏸ Freeze', replay: '🐢 Zeitlupe', text: '💬 Text' };
  const rows = cur.items.map((x) => ({ i: x.i, input: h('input', { value: x.text, maxlength: 42 }), label: `${KIND[x.kind] || x.kind} bei ${x.at.toFixed(1).replace('.', ',')} s` }));
  const wish = h('input', { placeholder: 'Wunsch an die KI (optional), z. B. „frecher“, „auf Englisch“, „mehr Spannung“' });
  const note = h('p', { class: 'hint' });
  const genBtn = h('button', { class: 'btn small', onclick: async () => {
    genBtn.disabled = true; genBtn.textContent = '⏳ KI schreibt …'; note.textContent = '';
    try {
      const r = await api('POST', `/api/videos/${v.id}/texts/suggest`, { wish: wish.value.trim() });
      if (hookIn && r.hook != null) hookIn.value = r.hook;
      for (const x of r.items || []) { const row = rows.find((y) => y.i === x.i); if (row) row.input.value = x.text; }
      note.textContent = `Vorschlag eingesetzt${r.engine ? ' (' + r.engine + ')' : ''} – prüfen, ggf. anpassen, dann übernehmen.`;
    } catch (x) { note.textContent = '✗ ' + x.message; }
    genBtn.disabled = false; genBtn.textContent = '🔄 Neu erzeugen (KI)';
  } }, '🔄 Neu erzeugen (KI)');
  const save = h('button', { class: 'btn primary', disabled: !!cur.why, onclick: async () => {
    try {
      Object.assign(v, await api('POST', `/api/videos/${v.id}/texts`, { hook: hookIn ? hookIn.value : undefined, items: rows.map((r) => ({ i: r.i, text: r.input.value })) }));
      toast('Texte übernommen – wird mit gleichem Schnitt neu gerechnet …'); close(); await refresh(); updateDetail(true); pollActivity(); startPolling();
    } catch (x) { toast(x.message, true); }
  } }, '✓ Übernehmen & neu rechnen');
  const empty = !hookIn && !rows.length;
  const modal = h('div', { class: 'modal sheetmodal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet narrow' }, h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'), h('h2', {}, '✏️ Eingeblendete Texte'),
      empty ? h('p', { class: 'hint' }, 'Dieser Short hat keine eingeblendeten Texte (kein Hook-Text, keine Freeze-/Zeitlupen-/Text-Effekte). Die Untertitel kommen aus dem Gesprochenen.')
        : h('div', {},
          h('p', { class: 'hint' }, 'Gleiche Texte werden nur einmal eingeblendet, Wortwiederholungen („WARTE WARTE“) fasst die Zentrale zusammen. Leeres Feld = Text weglassen.'),
          hookIn ? [h('label', {}, '⚡ Hook-Text (erstes Bild)'), hookIn] : null,
          rows.flatMap((r) => [h('label', {}, r.label), r.input]),
          h('div', { class: 'row', style: { marginTop: '10px' } }, wish, genBtn), note,
          cur.why ? h('p', { class: 'err' }, cur.why) : null,
          h('div', { class: 'row', style: { marginTop: '10px' } }, save))));
  document.body.append(modal);
}

// 🎥 Facecam-Rahmen und Bildaufbau eines Shorts von Hand setzen (Standbild aus dem Rohvideo, Rahmen ziehen)
function camEditor(v) {
  const mirror = !!v.rawInfo?.mirror;
  const flip = (c) => (c && mirror ? { ...c, x: 1 - c.x - c.w } : c);   // Rohvideo ↔ so wie im fertigen Video
  const L0 = v.edit?.layout || v.source.layout || { mode: 'crop', focus: 0.5 };
  const st = { mode: L0.mode || 'crop', cam: flip(L0.cam) || { x: 0.68, y: 0.05, w: 0.28, h: 0.3 }, focus: mirror ? 1 - (L0.focus ?? 0.5) : (L0.focus ?? 0.5) };
  const close = () => modal.remove();
  const ar = v.rawInfo.width / v.rawInfo.height;
  const img = h('img', { alt: '', draggable: false, style: { transform: mirror ? 'scaleX(-1)' : '' } });
  const load = (t) => { img.src = `/api/videos/${v.id}/layout-frame?t=${t.toFixed(1)}&_=${Date.now()}`; };
  const box = h('div', { class: 'cambox' }, ...['nw', 'ne', 'sw', 'se'].map((k) => h('i', { class: 'h ' + k, 'data-k': k })));
  const focusLine = h('div', { class: 'focusline' });
  const stage = h('div', { class: 'camstage', style: { aspectRatio: String(ar) } }, img, focusLine, box);
  const paint = () => {
    const c = st.cam;
    Object.assign(box.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%', display: st.mode === 'cam' ? '' : 'none' });
    focusLine.style.left = st.focus * 100 + '%';
    focusLine.style.display = st.mode === 'blur' ? 'none' : '';
  };
  // Ziehen (Rahmen verschieben) und an den Ecken aufziehen
  let drag = null;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  box.addEventListener('pointerdown', (e) => { e.preventDefault(); box.setPointerCapture(e.pointerId); drag = { k: e.target.dataset.k || 'move', p: rel(e), c: { ...st.cam } }; });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = rel(e), dx = p.x - drag.p.x, dy = p.y - drag.p.y, c0 = drag.c, min = 0.04;
    let { x, y, w, h: hh } = c0;
    if (drag.k === 'move') { x = clamp(c0.x + dx, 0, 1 - c0.w); y = clamp(c0.y + dy, 0, 1 - c0.h); }
    else {
      if (drag.k.includes('w')) { x = clamp(c0.x + dx, 0, c0.x + c0.w - min); w = c0.x + c0.w - x; }
      if (drag.k.includes('e')) w = clamp(c0.w + dx, min, 1 - c0.x);
      if (drag.k.includes('n')) { y = clamp(c0.y + dy, 0, c0.y + c0.h - min); hh = c0.y + c0.h - y; }
      if (drag.k.includes('s')) hh = clamp(c0.h + dy, min, 1 - c0.y);
    }
    st.cam = { x, y, w, h: hh }; paint();
  });
  box.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('pointerdown', (e) => { if (e.target === img || e.target === stage || e.target === focusLine) { if (st.mode !== 'blur') { st.focus = clamp(rel(e).x, 0, 1); paint(); } } });
  const modeSel = h('div', { class: 'chips' }, Object.entries({ cam: '🎥 Facecam oben + Spiel', crop: '✂ Ausschnitt', blur: '🌫 ganzes Bild + Blur' }).map(([k, n]) =>
    h('button', { class: 'chip-btn' + (st.mode === k ? ' on' : ''), onclick: (e) => { st.mode = k; for (const b of modeSel.querySelectorAll('.chip-btn')) b.classList.toggle('on', b === e.currentTarget); paint(); } }, n)));
  const t0 = v.source.start, t1 = v.source.end;
  const time = h('input', { type: 'range', min: t0, max: t1, step: 0.5, value: (t0 + t1) / 2, onchange: () => load(Number(time.value)) });
  const remember = h('input', { type: 'checkbox', checked: true });
  const save = h('button', { class: 'btn primary', onclick: async () => {
    try {
      const cam = st.mode === 'cam' ? flip(st.cam) : null;
      Object.assign(v, await api('POST', `/api/videos/${v.id}/layout`, { mode: st.mode, cam, focus: mirror ? 1 - st.focus : st.focus, remember: remember.checked && st.mode === 'cam' }));
      toast('Wird mit neuem Bildaufbau neu gerechnet …'); close(); await refresh(); updateDetail(true); pollActivity(); startPolling();
    } catch (x) { toast(x.message, true); }
  } }, '✓ Übernehmen & neu rechnen');
  const modal = h('div', { class: 'modal sheetmodal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet wide' }, h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'), h('h2', {}, '🎥 Facecam & Bildaufbau'),
      h('p', { class: 'hint' }, 'Rahmen genau um das Kamerabild ziehen (an den Ecken größer/kleiner). Klick ins Bild setzt die Mitte des Spiel-Ausschnitts (gestrichelte Linie).'),
      L0.cam2 ? h('p', { class: 'hint' }, '⚠ In diesem Clip wechselt die Facecam die Position (automatisch erkannt). Von Hand gilt ein Rahmen für den ganzen Clip.') : null,
      modeSel, stage,
      h('div', { class: 'row', style: { alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, h('span', { class: 'hint' }, 'Stelle im Clip:'), time),
      h('label', { class: 'check', style: { marginTop: '6px' } }, remember, 'Diesen Facecam-Rahmen für den Kanal merken (künftige Clips nehmen ihn automatisch, wenn die Facecam dort sitzt)'),
      h('div', { class: 'row', style: { marginTop: '10px' } }, save, h('button', { class: 'btn ghost', onclick: close }, 'Abbrechen'))));
  document.body.append(modal);
  load(Number(time.value)); paint();
}

// Titelbild als erstes Bild ins Video (beim Hochladen, Original bleibt)
function coverFrameSel(v) {
  const chan = profilesList().find((p) => p.id === (v.channel || v.suggestion?.id));
  const names = { aus: 'aus', bild: 'als erstes Bild', kurz: '0,4 s stehend' };
  const sel = h('select', { onchange: async () => {
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/cover-frame`, { mode: sel.value })); toast('Gespeichert.'); }
    catch (x) { toast(x.message, true); }
  } }, h('option', { value: '', selected: v.coverFrame == null }, `wie Kanal (${names[chan?.coverFrame || 'aus']})`),
  Object.entries(names).map(([k, n]) => h('option', { value: k, selected: v.coverFrame === k }, n)));
  return h('label', { class: 'hint', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }, title: 'Beim Hochladen wird eine Kopie mit dem Titelbild am Anfang gebaut – Vorschauen (Shorts, TikTok, WhatsApp) zeigen dann dein Titelbild. Das Original bleibt unverändert.' },
    '🖼 Titelbild vorne ins Video:', sel);
}

// 🪞 Spiegeln: Bild waagerecht spiegeln (z. B. gespiegelte Facecam/Schrift). Erzeugte Texte bleiben lesbar.
function renderMirror(box, v) {
  const st = v.rerender?.state;
  const kids = [];
  if (st === 'queued' || st === 'running') {
    kids.push(h('div', { class: 'status' }, '🪞 ' + (v.rerender.reason || 'Neu rechnen') + ': ' + (st === 'queued' ? 'wartet …' : (v.rerender.step || 'läuft') + ' …') + (v.rerender.progress ? ` ${v.rerender.progress} %` : '')),
      h('div', { class: 'bar-progress' }, h('i', { style: { width: (v.rerender.progress || 0) + '%' } })));
    box.replaceChildren(...kids);
    return;
  }
  if (st === 'error') kids.push(h('p', { class: 'err' }, '✗ ' + v.rerender.error));
  if (st === 'done' && v.rerender.doneAt && Date.now() - Date.parse(v.rerender.doneAt) < 10 * 60e3) kids.push(h('p', { class: 'ok-text' }, '✓ ' + (v.rerender.reason || 'Neu gerechnet') + ' – fertig.'));
  const isRawV = !v.source && ['eingang', 'eingang-profi', 'rohvideos'].includes(String(v.folder || '').split('/')[0]);
  const sib = v.mirrorSiblings || 0;
  const children = sib > 0 ? h('input', { type: 'checkbox', checked: isRawV }) : null;
  const run = async () => {
    try {
      const r = await api('POST', `/api/videos/${v.id}/mirror`, { children: !!children?.checked });
      Object.assign(v, r);
      const n = r.mirrorResult?.queued?.length || 0;
      toast(isRawV ? (r.mirror ? 'Rohvideo wird beim Schneiden gespiegelt.' : 'Spiegeln aufgehoben.') + (n ? ` ${n} Video(s) werden neu gerechnet.` : '')
        : (n > 1 ? `${n} Videos werden neu gerechnet.` : 'Wird neu gerechnet …'));
      await refresh(); updateDetail(true); pollActivity(); startPolling();
    } catch (x) { toast(x.message, true); }
  };
  // Text-Stil eines Shorts: andere Vorlage wählen → gleicher Schnitt, neu gerechnet
  if (v.source?.kind === 'short' && v.edit?.style && v.canMirror === true) {
    const cur = CAP.styles.find((x) => x.id === v.edit.style);
    const look = CAP.looks.find((x) => x.id === v.edit.hookLook);
    kids.push(h('div', { class: 'row', style: { alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
      h('span', { class: 'hint' }, `🔤 Text: ${cur?.name || v.edit.style}${look ? ' · Hook: ' + look.name : ''}`),
      h('button', { class: 'btn small', onclick: () => styleGallery(async (style, hookLook) => {
        try { Object.assign(v, await api('POST', `/api/videos/${v.id}/text-style`, { style, hookLook })); toast('Wird mit neuem Text-Stil neu gerechnet …'); await refresh(); updateDetail(true); pollActivity(); startPolling(); }
        catch (x) { toast(x.message, true); }
      }, v.edit) }, '🔤 Text-Stil ändern')));
  }
  // Eingeblendete Texte (Hook-Text, Freeze/Zeitlupe/Text) ändern oder neu schreiben lassen
  if (v.source?.kind === 'short' && v.canMirror === true) {
    kids.push(h('div', { class: 'row', style: { alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
      h('span', { class: 'hint' }, '✏️ Eingeblendete Texte'),
      h('button', { class: 'btn small', onclick: () => textsEditor(v) }, '✏️ Texte ändern / neu erzeugen')));
  }
  // Bildaufbau/Facecam von Hand (nur Shorts aus Querformat)
  if (v.source?.kind === 'short' && v.rawInfo && v.rawInfo.width > v.rawInfo.height && v.canMirror === true) {
    const L = v.edit?.layout || v.source.layout;
    const names = { cam: 'Facecam oben + Spiel', crop: 'Ausschnitt', blur: 'ganzes Bild + Blur' };
    kids.push(h('div', { class: 'row', style: { alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
      h('span', { class: 'hint' }, `🎥 Bild: ${names[L?.mode] || 'Ausschnitt'}${L?.manual ? ' (von Hand)' : ''}`),
      h('button', { class: 'btn small', onclick: () => camEditor(v) }, '🎥 Facecam / Ausschnitt korrigieren')));
  }
  if (v.canMirror !== true && !isRawV) kids.push(h('span', { class: 'hint' }, '🪞 ' + v.canMirror));
  else {
    kids.push(h('div', { class: 'row', style: { alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small' + (v.mirror ? ' primary' : ''), onclick: run }, v.mirror ? '🪞 Gespiegelt – zurückspiegeln' : '🪞 Video spiegeln'),
      children ? h('label', { class: 'check hint', style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1 1 200px', minWidth: 0 } }, children,
        isRawV ? `auch die ${sib} schon geschnittenen Videos neu rechnen` : `auch die ${sib} anderen Videos dieser Aufnahme`) : null),
      h('p', { class: 'hint' }, isRawV ? 'Gilt für alle Schnitte und Überarbeitungen aus dieser Aufnahme. Untertitel, Hook-Texte und Effekte bleiben lesbar.'
        : v.source ? 'Rechnet das Video mit gleichem Schnitt neu – nur das Bild wird gespiegelt, Untertitel und Texte bleiben lesbar. Dauert etwa so lange wie der Schnitt.'
          : 'Spiegelt das Bild der Datei (Ton bleibt).'));
  }
  box.replaceChildren(...kids);
}

function renderRevise(box, v) {
  const act = (fn, msg) => async () => { try { if ((await fn()) !== false && msg) toast(msg); } catch (x) { toast(x.message, true); } };
  const kids = [];
  if (v.edit?.how) kids.push(h('p', { class: 'hint' }, '⚡ ' + v.edit.how));
  // neue Fassung: vergleichen und entscheiden
  if (v.revisionOf) {
    const old = S.videos.find((x) => x.id === v.revisionOf);
    kids.push(h('div', { class: 'rev-new' },
      h('b', {}, '🔁 Überarbeitete Fassung'),
      h('p', {}, 'Dein Wunsch: „' + (v.revisionWish || '') + '“'),
      v.revisionChanges ? h('p', { class: 'hint' }, 'KI: ' + v.revisionChanges) : null,
      v.revisionKept ? h('p', { class: 'ok-text' }, '✓ Behalten – die vorherige Fassung liegt im Papierkorb.')
        : h('div', { class: 'row' },
          old && old.folder !== 'papierkorb' ? h('button', { class: 'btn small primary', onclick: act(async () => { await api('POST', `/api/videos/${v.id}/keep-revision`); await refresh(); updateDetail(true); }, 'Behalten – die vorherige liegt im Papierkorb.') }, '✓ Diese behalten') : null,
          old ? h('button', { class: 'btn small', onclick: () => go('video/' + old.id) }, '◀ Vorherige ansehen') : null,
          h('button', { class: 'btn small ghost', onclick: act(async () => { if (!confirm('Diese neue Fassung verwerfen (Papierkorb)?')) return false; await api('POST', `/api/videos/${v.id}/trash`); await refresh(); if (old) go('video/' + old.id); }, 'Neue Fassung verworfen.') }, '✗ Verwerfen'))));
  }
  if (v.canRevise !== undefined) {
    const st = v.revise?.state;
    const sec = h('div', { class: 'section rev' }, h('h3', {}, '🔁 Überarbeiten'));
    if (st === 'queued' || st === 'running') {
      sec.append(h('div', { class: 'status' }, (st === 'queued' ? 'Wartet …' : (v.revise.step || 'Läuft') + ' …') + (v.revise.progress ? ` ${v.revise.progress} %` : '')),
        h('div', { class: 'bar-progress' }, h('i', { style: { width: (v.revise.progress || 0) + '%' } })),
        h('p', { class: 'hint' }, 'Wunsch: „' + v.revise.wish + '“'));
    } else if (v.canRevise !== true) {
      sec.append(h('p', { class: 'hint' }, v.canRevise));
    } else {
      if (st === 'done' && v.revise.newId) {
        sec.append(h('p', { class: 'ok-text' }, '✓ Neue Fassung fertig: ', h('a', { href: '#video/' + v.revise.newId }, v.revise.newFile || 'öffnen')));
      }
      if (st === 'error') sec.append(h('p', { class: 'err' }, '✗ ' + v.revise.error));
      const isShort = v.source?.kind === 'short';
      const wish = h('textarea', { rows: 2, maxlength: 500, placeholder: isShort ? 'Was soll anders werden? z. B. „Fang mit dem Sniper-Kill an und lass das Gelaber am Ende weg“'
        : 'Was soll anders werden? z. B. „Intro raus, nur die besten 10 Minuten, mit Teaser vorne“' });
      const add = (c) => { wish.value = wish.value.trim() ? wish.value.trim().replace(/[.;,]?$/, '; ') + c : c; wish.focus(); };
      const chips = h('div', { class: 'chips' }, (isShort ? REVISE_CHIPS : REVISE_CHIPS_LONG).map((c) => h('button', { class: 'chip-btn', onclick: () => add(c) }, c)));
      const target = isShort ? null : h('input', { type: 'number', min: 1, max: 120, placeholder: 'z. B. 10', style: { width: '90px' } });
      sec.append(...[h('p', { class: 'hint' }, (isShort ? 'Die KI schneidet den Clip aus dem Rohvideo neu.' : 'Die KI sieht sich die ganze Aufnahme an und schneidet die Fassung aus dem Rohvideo neu.')
          + ' Die neue Fassung erscheint daneben als „v2“ – du entscheidest, welche bleibt.'),
        chips, wish,
        target ? h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'center' } }, h('span', { class: 'hint' }, 'Ziellänge (Minuten, optional):'), target,
          h('button', { class: 'chip-btn', onclick: () => target.value && add(`Ziellänge ca. ${target.value} Minuten`) }, 'übernehmen')) : null,
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: act(async () => {
          if (wish.value.trim().length < 3) throw new Error('Bitte kurz beschreiben, was anders werden soll.');
          Object.assign(v, await api('POST', `/api/videos/${v.id}/revise`, { wish: wish.value.trim() }));
          await refresh(); updateDetail(true); pollActivity(); startPolling();
        }, 'Überarbeitung gestartet.') }, '🔁 Überarbeiten lassen'))].filter(Boolean));
    }
    kids.push(sec);
  }
  box.replaceChildren(...kids);
}

// ---------- Bestand in die neue Ordnung umstellen (Vorschau → Themen erkennen → umstellen) ----------
// 🎬 Kanal-Trailer / Highlight-Video quer über alle Videos eines Kanals
async function trailerDialog() {
  const close = () => { clearTimeout(timer); modal.remove(); };
  let timer = null;
  const chans = profilesList().filter((p) => !isPro(p));
  const st = { profileId: S.channel && chans.some((p) => p.id === S.channel) ? S.channel : (chans.find((p) => p.isDefault) || chans[0])?.id, seconds: 180, format: '16:9', days: 0 };
  const body = h('div', {});
  const modal = h('div', { class: 'modal sheetmodal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet' }, h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'), h('h2', {}, '🎬 Highlight-Video / Kanal-Trailer'), body));
  document.body.append(modal);
  const sel = (key, opts, onch) => h('select', { onchange: (e) => { st[key] = isNaN(e.target.value) ? e.target.value : Number(e.target.value); onch?.(); } },
    opts.map(([k, n]) => h('option', { value: k, selected: String(st[key]) === String(k) }, n)));
  const wish = h('input', { placeholder: 'Wunsch an die KI (optional), z. B. „nur Rage-Momente“, „viel Fortnite“' });
  const cIntro = h('input', { type: 'checkbox', checked: true }), cWm = h('input', { type: 'checkbox', checked: true }), cLab = h('input', { type: 'checkbox', checked: true });
  const draw = async () => {
    clearTimeout(timer);
    let d;
    try { d = await api('GET', `/api/trailer?profile=${encodeURIComponent(st.profileId || '')}&days=${st.days}`); } catch (x) { body.replaceChildren(h('p', { class: 'bad' }, x.message)); return; }
    const pv = d.preview || { count: 0 };
    const logoImg = pv.logo ? h('img', { class: 'logo-prev', src: `/api/profiles/${st.profileId}/logo?v=${encodeURIComponent(pv.logo.at || '')}`, alt: 'Logo' }) : h('div', { class: 'logo-prev empty' }, 'kein Logo');
    const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await api('POST', `/api/profiles/${st.profileId}/logo`, undefined, f); toast('Logo gespeichert.'); draw(); } catch (x) { toast(x.message, true); }
    } });
    const fetchLogo = (from) => async () => { try { await api('POST', `/api/profiles/${st.profileId}/logo/fetch`, { from }); toast('Profilbild übernommen.'); draw(); } catch (x) { toast(x.message, true); } };
    const jobs = (d.jobs || []).slice(0, 5);
    const busy = jobs.some((j) => ['queued', 'running'].includes(j.state));
    body.replaceChildren(...[
      h('p', { class: 'hint' }, 'Die Zentrale nimmt die besten Momente aus allen Shorts des Kanals (Viral-Punkte, echte Aufrufe, Twitch-Clips). Die KI baut daraus einen Spannungsbogen: stärkster Einstieg, Abwechslung, bestes Highlight zum Schluss – mit Logo-Intro, „Jetzt abonnieren“ am Ende und Musik.'),
      h('div', { class: 'two' },
        h('div', {}, h('label', {}, 'Kanal'), sel('profileId', chans.map((p) => [p.id, p.name]), draw)),
        h('div', {}, h('label', {}, 'Zeitraum'), sel('days', [[0, 'alle Videos'], [7, 'letzte 7 Tage (Best of der Woche)'], [30, 'letzte 30 Tage'], [90, 'letzte 3 Monate'], [365, 'letztes Jahr']], draw))),
      h('div', { class: 'two' },
        h('div', {}, h('label', {}, 'Länge'), sel('seconds', [[30, '30 Sekunden'], [60, '1 Minute'], [90, '1:30'], [120, '2 Minuten'], [180, '3 Minuten'], [240, '4 Minuten'], [300, '5 Minuten']])),
        h('div', {}, h('label', {}, 'Format'), sel('format', [['16:9', 'Quer 16:9 – YouTube-Kanaltrailer'], ['9:16', 'Hoch 9:16 – Short/TikTok/Reel']]))),
      h('p', { class: pv.count ? 'ok-text' : 'bad' }, pv.count ? `${pv.count} Momente aus ${pv.videos} Aufnahme(n) stehen zur Wahl.` : 'In diesem Zeitraum gibt es noch keine Shorts dieses Kanals.'),
      pv.top?.length ? h('div', { class: 'hint' }, 'Stärkste: ' + pv.top.map((x) => `„${x.title}“${x.viral ? ' 🔥' + x.viral : ''}${x.views != null ? ' 👁 ' + fmtNum(x.views) : ''}`).join(' · ')) : null,
      h('div', { class: 'row logo-row' }, logoImg, h('div', {},
        h('b', {}, 'Logo'), h('p', { class: 'hint' }, 'Für Intro, Outro und Wasserzeichen. Am besten PNG mit transparentem Hintergrund.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => file.click() }, '⤒ Hochladen'), file,
          h('button', { class: 'btn small', onclick: fetchLogo('youtube') }, 'Vom YouTube-Kanal holen'),
          S.settings?.twitch?.connected ? h('button', { class: 'btn small', onclick: fetchLogo('twitch') }, 'Von Twitch holen') : null,
          pv.logo ? h('button', { class: 'btn small ghost', onclick: async () => { await api('DELETE', `/api/profiles/${st.profileId}/logo`); draw(); } }, 'Entfernen') : null))),
      h('label', {}, 'Wunsch'), wish,
      h('label', { class: 'check' }, cIntro, 'Intro mit Logo + Outro „Jetzt abonnieren“'),
      h('label', { class: 'check' }, cWm, 'Logo klein als Wasserzeichen'),
      h('label', { class: 'check' }, cLab, 'Spiel/Thema kurz einblenden'),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', disabled: !pv.count, onclick: async () => {
          try {
            await api('POST', '/api/trailer', { profileId: st.profileId, seconds: st.seconds, format: st.format, days: st.days, wish: wish.value, intro: cIntro.checked, watermark: cWm.checked, labels: cLab.checked });
            toast('Trailer wird erstellt – er erscheint danach unter „Zur Freigabe“.'); pollActivity(); startPolling(); draw();
          } catch (x) { toast(x.message, true); }
        } }, '🎬 Trailer erstellen'),
        h('span', { class: 'hint' }, 'Mit Claude ca. 0,30–1,50 $, lokal kostenlos (+ KI-Musik, falls keine eigene im Ordner).')),
      jobs.length ? h('div', { class: 'section' }, h('b', {}, 'Zuletzt'), jobs.map((j) => h('div', { class: 'row' },
        h('span', {}, `${fmtDate(j.at)} · ${j.profileName} · ${j.opts.format} · ${String(Math.round(j.opts.seconds / 60 * 10) / 10).replace('.', ',')} Min.`),
        j.state === 'done' ? h('a', { class: 'btn small', href: '#video/' + j.outId, onclick: close }, '▶ öffnen') : null,
        ['queued', 'running'].includes(j.state) ? h('span', { class: 'chip run' }, (j.step || 'wartet') + (j.progress ? ` ${j.progress} %` : '')) : null,
        j.state === 'error' ? h('span', { class: 'chip bad', title: j.error }, '⚠ ' + (j.error || 'Fehler').slice(0, 60)) : null,
        j.warning ? h('span', { class: 'hint' }, j.warning) : null))) : null,
    ].filter(Boolean));
    if (busy) timer = setTimeout(draw, 4000);
  };
  draw();
}

async function convertDialog(after = () => {}) {
  const close = () => { clearTimeout(timer); modal.remove(); after(); };
  let timer = null;
  const body = h('div', {}, h('p', { class: 'hint' }, 'Lade Vorschau …'));
  const modal = h('div', { class: 'modal sheetmodal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet' }, h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'), h('h2', {}, '🗂 Vorhandene Videos umstellen'), body));
  document.body.append(modal);
  const draw = async () => {
    let pl;
    try { pl = await api('GET', '/api/org/plan'); } catch (x) { body.replaceChildren(h('p', { class: 'bad' }, x.message)); return; }
    const tj = pl.topics;
    const running = tj?.state === 'running';
    const byFolder = {};
    for (const x of pl.moves) byFolder[x.folder] = (byFolder[x.folder] || 0) + 1;
    body.replaceChildren(...[
      h('p', {}, pl.moves.length ? `${pl.moves.length} Video(s) bekommen einen neuen Namen bzw. Platz: ` + Object.entries(byFolder).map(([f, n]) => `${n} in „${FOLDER_NAMES[f]}“`).join(', ') + '.'
        : 'Alles ist schon an seinem Platz.'),
      pl.noTopic ? h('div', { class: 'box', style: { margin: '10px 0' } },
        h('p', {}, `🎮 ${pl.noTopic} Video(s) ohne erkanntes Spiel/Thema – sie landen sonst unter „Sonstiges“.`),
        running ? h('p', { class: 'hint' }, `Die KI erkennt die Themen … ${tj.done} von ${tj.total}`)
          : h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/org/topics'); draw(); } catch (x) { toast(x.message, true); } } },
            `Spiel/Thema von der KI erkennen lassen (mit Claude ca. ${Math.max(0.01, pl.noTopic * 0.004).toFixed(2).replace('.', ',')} $)`),
        tj?.state === 'done' && tj.total ? h('p', { class: 'hint' }, `Zuletzt: ${tj.found} von ${tj.total} erkannt${tj.cost != null ? ` (${String(tj.cost).replace('.', ',')} $)` : ''}. Den Rest kannst du in der Bibliothek von Hand setzen (✎ Spiel).`) : null,
        tj?.state === 'error' ? h('p', { class: 'bad' }, tj.error) : null) : null,
      pl.moves.length ? h('div', { class: 'org-log', style: { maxHeight: '45vh' } }, pl.moves.slice(0, 300).map((x) => h('div', { class: 'org-row' },
        h('span', { class: 'hint' }, FOLDER_NAMES[x.folder]), h('span', {}, x.from, ' → ', h('b', {}, x.to)), h('span', {})))) : null,
      pl.moves.length > 300 ? h('p', { class: 'hint' }, `… und ${pl.moves.length - 300} weitere`) : null,
      pl.skipped.length ? h('details', {}, h('summary', {}, `${pl.skipped.length} bleiben vorerst, wo sie sind`),
        h('div', { class: 'org-log' }, pl.skipped.map((x) => h('div', { class: 'org-row' }, h('span', { class: 'hint' }, FOLDER_NAMES[x.folder]), h('span', {}, x.file), h('span', { class: 'hint' }, x.why))))) : null,
      h('p', { class: 'hint' }, 'Begleitdateien (Titelbild, .json) wandern mit. Jede Verschiebung lässt sich unter Einstellungen → Ordnung einzeln rückgängig machen. „Zur Freigabe“ wird nur umbenannt, Eingang und Papierkorb bleiben unverändert.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap', marginTop: '10px' } },
        h('button', { class: 'btn primary', disabled: !pl.moves.length || running, onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Wird umgestellt …';
          try { const r = await api('POST', '/api/org/convert'); toast(`${r.moved} Video(s) umgestellt.`); await refresh(); close(); }
          catch (x) { toast(x.message, true); e.target.disabled = false; }
        } }, running ? 'Erst Themen abwarten …' : `Jetzt umstellen (${pl.moves.length})`),
        h('button', { class: 'btn ghost', onclick: close }, 'Abbrechen'))].filter(Boolean));
    if (running) timer = setTimeout(draw, 2500);
  };
  draw();
}

// ---------- 📚 Bibliothek: Aufnahmen nach Thema, Speicherplatz, Aufräumen ----------
async function renderLibrary() {
  const o = await api('GET', '/api/org').catch(() => null);
  if (S.tab !== 'bibliothek' || S.openId) return;
  const gb = (b) => b == null ? '–' : b < 1024 ** 3 ? Math.max(1, Math.round(b / 1024 ** 2)) + ' MB' : (b / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB';
  const st = o?.storage || { folders: {} };
  const used = Object.values(st.folders).reduce((a, b) => a + b, 0);
  const storeBox = h('div', { class: 'box' }, h('h3', {}, '💾 Speicherplatz'),
    h('div', { class: 'stor' }, Object.entries(FOLDER_NAMES).filter(([k]) => st.folders[k]).map(([k, n]) =>
      h('div', { class: 'stor-row' }, h('span', {}, n), h('div', { class: 'stor-bar' }, h('i', { style: { width: Math.max(2, Math.round((st.folders[k] / Math.max(1, used)) * 100)) + '%' } })), h('b', {}, gb(st.folders[k]))))),
    st.free != null ? h('p', { class: 'hint' }, `Frei auf dem Laufwerk: ${gb(st.free)} von ${gb(st.total)}`) : null);
  const picks = new Set((o?.cleanup || []).map((x) => x.id));
  const cleanBox = h('div', { class: 'box' }, h('h3', {}, '🧹 Aufräumen'),
    o?.cleanup?.length ? [
      h('p', { class: 'hint' }, `Rohvideos, aus denen alles hochgeladen bzw. aussortiert ist und die älter als ${o.rawDays} Tage sind. Sie wandern in den Papierkorb (dort ${S.settings?.settings?.trashDays || 30} Tage wiederherstellbar). Ist ein Rohvideo endgültig weg, kann aus ihm nicht mehr neu geschnitten oder überarbeitet werden.`),
      ...o.cleanup.map((x) => { const c = h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) picks.add(x.id); else picks.delete(x.id); } });
        return h('label', { class: 'check' }, c, `${x.file.split('/').pop()} · ${gb(x.size)} · ${x.kids} Videos daraus · vor ${x.age} Tagen geschnitten`); }),
      h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: async () => {
        const sum = o.cleanup.filter((x) => picks.has(x.id)).reduce((a, x) => a + x.size, 0);
        if (!picks.size || !confirm(`${picks.size} Rohvideo(s) (${gb(sum)}) in den Papierkorb legen?`)) return;
        try { const r = await api('POST', '/api/org/cleanup', { ids: [...picks] }); toast(`${r.moved} Rohvideo(s) in den Papierkorb – ${gb(r.bytes)} frei, sobald der Papierkorb geleert ist.`); await refresh(); renderLibrary(); updateCounts(); }
        catch (x) { toast(x.message, true); }
      } }, `Ausgewählte in den Papierkorb (${gb(o.cleanup.reduce((a, x) => a + x.size, 0))})`)]
      : h('p', { class: 'hint' }, `Gerade nichts aufzuräumen. Vorschläge kommen, wenn aus einem Rohvideo alles hochgeladen ist und es älter als ${o?.rawDays || 30} Tage ist.`));
  // Aufnahmen (Rohvideos) mit allem, was daraus entstanden ist – nach Thema
  const isRec = (v) => !v.source && ['rohvideos', 'eingang', 'eingang-profi'].includes(v.folder);
  const raws = S.videos.filter((v) => isRec(v) && !v.missing && (!S.channel || channelOf(v)?.id === S.channel));
  const orphanKids = S.videos.filter((v) => !isRec(v) && !v.missing && v.folder !== 'papierkorb' && !raws.some((r) => r.id === v.source?.rawId) && (!S.channel || channelOf(v)?.id === S.channel));
  const byTopic = new Map();
  for (const r of raws) { const t = r.topic || 'Ohne Thema'; if (!byTopic.has(t)) byTopic.set(t, []); byTopic.get(t).push(r); }
  const status = (k) => k.folder === 'hochgeladen' ? '✅ hochgeladen' : k.li?.posted ? '✅ gepostet' : k.folder === 'geschnitten' ? '🕓 zur Freigabe' : FOLDER_NAMES[k.folder] || k.folder;
  const kidRow = (k) => h('a', { class: 'lib-kid', href: '#video/' + k.id }, h('span', {}, (k.revisionOf ? '🔁 ' : '') + (k.title || k.file.split('/').pop())), h('span', { class: 'hint' }, status(k)));
  const albums = [...byTopic.entries()].sort((a, b) => b[1].length - a[1].length).map(([t, rs]) => h('details', { class: 'album', open: byTopic.size <= 3 },
    h('summary', {}, h('b', {}, '🎮 ' + t), h('span', { class: 'hint' }, ` ${rs.length} Aufnahme${rs.length === 1 ? '' : 'n'}`)),
    rs.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).map((r) => {
      const kids = S.videos.filter((k) => k.source?.rawId === r.id && !k.missing && k.folder !== 'papierkorb');
      return h('div', { class: 'lib-rec' }, h('a', { href: '#video/' + r.id, class: 'lib-raw' }, `📼 ${fmtDate(r.mtime)} · ${FOLDER_NAMES[r.folder] || r.folder} · ${gb(r.size)}`),
        h('button', { class: 'btn small ghost', title: 'Spiel/Thema dieser Aufnahme ändern (gilt für alle Videos daraus)', onclick: async () => {
          const t = prompt('Spiel/Thema dieser Aufnahme (leer = automatisch):', r.topic || ''); if (t === null) return;
          try { await api('POST', `/api/videos/${r.id}/topic`, { topic: t }); await refresh(); renderLibrary(); toast('Gespeichert – wird gleich neu einsortiert.'); } catch (x) { toast(x.message, true); }
        } }, '✎ Spiel'),
        kids.length ? h('div', { class: 'lib-kids' }, kids.map(kidRow)) : h('span', { class: 'hint' }, ' noch nichts geschnitten'));
    })));
  mainEl.replaceChildren(...[h('div', { class: 'bar' }, h('h2', { class: 'h2' }, '📚 Bibliothek'),
      h('span', { class: 'hint' }, 'Jede Aufnahme mit allem, was daraus entstanden ist – sortiert nach Spiel/Thema (von der KI erkannt).'),
      h('div', { style: { flex: '1' } }), h('button', { class: 'btn small', onclick: () => convertDialog(renderLibrary) }, '🗂 Vorhandene umstellen …')),
    o?.pending ? h('div', { class: 'alert-line' }, `${o.pending} Video(s) liegen noch nach der alten Ordnung. `,
      h('button', { class: 'btn small primary', onclick: () => convertDialog(renderLibrary) }, 'Ansehen & umstellen')) : null,
    h('div', { class: 'settings' }, storeBox, cleanBox),
    h('div', { class: 'lib' }, albums.length ? albums : h('p', { class: 'hint' }, 'Noch keine Aufnahmen.'),
      orphanKids.length ? h('details', { class: 'album' }, h('summary', {}, h('b', {}, '📁 Ohne Rohvideo (ältere oder von Hand geschnittene)'), h('span', { class: 'hint' }, ` ${orphanKids.length} Videos`)), h('div', { class: 'lib-kids' }, orphanKids.map(kidRow))) : null)].filter(Boolean));
}

// ---------- Was läuft gerade (Zentrale / Rechenhelfer) ----------
let actEl = null, actTimer = null, actData = null;
const ACT_ICON = { cut: '✂', ai: '🤖', upload: '⤒' };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// Im geöffneten Video: was gerade daran gearbeitet wird – welche KI (Claude / Ollama Server / Ollama PC), Schnitt, Upload, Rechenhelfer
function drawWork() {
  const box = detail?.workBox;
  if (!box || !actData) return;
  const v = detail.v, ids = new Set([v.id]);
  const a = actData, rows = [];
  for (const j of a.ki || []) if (ids.has(j.videoId)) rows.push(['🤖', `${j.label}: ${j.engine || 'startet …'}`, j.since]);
  for (const x of a.server || []) if (ids.has(x.id) && x.kind !== 'ai') rows.push([ACT_ICON[x.kind] || '⚙', x.step + (x.progress ? ` · ${String(x.progress).replace('.', ',')} %` : '') + (x.waiting ? ' (wartet auf den PC)' : ''), 0]);
  for (const j of a.helper?.jobs || []) if (ids.has(j.id)) rows.push(['🖥', `${a.helper.name || 'PC'}: ${j.step}`, j.since]);
  const queued = [v.ai?.state === 'queued' && 'KI-Vorschlag', v.cut?.state === 'queued' && 'Schnitt', v.revise?.state === 'queued' && 'Überarbeiten',
    v.rerender?.state === 'queued' && (v.rerender.reason || 'Neu rechnen')].filter(Boolean);
  if (queued.length) rows.push(['⏳', 'in der Warteschlange: ' + queued.join(', '), 0]);
  box.hidden = !rows.length;
  box.replaceChildren(...rows.map(([i, t, since]) => h('div', { class: 'work-row' }, h('span', { class: 'spin' }, i), h('span', {}, t + (since ? ` · seit ${mmss(a.now - since)}` : '')))));
}
function activityBar() {
  actEl = h('div', { class: 'activity', role: 'status', 'aria-live': 'polite' });
  if (actData) drawActivity(); else actEl.hidden = true;
  if (!actTimer) pollActivity();
  return actEl;
}
async function pollActivity() {
  clearTimeout(actTimer);
  try { actData = await api('GET', '/api/activity'); drawActivity(); } catch { }
  const busy = actData && (actData.server.length || actData.helper.jobs.length || actData.ki?.length || (detail && !detail.workBox?.hidden));
  actTimer = setTimeout(pollActivity, busy ? 2500 : 10000);
}
function drawActivity() {
  if (!actEl || !actData) return;
  const a = actData, q = a.queue, hp = a.helper;
  const open = (id) => id ? { onclick: () => go('video/' + id), class: 'act-item link', title: 'Video öffnen' } : { class: 'act-item' };
  const pct = (x) => x.progress ? ` ${String(x.progress).replace('.', ',')} %` : '';
  // Zentrale
  const own = a.server.filter((x) => !x.waiting);
  const waiting = a.server.filter((x) => x.waiting);   // Schnitt wartet auf die Spracherkennung des Helfers
  const waits = [q.cut && `${q.cut} Schnitt`, q.ai && `${q.ai} KI`, q.upload && `${q.upload} Upload`].filter(Boolean).join(', ');
  const srv = h('div', { class: 'act-box' + (own.length ? ' run' : '') },
    h('b', {}, own.length ? '⚙ Zentrale arbeitet' : '⚙ Zentrale'),
    own.length ? own.map((x) => h('span', open(x.id), `${ACT_ICON[x.kind] || '•'} ${x.step}${pct(x)} · „${x.name}“` + (x.note ? ` ⚠ ${x.note}` : '')))
      : h('span', { class: 'act-item muted' }, waiting.length ? 'wartet auf den Rechenhelfer' : 'frei'),
    waits ? h('span', { class: 'act-item muted' }, 'Warteschlange: ' + waits) : null);
  // Rechenhelfer
  let hpBox = null;
  if (hp.enabled) {
    const jobs = hp.jobs.filter((j) => j.state === 'taken');
    const label = hp.name || 'Rechenhelfer';
    const state = jobs.length ? null
      : hp.online ? 'bereit'
      : hp.seen && hp.paused ? '🎮 ' + (hp.status || 'pausiert')
      : hp.seen && hp.status ? hp.status
      : 'offline';
    hpBox = h('div', { class: 'act-box' + (jobs.length ? ' run' : '') + (!hp.online && !jobs.length ? ' off' : '') },
      h('b', {}, jobs.length ? `🖥 ${label} arbeitet` : `🖥 ${label}`),
      jobs.length ? jobs.map((j) => h('span', open(j.id), `🎙 ${j.step} · „${j.name || 'Video'}“ · seit ${mmss(a.now - j.since)}`))
        : h('span', { class: 'act-item muted' }, state));
  }
  // Guthaben-Warnungen (fal.ai / Claude)
  const warns = (a.credits || []).map((w) => h('div', { class: 'act-warn ' + w.level }, '💳 ' + w.text + ' ',
    h('a', { href: w.url, target: '_blank', rel: 'noopener' }, 'aufladen'), ' · ',
    h('a', { href: '#einstellungen', onclick: () => setTimeout(() => document.getElementById('s-guthaben')?.scrollIntoView({ block: 'start' }), 600) }, 'Einstellungen'),
    w.level === 'bad' ? h('button', { class: 'chip-btn', onclick: async () => { await api('POST', '/api/credits/dismiss', { provider: w.provider }).catch(() => {}); pollActivity(); } }, 'erledigt') : null));
  actEl.replaceChildren(...warns, srv, hpBox || '');
  actEl.hidden = false;
  drawWork();
}

// ---------- Einstellungen ----------
async function loadSettings() { S.settings = await api('GET', '/api/settings'); return S.settings; }

// Anmeldung im Popup geht nur mit https (bzw. localhost) – sonst Code-Weg.
const secureOrigin = () => location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
async function oauthPopup(getUrl) {
  // Fenster sofort öffnen (sonst blockt der Browser), Adresse danach setzen
  const w = window.open('', 'vz-oauth', 'width=520,height=720');
  try { const { url } = await getUrl(); if (w) w.location = url; else location.href = url; }
  catch (x) { w?.close(); toast(x.message, true); }
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'vz-oauth') return;
  if (e.data.ok) toast(`${e.data.platform} verbunden für „${e.data.kanal}“.`); else toast(`${e.data.platform}: ${e.data.error}`, true);
  if (S.tab === 'einstellungen' && !S.openId) renderSettings();
});

// Facecam auf einem Standbild per Ziehen markieren → Anteile 0–1
function markFacecam(cur, done) {
  const img = h('img', { src: '/api/facecam-frame?t=' + Date.now(), alt: '', draggable: 'false' });
  const box = h('div', { class: 'selbox' });
  const stage = h('div', { class: 'stage' }, img, box);
  let r = cur?.w ? { x: cur.x, y: cur.y, w: cur.w, h: cur.h } : null, start = null;
  const show = () => { if (!r) { box.style.display = 'none'; return; } Object.assign(box.style, { display: 'block', left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }); };
  const pos = (e) => { const b = stage.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }; };
  stage.addEventListener('pointerdown', (e) => { start = pos(e); stage.setPointerCapture(e.pointerId); e.preventDefault(); });
  stage.addEventListener('pointermove', (e) => { if (!start) return; const p = pos(e); r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }; show(); });
  stage.addEventListener('pointerup', () => { start = null; });
  img.addEventListener('error', () => { toast('Kein Standbild verfügbar – erst eine Aufnahme in den Eingang legen.', true); modal.remove(); });
  const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) modal.remove(); } },
    h('div', { class: 'sheet' }, h('h2', {}, 'Facecam markieren'),
      h('p', { class: 'hint' }, 'Ziehe mit der Maus einen Rahmen um deine Facecam. Im Short kommt dieser Bereich oben hin, darunter das Spiel.'),
      stage,
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: () => { if (!r || r.w < 0.03 || r.h < 0.03) return toast('Bitte einen Rahmen ziehen.', true); done(r); modal.remove(); } }, 'Übernehmen'),
        h('button', { class: 'btn ghost', onclick: () => modal.remove() }, 'Abbrechen'))));
  document.body.append(modal);
  show();
}

// append ohne null/false (sonst steht „null“ im Text)
const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k != null && k !== false));

// Verbindungsstand als Kennung: nur wenn sich daran etwas ändert, wird die Seite neu aufgebaut
// (sonst gingen halb eingetippte Felder verloren).
const connSig = (st) => JSON.stringify([st.profiles.map((p) => [p.youtube, p.tiktok]), st.youtube.pending, st.youtube.configured,
  st.tiktok.configured, st.ai.configured]);
let settingsTimer = null;
// Statuszeile des Rechenhelfers (wird während der Einstellungen alle 3 s aufgefrischt, z. B. Download-Fortschritt)
function hpStatusText(hp) {
  if (hp.enabled && hp.seen && !hp.released && !hp.paused) return `🔒 ${hp.name || 'PC'} wartet auf Freigabe der Grafikkarte – die Zentrale rechnet solange selbst.`
    + (hp.ended ? ` (Freigabe beendet: ${hp.ended.replace(/^\S+ – /, '')})` : '');
  return hp.online ? `🟢 online: ${hp.name || 'PC'} · ${hp.gpu || ''}` + (hp.status && hp.status !== 'bereit' ? ` · ${hp.status}` : ' · bereit')
    : hp.seen && hp.paused ? `🎮 ${hp.name || 'PC'} ${hp.status || 'pausiert'} – die Zentrale rechnet solange selbst.`
    : hp.seen && hp.status ? `🟡 ${hp.name || 'PC'}: ${hp.status} – die Zentrale rechnet solange selbst.`
    : '⚪ offline' + (hp.lastSeen ? ' – zuletzt ' + fmtDate(hp.lastSeen) : ' – noch nie verbunden');
}
function hpStatusEl(hp) { return h('p', { id: 'hp-status', class: hp.online ? 'ok-text' : 'hint' }, hpStatusText(hp)); }
async function refreshHelperStatus() {
  const el = document.getElementById('hp-status');
  if (!el) return;
  const hp = await api('GET', '/api/helper-config').catch(() => null);
  if (hp?.enabled) { el.textContent = hpStatusText(hp); el.className = hp.online ? 'ok-text' : 'hint'; }
}
function watchSettings(sig) {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    if (S.tab !== 'einstellungen' || S.openId) return;
    const st = await loadSettings().catch(() => null);
    if (st && connSig(st) !== sig) renderSettings(); else { refreshHelperStatus(); watchSettings(sig); }
  }, 3000);
}

// Twitch-Anmeldung per Code: Einstellungen auffrischen, bis verbunden (oder abgelaufen)
let twTimer = null;
function watchTwitch() {
  clearTimeout(twTimer);
  twTimer = setTimeout(async () => {
    if (S.tab !== 'einstellungen') return;
    const t = await api('GET', '/api/twitch').catch(() => null);
    if (!t) return;
    if (t.connected || !t.pending) { await loadSettings(); renderSettings(); toast(t.connected ? 'Twitch verbunden.' : 'Twitch-Anmeldung abgebrochen.', !t.connected); return; }
    watchTwitch();
  }, 3000);
}
async function renderSettings() {
  clearTimeout(settingsTimer);
  const st = await loadSettings();
  if (S.tab !== 'einstellungen' || S.openId) return;
  watchSettings(connSig(st)); // erkennt fertige YouTube-Anmeldung und TikTok-Rückkehr aus dem anderen Tab
  const again = () => renderSettings();
  const run = (fn, msg) => async () => { try { await fn(); if (msg) toast(msg); again(); } catch (x) { toast(x.message, true); } };
  const y = st.youtube, t = st.tiktok;

  // ----- Kanäle -----
  const dupYt = new Map(), dupTt = new Map();
  for (const p of st.profiles) {
    if (p.youtube.channel?.id) dupYt.set(p.youtube.channel.id, [...(dupYt.get(p.youtube.channel.id) || []), p.name]);
    if (p.tiktok.user?.name) dupTt.set(p.tiktok.user.name, [...(dupTt.get(p.tiktok.user.name) || []), p.name]);
  }
  const channelBox = (p) => {
    const name = h('input', { value: p.name });
    const color = h('input', { type: 'color', value: p.color, class: 'color' });
    const def = h('input', { type: 'checkbox', checked: p.isDefault });
    const kw = h('textarea', { rows: 3, value: p.keywords, placeholder: 'z. B. fortnite, minecraft, clutch' });
    const style = h('textarea', { rows: 2, value: p.aiStyle, placeholder: 'Worum geht es, wie soll die KI schreiben, wer schaut zu?' });
    const cat = h('select', {}, CATEGORIES.map(([id, n]) => h('option', { value: id, selected: p.category === id }, n)));
    const tags = h('input', { value: p.tags });
    const footer = h('textarea', { rows: 3, value: p.footer, placeholder: 'z. B. Links zu Discord/Shop, „Musik: Epidemic Sound“' });
    const mStyle = h('input', { value: p.musicStyle, placeholder: 'englisch, z. B. energetic electronic gaming beat' });
    const mMood = h('select', {}, h('option', { value: '' }, '– keine –'), (st.music?.moods || []).map((x) => h('option', { value: x, selected: p.musicMood === x }, x)));
    const proMusic = h('input', { type: 'checkbox', checked: p.music });
    const clipHints = h('textarea', { rows: 2, value: p.clipHints || '', placeholder: 'z. B. Funny Moments, wo ich mich ärgere, Fails, Clutches …' });
    const chShorts = h('input', { type: 'number', min: 0, max: 10, value: p.shorts ?? '', placeholder: 'Standard' });
    const hookSel = h('select', {}, Object.entries({ auto: 'KI entscheidet je Clip', preview: 'Höhepunkt vorweg + Zurückspulen', cold: 'direkt mitten rein', off: 'aus' })
      .filter(([k]) => !isPro(p) || k !== 'preview').map(([k, n]) => h('option', { value: k, selected: (p.hookStyle || 'auto') === k }, n)));
    const tempoSel = h('select', {}, Object.entries({ aus: 'aus (nichts herausschneiden)', ruhig: 'ruhig (nur lange Pausen)', normal: 'normal (Pausen + „ähm“)', schnell: 'schnell (Jump Cuts + Zooms)' })
      .map(([k, n]) => h('option', { value: k, selected: (p.tempo || 'normal') === k }, n)));
    const hookHint = h('input', { value: p.hookHint || '', placeholder: 'z. B. Reaktion zuerst; bei 3D-Druck: Ergebnis zuerst' });
    const fxSel = h('select', {}, Object.entries({ aus: 'aus', dezent: 'dezent (wenige Emojis/Sounds)', normal: 'normal (+ Freeze, Zeitlupe, Zoom, Wackeln)', viel: 'viel (+ KI-Sticker)' })
      .map(([k, n]) => h('option', { value: k, selected: (p.fxLevel || 'normal') === k }, n)));
    const fxImg = h('input', { type: 'checkbox', checked: !!p.fxImages });
    const capSel = h('select', {}, h('option', { value: 'auto', selected: (p.captionStyle || 'auto') === 'auto' }, 'KI wählt je Clip passend'),
      (CAP.styles || []).map((x) => h('option', { value: x.id, selected: p.captionStyle === x.id }, `${x.name} – ${x.desc}`)));
    const lookSel = h('select', {}, h('option', { value: 'auto', selected: (p.hookLook || 'auto') === 'auto' }, 'KI wählt je Clip'),
      (CAP.looks || []).map((x) => h('option', { value: x.id, selected: p.hookLook === x.id }, x.name)));
    const coverSel = h('select', {}, Object.entries({ aus: 'aus', bild: 'als erstes Bild (unsichtbar beim Abspielen)', kurz: '0,4 Sekunden stehend' })
      .map(([k, n]) => h('option', { value: k, selected: (p.coverFrame || 'aus') === k }, n)));
    const save = run(() => api('PUT', '/api/profiles/' + p.id, { name: name.value, color: color.value, isDefault: def.checked || undefined,
      keywords: kw.value, aiStyle: style.value, category: cat.value, tags: tags.value, footer: footer.value,
      musicStyle: mStyle.value, musicMood: mMood.value, clipHints: clipHints.value, shorts: chShorts.value === '' ? null : Number(chShorts.value),
      hookStyle: hookSel.value, tempo: tempoSel.value, hookHint: hookHint.value, fxLevel: fxSel.value, fxImages: fxImg.checked, coverFrame: coverSel.value, captionStyle: capSel.value, hookLook: lookSel.value,
      ...(isPro(p) ? { music: proMusic.checked } : {}) }), 'Kanal gespeichert.');

    // YouTube
    const yp = y.pending[p.id];
    const ytPart = h('div', { class: 'conn' }, h('b', {}, h('span', { class: 'dot', style: { background: 'var(--yt)' } }), ' YouTube'));
    if (p.youtube.connected) {
      add(ytPart, h('div', { class: 'ok-text' }, '✓ ', p.youtube.channel ? '„' + p.youtube.channel.title + '“' : 'verbunden'),
        (dupYt.get(p.youtube.channel?.id) || []).length > 1 ? h('div', { class: 'err' }, 'Achtung: gleicher YouTube-Kanal wie bei ' + dupYt.get(p.youtube.channel.id).filter((n) => n !== p.name).join(', ') + ' – beim Verbinden den richtigen Kanal wählen.') : null,
        h('button', { class: 'btn small danger', onclick: () => confirm(`YouTube von „${p.name}“ trennen?`) && run(() => api('POST', `/api/profiles/${p.id}/youtube/disconnect`))() }, 'Trennen'));
    } else if (yp) {
      add(ytPart, h('div', {}, 'Öffne ', h('a', { href: yp.url, target: '_blank', rel: 'noopener' }, yp.url), ' und gib ein:'),
        h('div', { class: 'code' }, yp.code),
        h('div', { class: 'hint' }, `Dort das Google-Konto bzw. den Kanal „${p.name}“ wählen (bei Brand-Konten erscheint eine Kanalauswahl).`),
        yp.error ? h('div', { class: 'err' }, yp.error) : null);
    } else if (secureOrigin()) {
      add(ytPart, h('button', { class: 'btn small yt', disabled: !y.configured, title: y.configured ? '' : 'Erst unten die Google-App eintragen',
        onclick: () => oauthPopup(() => api('GET', `/api/profiles/${p.id}/youtube/auth-url?origin=${encodeURIComponent(location.origin)}`)) }, 'Mit YouTube verbinden'),
        h('div', { class: 'hint' }, `Im Fenster das Google-Konto bzw. den Kanal „${p.name}“ wählen und erlauben.`));
    } else {
      add(ytPart, h('button', { class: 'btn small yt', disabled: !y.configured, title: y.configured ? '' : 'Erst unten die Google-App eintragen',
        onclick: run(() => api('POST', `/api/profiles/${p.id}/youtube/connect`)) }, 'YouTube verbinden (per Code)'),
        h('div', { class: 'hint' }, 'Mit einem Klick (Fenster) geht es, wenn du die Zentrale über https öffnest – siehe Anleitung.'));
    }

    // TikTok
    const paste = h('input', { placeholder: 'Adresse nach der Anmeldung einfügen' });
    const ttPart = h('div', { class: 'conn' }, h('b', {}, h('span', { class: 'dot', style: { background: 'var(--tt)' } }), ' TikTok'));
    if (p.tiktok.connected) {
      add(ttPart, h('div', { class: 'ok-text' }, '✓ ', p.tiktok.user?.name ? '„' + p.tiktok.user.name + '“' : 'verbunden',
        p.tiktok.refreshExpires ? h('span', { class: 'hint' }, ' · gültig bis ' + fmtDate(p.tiktok.refreshExpires)) : null),
        (dupTt.get(p.tiktok.user?.name) || []).length > 1 ? h('div', { class: 'err' }, 'Achtung: gleiches TikTok-Konto wie bei ' + dupTt.get(p.tiktok.user.name).filter((n) => n !== p.name).join(', ') + '.') : null,
        h('button', { class: 'btn small danger', onclick: () => confirm(`TikTok von „${p.name}“ trennen?`) && run(() => api('POST', `/api/profiles/${p.id}/tiktok/disconnect`))() }, 'Trennen'));
    } else {
      const ownCallback = t.redirectUri && t.redirectUri.startsWith(location.origin + '/');
      add(ttPart,
        h('div', { class: 'row' },
          h('button', { class: 'btn small tt', disabled: !t.configured, title: t.configured ? '' : 'Erst unten die TikTok-App eintragen',
            onclick: () => oauthPopup(() => api('GET', `/api/profiles/${p.id}/tiktok/auth-url`)) }, 'Mit TikTok verbinden')),
        h('div', { class: 'hint' }, `Im Fenster mit dem Konto „${p.name}“ anmelden. Ist dort schon ein anderes Konto angemeldet: erst bei TikTok abmelden.`),
        ownCallback ? null : h('details', {}, h('summary', { class: 'hint' }, 'Fenster bleibt auf einer fremden Seite stehen?'),
          h('div', { class: 'hint' }, 'Die Adresse aus dem Fenster kopieren und hier einfügen:'),
          h('div', { class: 'row', style: { marginTop: '6px' } }, paste,
            h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/tiktok/finish', { url: paste.value, profileId: p.id }), 'TikTok verbunden.') }, 'Übernehmen'))));
    }

    const head = h('h3', {}, h('span', { class: 'dot' }), p.name, p.isDefault ? h('span', { class: 'chip' }, 'Standard') : null);
    head.firstChild.style.background = p.color;
    const box = h('div', { class: 'box channelbox' }, head,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Name'), name), h('div', {}, h('label', {}, 'Farbe'), color)),
      isPro(p) ? null : h('label', { class: 'check' }, def, 'Standardkanal (wenn kein Stichwort passt)'),
      h('label', {}, 'Beschreibung für die KI (Thema, Ton, Publikum)'), style,
      h('label', {}, 'Stichwörter für den Vorschlag (mit Komma; Titel/Dateiname zählt doppelt)'), kw,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, 'YouTube-Kategorie'), cat), h('div', {}, h('label', {}, 'Standard-Tags'), tags)),
      h('label', {}, 'Text unter jeder YouTube-Beschreibung'), footer,
      h('label', {}, '✂ Was soll die KI als Clips rausholen?'), clipHints,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Clips je Video (leer = Standard)'), chShorts), h('div', {})),
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '⚡ Hook am Anfang der Clips'), hookSel), h('div', {}, h('label', {}, '✂ Tempo der Clips'), tempoSel)),
      h('label', {}, 'Hinweis zum Hook für die KI'), hookHint,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '🎉 Effekte in Clips (Emojis, Sounds, Freeze …)'), fxSel),
        h('div', {}, h('label', { class: 'check', style: { marginTop: '22px' } }, fxImg, 'KI-Sticker aus meinen Fotos (Stufe „viel“, ca. 5 Cent)'))),
      isPro(p) ? null : h('div', { class: 'two' }, h('div', {}, h('label', {}, '🔤 Untertitel-Stil'), capSel),
        h('div', {}, h('label', {}, '💬 Look des Hook-Texts'), lookSel,
          h('button', { class: 'btn small', style: { marginTop: '6px' }, onclick: () => styleGallery((id, look) => { capSel.value = id; if (look) lookSel.value = look; toast('Übernommen – bitte Kanal speichern.'); }) }, '👀 Vorlagen ansehen'))),
      p.camScenes ? h('div', { class: 'hint' }, `🎥 ${p.camScenes} gemerkte Facecam-Rahmen (von Hand korrigiert) `,
        h('button', { class: 'btn small ghost', onclick: () => confirm('Gemerkte Facecam-Rahmen dieses Kanals vergessen?') && run(() => api('PUT', '/api/profiles/' + p.id, { clearScenes: true }), 'Vergessen.')() }, 'vergessen')) : null,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '🖼 Titelbild vorne ins Video (beim Hochladen)'), coverSel),
        h('div', { class: 'hint', style: { marginTop: '22px' } }, 'Vorschauen (Shorts, TikTok, WhatsApp) zeigen dann dein Titelbild. Je Video änderbar.')),
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '🎵 Musikstil für KI-Musik'), mStyle), h('div', {}, h('label', {}, 'Stimmung (Langfassung)'), mMood)),
      h('p', { class: 'hint' }, `Eigene Titel: ${st.music?.counts?.[p.id] ?? 0} (Ordner musik\\${p.id} + musik)`),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: save }, 'Speichern'),
        st.profiles.length > 1 ? h('button', { class: 'btn ghost danger', onclick: () => confirm(`Kanal „${p.name}“ löschen?`) && run(() => api('DELETE', '/api/profiles/' + p.id), 'Kanal gelöscht.')() }, 'Löschen') : null),
      ...(isPro(p) ? [h('div', { class: 'conn' }, h('b', {}, h('span', { class: 'dot', style: { background: '#0a66c2' } }), ' LinkedIn – nur Download'),
        h('p', { class: 'hint' }, 'Kein automatischer Upload: Im Video gibt es „Video herunterladen“ und „Beitrag kopieren“. Videos aus dem Ordner \\\\PowerServer\\videos\\eingang-profi landen automatisch hier, '
          + 'werden im Profi-Stil geschnitten (Format und Untertitel unter „Automatischer Schnitt“) und die KI schreibt den Beitrag in der Ich-Form.'),
        h('label', { class: 'check' }, proMusic, 'Hintergrundmusik in LinkedIn-Clips'))] : [ytPart, ttPart]));
    box.style.borderTop = '3px solid ' + p.color;
    return box;
  };

  // ----- Google-App -----
  const yId = h('input', { value: y.clientId, placeholder: '…apps.googleusercontent.com' });
  const ySecret = h('input', { type: 'password', placeholder: y.hasSecret ? '•••••• gespeichert' : 'Client-Secret', autocomplete: 'off' });
  const googleBox = h('div', { class: 'box' }, h('h3', {}, h('span', { class: 'dot', style: { background: 'var(--yt)' } }), ' Google-App (für alle YouTube-Kanäle)'),
    y.configured ? h('p', { class: 'ok-text' }, '✓ eingerichtet') : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'console.cloud.google.com: Projekt anlegen, „YouTube Data API v3“ aktivieren.'),
      h('li', {}, 'OAuth-Zustimmungsbildschirm: Extern, dann „App veröffentlichen“ (sonst läuft die Anmeldung nach 7 Tagen ab).'),
      secureOrigin()
        ? h('li', {}, 'Anmeldedaten → OAuth-Client-ID → Typ „Webanwendung“, autorisierte Weiterleitungs-URI: ',
          h('code', {}, location.origin + '/oauth/google'), ' ', h('button', { class: 'btn small', onclick: () => copy(location.origin + '/oauth/google') }, '⧉'))
        : h('li', {}, 'Anmeldedaten → OAuth-Client-ID → Typ „Fernseher und Geräte mit begrenzter Eingabe“ (über https: „Webanwendung“ – dann geht es mit einem Klick).'),
      h('li', {}, 'Client-ID und Secret hier eintragen, dann oben je Kanal „Mit YouTube verbinden“.')),
    h('label', {}, 'Client-ID'), yId, h('label', {}, 'Client-Secret'), ySecret,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/youtube/config', { clientId: yId.value, clientSecret: ySecret.value }), 'Gespeichert.') }, 'Speichern')));

  // ----- TikTok-App -----
  const suggest = location.protocol === 'https:' ? location.origin + '/oauth/tiktok' : '';
  const tKey = h('input', { value: t.clientKey, placeholder: 'Client Key' });
  const tSecret = h('input', { type: 'password', placeholder: t.hasSecret ? '•••••• gespeichert' : 'Client Secret', autocomplete: 'off' });
  const tRedirect = h('input', { value: t.redirectUri || suggest, placeholder: 'https://…/oauth/tiktok' });
  const tDirect = h('input', { type: 'checkbox', checked: !!t.directPost });
  const tiktokBox = h('div', { class: 'box' }, h('h3', {}, h('span', { class: 'dot', style: { background: 'var(--tt)' } }), ' TikTok-App (für alle TikTok-Konten)'),
    t.configured ? h('p', { class: 'ok-text' }, '✓ eingerichtet') : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'developers.tiktok.com: App anlegen, „Login Kit“ + „Content Posting API“, Scope video.upload.'),
      h('li', {}, 'Sandbox: beide TikTok-Konten als Target User eintragen.'),
      secureOrigin()
        ? h('li', {}, 'Redirect URI bei TikTok und hier: ', h('code', {}, location.origin + '/oauth/tiktok'), ' ', h('button', { class: 'btn small', onclick: () => copy(location.origin + '/oauth/tiktok') }, '⧉'))
        : h('li', {}, 'Redirect URI muss https sein: Zentrale über Nginx Proxy Manager per https öffnen (dann wird sie hier vorgeschlagen).')),
    h('label', {}, 'Client Key'), tKey, h('label', {}, 'Client Secret'), tSecret, h('label', {}, 'Redirect URI'), tRedirect,
    h('label', { class: 'check', style: { marginTop: '10px' } }, tDirect, 'Direkt veröffentlichen erlauben (Direct Post, Text geht mit)'),
    h('p', { class: 'hint' }, 'Dafür in der TikTok-App bei „Content Posting API“ Direct Post einschalten und den Scope video.publish hinzufügen, hier speichern und danach jeden Kanal unter „TikTok“ einmal trennen und neu verbinden. '
      + 'Solange TikTok die App nicht geprüft hat, sind direkt gepostete Videos nur für dich sichtbar („Nur ich“).'),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/tiktok/config', { clientKey: tKey.value, clientSecret: tSecret.value, redirectUri: tRedirect.value, directPost: tDirect.checked }), 'Gespeichert.') }, 'Speichern')));

  // ----- Claude -----
  const a = st.ai;
  const aKey = h('input', { type: 'password', autocomplete: 'off', placeholder: a.configured ? 'gespeichert (' + a.keyHint + ') – zum Ändern neu eintragen' : 'sk-ant-…' });
  const aAuto = h('input', { type: 'checkbox', checked: a.auto });
  const aTips = h('input', { type: 'checkbox', checked: a.autoTips !== false });
  const aScout = h('input', { type: 'checkbox', checked: a.scout !== false });
  const aQc = h('input', { type: 'checkbox', checked: a.qc !== false });
  const aEffort = h('select', {}, [['max', 'Maximum – beste Schnitte (empfohlen, ca. 0,20–1 $ je Aufnahme)'], ['xhigh', 'Sehr hoch'], ['high', 'Hoch'], ['medium', 'Mittel – günstig, schneller']]
    .map(([k, n]) => h('option', { value: k, selected: (a.cutEffort || 'max') === k }, n)));
  const aHints = h('textarea', { rows: 3, value: a.hints, placeholder: 'z. B. „Ich heiße Micha“, „keine Emojis im Titel“, „immer auf Deutsch“' });
  const claudeBox = h('div', { class: 'box' }, h('h3', {}, '✨ KI-Einstellungen & Claude-Zugang'),
    a.configured ? h('p', { class: 'ok-text' }, '✓ eingerichtet · bisher ' + a.count + ' Vorschläge, ca. ' + (a.spent || 0).toFixed(2).replace('.', ',') + ' $') : null,
    a.blocked ? h('div', { class: 'alert-line' }, `⛔ Claude gesperrt seit ${fmtDate(a.blocked.at)}: ${a.blocked.reason} Alle KI-Aufgaben laufen solange lokal (Ollama). ${a.blocked.until ? `Ab ${fmtDate(a.blocked.until)} versucht es die Zentrale von selbst wieder.` : 'Nach 6 Stunden versucht es die Zentrale von selbst wieder.'}`,
      h('button', { class: 'btn small', style: { marginLeft: '8px' }, onclick: run(() => api('POST', '/api/ai/config', { unblock: true }), 'Claude wird wieder versucht.') }, 'Guthaben aufgeladen – wieder versuchen')) : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'console.anthropic.com: Konto anlegen, unter Billing Guthaben aufladen (z. B. 5 $; eigene Abrechnung, nicht im Claude-Abo enthalten).'),
      h('li', {}, 'API Keys → „Create Key“ → hier einfügen und speichern.'),
      h('li', {}, 'Ein Vorschlag kostet etwa 2–6 Cent (Claude Opus 5.5 schaut 6 Standbilder an).')),
    h('label', {}, 'API-Schlüssel'), aKey,
    h('label', { class: 'check' }, aAuto, 'Neue Videos unter „Zur Freigabe“ automatisch vorschlagen lassen'),
    h('label', { class: 'check' }, aTips, '⚡ Viral-Tipps zu Einstieg und Schnitt einmal automatisch umsetzen (neue Fassung „v2“ zum Vergleichen, je Video ein weiterer KI-Aufruf)'),
    h('label', { class: 'check' }, aScout, '👀 Die KI liest vor dem Schnitt die ganze Aufnahme und meldet starke Momente (findet auch leise Lacher; mit Claude ca. 0,10–0,30 $ je Aufnahme)'),
    h('label', { class: 'check' }, aQc, '✔ Fertige Clips prüfen lassen (Gesicht verdeckt? Untertitel lesbar? Action im Bild? – ca. 1 Cent je Clip)'),
    h('label', {}, '✂ Denkstufe beim Schneiden (Highlights, Kurzfassung, Überarbeiten)'), aEffort,
    h('p', { class: 'hint' }, 'Die KI wählt Anfang und Ende als ganze Sätze; je höher die Stufe, desto gründlicher prüft es Pointe, Zusammenhang und saubere Übergänge.'),
    h('label', {}, 'Allgemeine Hinweise an die KI'), aHints,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/ai/config', { apiKey: aKey.value, auto: aAuto.checked, autoTips: aTips.checked, scout: aScout.checked, qc: aQc.checked, cutEffort: aEffort.value, hints: aHints.value }), 'Gespeichert.') }, 'Speichern'),
      a.configured ? h('button', { class: 'btn ghost danger', onclick: () => confirm('API-Schlüssel entfernen?') && run(() => api('POST', '/api/ai/config', { removeKey: true }), 'Schlüssel entfernt.')() }, 'Schlüssel entfernen') : null));

  // ----- Lokale KI (Ollama) -----
  const L = st.llm || { tasks: {}, names: {}, stats: {}, pc: {} };
  const lUrl = h('input', { value: L.url || '', placeholder: 'http://192.168.1.10:11434' });
  const lModel = h('input', { value: L.model || '', placeholder: 'qwen2.5:7b-instruct', list: 'llm-models' });
  const lModels = h('datalist', { id: 'llm-models' });
  const lCtx = h('select', {}, [[8192, '8.000 (schnell, kurze Aufnahmen)'], [16384, '16.000 (Standard)'], [32768, '32.000 (lange Aufnahmen, braucht viel RAM)']]
    .map(([k, n]) => h('option', { value: k, selected: Number(L.ctx || 16384) === k }, n)));
  const lPc = h('input', { type: 'checkbox', checked: !!L.pc?.enabled });
  const lPcModel = h('input', { value: L.pc?.model || 'qwen2.5vl:7b', placeholder: 'qwen2.5vl:7b' });
  const modeNames = L.modeNames || { lokal: 'Nur lokal', auto: 'Lokal, sonst Claude', claude: 'Claude, sonst lokal', nurclaude: 'Nur Claude' };
  const lSel = {};
  const fmtMoney = (x) => (x || 0).toFixed(2).replace('.', ',') + ' $';
  const statRow = (k) => {
    const s = L.stats?.[k] || {};
    const loc = ['server', 'pc'].reduce((a, w) => a + (s[w]?.count || 0), 0), fail = ['server', 'pc'].reduce((a, w) => a + (s[w]?.failed || 0), 0);
    const saved = ['server', 'pc'].reduce((a, w) => a + (s[w]?.saved || 0), 0);
    lSel[k] = h('select', {}, Object.entries(modeNames).map(([m, n]) => h('option', { value: m, selected: (L.tasks?.[k] || 'claude') === m }, n)));
    return h('tr', {}, h('td', {}, L.names?.[k] || k), h('td', {}, lSel[k]),
      h('td', { class: 'hint' }, `Claude ${s.claude?.count || 0}× · ${fmtMoney(s.claude?.cost)}`),
      h('td', { class: 'hint' }, `lokal ${loc}×${fail ? ` (${fail} Fehler)` : ''} · gespart ≈ ${fmtMoney(saved)}`));
  };
  const lTable = h('table', { class: 'llmtable' }, h('tbody', {}, Object.keys(L.names || {}).map(statRow)));
  const lTestOut = h('div', { class: 'hint' }, L.lastError ? h('span', { class: 'err' }, 'Letzter Fehler: ' + L.lastError) : '');
  const lTest = async () => {
    lTestOut.textContent = 'Prüfe …';
    try {
      await api('POST', '/api/llm', { url: lUrl.value, model: lModel.value, ctx: Number(lCtx.value), pc: { enabled: lPc.checked, model: lPcModel.value } });
      const t = await api('POST', '/api/llm/test');
      const s = t.server;
      lModels.replaceChildren(...(s?.models || []).map((m) => h('option', { value: m })));
      lTestOut.replaceChildren(
        h('div', {}, !s ? '– Server: keine Adresse eingetragen' : s.ok ? (s.has ? `✓ Server erreichbar, Modell „${lModel.value}“ vorhanden${s.vision ? ', versteht Bilder' : ' (reines Textmodell – sieht keine Bilder)'}`
          : `⚠ Server erreichbar, aber Modell „${lModel.value}“ fehlt. Vorhanden: ${(s.models || []).join(', ') || 'keine'}`) : '✗ Server: ' + s.error),
        h('div', {}, !t.pc.enabled ? '– PC: aus' : t.pc.ready ? `✓ PC bereit (Modell ${t.pc.model}${t.pc.vision ? ', versteht Bilder' : ''})`
          : t.pc.helperCan ? '⏸ PC kann es, Grafikkarte gerade nicht freigegeben – dann rechnet der Server' : /lädt|Ollama|KI-Modell/i.test(t.pc.helperStatus || '') ? '⏳ PC: ' + t.pc.helperStatus
            : '⏳ PC: Rechenhelfer ab 1.9 nötig (neu herunterladen) – richtet Ollama dort beim nächsten Start ein' + (t.pc.helperVersion ? ` (läuft: ${t.pc.helperVersion})` : '')));
    } catch (x) { lTestOut.textContent = '✗ ' + x.message; }
  };
  const llmBox = h('div', { class: 'box' }, h('h3', {}, '🏠 Lokale KI (Ollama) – spart Claude-Kosten'),
    h('p', { class: 'hint' }, 'Die Zentrale kann Aufgaben an deinen eigenen Ollama geben statt an Claude – kostenlos, aber langsamer und schwächer. Ist der PC freigegeben, rechnet er (schnell, mit Bildverständnis); sonst der Server (nur Prozessor).'),
    h('label', {}, 'Ollama auf dem Server (Adresse)'), lUrl,
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Modell auf dem Server'), lModel, lModels), h('div', {}, h('label', {}, 'Kontext (wie viel Text auf einmal)'), lCtx)),
    h('label', { class: 'check', style: { marginTop: '8px' } }, lPc, '🖥 PC mitnutzen, wenn die Grafikkarte freigegeben ist (Rechenhelfer lädt Ollama + Modell einmalig, ca. 7 GB)'),
    h('label', {}, 'Modell auf dem PC (mit Bildverständnis)'), lPcModel,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: lTest }, '🔌 Verbindung testen'), lTestOut),
    h('h4', { style: { marginTop: '14px' } }, 'Wer macht was?'),
    h('div', { class: 'chips', style: { marginBottom: '6px' } }, Object.entries(L.presets || {}).map(([k, n]) =>
      h('button', { class: 'chip-btn', onclick: run(() => api('POST', '/api/llm', { preset: k }), 'Vorlage übernommen.') }, n))),
    h('div', { class: 'table-wrap' }, lTable),
    h('p', { class: 'hint' }, '„Claude, sonst lokal“: läuft bei Claude und geht lokal weiter, wenn Claude gesperrt ist (z. B. kein Guthaben) oder einen Fehler meldet. „Nur Claude“ nutzt nie die lokale KI. Sind Server und PC verfügbar, rechnen beide gleichzeitig: Aufträge gehen an den freieren Rechner, Vorschläge laufen zu zweit.'
      + (L.busy && (L.busy.pc || L.busy.server) ? ` Gerade: PC ${L.busy.pc}, Server ${L.busy.server} Auftrag/Aufträge.` : '')),
    h('p', { class: 'hint' }, 'Tipp: Mit „Lokal, sonst Claude“ anfangen. Clips auswählen und Überarbeiten sind die schwersten Aufgaben – erst umstellen, wenn dir die lokalen Ergebnisse gefallen. '
      + 'Ohne Bildverständnis (Server-Modell) entfällt die Bild-Prüfung fertiger Clips; die Facecam kommt dann aus der Gesichtserkennung des PCs.'),
    h('p', { class: 'hint' }, 'Weitere Spar-Hebel bei Claude (Kasten oben): Denkstufe beim Schneiden auf „Hoch“ oder „Mittel“, Viral-Tipps nicht automatisch umsetzen.'),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/llm', { url: lUrl.value, model: lModel.value, ctx: Number(lCtx.value), pc: { enabled: lPc.checked, model: lPcModel.value },
        tasks: Object.fromEntries(Object.entries(lSel).map(([k, el]) => [k, el.value])) }), 'Gespeichert.') }, 'Speichern'),
      h('button', { class: 'btn ghost', onclick: () => confirm('Kostenübersicht zurücksetzen?') && run(() => api('POST', '/api/llm', { resetStats: true }), 'Zurückgesetzt.')() }, 'Zähler zurücksetzen')));

  // ----- Automatischer Schnitt -----
  const c = st.cut, w = c.whisper;
  const cb = (on) => h('input', { type: 'checkbox', checked: on });
  const numIn = (val, attrs = {}) => h('input', { type: 'number', value: val, ...attrs });
  const cCopy = cb(c.longCopy);
  const cAuto = cb(c.auto), cLong = cb(c.longVersion), cPause = cb(c.cutPauses), cMove = cb(c.moveRaw);
  const cDb = numIn(c.silenceDb, { min: -70, max: -20 }), cMin = numIn(c.minPause, { min: 5, max: 600 });
  const cShorts = numIn(c.shorts, { min: 0, max: 10 }), cSmin = numIn(c.shortMin, { min: 10, max: 170 }), cSmax = numIn(c.shortMax, { min: 10, max: 180 });
  const wOn = cb(w.enabled);
  const hookTxt = cb(c.hookText !== false);
  const capOn = cb(c.captions?.enabled), capColor = h('input', { type: 'color', value: c.captions?.color || '#FFE14D', class: 'color small' });
  const camOn = cb(c.facecam?.enabled);
  const camAuto = cb(c.facecam?.auto !== false);
  const cVoice = h('select', {}, [['auto', 'automatisch: Spur 2, wenn es mehrere gibt (OBS-Mehrspur)'], ['off', 'aus – immer die Mischspur'], ...[1, 2, 3, 4, 5, 6].map((n) => [String(n), 'Spur ' + n])]
    .map(([k, n]) => h('option', { value: k, selected: String(c.voiceTrack || 'auto') === k }, n)));
  let cam = { ...(c.facecam || {}) };
  const camInfo = h('span', { class: 'hint' }, cam.w ? `markiert: ${Math.round(cam.x * 100)} % / ${Math.round(cam.y * 100)} %, ${Math.round(cam.w * 100)} × ${Math.round(cam.h * 100)} %` : 'noch nicht markiert');
  const camPart = h('div', { class: 'cam' }, h('div', { class: 'row' },
    h('button', { class: 'btn small', onclick: () => markFacecam(cam, (r) => { cam = { ...cam, ...r }; camInfo.textContent = `markiert: ${Math.round(r.x * 100)} % / ${Math.round(r.y * 100)} %, ${Math.round(r.w * 100)} × ${Math.round(r.h * 100)} % – noch speichern`; }) }, '⬚ Facecam markieren'), camInfo));
  const wModel = h('select', {}, Object.entries(w.whisper?.models || w.models || {}).map(([m, d]) => h('option', { value: m, selected: w.model === m }, `${m} – ${d}${(w.installed || []).includes(m) ? ' ✓ geladen' : ''}`)));
  const wThreads = numIn(w.threads, { min: 1, max: 32 });
  const wGpu = cb(w.useGpu);
  const cSum = h('select', {}, [[0, 'keine'], [60, '1 Minute'], [120, '2 Minuten'], [180, '3 Minuten'], [300, '5 Minuten'], [480, '8 Minuten'], [600, '10 Minuten']]
    .map(([n, t]) => h('option', { value: n, selected: (c.summary || 0) === n }, t)));
  const win = c.window || {};
  const liFmt = h('select', {}, [['4:5', '4:5 hoch (empfohlen, 1080 × 1350)'], ['1:1', '1:1 quadratisch (1080 × 1080)'], ['16:9', '16:9 quer (1920 × 1080)']]
    .map(([k, n]) => h('option', { value: k, selected: (c.linkedin?.format || '4:5') === k }, n)));
  const liCap = cb(c.linkedin?.captions !== false);
  const wnOn = cb(win.enabled), wnFrom = h('input', { type: 'time', value: win.from || '01:00' }), wnTo = h('input', { type: 'time', value: win.to || '07:00' });
  const gpuInfo = !w.gpu?.available ? 'Grafikkarten-Version ist in diesem Image nicht enthalten.'
    : w.gpu.tried ? (w.gpu.ok ? '🟢 läuft auf der Grafikkarte' : '⚪ Grafikkarte ging nicht (' + (w.gpu.error || '?') + ') – nutzt Prozessor') : 'wird beim nächsten Mal ausprobiert';
  const dl = w.download;
  const cutBox = h('div', { class: 'box' }, h('h3', {}, '✂ Automatischer Schnitt'),
    c.running ? h('p', { class: 'hint' }, 'Läuft gerade' + (c.queued ? `, ${c.queued} warten` : '') + '.') : null,
    h('label', { class: 'check' }, cAuto, 'Neue Rohaufnahmen im Eingang automatisch schneiden'),
    h('label', { class: 'check' }, cLong, 'Langfassung für YouTube erzeugen'),
    h('label', { class: 'check' }, cPause, 'dabei ruhige Abschnitte (Menü, Pause, Laden) herausschneiden'),
    h('label', { class: 'check' }, cCopy, 'Langfassung schnell ohne Neukodieren (nur Keyframes – kann an Schnitten ruckeln)'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'ruhig = leiser als (LUFS)'), cDb), h('div', {}, h('label', {}, 'ab Länge (Sekunden)'), cMin)),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Shorts je Video (0 = keine)'), cShorts),
      h('div', {}, h('label', {}, 'Länge von – bis (s)'), h('div', { class: 'row' }, cSmin, cSmax))),
    h('div', {}, h('label', {}, 'Kurzfassung (beste Stellen am Stück) – Standard'), cSum),
    h('p', { class: 'hint' }, 'Je Video kannst du im Video selbst (Eingang/Rohvideos) festlegen, was entstehen soll, und der KI einen Wunsch mitgeben.'),
    h('label', { class: 'check' }, cMove, 'Original danach nach „Rohvideos“ verschieben'),
    h('label', { class: 'check' }, wnOn, '🌙 Nachtbetrieb: nur in diesem Zeitfenster schneiden'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'von'), wnFrom, h('span', { class: 'hint' }, 'bis'), wnTo,
      h('span', { class: 'hint' }, c.window?.enabled ? (c.windowOpen ? '(gerade offen)' : '(gerade zu – „Jetzt schneiden“ geht trotzdem)') : '')),
    h('label', { class: 'check' }, capOn, 'Animierte Untertitel in Shorts (Wort für Wort)'),
    h('label', { class: 'check' }, hookTxt, '⚡ Hook-Text der KI groß im ersten Bild der Shorts (Hook-Stil und Tempo je Kanal unter „Kanäle“)'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Farbe des gesprochenen Worts:'), capColor),
    h('label', { class: 'check' }, camAuto, '🖼 Bildaufbau automatisch: die KI findet die Facecam (auch wenn sie wandert) und wählt Facecam oben / Ausschnitt um die Action / Blur'),
    h('label', { class: 'check' }, camOn, 'Feste Facecam statt automatisch (von Hand markierter Bereich)'),
    h('label', {}, '🎙 Tonspur deiner Stimme (für Tonfall, Lacher, Spracherkennung)'), cVoice,
    h('p', { class: 'hint' }, 'Mit OBS-Mehrspur (Spur 1 = alles, Spur 2 = Mikrofon, Spur 3 = Spiel) hört die Zentrale deine Reaktionen getrennt vom Spiel. Twitch-VODs haben nur eine Spur – dann wird die Mischspur genutzt.'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'LinkedIn-Clips (Ordner eingang-profi): Format'), liFmt),
      h('div', {}, h('label', {}, '\u00a0'), h('label', { class: 'check' }, liCap, 'ruhige Untertitel einbrennen'))),
    camPart,
    h('p', { class: 'hint' }, c.gpu?.nvenc ? '🟢 Grafikkarte (NVENC) wird zum Kodieren genutzt.' : '⚪ Grafikkarte nicht genutzt' + (c.gpu?.error ? ' – ' + c.gpu.error : '') + '. In Unraid: --runtime=nvidia, NVIDIA_VISIBLE_DEVICES=all, NVIDIA_DRIVER_CAPABILITIES=all.'),
    h('h3', { style: { marginTop: '16px' } }, '🗣 Sprache erkennen (Whisper)'),
    h('p', { class: 'hint' }, 'Wandelt Gesprochenes in Text – die KI versteht dann, was du sagst. Läuft lokal auf dem Server, kostet nichts. Das Modell wird beim ersten Mal geladen.'),
    dl ? h('p', { class: dl.error ? 'err' : 'hint' }, dl.error || `Lade Modell „${dl.model}“ … ${dl.total ? Math.round(dl.done / dl.total * 100) + ' %' : Math.round(dl.done / 1e6) + ' MB'}`) : null,
    h('label', { class: 'check' }, wOn, 'Sprache erkennen'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Modell'), wModel), h('div', {}, h('label', {}, 'CPU-Kerne (ohne Grafikkarte)'), wThreads)),
    h('label', { class: 'check' }, wGpu, 'Whisper auf der Grafikkarte (deutlich schneller, Prozessor bleibt frei)'),
    h('p', { class: 'hint' }, gpuInfo + (w.lastEngine ? ' · zuletzt gerechnet von: ' + w.lastEngine : '') + (w.helperOnline ? ' · 🖥 Rechenhelfer online' : '')),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/cut/config', { auto: cAuto.checked, longVersion: cLong.checked, cutPauses: cPause.checked,
        silenceDb: Number(cDb.value), minPause: Number(cMin.value), shorts: Number(cShorts.value), shortMin: Number(cSmin.value), shortMax: Number(cSmax.value),
        moveRaw: cMove.checked, summary: Number(cSum.value), longCopy: cCopy.checked, hookText: hookTxt.checked, whisper: { enabled: wOn.checked, model: wModel.value, threads: Number(wThreads.value), gpu: wGpu.checked },
        window: { enabled: wnOn.checked, from: wnFrom.value, to: wnTo.value }, linkedin: { format: liFmt.value, captions: liCap.checked },
        captions: { enabled: capOn.checked, color: capColor.value }, facecam: { enabled: camOn.checked, auto: camAuto.checked, x: cam.x, y: cam.y, w: cam.w, h: cam.h }, voiceTrack: cVoice.value }), 'Gespeichert.') }, 'Speichern')));

  // ----- Twitch -----
  const tw = st.twitch || {};
  const twId = h('input', { value: tw.configured ? '' : '', placeholder: tw.configured ? 'gespeichert – zum Ändern neu eintragen' : 'Client-ID aus dev.twitch.tv' });
  const twSecret = h('input', { type: 'password', autocomplete: 'off', placeholder: tw.hasSecret ? 'gespeichert' : 'nur bei App-Typ „Vertraulich“ (sonst leer lassen)' });
  const twChat = cb(tw.chat !== false), twVod = cb(!!tw.vodImport);
  const twFolder = h('select', {}, [['eingang', 'Eingang'], ['eingang-profi', 'Eingang (Profi)']].map(([k, n]) => h('option', { value: k, selected: (tw.vodFolder || 'eingang') === k }, n)));
  const es = tw.eventsub || {};
  const twitchBox = h('div', { class: 'box' }, h('h3', {}, '🟣 Twitch (Chat-Ausschläge, Zuschauer-Clips, Marker)'),
    tw.connected ? h('p', { class: 'ok-text' }, `✓ verbunden als ${tw.user?.name || '?'} · Chat-Mitschnitt: ${es.state || 'aus'}${es.error ? ' (' + es.error + ')' : ''}`
      + (tw.live ? ` · 🔴 live seit ${fmtDate(tw.live.startedAt)}` : '')) : null,
    tw.pending ? h('div', { class: 'section' }, h('p', {}, 'Auf ', h('a', { href: tw.pending.url, target: '_blank', rel: 'noopener' }, 'twitch.tv/activate'), ' den Code eingeben:'),
      h('div', { class: 'code' }, tw.pending.code), tw.pending.error ? h('p', { class: 'err' }, tw.pending.error) : h('p', { class: 'hint' }, 'Wartet auf deine Bestätigung …')) : null,
    !tw.connected ? h('ol', { class: 'steps' },
      h('li', {}, 'dev.twitch.tv/console → „Register Your Application“: Name z. B. „Micha Video-Zentrale“, OAuth Redirect URL ', h('code', {}, 'http://localhost'), ' (wird nicht genutzt, ist aber Pflicht), Kategorie „Application Integration“, Client-Typ „Öffentlich“.'),
      h('li', {}, 'Client-ID hier eintragen, speichern, dann „Mit Twitch verbinden“ – Code auf twitch.tv/activate eingeben.'),
      h('li', {}, 'Rechte: Chat lesen (user:read:chat) und Stream-Marker lesen (user:read:broadcast) – nichts wird gepostet.')) : null,
    h('label', {}, 'Client-ID'), twId,
    h('label', {}, 'Client-Secret (optional)'), twSecret,
    h('label', { class: 'check' }, twChat, '💬 Chat live mitschreiben (nur Uhrzeit + Text, keine Namen) – Chat-Ausschläge werden Highlight-Signale'),
    h('label', { class: 'check' }, twVod, '⬇ VOD nach Streamende automatisch in den Eingang laden (inoffizieller Download-Weg über yt-dlp – kann brechen, wenn Twitch etwas ändert)'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Ziel:'), twFolder,
      h('span', { class: 'hint' }, tw.ytdlp?.ok ? 'yt-dlp ' + tw.ytdlp.version : 'yt-dlp fehlt (kommt mit dem nächsten Update des Containers)')),
    h('p', { class: 'hint' }, 'Tipp: Setz im Stream bei starken Momenten einen Marker (/marker oder Stream-Deck) – die Zentrale nimmt diese Stellen sicher als Kandidaten. Nimmt OBS beim Streamen mit auf, wird die Aufnahme über die Uhrzeit im Dateinamen zugeordnet; Twitch-VODs über ihre Nummer bzw. Länge.'),
    (tw.streams || []).length ? h('details', {}, h('summary', {}, `Streams (${tw.streams.length})`),
      tw.streams.map((x) => h('div', { class: 'row' }, h('span', {}, fmtDate(x.startedAt) + ' · ' + (x.title || 'Stream')),
        h('span', { class: 'hint' }, [x.messages ? `💬 ${x.messages}` : '', x.vodId ? 'VOD ' + x.vodId : 'kein VOD', x.imported ? '✓ importiert' : '', x.importError ? '⚠ ' + x.importError : ''].filter(Boolean).join(' · ')),
        x.vodId && !x.imported ? h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/twitch/import/' + x.id), 'VOD wird geladen – erscheint danach im Eingang.') }, '⬇ VOD laden') : null))) : null,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/twitch/config', { ...(twId.value.trim() ? { clientId: twId.value.trim() } : {}), clientSecret: twSecret.value, chat: twChat.checked, vodImport: twVod.checked, vodFolder: twFolder.value }), 'Gespeichert.') }, 'Speichern'),
      tw.configured && !tw.connected ? h('button', { class: 'btn primary', onclick: run(async () => { await api('POST', '/api/twitch/connect'); watchTwitch(); }) }, 'Mit Twitch verbinden') : null,
      tw.connected ? h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/twitch/sync'), 'Streams abgeglichen.') }, '↻ Streams abgleichen') : null,
      tw.connected ? h('button', { class: 'btn ghost danger', onclick: () => confirm('Twitch trennen?') && run(() => api('POST', '/api/twitch/disconnect'), 'Getrennt.')() }, 'Trennen') : null));

  // ----- Zahlen (Statistik) -----
  const sYa = cb(!!y.analytics), sTl = cb(!!t.statsList);
  const statsBox = h('div', { class: 'box' }, h('h3', {}, '📈 Zahlen von YouTube, TikTok und Twitch'),
    h('p', { class: 'hint' }, 'Alle 6 Stunden holt die Zentrale Aufrufe, Likes und Kommentare deiner hochgeladenen Videos (Reiter „📈 Zahlen“). Die KI lernt daraus, was bei deinem Publikum läuft.'
      + (st.stats?.lastRun ? ' Zuletzt: ' + fmtDate(st.stats.lastRun) + '.' : '')),
    h('label', { class: 'check' }, sYa, 'YouTube Analytics: wie viel % angesehen wird (danach jeden Kanal unter „YouTube“ einmal trennen und neu verbinden – zusätzliches Nur-Lese-Recht)'),
    h('label', { class: 'check' }, sTl, 'TikTok-Zahlen (Recht video.list) – erst einschalten, wenn TikTok die App freigegeben hat und „Display API“ hinzugefügt ist, danach Kanäle neu verbinden'),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/stats/config', { ytAnalytics: sYa.checked, ttList: sTl.checked }), 'Gespeichert.') }, 'Speichern'),
      h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/stats/refresh'), 'Zahlen werden abgerufen.') }, '↻ Jetzt abrufen')));

  // ----- Musik -----
  const mu = st.music || {};
  const muOn = cb(mu.enabled), muShorts = cb(mu.shorts), muLong = cb(mu.long);
  const muSrc = h('select', {}, [['mixed', 'Eigene Titel zuerst, sonst KI-Musik'], ['library', 'Nur eigene Titel (Ordner)'], ['ai', 'Immer KI-Musik']]
    .map(([k, n]) => h('option', { value: k, selected: mu.source === k }, n)));
  const lufsTxt = (x) => { const d = Number(x) + 14; return `${x} LUFS – ${-d} dB unter der Stimme` + (x <= -34 ? ' (sehr leise)' : x <= -31 ? ' (leise)' : x <= -27 ? ' (mittel)' : ' (laut)'); };
  const muLufsOut = h('span', { class: 'hint' }, lufsTxt(mu.lufs ?? -30));
  const muLevel = h('input', { type: 'range', min: -42, max: -18, step: 1, value: mu.lufs ?? -30, oninput: () => { muLufsOut.textContent = lufsTxt(muLevel.value); } });
  const muDuckSel = h('select', {}, [['aus', 'aus – Musik bleibt gleich laut'], ['leicht', 'leicht – sanft, kaum hörbar (empfohlen)'], ['mittel', 'mittel'], ['stark', 'stark – Musik fast weg beim Sprechen']]
    .map(([k, n]) => h('option', { value: k, selected: (mu.duckLevel || 'leicht') === k }, n)));
  const muLongMax = numIn(mu.longMax, { min: 30, max: 600 });
  const muModel = h('input', { value: mu.model || '' });
  const musicBox = h('div', { class: 'box' }, h('h3', {}, '🎵 Hintergrundmusik'),
    h('p', { class: 'hint' }, `Eigene Titel (z. B. von Epidemic Sound) in ${mu.folder || 'musik'} legen – je Kanal in den Unterordner mit der Kanal-ID, nach Stimmung in Unterordner wie „episch“, „lustig“, „chillig“. Sonst erzeugt fal.ai passende KI-Musik (Sonilo, laut Anbieter kommerziell nutzbar, ca. ${String(mu.pricePerMinute ?? 0.15).replace('.', ',')} $ je Minute). Musik wird unter die Stimme gemischt und leiser, sobald du sprichst.`),
    h('label', { class: 'check' }, muOn, 'Hintergrundmusik einmischen'),
    h('label', { class: 'check' }, muShorts, 'in Shorts'),
    h('label', { class: 'check' }, muLong, 'in der Langfassung (Titel wird wiederholt)'),
    h('label', {}, 'Quelle'), muSrc,
    h('label', {}, 'Musik-Lautstärke (unter der Stimme)'), muLevel, muLufsOut,
    h('label', {}, 'Musik absenken, während du sprichst'), muDuckSel,
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'KI-Titel Langfassung max. (s)'), muLongMax), h('div', {}, h('label', {}, 'KI-Modell (fal.ai)'), muModel)),
    h('p', { class: 'hint' }, `Allgemeiner Ordner: ${mu.common ?? 0} Titel · KI-Musik bisher: ${mu.generated || 0} Titel, ca. ${(mu.spent || 0).toFixed(2).replace('.', ',')} $`
      + (mu.falConfigured ? '' : ' · ⚠ fal.ai-Schlüssel fehlt (unten bei Titelbilder)')),
    h('p', { class: 'hint' }, 'Epidemic Sound: deine Kanäle müssen in deinem Epidemic-Konto verknüpft sein, sonst meldet YouTube Urheberrechtsansprüche.'),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/music/config', { enabled: muOn.checked, shorts: muShorts.checked, long: muLong.checked,
        duckLevel: muDuckSel.value, source: muSrc.value, lufs: Number(muLevel.value), longMax: Number(muLongMax.value), model: muModel.value }), 'Gespeichert.') }, 'Speichern')));

  // ----- Titelbilder & Fotos -----
  const fl = st.fal;
  const fKey = h('input', { type: 'password', autocomplete: 'off', placeholder: fl.configured ? 'gespeichert (' + fl.keyHint + ') – zum Ändern neu eintragen' : 'fal.ai API-Schlüssel' });
  const fModel = h('input', { value: fl.model });
  const fGen = h('input', { value: fl.genModel });
  const fAuto = cb(fl.autoThumb);
  const upLabel = h('select', {}, fl.labels.map((l) => h('option', { value: l }, l)));
  const upChannel = h('select', {}, h('option', { value: '' }, 'alle Kanäle'), st.profiles.map((p) => h('option', { value: p.id }, p.name)));
  const upInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, class: 'hidden', onchange: async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      toast(`Lade „${f.name}“ hoch${fl.configured ? ' und stelle frei' : ''} …`);
      try { const p = await api('POST', `/api/photos?label=${encodeURIComponent(upLabel.value)}&channel=${encodeURIComponent(upChannel.value)}`, undefined, f); if (p.note) toast(p.note, true); }
      catch (x) { toast(x.message, true); }
    }
    again();
  } });
  const phList = await api('GET', '/api/photos').catch(() => ({ photos: [] }));
  const photoGrid = h('div', { class: 'photos' }, phList.photos.map((p) => {
    const lab = h('select', { onchange: () => api('PUT', '/api/photos/' + p.id, { label: lab.value }).then(() => toast('Gespeichert.')) }, fl.labels.map((l) => h('option', { value: l, selected: p.label === l }, l)));
    const chs = h('select', { onchange: () => api('PUT', '/api/photos/' + p.id, { channel: chs.value }).then(() => toast('Gespeichert.')) },
      h('option', { value: '' }, 'alle Kanäle'), st.profiles.map((x) => h('option', { value: x.id, selected: p.channel === x.id }, x.name)));
    const pic = h('div', { class: 'photo-img' }); pic.style.backgroundImage = `url("/api/photos/${p.id}/image?v=${p.rev || encodeURIComponent(p.at)}")`;
    const img = h('div', { class: 'photo' + (p.cut ? '' : ' uncut') }, pic);
    return h('div', { class: 'phcard' }, img, lab, chs,
      p.cut ? h('div', { class: 'hint ok-text' }, '✓ freigestellt') : h('div', { class: 'hint' }, 'nicht freigestellt', p.note ? h('div', { class: 'err' }, p.note) : null,
        fl.configured ? h('button', { class: 'btn small', onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'wird freigestellt …';
          try { await api('POST', `/api/photos/${p.id}/recut`); toast('Freigestellt.'); again(); }
          catch (x) { toast(x.message, true); e.target.disabled = false; e.target.textContent = 'freistellen'; }
        } }, 'freistellen') : null),
      h('button', { class: 'btn small ghost danger', onclick: () => confirm('Foto löschen?') && run(() => api('DELETE', '/api/photos/' + p.id), 'Gelöscht.')() }, 'Löschen'));
  }));
  const thumbBox = h('div', { class: 'box wide' }, h('h3', {}, '🖼 Titelbilder & Fotos von dir'),
    h('p', { class: 'hint' }, 'Lade 4–8 Fotos mit verschiedenen Gesichtsausdrücken hoch (überrascht, jubelnd, zeigend …). Die KI wählt je Video das passende Foto, Standbild und den Text; die Zentrale baut 3 Varianten (1280 × 720). Mit fal.ai werden Fotos automatisch freigestellt.'),
    h('div', { class: 'row' }, upLabel, upChannel, h('button', { class: 'btn primary', onclick: () => upInput.click() }, '⤒ Fotos hochladen'), upInput),
    phList.photos.length ? photoGrid : h('p', { class: 'hint' }, 'Noch keine Fotos.'),
    h('h3', { style: { marginTop: '16px' } }, 'fal.ai'),
    fl.configured ? h('p', { class: 'ok-text' }, `✓ eingerichtet · ${fl.count} freigestellt, ${fl.generated} KI-Titelbilder, ${fl.boosts} KI-Aufwertungen`) : h('p', { class: 'hint' }, 'Schlüssel von fal.ai (Dashboard → API Keys). Freistellen kostet nur Bruchteile eines Cents; „KI-Aufwertung“ eines Titelbilds je nach Modell einige Cent.'),
    h('label', {}, 'API-Schlüssel'), fKey,
    h('label', { class: 'check' }, fAuto, '✨ Für jedes neue Video automatisch ein KI-Titelbild erzeugen (ca. 4 Cent)'),
    h('details', {}, h('summary', { class: 'hint' }, 'Modelle (fal.ai)'), h('label', {}, 'KI-Titelbild'), fGen, h('label', {}, 'KI-Aufwertung'), fModel),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/fal/config', { key: fKey.value, model: fModel.value, genModel: fGen.value, autoThumb: fAuto.checked }), 'Gespeichert.') }, 'Speichern')));

  // ----- Rechenhelfer (PC) -----
  const hp = await api('GET', '/api/helper-config').catch(() => null);
  const hpOn = cb(hp?.enabled);
  const hpGame = cb(hp?.pauseGaming !== false);
  const hpLoad = h('input', { type: 'number', min: 5, max: 95, value: hp?.gpuLoad ?? 25 });
  const hpGames = h('input', { value: hp?.games || '', placeholder: 'z. B. Wow, FortniteClient-Win64-Shipping, cs2 (Prozessname ohne .exe)' });
  const hpModel = h('select', {}, [['large-v3', 'large-v3 – beste Qualität, genaueste Satzgrenzen (empfohlen)'], ['large-v3-turbo', 'large-v3-turbo – sehr gut, schneller'], ['medium', 'medium'], ['small', 'small']]
    .map(([k, n]) => h('option', { value: k, selected: (hp?.model || 'large-v3') === k }, n)));
  const hpMode = h('select', {}, [['manual', 'Nur nach Freigabe (Knopf hier oder Desktop-Verknüpfung)'], ['night', 'Nachts automatisch + nach Freigabe'], ['auto', 'Immer, wenn nicht gezockt wird']]
    .map(([k, n]) => h('option', { value: k, selected: (hp?.mode || 'manual') === k }, n)));
  const hpNf = h('input', { type: 'time', value: hp?.nightFrom || '02:00' }), hpNt = h('input', { type: 'time', value: hp?.nightTo || '07:00' });
  const hpAn = h('input', { type: 'checkbox', checked: hp?.analyse !== false }), hpWait = h('input', { type: 'checkbox', checked: hp?.waitPc !== false });
  const hpWaitH = h('input', { type: 'number', min: 1, max: 72, value: hp?.waitHours || 12, style: { width: '80px' } });
  const hpWords = h('textarea', { rows: 2, value: hp?.ocrWords || '', placeholder: 'leer = Standardliste (victory, sieg, eliminated, headshot, #1, you died …)' });
  const helperBox = h('div', { class: 'box' }, h('h3', {}, '🖥 Rechenhelfer (dein PC)'),
    h('p', { class: 'hint' }, 'Ein PC mit NVIDIA-Grafikkarte (z. B. RTX 3070) übernimmt die Spracherkennung mit dem großen Whisper-Modell – genauer, schneller und der Server wird entlastet. Ist der PC aus, rechnet die Zentrale selbst.'),
    hp?.enabled ? hpStatusEl(hp) : null,
    hp?.enabled ? h('div', { class: 'section' },
      h('b', {}, '🔓 Grafikkarte freigeben'),
      h('p', { class: hp.released ? 'ok-text' : 'hint' }, hp.released ? (hp.until ? `Freigegeben bis ${fmtDate(hp.until)}` + (hp.by ? ` (von ${hp.by})` : '') : hp.mode === 'auto' ? 'Immer freigegeben (Modus automatisch).' : 'Freigegeben (Nachtfenster).')
        : 'Gesperrt – der PC rechnet erst, wenn du freigibst.'),
      h('div', { class: 'row' },
        [['2 Std.', 2], ['bis morgen früh', 'morning'], ['bis ich sperre', 'stop']].map(([n, v]) => h('button', { class: 'btn small' + (hp.released ? '' : ' primary'), onclick: run(() => api('POST', '/api/helper-release', { hours: v }), 'Grafikkarte freigegeben.') }, '🔓 ' + n)),
        hp.until ? h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/helper-release', { hours: 0 }), 'Gesperrt.') }, '🔒 Sperren') : null),
      h('p', { class: 'hint' }, 'Auf dem PC gibt es dafür auch die Verknüpfungen „Grafikkarte freigeben/sperren (Video-Zentrale)“ auf dem Desktop (werden bei „Einrichten.bat“ angelegt). Startest du ein Spiel oder OBS, endet die Freigabe sofort.')) : null,
    hp?.enabled && (hp.done || hp.failed) ? h('p', { class: 'hint' }, `${hp.done} Aufträge erledigt` + (hp.failed ? `, ${hp.failed} fehlgeschlagen` : '') + (hp.lastError ? ` · letzter Fehler: ${hp.lastError}` : '')) : null,
    h('label', { class: 'check' }, hpOn, 'Rechenhelfer verwenden'),
    h('label', {}, 'Wann darf der PC rechnen?'), hpMode,
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Nachtfenster von'), hpNf, h('span', { class: 'hint' }, 'bis'), hpNt),
    h('label', {}, 'Whisper-Modell auf dem PC'), hpModel,
    h('div', { class: 'section' }, h('b', {}, '🧠 PC-Analyse (ab Rechenhelfer 1.5)'),
      h('p', { class: 'hint' }, 'Der PC trennt deine Stimme vom Spielton (wichtig für Twitch-VODs), erkennt Lachen, Schreie, Jubel, Explosionen und liest Spieltexte wie „VICTORY“ oder „ELIMINATED“. '
        + 'Beim ersten Mal richtet er Python und die Modelle selbst ein (ca. 5–6 GB, dauert je nach Leitung 15–60 Min.).'
        + ((hp?.caps || []).includes('analyse') ? ' ✓ Der PC kann das bereits.' : ' Noch nicht eingerichtet – nach dem Update ZIP neu laden und „Einrichten.bat“ ausführen.')),
      h('label', { class: 'check' }, hpAn, 'PC-Analyse für neue Aufnahmen'),
      h('label', { class: 'check' }, hpWait, 'Mit dem Schnitt warten, bis die Grafikkarte freigegeben ist'),
      h('div', { class: 'row' }, h('span', { class: 'hint' }, 'höchstens'), hpWaitH, h('span', { class: 'hint' }, 'Stunden, danach ohne PC-Analyse schneiden')),
      h('label', {}, 'Spieltexte, die als Highlight zählen (mit Komma)'), hpWords),
    h('label', { class: 'check', style: { marginTop: '8px' } }, hpGame, '🎮 Pausieren, wenn ich zocke (OBS läuft, Spiel aus der Liste läuft oder Grafikkarte ausgelastet)'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Grafikkarte gilt als belegt ab (%)'), hpLoad), h('div', {}, h('label', {}, 'Spiele (Prozessnamen, mit Komma)'), hpGames)),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/helper-config', { enabled: hpOn.checked, model: hpModel.value, mode: hpMode.value, nightFrom: hpNf.value, nightTo: hpNt.value,
        analyse: hpAn.checked, waitPc: hpWait.checked, waitHours: Number(hpWaitH.value), ocrWords: hpWords.value,
        pauseGaming: hpGame.checked, gpuLoad: Number(hpLoad.value), games: hpGames.value }), 'Gespeichert.') }, 'Speichern'),
      hp?.enabled ? h('a', { class: 'btn primary', href: '/api/helper-download?origin=' + encodeURIComponent(location.origin), download: '' }, '⤓ Rechenhelfer für Windows (ZIP)') : null,
      hp?.enabled ? h('button', { class: 'btn small ghost', onclick: () => confirm('Neuen Schlüssel erzeugen? Der PC muss danach das neue ZIP bekommen.') && run(() => api('POST', '/api/helper-config', { newToken: true }), 'Neuer Schlüssel – ZIP neu herunterladen.')() }, 'Neuen Schlüssel erzeugen') : null),
    hp?.enabled ? h('ol', { class: 'hint' },
      h('li', {}, 'ZIP herunterladen und auf dem PC entpacken, z. B. nach C:\\VideoZentrale-Rechenhelfer.'),
      h('li', {}, 'Im Ordner „Rechenhelfer“ doppelt auf „Einrichten.bat“ klicken (lädt einmalig whisper.cpp und das Modell, ca. 1,5–3 GB, und startet künftig automatisch).'),
      h('li', {}, 'Hier steht dann „online“ (beim ersten Start erst nach dem Download von whisper.cpp). Läuft er nicht: auf dem PC „Starten.bat“ – dort siehst du die Meldungen; Protokoll unter %LOCALAPPDATA%\\VideoZentrale-Rechenhelfer\\rechenhelfer.log.'),
      h('li', {}, 'Das ZIP enthält deinen Schlüssel – nicht weitergeben.')) : null);

  // ----- Sicherung -----
  const bk = await api('GET', '/api/backup').catch(() => null);
  const fmtSize = (n) => n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
  const restoreFrom = async (label, doIt) => {
    if (!confirm(`Einstellungen aus „${label}“ wiederherstellen?\n\nDer jetzige Stand wird vorher automatisch gesichert. Kanäle, Verbindungen, Schlüssel, Fotos und Videodaten werden ersetzt.`)) return;
    try { const r = await doIt(); toast(`Wiederhergestellt: ${r.profiles} Kanäle, ${r.videos} Videos. Vorheriger Stand liegt in „${r.before}“.`); await loadSettings(); again(); }
    catch (x) { toast(x.message, true); }
  };
  const bkInput = h('input', { type: 'file', accept: '.zip,application/zip', class: 'hidden', onchange: (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) restoreFrom(f.name, () => api('POST', '/api/backup/restore', undefined, f));
  } });
  const bkAuto = cb(bk?.auto), bkTime = h('input', { type: 'time', value: bk?.time || '03:30' }), bkKeep = numIn(bk?.keep ?? 14, { min: 1, max: 90 });
  // ----- Öffentliche Info-Seite (/info) -----
  const pi = await api('GET', '/api/public-info').catch(() => null);
  const infoUrl = location.origin + '/info';
  const npmSnippet = `location ^~ /info {\n    allow all;\n    proxy_pass http://192.168.1.10:8094;\n    proxy_set_header Host $host;\n}`;
  const piCompany = h('input', { value: pi?.company || '' }), piContact = h('textarea', { rows: 3, value: pi?.contact || '', placeholder: 'Inhaber, Anschrift, E-Mail' });
  const piImprint = h('input', { value: pi?.imprintUrl || '', placeholder: 'https://…/impressum' }), piPrivacy = h('input', { value: pi?.privacyUrl || '', placeholder: 'optional: https://…/datenschutz' });
  const infoBox = h('div', { class: 'box' }, h('h3', {}, '🌐 Öffentliche Info-Seite'),
    h('p', { class: 'hint' }, 'Für die App-Prüfung bei TikTok (und Google) braucht es eine von außen erreichbare Website. Die Zentrale hat dafür unter /info drei Seiten ohne Anmeldung: '
      + 'Beschreibung, Nutzungsbedingungen und Datenschutzhinweise (deutsch + englisch). Alles andere bleibt im Heimnetz.'),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } }, ...[['/info', 'Info-Seite'], ['/info/nutzungsbedingungen', 'Nutzungsbedingungen'], ['/info/datenschutz', 'Datenschutz']]
      .map(([u, n]) => h('a', { class: 'btn small ghost', href: u, target: '_blank', rel: 'noopener' }, n + ' ↗'))),
    h('label', {}, 'Firma / Name'), piCompany, h('label', {}, 'Kontakt (erscheint auf den Seiten)'), piContact,
    h('label', {}, 'Impressum-Adresse'), piImprint, h('label', {}, 'Allgemeine Datenschutzerklärung (optional)'), piPrivacy,
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: run(() => api('POST', '/api/public-info', { company: piCompany.value, contact: piContact.value, imprintUrl: piImprint.value, privacyUrl: piPrivacy.value }), 'Gespeichert.') }, 'Speichern')),
    h('details', {}, h('summary', {}, 'So gibst du nur /info nach außen frei (Nginx Proxy Manager)'),
      h('ol', { class: 'steps' },
        h('li', {}, 'NPM öffnen → Proxy Hosts → videos.flexisticker.de → Bearbeiten (⋮ → Edit).'),
        h('li', {}, 'Reiter „Advanced“ → in „Custom Nginx Configuration“ diesen Block einfügen (IP/Port wie beim Proxy-Ziel der Zentrale):'),
        h('li', {}, h('pre', { class: 'snippet' }, npmSnippet), h('button', { class: 'btn small', onclick: () => { navigator.clipboard?.writeText(npmSnippet).then(() => toast('Kopiert.'), () => toast('Bitte von Hand markieren.', true)); } }, 'Kopieren')),
        h('li', {}, 'Speichern. Die Zugriffsliste „Nur Heimnetz“ bleibt eingeschaltet – sie gilt weiter für alles außer /info.'),
        h('li', {}, 'Am Handy mit WLAN aus prüfen: ' + infoUrl + ' lädt, ' + location.origin + '/ zeigt weiterhin 403.'),
        h('li', {}, 'Bei TikTok eintragen: Website ' + infoUrl + ', Terms ' + infoUrl + '/nutzungsbedingungen, Privacy ' + infoUrl + '/datenschutz.'))));
  const backupBox = h('div', { class: 'box' }, h('h3', {}, '💾 Sicherung'),
    h('p', { class: 'hint' }, 'Sichert Kanäle, Verbindungen, Schlüssel, alle Einstellungen, Videodaten (Titel, Texte, Status), deine Fotos und Transkripte. Die Videos selbst und die Musik liegen auf dem Server-Array und sind nicht enthalten.'),
    !bk ? h('p', { class: 'err' }, 'Sicherungen konnten nicht geladen werden.') : null,
    bk?.lastError ? h('p', { class: 'err' }, 'Letzte Sicherung fehlgeschlagen: ' + bk.lastError) : null,
    bk?.lastAt ? h('p', { class: 'ok-text' }, '✓ Letzte Sicherung: ' + fmtDate(bk.lastAt)) : h('p', { class: 'hint' }, 'Noch keine Sicherung.'),
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: '/api/backup/download', download: '' }, '⤓ Sicherung herunterladen'),
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/backup'), 'Sicherung angelegt.') }, 'Jetzt sichern'),
      h('button', { class: 'btn ghost', onclick: () => bkInput.click() }, '⤒ Aus Datei wiederherstellen'), bkInput),
    h('label', { class: 'check', style: { marginTop: '10px' } }, bkAuto, 'Täglich automatisch sichern'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Uhrzeit'), bkTime), h('div', {}, h('label', {}, 'Wie viele aufheben'), bkKeep)),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/backup/config', { auto: bkAuto.checked, time: bkTime.value, keep: Number(bkKeep.value) }), 'Gespeichert.') }, 'Speichern')),
    bk?.list?.length ? h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'hint' }, `Gespeicherte Sicherungen auf dem Server (${bk.list.length}) – ${bk.dir}`),
      h('div', { class: 'bklist' }, bk.list.map((x) => h('div', { class: 'bkrow' },
        h('span', {}, fmtDate(x.at), h('span', { class: 'hint' }, ' · ' + fmtSize(x.size) + (x.file.includes('vor-wiederherstellung') ? ' · vor Wiederherstellung' : ''))),
        h('a', { class: 'btn small', href: '/api/backup/download?file=' + encodeURIComponent(x.file), download: '' }, '⤓'),
        h('button', { class: 'btn small', onclick: () => restoreFrom(fmtDate(x.at), () => api('POST', '/api/backup/restore?file=' + encodeURIComponent(x.file))) }, 'Wiederherstellen'),
        h('button', { class: 'btn small ghost danger', onclick: () => confirm('Diese Sicherung löschen?') && run(() => api('DELETE', '/api/backup?file=' + encodeURIComponent(x.file)), 'Gelöscht.')() }, '✕'))))) : null,
    h('p', { class: 'hint', style: { marginTop: '10px' } }, '⚠ Die Datei enthält deine Schlüssel und Zugänge – sicher aufbewahren, nicht weitergeben.'));

  // ----- Allgemein + Zugang -----
  const auto = h('input', { type: 'checkbox', checked: st.settings.autoArchive });
  const trashDays = h('input', { type: 'number', min: 0, max: 365, value: st.settings.trashDays ?? 30 });
  const old = h('input', { type: 'password', autocomplete: 'current-password' });
  const neu = h('input', { type: 'password', autocomplete: 'new-password' });
  const account = h('div', { class: 'box' }, h('h3', {}, 'Allgemein & Zugang'),
    h('label', { class: 'check' }, auto, 'Nach YouTube + TikTok automatisch ins Archiv'),
    h('label', {}, 'Papierkorb automatisch leeren nach … Tagen (0 = nie)'), trashDays,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: run(() => api('PUT', '/api/settings', { autoArchive: auto.checked, trashDays: Number(trashDays.value) }), 'Gespeichert.') }, 'Speichern')),
    h('label', {}, 'Altes Passwort'), old, h('label', {}, 'Neues Passwort (mind. 8 Zeichen)'), neu,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/password', { old: old.value, password: neu.value }); old.value = neu.value = ''; toast('Passwort geändert.'); } catch (x) { toast(x.message, true); } } }, 'Passwort ändern'),
      h('button', { class: 'btn ghost', onclick: async () => { await api('POST', '/api/logout'); start(); } }, 'Abmelden')),
    h('p', { class: 'hint', style: { marginTop: '14px' } }, APP_NAME + ' ' + versionText(),
      ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); showChangelog(); } }, 'Was ist neu'),
      ' · ', h('a', { href: '#', onclick: async (e) => { e.preventDefault(); S.version = await api('POST', '/api/version/check'); toast(S.version.updateAvailable ? `Update ${S.version.latest.version} verfügbar – in Unraid „Check for Updates“ → „apply update“.` : S.version.latest.error ? 'Prüfung ging nicht: ' + S.version.latest.error : 'Du hast die neueste Version.', !!S.version.latest.error); render(); } }, 'Nach Updates suchen')));

  const cr = await api('GET', '/api/credits').catch(() => null);
  const crRow = (p) => {
    const x = cr[p];
    const top = h('input', { type: 'number', min: 0, step: '0.01', placeholder: 'z. B. 25', style: { width: '110px' } });
    const warn = h('input', { type: 'number', min: 0, step: '0.5', value: x.warnBelow, style: { width: '90px' } });
    const money = (n) => n == null ? '–' : n.toFixed(2).replace('.', ',') + ' $';
    return h('div', { class: 'cr-row' + (x.low || x.alert ? ' low' : '') },
      h('b', {}, x.name),
      x.alert ? h('p', { class: 'err' }, '⚠ ' + x.alert.msg + ' (' + fmtDate(x.alert.at) + ')') : null,
      h('p', {}, x.live?.balance != null ? `Guthaben laut ${p === 'fal' ? 'fal.ai' : 'Anbieter'}: ${money(x.live.balance)} (abgefragt ${fmtDate(x.live.at)})`
        : x.estimate != null ? `Geschätzt noch ${money(x.estimate)} (aufgeladen ${money(x.topup)} am ${fmtDate(x.at)}, seitdem verbraucht ${money(x.topup - x.estimate)})`
        : 'Noch keine Aufladung eingetragen – trag ein, wie viel Guthaben gerade drauf ist, dann rechnet die Zentrale mit.',
        h('span', { class: 'hint' }, ` · insgesamt von der Zentrale verbraucht: ${money(x.used)}`)),
      x.live?.error ? h('p', { class: 'hint' }, 'Abfrage: ' + x.live.error) : null,
      h('div', { class: 'row', style: { alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { class: 'hint' }, 'Aktuelles Guthaben ($):'), top,
        h('span', { class: 'hint' }, 'warnen unter ($):'), warn,
        h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/credits', { [p]: { topup: top.value === '' ? undefined : Number(top.value), warnBelow: Number(warn.value) } }), 'Gespeichert.') }, 'Speichern'),
        p === 'fal' ? h('button', { class: 'btn small ghost', onclick: run(() => api('POST', '/api/credits/check'), 'Abgefragt.') }, 'Jetzt abfragen') : null,
        h('a', { class: 'btn small ghost', href: x.url, target: '_blank', rel: 'noopener' }, 'Zum Aufladen ↗')));
  };
  const creditBox = h('div', { class: 'box' }, h('h3', {}, '💳 Guthaben der KI-Dienste'),
    h('p', { class: 'hint' }, 'Oben erscheint eine Warnung, sobald ein Guthaben unter die Schwelle fällt oder ein Dienst „kein Guthaben“ meldet. '
      + 'fal.ai kann das echte Guthaben liefern: dafür bei fal.ai unter API-Keys einen zusätzlichen Schlüssel mit „Read only“ anlegen und unten eintragen (er darf nur lesen, nichts erzeugen). '
      + 'Bei Claude gibt es keine Abfrage – trag nach dem Aufladen den Stand ein, dann zieht die Zentrale ihren Verbrauch ab (Schätzung, andere Nutzung desselben Kontos zählt nicht mit).'),
    cr ? crRow('fal') : null,
    cr ? (() => { const k = h('input', { type: 'password', autocomplete: 'off', placeholder: cr.falReadKey ? '•••••• gespeichert' : 'optional: fal.ai-Schlüssel mit „Read only“' });
      return h('div', { class: 'row', style: { alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' } }, h('span', { class: 'hint' }, 'Nur-Lese-Schlüssel fürs Guthaben:'), k,
        h('button', { class: 'btn small', onclick: run(async () => { await api('POST', '/api/credits', { falReadKey: k.value }); await api('POST', '/api/credits/check'); }, 'Gespeichert und abgefragt.') }, 'Speichern'),
        cr.falReadKey ? h('button', { class: 'btn small ghost', onclick: run(() => api('POST', '/api/credits', { removeFalReadKey: true }), 'Entfernt.') }, 'Entfernen') : null); })() : null,
    cr ? crRow('claude') : null);
  const sx = await api('GET', '/api/sfx').catch(() => null);
  const sfxBox = h('div', { class: 'box' }, h('h3', {}, '🔊 Soundeffekte'),
    h('p', { class: 'hint' }, 'Die KI setzt in Shorts passende Sounds (Whoosh, Bass-Boom, Zurückspulen, Pop …). Der Grundbaukasten wird einmal per KI erzeugt (fal.ai, laut Anbieter kommerziell nutzbar) und dann immer wieder verwendet. '
      + 'Eigene Sounds (z. B. von Epidemic Sound) einfach in den Ordner „musik\\sfx“ legen – gleicher Name wie unten ersetzt den KI-Sound, andere Namen kann die KI zusätzlich nutzen. Bekannte Internet-Meme-Sounds bitte nicht verwenden (Urheberrecht).'),
    sx ? h('p', {}, `${sx.ready} von ${sx.total} Baukasten-Sounds vorhanden`, sx.own.length ? ` · ${sx.own.length} eigene` : '', sx.custom ? ` · ${sx.custom} Sonder-Sounds` : '',
      sx.spent ? ` · bisher ca. ${sx.spent.toFixed(2).replace('.', ',')} $` : '', sx.building ? ' · wird gerade erzeugt …' : '') : null,
    sx && sx.ready < sx.total ? h('button', { class: 'btn primary', disabled: !sx.falKey || sx.building, onclick: run(() => api('POST', '/api/sfx/build'), 'Baukasten wird erzeugt – dauert ein paar Minuten.') },
      sx.falKey ? `Baukasten erzeugen (${sx.total - sx.ready} Sounds, ca. 0,10 $)` : 'Erst fal.ai-Schlüssel eintragen') : null,
    sx ? h('div', { class: 'sfx-list' }, sx.sounds.map((x) => h('button', { class: 'chip-btn' + (x.ready ? '' : ' off'), disabled: !x.ready, title: x.own ? 'eigener Sound' : x.id,
      onclick: () => { const a = new Audio('/api/sfx/file/' + x.id); a.play().catch(() => {}); } }, (x.ready ? '▶ ' : '') + x.name + (x.own ? ' ★' : '')))) : null,
    h('p', { class: 'hint' }, 'Fehlt ein Sound beim Schnitt, wird er automatisch erzeugt (sofern der fal.ai-Schlüssel eingetragen ist).'));
  const og = await api('GET', '/api/org').catch(() => null);
  const orgBox = h('div', { class: 'box' }, h('h3', {}, '🗂 Ordnung'),
    h('p', { class: 'hint' }, 'Die Zentrale benennt Videos sprechend um (Datum, Spiel/Thema laut KI, Titel, Art) und legt sie in Ordner: '
      + 'Rohvideos\\Kanal\\JJJJ-MM\\Spiel, Hochgeladen\\Kanal\\JJJJ\\MM. „Zur Freigabe“ wird nur umbenannt. Nie während Schnitt oder Upload; jede Verschiebung lässt sich rückgängig machen.'),
    og ? [
      ...[['enabled', 'Automatisch ordnen (nach Schnitt, KI-Vorschlag und Upload, sonst stündlich)'], ['rename', 'Dateien sprechend umbenennen'], ['folders', 'Unterordner anlegen (Kanal / Monat / Spiel)']].map(([k, label]) =>
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!og[k], onchange: (e) => run(() => api('POST', '/api/org/config', { [k]: e.target.checked }), 'Gespeichert.')() }), label)),
      h('div', { class: 'row', style: { alignItems: 'center', flexWrap: 'wrap' } },
        h('span', { class: 'hint' }, 'Rohvideos zum Aufräumen vorschlagen nach'),
        (() => { const i = h('input', { type: 'number', min: 1, max: 365, value: og.rawDays, style: { width: '80px' }, onchange: () => run(() => api('POST', '/api/org/config', { rawDays: Number(i.value) }), 'Gespeichert.')() }); return i; })(),
        h('span', { class: 'hint' }, 'Tagen (wenn alles daraus hochgeladen ist – Vorschläge im Reiter 📚 Bibliothek).')),
      h('div', { class: 'row', style: { alignItems: 'center', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', onclick: () => convertDialog(again) }, 'Vorhandene Videos umstellen …'),
        h('span', { class: 'hint' }, og.pending ? `${og.pending} Video(s) noch nicht an ihrem Platz` : 'Alles an seinem Platz.')),
      og.log.length ? h('details', {}, h('summary', {}, `Letzte Verschiebungen (${og.log.length})`),
        h('div', { class: 'org-log' }, og.log.map((e, i) => h('div', { class: 'org-row' },
          h('span', { class: 'hint' }, fmtDate(e.at)), h('span', {}, e.from, ' → ', h('b', {}, e.to)),
          h('button', { class: 'btn small ghost', title: 'Zurück an den alten Platz; das Video wird danach nicht mehr automatisch verschoben.',
            onclick: run(async () => { await api('POST', '/api/org/undo', { index: i }); await refresh(); }, 'Rückgängig gemacht.') }, '↶ Rückgängig'))))) : null,
    ] : null);
  const jumps = [['s-kanaele', 'Kanäle'], ['s-claude', 'KI & Claude'], ['s-lokal', 'Lokale KI'], ['s-schnitt', 'Schnitt'], ['s-twitch', 'Twitch'], ['s-zahlen', 'Zahlen'], ['s-musik', 'Musik'], ['s-sfx', 'Sounds'], ['s-guthaben', 'Guthaben'], ['s-ordnung', 'Ordnung'], ['s-bilder', 'Titelbilder'],
    ['s-helfer', 'Rechenhelfer'], ['s-google', 'YouTube-App'], ['s-tiktok', 'TikTok-App'], ['s-info', 'Info-Seite'], ['s-sicherung', 'Sicherung'], ['s-allgemein', 'Allgemein']];
  [[claudeBox, 's-claude'], [llmBox, 's-lokal'], [cutBox, 's-schnitt'], [twitchBox, 's-twitch'], [statsBox, 's-zahlen'], [musicBox, 's-musik'], [sfxBox, 's-sfx'], [creditBox, 's-guthaben'], [orgBox, 's-ordnung'], [thumbBox, 's-bilder'], [helperBox, 's-helfer'], [googleBox, 's-google'],
    [tiktokBox, 's-tiktok'], [infoBox, 's-info'], [backupBox, 's-sicherung'], [account, 's-allgemein']].forEach(([el, id]) => { el.id = id; el.style.scrollMarginTop = '110px'; });
  const jumpBar = h('div', { class: 'setjump' }, jumps.map(([id, label]) => h('button', { class: 'btn small', onclick: () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label)));
  mainEl.replaceChildren(jumpBar,
    h('div', { class: 'bar', id: 's-kanaele', style: { scrollMarginTop: '110px' } }, h('h2', { class: 'h2' }, 'Kanäle'), h('span', { class: 'hint' }, 'Jeder Kanal hat eigene YouTube-/TikTok-Verbindung und Vorgaben. Die Zentrale schlägt je Video den Kanal vor.'),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn small', onclick: () => { const n = prompt('Name des neuen Kanals:'); if (n) run(() => api('POST', '/api/profiles', { name: n }), 'Kanal angelegt.')(); } }, '+ Kanal')),
    h('div', { class: 'settings' }, st.profiles.map(channelBox)),
    h('h2', { class: 'h2', style: { marginTop: '24px' } }, 'Apps & Zugang'),
    h('div', { class: 'settings' }, claudeBox, llmBox, cutBox, twitchBox, statsBox, musicBox, sfxBox, creditBox, orgBox, thumbBox, helperBox, googleBox, tiktokBox, infoBox, backupBox, account));
}

start();

'use strict';
// Video-Zentrale – Oberfläche (ohne Framework)

const CATEGORIES = [['20', 'Gaming'], ['24', 'Unterhaltung'], ['22', 'Menschen & Blogs'], ['23', 'Comedy'],
  ['26', 'Praktische Tipps & Styling'], ['27', 'Bildung'], ['28', 'Wissenschaft & Technik'], ['17', 'Sport'],
  ['10', 'Musik'], ['1', 'Film & Animation'], ['2', 'Autos & Fahrzeuge'], ['19', 'Reisen & Events']];
const TABS = [
  ['posten', '📱 Zum Posten'],
  ['coach', '💡 Coach'],
  ['geschnitten', 'Zur Freigabe'],
  ['eingang', 'Eingang (roh)'],
  ['hochgeladen', 'Hochgeladen'],
  ['rohvideos', 'Rohvideos'],
  ['papierkorb', '🗑 Papierkorb'],
  ['einstellungen', 'Einstellungen'],
];

const INBOXES = ['eingang', 'eingang-profi'];
const inTab = (v, tab) => v.folder === tab || (tab === 'eingang' && v.folder === 'eingang-profi');
const FOLDER_NAMES = { papierkorb: 'Papierkorb', eingang: 'Eingang (roh)', 'eingang-profi': 'Eingang Profi (LinkedIn)', geschnitten: 'Zur Freigabe', hochgeladen: 'Hochgeladen', rohvideos: 'Rohvideos (Originale)' };
const S = { videos: [], busy: false, tab: 'geschnitten', search: '', channel: '', openId: null, settings: null, version: '' };
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
  await Promise.all([refresh(), loadSettings(), loadVersion()]);
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
    const c = ['einstellungen', 'coach'].includes(id) ? null : h('span', { class: 'count' });
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
  }), h('button', { class: 'bn' + (['hochgeladen', 'rohvideos', 'papierkorb', 'einstellungen'].includes(S.tab) && !S.openId ? ' on' : ''), onclick: () => moreSheet(fileInput) },
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
      item('hochgeladen', '📦 Hochgeladen (Archiv)'), item('rohvideos', '🎞 Rohvideos'), item('papierkorb', '🗑 Papierkorb'), item('einstellungen', '⚙ Einstellungen'),
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
  const q = S.search.toLowerCase();
  const list = S.videos.filter((v) => inTab(v, S.tab) && (!q || (v.title + ' ' + v.file + ' ' + v.tags).toLowerCase().includes(q))
    && (!S.channel || channelOf(v)?.id === S.channel));
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
  const grid = h('div', { class: 'grid' }, list.filter((v) => !v.missing).map(card));
  mainEl.replaceChildren(...[
    h('div', { class: 'bar' }, search, filter, h('span', { class: 'hint' }, hints[S.tab]),
      h('div', { style: { flex: '1' } }), emptyTrash,
      h('button', { class: 'btn small ghost', onclick: async () => { await api('POST', '/api/scan'); await refresh(); renderMain(); updateCounts(); toast('Ordner neu eingelesen.'); } }, '↻ Ordner prüfen')),
    list.some((v) => !v.missing) ? grid : h('div', { class: 'empty' },
      h('b', {}, q ? 'Nichts gefunden.' : 'Noch keine Videos hier.'),
      S.tab === 'geschnitten' ? 'Geschnittene Videos in den Ordner „geschnitten“ legen oder hierher ziehen (Video + gleichnamiges .jpg/.png als Titelbild).' : ''),
    missing.length ? h('div', { class: 'section' }, h('h3', {}, 'Nicht mehr gefunden'),
      h('p', { class: 'hint' }, 'Diese Dateien wurden außerhalb der Zentrale verschoben oder gelöscht.'),
      missing.map((v) => h('div', { class: 'row' }, h('span', {}, v.file),
        h('button', { class: 'btn small', onclick: async () => { await api('POST', `/api/videos/${v.id}/forget`); await refresh(); renderMain(); } }, 'Eintrag entfernen')))) : null].filter(Boolean));
  if (keepFocus) { const s = document.getElementById('search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
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
  return h('button', { class: 'card', onclick: () => go('video/' + v.id) }, thumb,
    h('div', { class: 'body' },
      h('div', { class: 'title' }, v.title || v.file),
      h('div', { class: 'meta' }, fmtDate(v.mtime), ' · ', fmtSize(v.size)),
      h('div', { class: 'chips' }, channelBadge(v),
        ['queued', 'running'].includes(v.ai?.state) ? h('span', { class: 'chip run' }, '✨ Claude schreibt …') : null,
        v.cut?.state === 'queued' ? h('span', { class: 'chip run' }, S.settings?.cut?.window?.enabled && !S.settings?.cut?.windowOpen && !v.cut.now
          ? `🌙 schneidet ab ${S.settings.cut.window.from} Uhr` : '✂ wartet auf Schnitt') : null,
        v.cut?.state === 'running' ? h('span', { class: 'chip run', title: v.cut.step }, `✂ ${v.cut.step || 'schneidet'} ${v.cut.progress ? v.cut.progress + ' %' : ''}`) : null,
        v.cut?.state === 'error' ? h('span', { class: 'chip bad', title: v.cut.error }, '✂ Fehler') : null,
        v.cut?.state === 'done' ? h('span', { class: 'chip ok' }, `✂ ${v.cut.outputs?.length || 0} Videos`) : null,
        v.folder === 'eingang-profi' ? h('span', { class: 'chip li' }, 'Profi') : null,
        viralChip(v),
        v.revisionOf ? h('span', { class: 'chip ver', title: 'Überarbeitete Fassung' + (v.revisionWish ? ': ' + v.revisionWish : '') }, '🔁 ' + (/ v(\d+)\.[^.]+$/.exec(v.file)?.[0].replace(/\.[^.]+$/, '').trim() || 'neu') + (v.revisionKept ? ' ✓' : '')) : null,
        hasNewer(v) ? h('span', { class: 'chip', title: 'Es gibt eine überarbeitete Fassung' }, '↳ hat ' + hasNewer(v)) : null,
        ['queued', 'running'].includes(v.revise?.state) ? h('span', { class: 'chip run' }, '🔁 wird überarbeitet') : null,
        v.folder === 'papierkorb' ? h('span', { class: 'chip bad' }, '🗑 ' + fmtDate(v.trash?.at)) : null,
        ...(isPro(channelOf(v)) ? [stateChip('LinkedIn', v.li)] : [stateChip('YouTube', v.yt), stateChip('TikTok', v.tt)])),
      running ? h('div', { class: 'bar-progress' }, h('i', { style: { width: (running.progress || 0) + '%' } })) : null));
}

// ---------- 💡 Coach ----------
async function renderCoach() {
  const all = await api('GET', '/api/coach').catch(() => ({}));
  if (S.tab !== 'coach') return;
  const box = (p) => {
    const c = all[p.id];
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Claude schaut sich deine Videos an … (ca. 30 s)';
      try { await api('POST', '/api/coach', { profileId: p.id }); renderCoach(); } catch (x) { toast(x.message, true); btn.disabled = false; btn.textContent = c ? '↻ Neue Tipps holen' : '💡 Tipps holen'; }
    } }, c ? '↻ Neue Tipps holen' : '💡 Tipps holen');
    const head = h('h3', {}, h('span', { class: 'dot', style: { background: p.color } }), ' ', p.name);
    if (!c) return h('div', { class: 'box coach' }, head, h('p', { class: 'hint' }, 'Claude schaut sich deine letzten Videos dieses Kanals an und gibt dir persönliche Tipps und Ideen (kostet ein paar Cent).'), btn);
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
    h('p', { class: 'hint' }, 'Persönliche Tipps aus deinen letzten Videos – Einstieg, Rhythmus, Themen, Aufnahme, Titel. Aufrufzahlen kennt Claude (noch) nicht, nur Inhalte und Einschätzungen. Die Tipps je Video stehen im Video unter „Viral-Potenzial“.'),
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

  const player = h('video', { src: `/api/videos/${v.id}/file`, controls: true, preload: 'metadata', playsinline: true });
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
  const left = h('div', {}, player,
    h('div', { class: 'coverbox' }, cover, h('div', { class: 'acts' },
      h('b', {}, 'Titelbild'),
      h('button', { class: 'btn small', onclick: grabFrame }, '📷 Aktuelles Videobild nehmen'),
      h('button', { class: 'btn small', onclick: () => imgInput.click() }, '⤒ Bild hochladen'),
      v.hasImage ? h('a', { class: 'btn small ghost', href: imgUrl(v) + '&download=1', download: '' }, '⤓ Titelbild herunterladen') : null,
      h('span', { class: 'hint' }, 'YouTube: 1280 × 720, max. 2 MB (wird automatisch angepasst).'), imgInput)),
    h('div', { class: 'meta', style: { marginTop: '10px' } },
      v.file, ' · ', fmtSize(v.size), v.width ? ` · ${v.width} × ${v.height}` : '', v.duration ? ' · ' + fmtDur(v.duration) : ''),
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

  const modal = h('div', { class: 'modal', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'sheet' },
      h('button', { class: 'close', onclick: close, title: 'Schließen' }, '×'),
      h('h2', {}, v.title || v.file),
      folderEl,
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
  detail = { id, cutBox, transcriptBox, v, ytBox, ttBox, moveBox, folderEl, ensureSaved, chanInfo, chan, aiBox, genBox, reviseBox, f, applyMode, setField, setCover, setCoverFromFrame, isDirty: () => !saveBtn.disabled, markClean: () => { saveBtn.disabled = true; }, cleanup: () => document.removeEventListener('keydown', onKey) };
  updateDetail();
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
      h('a', { class: 'btn primary', href: `/api/videos/${v.id}/file?download=1`, download: v.file }, '⤓ Video herunterladen'),
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

function renderViral(v) {
  const x = v.viral;
  if (!x?.score) return null;
  return h('div', { class: 'section viralbox' }, h('div', { class: 'row' }, h('b', {}, 'Viral-Potenzial'), viralChip(v, true),
    h('span', { class: 'hint' }, x.by === 'Schnitt' ? '(Einschätzung beim Schnitt)' : '(Einschätzung von Claude)')),
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
    try { Object.assign(v, await api('POST', `/api/videos/${v.id}/apply-tips`)); await refresh(); updateDetail(true); pollActivity(); startPolling(); toast('Claude schneidet nach den Tipps neu – die neue Fassung erscheint als v2.'); }
    catch (e) { toast(e.message, true); }
  } }, '⚡ Tipps umsetzen (neu schneiden)'), h('span', { class: 'hint' }, 'als v2 zum Vergleichen'));
}

function renderAi(box, v) {
  const a = v.ai || {};
  const conf = S.settings?.ai?.configured;
  const hint = h('input', { placeholder: 'Hinweis für Claude (optional), z. B. „Thema: 1v3 in Runde 5“' });
  const ask = h('button', { class: 'btn primary', disabled: !conf || ['queued', 'running'].includes(a.state), onclick: async () => {
    try { await detail.ensureSaved(); Object.assign(v, await api('POST', `/api/videos/${v.id}/ai`, { extra: hint.value })); await refresh(); updateDetail(); startPolling(); }
    catch (x) { toast(x.message, true); }
  } }, a.titles ? '✨ Neuen Vorschlag holen' : '✨ Vorschlag von Claude');
  const kids = [h('h3', {}, '✨ Claude')];
  if (!conf) kids.push(h('div', { class: 'hint' }, 'Claude ist noch nicht eingerichtet – ', h('a', { href: '#einstellungen' }, 'Einstellungen → Claude'), '.'));
  if (a.state === 'queued' || a.state === 'running') kids.push(h('div', { class: 'status' }, 'Claude schaut sich das Video an und schreibt … (ca. 20–60 s)'));
  if (a.state === 'error') kids.push(h('div', { class: 'status err' }, a.error || 'Fehler'));
  if (a.titles?.length) {
    const d = detail;
    kids.push(
      h('div', { class: 'meta' }, a.summary, a.game ? ' · ' + a.game : '', a.applied ? ' · automatisch übernommen' : ''),
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
      a.frames?.length ? h('details', {}, h('summary', { class: 'meta' }, 'Standbilder – Claude empfiehlt Bild ' + a.thumbnailFrame + (a.thumbnailText ? ', Text: „' + a.thumbnailText + '“' : '') + ':'),
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

// Was soll geschnitten werden? Je Video einstellbar, dazu ein Wunsch in Worten für Claude.
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
    h('label', {}, 'Dein Wunsch an Claude (optional)'), wish,
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
    else if (c.state === 'queued') add(sec, h('div', { class: 'status' }, 'Wartet – es wird immer nur ein Video gleichzeitig geschnitten.'));
    else if (c.state === 'running') add(sec, h('div', { class: 'status' }, (c.step || 'Läuft') + ' …' + (c.progress ? ' ' + c.progress + ' %' : '')),
      h('div', { class: 'bar-progress' }, h('i', { style: { width: (c.progress || 0) + '%' } })));
    else if (c.state === 'error') add(sec, h('div', { class: 'status err' }, c.error || 'Fehler'));
    else if (c.state === 'done') {
      add(sec, h('div', { class: 'status ok-text' }, `✓ ${fmtDate(c.at)}: ${c.outputs?.length || 0} Videos erzeugt` + (c.removed ? `, ${fmtDur(c.removed)} ruhige Abschnitte entfernt` : '')),
        h('div', { class: 'row' }, (c.outputs || []).map((id) => { const o = S.videos.find((x) => x.id === id); return o ? h('a', { class: 'btn small', href: '#video/' + id }, o.title || o.file) : null; })));
    }
    if (c?.warning) add(sec, h('div', { class: 'hint' }, 'Hinweis: ' + c.warning));
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
  const aiChanged = force === true || JSON.stringify([v.ai || null, v.thumbVariantsAt || 0, v.revise || null, v.viral || null]) !== detail.aiSeen;
  if (aiChanged) {
    detail.aiSeen = JSON.stringify([v.ai || null, v.thumbVariantsAt || 0, v.revise || null, v.viral || null]);
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
    detail.aiBox.replaceChildren(); detail.v.viral = v.viral;
    const vb = renderViral(detail.v); if (vb) detail.aiBox.append(vb);
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
      v.revisionChanges ? h('p', { class: 'hint' }, 'Claude: ' + v.revisionChanges) : null,
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
      sec.append(h('p', { class: 'hint' }, (isShort ? 'Claude schneidet den Clip aus dem Rohvideo neu.' : 'Claude sieht sich die ganze Aufnahme an und schneidet die Fassung aus dem Rohvideo neu.')
          + ' Die neue Fassung erscheint daneben als „v2“ – du entscheidest, welche bleibt.'),
        chips, wish,
        target ? h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'center' } }, h('span', { class: 'hint' }, 'Ziellänge (Minuten, optional):'), target,
          h('button', { class: 'chip-btn', onclick: () => target.value && add(`Ziellänge ca. ${target.value} Minuten`) }, 'übernehmen')) : null,
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: act(async () => {
          if (wish.value.trim().length < 3) throw new Error('Bitte kurz beschreiben, was anders werden soll.');
          Object.assign(v, await api('POST', `/api/videos/${v.id}/revise`, { wish: wish.value.trim() }));
          await refresh(); updateDetail(true); pollActivity(); startPolling();
        }, 'Überarbeitung gestartet.') }, '🔁 Überarbeiten lassen')));
    }
    kids.push(sec);
  }
  box.replaceChildren(...kids);
}

// ---------- Was läuft gerade (Zentrale / Rechenhelfer) ----------
let actEl = null, actTimer = null, actData = null;
const ACT_ICON = { cut: '✂', ai: '🤖', upload: '⤒' };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function activityBar() {
  actEl = h('div', { class: 'activity', role: 'status', 'aria-live': 'polite' });
  if (actData) drawActivity(); else actEl.hidden = true;
  if (!actTimer) pollActivity();
  return actEl;
}
async function pollActivity() {
  clearTimeout(actTimer);
  try { actData = await api('GET', '/api/activity'); drawActivity(); } catch { }
  const busy = actData && (actData.server.length || actData.helper.jobs.length);
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
  const waits = [q.cut && `${q.cut} Schnitt`, q.ai && `${q.ai} Claude`, q.upload && `${q.upload} Upload`].filter(Boolean).join(', ');
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
  actEl.replaceChildren(srv, hpBox || '');
  actEl.hidden = false;
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
    const style = h('textarea', { rows: 2, value: p.aiStyle, placeholder: 'Worum geht es, wie soll Claude schreiben, wer schaut zu?' });
    const cat = h('select', {}, CATEGORIES.map(([id, n]) => h('option', { value: id, selected: p.category === id }, n)));
    const tags = h('input', { value: p.tags });
    const footer = h('textarea', { rows: 3, value: p.footer, placeholder: 'z. B. Links zu Discord/Shop, „Musik: Epidemic Sound“' });
    const mStyle = h('input', { value: p.musicStyle, placeholder: 'englisch, z. B. energetic electronic gaming beat' });
    const mMood = h('select', {}, h('option', { value: '' }, '– keine –'), (st.music?.moods || []).map((x) => h('option', { value: x, selected: p.musicMood === x }, x)));
    const proMusic = h('input', { type: 'checkbox', checked: p.music });
    const clipHints = h('textarea', { rows: 2, value: p.clipHints || '', placeholder: 'z. B. Funny Moments, wo ich mich ärgere, Fails, Clutches …' });
    const chShorts = h('input', { type: 'number', min: 0, max: 10, value: p.shorts ?? '', placeholder: 'Standard' });
    const hookSel = h('select', {}, Object.entries({ auto: 'Claude entscheidet je Clip', preview: 'Höhepunkt vorweg + Zurückspulen', cold: 'direkt mitten rein', off: 'aus' })
      .filter(([k]) => !isPro(p) || k !== 'preview').map(([k, n]) => h('option', { value: k, selected: (p.hookStyle || 'auto') === k }, n)));
    const tempoSel = h('select', {}, Object.entries({ aus: 'aus (nichts herausschneiden)', ruhig: 'ruhig (nur lange Pausen)', normal: 'normal (Pausen + „ähm“)', schnell: 'schnell (Jump Cuts + Zooms)' })
      .map(([k, n]) => h('option', { value: k, selected: (p.tempo || 'normal') === k }, n)));
    const hookHint = h('input', { value: p.hookHint || '', placeholder: 'z. B. Reaktion zuerst; bei 3D-Druck: Ergebnis zuerst' });
    const fxSel = h('select', {}, Object.entries({ aus: 'aus', dezent: 'dezent (wenige Emojis/Sounds)', normal: 'normal (+ Freeze, Zeitlupe, Zoom, Wackeln)', viel: 'viel (+ KI-Sticker)' })
      .map(([k, n]) => h('option', { value: k, selected: (p.fxLevel || 'normal') === k }, n)));
    const fxImg = h('input', { type: 'checkbox', checked: !!p.fxImages });
    const save = run(() => api('PUT', '/api/profiles/' + p.id, { name: name.value, color: color.value, isDefault: def.checked || undefined,
      keywords: kw.value, aiStyle: style.value, category: cat.value, tags: tags.value, footer: footer.value,
      musicStyle: mStyle.value, musicMood: mMood.value, clipHints: clipHints.value, shorts: chShorts.value === '' ? null : Number(chShorts.value),
      hookStyle: hookSel.value, tempo: tempoSel.value, hookHint: hookHint.value, fxLevel: fxSel.value, fxImages: fxImg.checked,
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
      h('label', {}, 'Beschreibung für Claude (Thema, Ton, Publikum)'), style,
      h('label', {}, 'Stichwörter für den Vorschlag (mit Komma; Titel/Dateiname zählt doppelt)'), kw,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, 'YouTube-Kategorie'), cat), h('div', {}, h('label', {}, 'Standard-Tags'), tags)),
      h('label', {}, 'Text unter jeder YouTube-Beschreibung'), footer,
      h('label', {}, '✂ Was soll Claude als Clips rausholen?'), clipHints,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Clips je Video (leer = Standard)'), chShorts), h('div', {})),
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '⚡ Hook am Anfang der Clips'), hookSel), h('div', {}, h('label', {}, '✂ Tempo der Clips'), tempoSel)),
      h('label', {}, 'Hinweis zum Hook für Claude'), hookHint,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '🎉 Effekte in Clips (Emojis, Sounds, Freeze …)'), fxSel),
        h('div', {}, h('label', { class: 'check', style: { marginTop: '22px' } }, fxImg, 'KI-Sticker aus meinen Fotos (Stufe „viel“, ca. 5 Cent)'))),
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '🎵 Musikstil für KI-Musik'), mStyle), h('div', {}, h('label', {}, 'Stimmung (Langfassung)'), mMood)),
      h('p', { class: 'hint' }, `Eigene Titel: ${st.music?.counts?.[p.id] ?? 0} (Ordner musik\\${p.id} + musik)`),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: save }, 'Speichern'),
        st.profiles.length > 1 ? h('button', { class: 'btn ghost danger', onclick: () => confirm(`Kanal „${p.name}“ löschen?`) && run(() => api('DELETE', '/api/profiles/' + p.id), 'Kanal gelöscht.')() }, 'Löschen') : null),
      ...(isPro(p) ? [h('div', { class: 'conn' }, h('b', {}, h('span', { class: 'dot', style: { background: '#0a66c2' } }), ' LinkedIn – nur Download'),
        h('p', { class: 'hint' }, 'Kein automatischer Upload: Im Video gibt es „Video herunterladen“ und „Beitrag kopieren“. Videos aus dem Ordner \\\\PowerServer\\videos\\eingang-profi landen automatisch hier, '
          + 'werden im Profi-Stil geschnitten (Format und Untertitel unter „Automatischer Schnitt“) und Claude schreibt den Beitrag in der Ich-Form.'),
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
  const aHints = h('textarea', { rows: 3, value: a.hints, placeholder: 'z. B. „Ich heiße Micha“, „keine Emojis im Titel“, „immer auf Deutsch“' });
  const claudeBox = h('div', { class: 'box' }, h('h3', {}, '✨ Claude (Vorschläge für Titel & Texte)'),
    a.configured ? h('p', { class: 'ok-text' }, '✓ eingerichtet · bisher ' + a.count + ' Vorschläge, ca. ' + (a.spent || 0).toFixed(2).replace('.', ',') + ' $') : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'console.anthropic.com: Konto anlegen, unter Billing Guthaben aufladen (z. B. 5 $; eigene Abrechnung, nicht im Claude-Abo enthalten).'),
      h('li', {}, 'API Keys → „Create Key“ → hier einfügen und speichern.'),
      h('li', {}, 'Ein Vorschlag kostet etwa 2–6 Cent (Claude Opus 5.5 schaut 6 Standbilder an).')),
    h('label', {}, 'API-Schlüssel'), aKey,
    h('label', { class: 'check' }, aAuto, 'Neue Videos unter „Zur Freigabe“ automatisch vorschlagen lassen'),
    h('label', { class: 'check' }, aTips, '⚡ Viral-Tipps zu Einstieg und Schnitt einmal automatisch umsetzen (neue Fassung „v2“ zum Vergleichen, kostet je Video einen weiteren Claude-Aufruf)'),
    h('label', {}, 'Allgemeine Hinweise an Claude'), aHints,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/ai/config', { apiKey: aKey.value, auto: aAuto.checked, autoTips: aTips.checked, hints: aHints.value }), 'Gespeichert.') }, 'Speichern'),
      a.configured ? h('button', { class: 'btn ghost danger', onclick: () => confirm('API-Schlüssel entfernen?') && run(() => api('POST', '/api/ai/config', { removeKey: true }), 'Schlüssel entfernt.')() }, 'Schlüssel entfernen') : null));

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
    h('p', { class: 'hint' }, 'Je Video kannst du im Video selbst (Eingang/Rohvideos) festlegen, was entstehen soll, und Claude einen Wunsch mitgeben.'),
    h('label', { class: 'check' }, cMove, 'Original danach nach „Rohvideos“ verschieben'),
    h('label', { class: 'check' }, wnOn, '🌙 Nachtbetrieb: nur in diesem Zeitfenster schneiden'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'von'), wnFrom, h('span', { class: 'hint' }, 'bis'), wnTo,
      h('span', { class: 'hint' }, c.window?.enabled ? (c.windowOpen ? '(gerade offen)' : '(gerade zu – „Jetzt schneiden“ geht trotzdem)') : '')),
    h('label', { class: 'check' }, capOn, 'Animierte Untertitel in Shorts (Wort für Wort)'),
    h('label', { class: 'check' }, hookTxt, '⚡ Hook-Text von Claude groß im ersten Bild der Shorts (Hook-Stil und Tempo je Kanal unter „Kanäle“)'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Farbe des gesprochenen Worts:'), capColor),
    h('label', { class: 'check' }, camOn, 'Facecam-Layout für Shorts (Facecam oben, Spiel unten)'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'LinkedIn-Clips (Ordner eingang-profi): Format'), liFmt),
      h('div', {}, h('label', {}, '\u00a0'), h('label', { class: 'check' }, liCap, 'ruhige Untertitel einbrennen'))),
    camPart,
    h('p', { class: 'hint' }, c.gpu?.nvenc ? '🟢 Grafikkarte (NVENC) wird zum Kodieren genutzt.' : '⚪ Grafikkarte nicht genutzt' + (c.gpu?.error ? ' – ' + c.gpu.error : '') + '. In Unraid: --runtime=nvidia, NVIDIA_VISIBLE_DEVICES=all, NVIDIA_DRIVER_CAPABILITIES=all.'),
    h('h3', { style: { marginTop: '16px' } }, '🗣 Sprache erkennen (Whisper)'),
    h('p', { class: 'hint' }, 'Wandelt Gesprochenes in Text – Claude versteht dann, was du sagst. Läuft lokal auf dem Server, kostet nichts. Das Modell wird beim ersten Mal geladen.'),
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
        captions: { enabled: capOn.checked, color: capColor.value }, facecam: { enabled: camOn.checked, x: cam.x, y: cam.y, w: cam.w, h: cam.h } }), 'Gespeichert.') }, 'Speichern')));

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
    h('p', { class: 'hint' }, 'Lade 4–8 Fotos mit verschiedenen Gesichtsausdrücken hoch (überrascht, jubelnd, zeigend …). Claude wählt je Video das passende Foto, Standbild und den Text; die Zentrale baut 3 Varianten (1280 × 720). Mit fal.ai werden Fotos automatisch freigestellt.'),
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
  const hpModel = h('select', {}, [['large-v3-turbo', 'large-v3-turbo – sehr gut und schnell (empfohlen)'], ['large-v3', 'large-v3 – beste Qualität, langsamer'], ['medium', 'medium'], ['small', 'small']]
    .map(([k, n]) => h('option', { value: k, selected: (hp?.model || 'large-v3-turbo') === k }, n)));
  const helperBox = h('div', { class: 'box' }, h('h3', {}, '🖥 Rechenhelfer (dein PC)'),
    h('p', { class: 'hint' }, 'Ein PC mit NVIDIA-Grafikkarte (z. B. RTX 3070) übernimmt die Spracherkennung mit dem großen Whisper-Modell – genauer, schneller und der Server wird entlastet. Ist der PC aus, rechnet die Zentrale selbst.'),
    hp?.enabled ? hpStatusEl(hp) : null,
    hp?.enabled && (hp.done || hp.failed) ? h('p', { class: 'hint' }, `${hp.done} Aufträge erledigt` + (hp.failed ? `, ${hp.failed} fehlgeschlagen` : '') + (hp.lastError ? ` · letzter Fehler: ${hp.lastError}` : '')) : null,
    h('label', { class: 'check' }, hpOn, 'Rechenhelfer verwenden'),
    h('label', {}, 'Whisper-Modell auf dem PC'), hpModel,
    h('label', { class: 'check', style: { marginTop: '8px' } }, hpGame, '🎮 Pausieren, wenn ich zocke (OBS läuft, Spiel aus der Liste läuft oder Grafikkarte ausgelastet)'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Grafikkarte gilt als belegt ab (%)'), hpLoad), h('div', {}, h('label', {}, 'Spiele (Prozessnamen, mit Komma)'), hpGames)),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/helper-config', { enabled: hpOn.checked, model: hpModel.value,
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

  const sx = await api('GET', '/api/sfx').catch(() => null);
  const sfxBox = h('div', { class: 'box' }, h('h3', {}, '🔊 Soundeffekte'),
    h('p', { class: 'hint' }, 'Claude setzt in Shorts passende Sounds (Whoosh, Bass-Boom, Zurückspulen, Pop …). Der Grundbaukasten wird einmal per KI erzeugt (fal.ai, laut Anbieter kommerziell nutzbar) und dann immer wieder verwendet. '
      + 'Eigene Sounds (z. B. von Epidemic Sound) einfach in den Ordner „musik\\sfx“ legen – gleicher Name wie unten ersetzt den KI-Sound, andere Namen kann Claude zusätzlich nutzen. Bekannte Internet-Meme-Sounds bitte nicht verwenden (Urheberrecht).'),
    sx ? h('p', {}, `${sx.ready} von ${sx.total} Baukasten-Sounds vorhanden`, sx.own.length ? ` · ${sx.own.length} eigene` : '', sx.custom ? ` · ${sx.custom} Sonder-Sounds` : '',
      sx.spent ? ` · bisher ca. ${sx.spent.toFixed(2).replace('.', ',')} $` : '', sx.building ? ' · wird gerade erzeugt …' : '') : null,
    sx && sx.ready < sx.total ? h('button', { class: 'btn primary', disabled: !sx.falKey || sx.building, onclick: run(() => api('POST', '/api/sfx/build'), 'Baukasten wird erzeugt – dauert ein paar Minuten.') },
      sx.falKey ? `Baukasten erzeugen (${sx.total - sx.ready} Sounds, ca. 0,10 $)` : 'Erst fal.ai-Schlüssel eintragen') : null,
    sx ? h('div', { class: 'sfx-list' }, sx.sounds.map((x) => h('button', { class: 'chip-btn' + (x.ready ? '' : ' off'), disabled: !x.ready, title: x.own ? 'eigener Sound' : x.id,
      onclick: () => { const a = new Audio('/api/sfx/file/' + x.id); a.play().catch(() => {}); } }, (x.ready ? '▶ ' : '') + x.name + (x.own ? ' ★' : '')))) : null,
    h('p', { class: 'hint' }, 'Fehlt ein Sound beim Schnitt, wird er automatisch erzeugt (sofern der fal.ai-Schlüssel eingetragen ist).'));
  const jumps = [['s-kanaele', 'Kanäle'], ['s-claude', 'Claude'], ['s-schnitt', 'Schnitt'], ['s-musik', 'Musik'], ['s-sfx', 'Sounds'], ['s-bilder', 'Titelbilder'],
    ['s-helfer', 'Rechenhelfer'], ['s-google', 'YouTube-App'], ['s-tiktok', 'TikTok-App'], ['s-sicherung', 'Sicherung'], ['s-allgemein', 'Allgemein']];
  [[claudeBox, 's-claude'], [cutBox, 's-schnitt'], [musicBox, 's-musik'], [sfxBox, 's-sfx'], [thumbBox, 's-bilder'], [helperBox, 's-helfer'], [googleBox, 's-google'],
    [tiktokBox, 's-tiktok'], [backupBox, 's-sicherung'], [account, 's-allgemein']].forEach(([el, id]) => { el.id = id; el.style.scrollMarginTop = '110px'; });
  const jumpBar = h('div', { class: 'setjump' }, jumps.map(([id, label]) => h('button', { class: 'btn small', onclick: () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label)));
  mainEl.replaceChildren(jumpBar,
    h('div', { class: 'bar', id: 's-kanaele', style: { scrollMarginTop: '110px' } }, h('h2', { class: 'h2' }, 'Kanäle'), h('span', { class: 'hint' }, 'Jeder Kanal hat eigene YouTube-/TikTok-Verbindung und Vorgaben. Die Zentrale schlägt je Video den Kanal vor.'),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn small', onclick: () => { const n = prompt('Name des neuen Kanals:'); if (n) run(() => api('POST', '/api/profiles', { name: n }), 'Kanal angelegt.')(); } }, '+ Kanal')),
    h('div', { class: 'settings' }, st.profiles.map(channelBox)),
    h('h2', { class: 'h2', style: { marginTop: '24px' } }, 'Apps & Zugang'),
    h('div', { class: 'settings' }, claudeBox, cutBox, musicBox, sfxBox, thumbBox, helperBox, googleBox, tiktokBox, backupBox, account));
}

start();

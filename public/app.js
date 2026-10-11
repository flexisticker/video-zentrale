'use strict';
// Video-Zentrale – Oberfläche (ohne Framework)

const CATEGORIES = [['20', 'Gaming'], ['24', 'Unterhaltung'], ['22', 'Menschen & Blogs'], ['23', 'Comedy'],
  ['26', 'Praktische Tipps & Styling'], ['27', 'Bildung'], ['28', 'Wissenschaft & Technik'], ['17', 'Sport'],
  ['10', 'Musik'], ['1', 'Film & Animation'], ['2', 'Autos & Fahrzeuge'], ['19', 'Reisen & Events']];
const TABS = [
  ['geschnitten', 'Zur Freigabe'],
  ['eingang', 'Eingang (roh)'],
  ['hochgeladen', 'Hochgeladen'],
  ['rohvideos', 'Rohvideos'],
  ['einstellungen', 'Einstellungen'],
];

const FOLDER_NAMES = { eingang: 'Eingang (roh)', geschnitten: 'Zur Freigabe', hochgeladen: 'Hochgeladen', rohvideos: 'Rohvideos (Originale)' };
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

function stateChip(label, s) {
  const st = s?.state || 'none';
  if (st === 'none') return h('span', { class: 'chip' }, label + ': –');
  if (st === 'queued') return h('span', { class: 'chip run' }, label + ': wartet');
  if (st === 'uploading') return h('span', { class: 'chip run' }, `${label}: ${String(s.progress || 0).replace('.', ',')} %`);
  if (st === 'processing') return h('span', { class: 'chip run' }, label + ': verarbeitet');
  if (st === 'error') return h('span', { class: 'chip bad', title: s.error || '' }, label + ': Fehler');
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

function go(hash) { location.hash = hash; }

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
      || ['queued', 'running'].includes(v.ai?.state) || ['queued', 'running'].includes(v.cut?.state));
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
    const c = id === 'einstellungen' ? null : h('span', { class: 'count' });
    if (c) countEls[id] = c;
    return h('button', { class: 'tab' + (S.tab === id && !S.openId ? ' on' : ''), onclick: () => go(id) }, label, c);
  }));
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'video/*,image/*,.json', class: 'hidden',
    onchange: (e) => { uploadFiles([...e.target.files]); e.target.value = ''; } });
  mainEl = h('main');
  app.replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), APP_NAME),
      tabs, h('div', { class: 'spacer' }),
      versionChip(),
      h('button', { class: 'btn', onclick: () => fileInput.click(), title: 'Videos, Titelbilder oder .json hochladen' }, '⤒ Hochladen'), fileInput),
    mainEl);
  updateCounts();
  renderMain();
  document.querySelector('.modal')?.remove();
  detail?.cleanup(); detail = null;
  if (S.openId) openDetail(S.openId);
}

function updateCounts() {
  for (const [id, el] of Object.entries(countEls)) {
    el.textContent = S.videos.filter((v) => v.folder === id && !v.missing).length;
  }
}

function renderMain() {
  if (!mainEl) return;
  if (S.tab === 'einstellungen') return renderSettings();
  const q = S.search.toLowerCase();
  const list = S.videos.filter((v) => v.folder === S.tab && (!q || (v.title + ' ' + v.file + ' ' + v.tags).toLowerCase().includes(q))
    && (!S.channel || channelOf(v)?.id === S.channel));
  const setChannel = (id) => { S.channel = id; try { localStorage.setItem('vz-channel', id); } catch { /* egal */ } renderMain(); };
  const filter = profilesList().length > 1 ? h('div', { class: 'filter' },
    h('button', { class: 'btn small' + (!S.channel ? ' on' : ''), onclick: () => setChannel('') }, 'Alle Kanäle'),
    profilesList().map((p) => {
      const b = h('button', { class: 'btn small' + (S.channel === p.id ? ' on' : ''), onclick: () => setChannel(p.id) }, h('span', { class: 'dot' }), p.name);
      b.firstChild.style.background = p.color;
      return b;
    })) : null;
  const missing = S.videos.filter((v) => v.missing && v.folder === S.tab);
  const keepFocus = document.activeElement?.id === 'search';
  const search = h('input', { id: 'search', type: 'search', placeholder: 'Suchen …', value: S.search,
    oninput: (e) => { S.search = e.target.value; renderMain(); } });
  const hints = {
    geschnitten: 'Geschnittene Videos – prüfen, Titel & Titelbild anpassen, dann für YouTube/TikTok freigeben.',
    eingang: 'Rohaufnahmen vom OBS-Sortierer – werden automatisch geschnitten (Langfassung + Shorts → „Zur Freigabe“).',
    hochgeladen: 'Archiv: Videos, die auf YouTube und TikTok sind.',
    rohvideos: 'Originale, aus denen die Zentrale geschnitten hat. Hier aufräumen, wenn Platz knapp wird.',
  };
  const grid = h('div', { class: 'grid' }, list.filter((v) => !v.missing).map(card));
  mainEl.replaceChildren(...[
    h('div', { class: 'bar' }, search, filter, h('span', { class: 'hint' }, hints[S.tab]),
      h('div', { style: { flex: '1' } }),
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
        stateChip('YouTube', v.yt), stateChip('TikTok', v.tt)),
      running ? h('div', { class: 'bar-progress' }, h('i', { style: { width: (running.progress || 0) + '%' } })) : null));
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
  const field = (key, label, max, opts = {}) => {
    const len = h('span', { class: 'len' });
    const el = h(opts.area ? 'textarea' : 'input', { value: v[key] || '', rows: opts.rows, placeholder: opts.placeholder || '' });
    const upd = () => { len.textContent = el.value.length + ' / ' + max; len.classList.toggle('over', el.value.length > max); dirty(); };
    el.addEventListener('input', upd);
    f[key] = el;
    const l = h('label', {}, label, len);
    upd(); saveBtn.disabled = true;
    return [l, el];
  };
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => saveFields() }, 'Speichern');
  const dirty = () => { saveBtn.disabled = false; };
  const cat = h('select', { onchange: dirty }, h('option', { value: '' }, 'Vorgabe des Kanals'),
    CATEGORIES.map(([id, n]) => h('option', { value: id, selected: String(v.category) === id }, n)));
  f.category = cat;
  const chan = h('select', { onchange: () => { dirty(); chanInfo(); } });
  const chanReason = h('div', { class: 'hint' });
  const chanInfo = () => {
    const auto = profileOf(v.suggestion?.id);
    const cur = chan.options.length ? chan.value : (v.channel || '');
    chan.replaceChildren(h('option', { value: '' }, 'Automatisch' + (auto && !v.channel ? ': ' + auto.name : '')),
      ...profilesList().map((p) => h('option', { value: p.id }, p.name)));
    chan.value = cur;
    const p = chan.value ? profileOf(chan.value) : auto;
    const why = !chan.value ? 'Vorschlag (' + (v.suggestion?.reason || '–') + ')' : v.channelFrom === 'json' && chan.value === v.channel ? 'aus der .json' : 'von dir gewählt';
    chanReason.textContent = p ? `→ YouTube ${p.youtube.channel ? '„' + p.youtube.channel.title + '“' : '(nicht verbunden)'} · TikTok ${p.tiktok.user?.name ? '„' + p.tiktok.user.name + '“' : p.tiktok.connected ? 'verbunden' : '(nicht verbunden)'} · ${why}` : '';
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

  const left = h('div', {}, player,
    h('div', { class: 'coverbox' }, cover, h('div', { class: 'acts' },
      h('b', {}, 'Titelbild'),
      h('button', { class: 'btn small', onclick: grabFrame }, '📷 Aktuelles Videobild nehmen'),
      h('button', { class: 'btn small', onclick: () => imgInput.click() }, '⤒ Bild hochladen'),
      v.hasImage ? h('a', { class: 'btn small ghost', href: imgUrl(v), download: v.file.replace(/\.[^.]+$/, '') + '.jpg' }, '⤓ Herunterladen') : null,
      h('span', { class: 'hint' }, 'YouTube: 1280 × 720, max. 2 MB (wird automatisch angepasst).'), imgInput)),
    h('div', { class: 'meta', style: { marginTop: '10px' } },
      v.file, ' · ', fmtSize(v.size), v.width ? ` · ${v.width} × ${v.height}` : '', v.duration ? ' · ' + fmtDur(v.duration) : ''),
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
    field('tiktok', 'TikTok-Text (zum Einfügen in der App)', 2200, { area: true, rows: 3, placeholder: 'leer = Titel + Hashtags aus den Tags' }),
    h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn small', onclick: () => { f.tiktok.value = (f.title.value + ' ' + hashtags(f.tags.value)).trim(); f.tiktok.dispatchEvent(new Event('input')); } }, 'Aus Titel + Tags erzeugen'),
      h('button', { class: 'btn small', onclick: () => copy(f.tiktok.value || (f.title.value + ' ' + hashtags(f.tags.value)).trim()) }, '⧉ Kopieren')),
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
  detail = { id, cutBox, transcriptBox, v, ytBox, ttBox, moveBox, folderEl, ensureSaved, chanInfo, chan, aiBox, f, setField, setCover, setCoverFromFrame, isDirty: () => !saveBtn.disabled, markClean: () => { saveBtn.disabled = true; }, cleanup: () => document.removeEventListener('keydown', onKey) };
  updateDetail();
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
    kids.push(h('div', { class: 'status' }, `Wird hochgeladen … ${String(s.progress || 0).replace('.', ',')} %`),
      h('div', { class: 'bar-progress' }, h('i', { style: { width: (s.progress || 0) + '%' } })));
  } else if (s.state === 'processing') {
    kids.push(h('div', { class: 'status' }, 'Hochgeladen – TikTok verarbeitet das Video …'));
  } else if (s.state === 'error') {
    kids.push(h('div', { class: 'status err' }, s.error || 'Fehler'));
  } else if (s.state === 'done') {
    if (key === 'yt') {
      kids.push(h('div', { class: 'status ok-text' }, s.manual ? '✓ Als erledigt markiert ' : `✓ Hochgeladen (${s.privacy === 'public' ? 'öffentlich' : 'privat'}) `,
        s.profileName ? 'auf „' + (s.channelTitle || s.profileName) + '“ ' : '', fmtDate(s.at)));
      if (s.thumbError) kids.push(h('div', { class: 'status err' }, s.thumbError));
      kids.push(h('div', { class: 'row' },
        s.studio ? h('a', { class: 'btn small', href: s.studio, target: '_blank', rel: 'noopener' }, 'In YouTube Studio öffnen → veröffentlichen') : null,
        s.url ? h('a', { class: 'btn small ghost', href: s.url, target: '_blank', rel: 'noopener' }, 'Ansehen') : null));
    } else {
      kids.push(h('div', { class: 'status ok-text' }, s.manual ? '✓ Als erledigt markiert ' : '✓ Im TikTok-Posteingang ', s.profileName ? 'von „' + s.profileName + '“ ' : '', fmtDate(s.at)),
        s.manual ? null : h('div', { class: 'status' }, s.note || 'Öffne die TikTok-App → Benachrichtigung „Bearbeiten“ → Text einfügen → Posten.'),
        s.url ? h('a', { class: 'btn small ghost', href: s.url, target: '_blank', rel: 'noopener' }, 'Ansehen') : null);
    }
  }
  const actions = h('div', { class: 'row', style: { marginTop: '8px' } });
  if (['none', 'error', 'done'].includes(s.state)) {
    if (!conn) actions.append(h('span', { class: 'hint' }, `${label} ist für „${target?.name || '–'}“ nicht verbunden – `), h('a', { href: '#einstellungen' }, 'Einstellungen'));
    else actions.append(h('button', { class: btnClass, onclick: doUpload }, s.state === 'done' ? upLabel.replace('▲', '↻ Erneut:') : s.state === 'error' ? '↻ Erneut versuchen' : upLabel));
    if (s.state !== 'done') actions.append(h('button', { class: 'btn small ghost', onclick: markDone }, 'Schon erledigt'));
  }
  if (key === 'tt' && isVertical(v) === false && v.width) kids.push(h('div', { class: 'hint' }, 'Hinweis: Querformat – auf TikTok wirkt Hochformat (9:16) besser.'));
  box.replaceChildren(...[...kids, actions].filter(Boolean));
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
      v.thumbVariants?.length ? h('div', {}, h('b', { class: 'meta' }, 'Titelbild-Varianten – anklicken zum Übernehmen:'),
        h('div', { class: 'variants' }, v.thumbVariants.map((t) => {
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
          S.settings?.fal?.configured && v.width > v.height ? h('button', { class: 'btn small primary', onclick: async (e) => {
            e.target.disabled = true; e.target.textContent = '✨ KI malt … (ca. 10–20 s)';
            try { Object.assign(v, await api('POST', `/api/videos/${v.id}/aithumb`)); await refresh(); updateDetail(true); toast('KI-Titelbild fertig.'); }
            catch (x) { toast(x.message, true); e.target.disabled = false; e.target.textContent = '✨ KI-Titelbild erzeugen'; }
          } }, v.thumbVariants.some((t) => t.gen) ? '✨ Neues KI-Titelbild' : '✨ KI-Titelbild erzeugen') : null,
          h('button', { class: 'btn small ghost', onclick: async () => { try { Object.assign(v, await api('POST', `/api/videos/${v.id}/variants`)); await refresh(); updateDetail(true); toast('Neu erzeugt.'); } catch (x) { toast(x.message, true); } } }, '↻ Varianten neu bauen (z. B. nach neuen Fotos)')),
        a.aiThumbError ? h('div', { class: 'status err' }, 'KI-Titelbild: ' + a.aiThumbError) : null) : null,
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

function renderCut(box, v) {
  const c = v.cut;
  const kids = [];
  if (v.source?.rawFile) {
    const raw = S.videos.find((x) => x.id === v.source.rawId);
    kids.push(h('div', { class: 'meta' }, '✂ Automatisch geschnitten aus ', raw ? h('a', { href: '#video/' + raw.id }, v.source.rawFile) : v.source.rawFile,
      v.source.kind === 'short' ? ' (Short)' : ' (Langfassung)'));
  }
  if (['eingang', 'rohvideos'].includes(v.folder)) {
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
    if (!c || ['done', 'error'].includes(c.state)) add(sec, h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn', onclick: async () => {
        if (c?.state === 'done' && !confirm('Nochmal schneiden? Es entstehen zusätzliche Videos unter „Zur Freigabe“.')) return;
        try { await api('POST', `/api/videos/${v.id}/cut`, { force: true }); await refresh(); updateDetail(true); startPolling(); } catch (x) { toast(x.message, true); }
      } }, c ? '↻ Erneut schneiden' : '✂ Jetzt schneiden')));
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
  const aiChanged = force === true || JSON.stringify([v.ai || null, v.thumbVariantsAt || 0]) !== detail.aiSeen;
  if (aiChanged) {
    detail.aiSeen = JSON.stringify([v.ai || null, v.thumbVariantsAt || 0]);
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
    detail.aiBox.replaceChildren(); renderAi(detail.aiBox, detail.v);
  }
  // Felder nicht überschreiben, nur Status-Teile
  Object.assign(detail.v, { yt: v.yt, tt: v.tt, folder: v.folder, file: v.file, hasImage: v.hasImage, imageVersion: v.imageVersion });
  if (!detail.chan.value && v.suggestion?.id !== detail.v.suggestion?.id) { detail.v.suggestion = v.suggestion; detail.chanInfo(); }
  platformBox(detail.ytBox, detail.v, 'yt', 'YouTube', 'var(--yt)');
  platformBox(detail.ttBox, detail.v, 'tt', 'TikTok', 'var(--tt)');
  const mv = async (folder, msg) => {
    try { await detail.ensureSaved(); await api('POST', `/api/videos/${v.id}/move`, { folder }); await refresh(); toast(msg); go(folder); }
    catch (x) { toast(x.message, true); }
  };
  detail.folderEl.textContent = 'Ordner: ' + FOLDER_NAMES[v.folder] + (v.folder === 'hochgeladen' ? ' (Archiv)' : '');
  const b = [];
  if (v.folder === 'eingang') b.push(h('button', { class: 'btn', onclick: () => mv('geschnitten', 'Zur Freigabe verschoben.') }, '→ Zur Freigabe (ohne Schnitt)'));
  if (v.folder === 'geschnitten') {
    b.push(h('button', { class: 'btn', onclick: () => mv('hochgeladen', 'Ins Archiv verschoben.') }, '✓ Fertig – ins Archiv'));
    b.push(h('button', { class: 'btn ghost', onclick: () => mv('eingang', 'Zurück in den Eingang.') }, '← Zurück in den Eingang'));
  }
  if (v.folder === 'hochgeladen') b.push(h('button', { class: 'btn ghost', onclick: () => mv('geschnitten', 'Zurück zur Freigabe.') }, '← Zurück zur Freigabe'));
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
    chain = chain.then(() => new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/upload?folder=${folder}&name=${encodeURIComponent(file.name)}`);
      x.setRequestHeader('X-Zentrale', '1');
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%'; };
      x.onload = () => {
        let j = {}; try { j = JSON.parse(x.responseText); } catch { }
        if (x.status === 200) { label.textContent = '✓ ' + file.name; setTimeout(() => item.remove(), 3000); }
        else { label.textContent = '✗ ' + file.name + ': ' + (j.error || x.status); item.style.borderColor = 'var(--bad)'; setTimeout(() => item.remove(), 10000); }
        resolve();
      };
      x.onerror = () => { label.textContent = '✗ ' + file.name + ': Verbindung abgebrochen'; resolve(); };
      x.send(file);
    }));
  }
  chain.then(async () => { await api('POST', '/api/scan').catch(() => {}); await refresh(); renderMain(); updateCounts(); });
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
function watchSettings(sig) {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    if (S.tab !== 'einstellungen' || S.openId) return;
    const st = await loadSettings().catch(() => null);
    if (st && connSig(st) !== sig) renderSettings(); else watchSettings(sig);
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
    const save = run(() => api('PUT', '/api/profiles/' + p.id, { name: name.value, color: color.value, isDefault: def.checked || undefined,
      keywords: kw.value, aiStyle: style.value, category: cat.value, tags: tags.value, footer: footer.value,
      musicStyle: mStyle.value, musicMood: mMood.value }), 'Kanal gespeichert.');

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
      h('label', { class: 'check' }, def, 'Standardkanal (wenn kein Stichwort passt)'),
      h('label', {}, 'Beschreibung für Claude (Thema, Ton, Publikum)'), style,
      h('label', {}, 'Stichwörter für den Vorschlag (mit Komma; Titel/Dateiname zählt doppelt)'), kw,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, 'YouTube-Kategorie'), cat), h('div', {}, h('label', {}, 'Standard-Tags'), tags)),
      h('label', {}, 'Text unter jeder YouTube-Beschreibung'), footer,
      h('div', { class: 'two' }, h('div', {}, h('label', {}, '🎵 Musikstil für KI-Musik'), mStyle), h('div', {}, h('label', {}, 'Stimmung (Langfassung)'), mMood)),
      h('p', { class: 'hint' }, `Eigene Titel: ${st.music?.counts?.[p.id] ?? 0} (Ordner musik\\${p.id} + musik)`),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: save }, 'Speichern'),
        st.profiles.length > 1 ? h('button', { class: 'btn ghost danger', onclick: () => confirm(`Kanal „${p.name}“ löschen?`) && run(() => api('DELETE', '/api/profiles/' + p.id), 'Kanal gelöscht.')() }, 'Löschen') : null),
      ytPart, ttPart);
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
  const tiktokBox = h('div', { class: 'box' }, h('h3', {}, h('span', { class: 'dot', style: { background: 'var(--tt)' } }), ' TikTok-App (für alle TikTok-Konten)'),
    t.configured ? h('p', { class: 'ok-text' }, '✓ eingerichtet') : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'developers.tiktok.com: App anlegen, „Login Kit“ + „Content Posting API“, Scope video.upload.'),
      h('li', {}, 'Sandbox: beide TikTok-Konten als Target User eintragen.'),
      secureOrigin()
        ? h('li', {}, 'Redirect URI bei TikTok und hier: ', h('code', {}, location.origin + '/oauth/tiktok'), ' ', h('button', { class: 'btn small', onclick: () => copy(location.origin + '/oauth/tiktok') }, '⧉'))
        : h('li', {}, 'Redirect URI muss https sein: Zentrale über Nginx Proxy Manager per https öffnen (dann wird sie hier vorgeschlagen).')),
    h('label', {}, 'Client Key'), tKey, h('label', {}, 'Client Secret'), tSecret, h('label', {}, 'Redirect URI'), tRedirect,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/tiktok/config', { clientKey: tKey.value, clientSecret: tSecret.value, redirectUri: tRedirect.value }), 'Gespeichert.') }, 'Speichern')));

  // ----- Claude -----
  const a = st.ai;
  const aKey = h('input', { type: 'password', autocomplete: 'off', placeholder: a.configured ? 'gespeichert (' + a.keyHint + ') – zum Ändern neu eintragen' : 'sk-ant-…' });
  const aAuto = h('input', { type: 'checkbox', checked: a.auto });
  const aHints = h('textarea', { rows: 3, value: a.hints, placeholder: 'z. B. „Ich heiße Micha“, „keine Emojis im Titel“, „immer auf Deutsch“' });
  const claudeBox = h('div', { class: 'box' }, h('h3', {}, '✨ Claude (Vorschläge für Titel & Texte)'),
    a.configured ? h('p', { class: 'ok-text' }, '✓ eingerichtet · bisher ' + a.count + ' Vorschläge, ca. ' + (a.spent || 0).toFixed(2).replace('.', ',') + ' $') : null,
    h('ol', { class: 'steps' },
      h('li', {}, 'console.anthropic.com: Konto anlegen, unter Billing Guthaben aufladen (z. B. 5 $; eigene Abrechnung, nicht im Claude-Abo enthalten).'),
      h('li', {}, 'API Keys → „Create Key“ → hier einfügen und speichern.'),
      h('li', {}, 'Ein Vorschlag kostet etwa 2–6 Cent (Claude Opus 5.5 schaut 6 Standbilder an).')),
    h('label', {}, 'API-Schlüssel'), aKey,
    h('label', { class: 'check' }, aAuto, 'Neue Videos unter „Zur Freigabe“ automatisch vorschlagen lassen'),
    h('label', {}, 'Allgemeine Hinweise an Claude'), aHints,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/ai/config', { apiKey: aKey.value, auto: aAuto.checked, hints: aHints.value }), 'Gespeichert.') }, 'Speichern'),
      a.configured ? h('button', { class: 'btn ghost danger', onclick: () => confirm('API-Schlüssel entfernen?') && run(() => api('POST', '/api/ai/config', { removeKey: true }), 'Schlüssel entfernt.')() }, 'Schlüssel entfernen') : null));

  // ----- Automatischer Schnitt -----
  const c = st.cut, w = c.whisper;
  const cb = (on) => h('input', { type: 'checkbox', checked: on });
  const numIn = (val, attrs = {}) => h('input', { type: 'number', value: val, ...attrs });
  const cAuto = cb(c.auto), cLong = cb(c.longVersion), cPause = cb(c.cutPauses), cMove = cb(c.moveRaw);
  const cDb = numIn(c.silenceDb, { min: -70, max: -20 }), cMin = numIn(c.minPause, { min: 5, max: 600 });
  const cShorts = numIn(c.shorts, { min: 0, max: 5 }), cSmin = numIn(c.shortMin, { min: 10, max: 170 }), cSmax = numIn(c.shortMax, { min: 10, max: 180 });
  const wOn = cb(w.enabled);
  const capOn = cb(c.captions?.enabled), capColor = h('input', { type: 'color', value: c.captions?.color || '#FFE14D', class: 'color small' });
  const camOn = cb(c.facecam?.enabled);
  let cam = { ...(c.facecam || {}) };
  const camInfo = h('span', { class: 'hint' }, cam.w ? `markiert: ${Math.round(cam.x * 100)} % / ${Math.round(cam.y * 100)} %, ${Math.round(cam.w * 100)} × ${Math.round(cam.h * 100)} %` : 'noch nicht markiert');
  const camPart = h('div', { class: 'cam' }, h('div', { class: 'row' },
    h('button', { class: 'btn small', onclick: () => markFacecam(cam, (r) => { cam = { ...cam, ...r }; camInfo.textContent = `markiert: ${Math.round(r.x * 100)} % / ${Math.round(r.y * 100)} %, ${Math.round(r.w * 100)} × ${Math.round(r.h * 100)} % – noch speichern`; }) }, '⬚ Facecam markieren'), camInfo));
  const wModel = h('select', {}, Object.entries(w.whisper?.models || w.models || {}).map(([m, d]) => h('option', { value: m, selected: w.model === m }, `${m} – ${d}${(w.installed || []).includes(m) ? ' ✓ geladen' : ''}`)));
  const wThreads = numIn(w.threads, { min: 1, max: 32 });
  const wGpu = cb(w.useGpu);
  const win = c.window || {};
  const wnOn = cb(win.enabled), wnFrom = h('input', { type: 'time', value: win.from || '01:00' }), wnTo = h('input', { type: 'time', value: win.to || '07:00' });
  const gpuInfo = !w.gpu?.available ? 'Grafikkarten-Version ist in diesem Image nicht enthalten.'
    : w.gpu.tried ? (w.gpu.ok ? '🟢 läuft auf der Grafikkarte' : '⚪ Grafikkarte ging nicht (' + (w.gpu.error || '?') + ') – nutzt Prozessor') : 'wird beim nächsten Mal ausprobiert';
  const dl = w.download;
  const cutBox = h('div', { class: 'box' }, h('h3', {}, '✂ Automatischer Schnitt'),
    c.running ? h('p', { class: 'hint' }, 'Läuft gerade' + (c.queued ? `, ${c.queued} warten` : '') + '.') : null,
    h('label', { class: 'check' }, cAuto, 'Neue Rohaufnahmen im Eingang automatisch schneiden'),
    h('label', { class: 'check' }, cLong, 'Langfassung für YouTube erzeugen'),
    h('label', { class: 'check' }, cPause, 'dabei ruhige Abschnitte (Menü, Pause, Laden) herausschneiden'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'ruhig = leiser als (LUFS)'), cDb), h('div', {}, h('label', {}, 'ab Länge (Sekunden)'), cMin)),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Shorts je Video (0 = keine)'), cShorts),
      h('div', {}, h('label', {}, 'Länge von – bis (s)'), h('div', { class: 'row' }, cSmin, cSmax))),
    h('label', { class: 'check' }, cMove, 'Original danach nach „Rohvideos“ verschieben'),
    h('label', { class: 'check' }, wnOn, '🌙 Nachtbetrieb: nur in diesem Zeitfenster schneiden'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'von'), wnFrom, h('span', { class: 'hint' }, 'bis'), wnTo,
      h('span', { class: 'hint' }, c.window?.enabled ? (c.windowOpen ? '(gerade offen)' : '(gerade zu – „Jetzt schneiden“ geht trotzdem)') : '')),
    h('label', { class: 'check' }, capOn, 'Animierte Untertitel in Shorts (Wort für Wort)'),
    h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Farbe des gesprochenen Worts:'), capColor),
    h('label', { class: 'check' }, camOn, 'Facecam-Layout für Shorts (Facecam oben, Spiel unten)'),
    camPart,
    h('p', { class: 'hint' }, c.gpu?.nvenc ? '🟢 Grafikkarte (NVENC) wird zum Kodieren genutzt.' : '⚪ Grafikkarte nicht genutzt' + (c.gpu?.error ? ' – ' + c.gpu.error : '') + '. In Unraid: --runtime=nvidia, NVIDIA_VISIBLE_DEVICES=all, NVIDIA_DRIVER_CAPABILITIES=all.'),
    h('h3', { style: { marginTop: '16px' } }, '🗣 Sprache erkennen (Whisper)'),
    h('p', { class: 'hint' }, 'Wandelt Gesprochenes in Text – Claude versteht dann, was du sagst. Läuft lokal auf dem Server, kostet nichts. Das Modell wird beim ersten Mal geladen.'),
    dl ? h('p', { class: dl.error ? 'err' : 'hint' }, dl.error || `Lade Modell „${dl.model}“ … ${dl.total ? Math.round(dl.done / dl.total * 100) + ' %' : Math.round(dl.done / 1e6) + ' MB'}`) : null,
    h('label', { class: 'check' }, wOn, 'Sprache erkennen'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Modell'), wModel), h('div', {}, h('label', {}, 'CPU-Kerne (ohne Grafikkarte)'), wThreads)),
    h('label', { class: 'check' }, wGpu, 'Whisper auf der Grafikkarte (deutlich schneller, Prozessor bleibt frei)'),
    h('p', { class: 'hint' }, gpuInfo),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/cut/config', { auto: cAuto.checked, longVersion: cLong.checked, cutPauses: cPause.checked,
        silenceDb: Number(cDb.value), minPause: Number(cMin.value), shorts: Number(cShorts.value), shortMin: Number(cSmin.value), shortMax: Number(cSmax.value),
        moveRaw: cMove.checked, whisper: { enabled: wOn.checked, model: wModel.value, threads: Number(wThreads.value), gpu: wGpu.checked },
        window: { enabled: wnOn.checked, from: wnFrom.value, to: wnTo.value },
        captions: { enabled: capOn.checked, color: capColor.value }, facecam: { enabled: camOn.checked, x: cam.x, y: cam.y, w: cam.w, h: cam.h } }), 'Gespeichert.') }, 'Speichern')));

  // ----- Musik -----
  const mu = st.music || {};
  const muOn = cb(mu.enabled), muShorts = cb(mu.shorts), muLong = cb(mu.long), muDuck = cb(mu.duck);
  const muSrc = h('select', {}, [['mixed', 'Eigene Titel zuerst, sonst KI-Musik'], ['library', 'Nur eigene Titel (Ordner)'], ['ai', 'Immer KI-Musik']]
    .map(([k, n]) => h('option', { value: k, selected: mu.source === k }, n)));
  const muLevel = h('select', {}, (mu.levels || []).map((k) => h('option', { value: k, selected: mu.level === k }, k)));
  const muLongMax = numIn(mu.longMax, { min: 30, max: 600 });
  const muModel = h('input', { value: mu.model || '' });
  const musicBox = h('div', { class: 'box' }, h('h3', {}, '🎵 Hintergrundmusik'),
    h('p', { class: 'hint' }, `Eigene Titel (z. B. von Epidemic Sound) in ${mu.folder || 'musik'} legen – je Kanal in den Unterordner mit der Kanal-ID, nach Stimmung in Unterordner wie „episch“, „lustig“, „chillig“. Sonst erzeugt fal.ai passende KI-Musik (Sonilo, laut Anbieter kommerziell nutzbar, ca. ${String(mu.pricePerMinute ?? 0.15).replace('.', ',')} $ je Minute). Musik wird unter die Stimme gemischt und leiser, sobald du sprichst.`),
    h('label', { class: 'check' }, muOn, 'Hintergrundmusik einmischen'),
    h('label', { class: 'check' }, muShorts, 'in Shorts'),
    h('label', { class: 'check' }, muLong, 'in der Langfassung (Titel wird wiederholt)'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Quelle'), muSrc), h('div', {}, h('label', {}, 'Lautstärke'), muLevel)),
    h('label', { class: 'check' }, muDuck, 'Musik leiser, wenn gesprochen wird (Ducking)'),
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'KI-Titel Langfassung max. (s)'), muLongMax), h('div', {}, h('label', {}, 'KI-Modell (fal.ai)'), muModel)),
    h('p', { class: 'hint' }, `Allgemeiner Ordner: ${mu.common ?? 0} Titel · KI-Musik bisher: ${mu.generated || 0} Titel, ca. ${(mu.spent || 0).toFixed(2).replace('.', ',')} $`
      + (mu.falConfigured ? '' : ' · ⚠ fal.ai-Schlüssel fehlt (unten bei Titelbilder)')),
    h('p', { class: 'hint' }, 'Epidemic Sound: deine Kanäle müssen in deinem Epidemic-Konto verknüpft sein, sonst meldet YouTube Urheberrechtsansprüche.'),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: run(() => api('POST', '/api/music/config', { enabled: muOn.checked, shorts: muShorts.checked, long: muLong.checked,
        duck: muDuck.checked, source: muSrc.value, level: muLevel.value, longMax: Number(muLongMax.value), model: muModel.value }), 'Gespeichert.') }, 'Speichern')));

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

  // ----- Allgemein + Zugang -----
  const auto = h('input', { type: 'checkbox', checked: st.settings.autoArchive });
  const old = h('input', { type: 'password', autocomplete: 'current-password' });
  const neu = h('input', { type: 'password', autocomplete: 'new-password' });
  const account = h('div', { class: 'box' }, h('h3', {}, 'Allgemein & Zugang'),
    h('label', { class: 'check' }, auto, 'Nach YouTube + TikTok automatisch ins Archiv'),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: run(() => api('PUT', '/api/settings', { autoArchive: auto.checked }), 'Gespeichert.') }, 'Speichern')),
    h('label', {}, 'Altes Passwort'), old, h('label', {}, 'Neues Passwort (mind. 8 Zeichen)'), neu,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/password', { old: old.value, password: neu.value }); old.value = neu.value = ''; toast('Passwort geändert.'); } catch (x) { toast(x.message, true); } } }, 'Passwort ändern'),
      h('button', { class: 'btn ghost', onclick: async () => { await api('POST', '/api/logout'); start(); } }, 'Abmelden')),
    h('p', { class: 'hint', style: { marginTop: '14px' } }, APP_NAME + ' ' + versionText(),
      ' · ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); showChangelog(); } }, 'Was ist neu'),
      ' · ', h('a', { href: '#', onclick: async (e) => { e.preventDefault(); S.version = await api('POST', '/api/version/check'); toast(S.version.updateAvailable ? `Update ${S.version.latest.version} verfügbar – in Unraid „Check for Updates“ → „apply update“.` : S.version.latest.error ? 'Prüfung ging nicht: ' + S.version.latest.error : 'Du hast die neueste Version.', !!S.version.latest.error); render(); } }, 'Nach Updates suchen')));

  mainEl.replaceChildren(
    h('div', { class: 'bar' }, h('h2', { class: 'h2' }, 'Kanäle'), h('span', { class: 'hint' }, 'Jeder Kanal hat eigene YouTube-/TikTok-Verbindung und Vorgaben. Die Zentrale schlägt je Video den Kanal vor.'),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn small', onclick: () => { const n = prompt('Name des neuen Kanals:'); if (n) run(() => api('POST', '/api/profiles', { name: n }), 'Kanal angelegt.')(); } }, '+ Kanal')),
    h('div', { class: 'settings' }, st.profiles.map(channelBox)),
    h('h2', { class: 'h2', style: { marginTop: '24px' } }, 'Apps & Zugang'),
    h('div', { class: 'settings' }, claudeBox, cutBox, musicBox, thumbBox, googleBox, tiktokBox, account));
}

start();

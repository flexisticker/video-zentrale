'use strict';
// Video-Zentrale – Oberfläche (ohne Framework)

const CATEGORIES = [['20', 'Gaming'], ['24', 'Unterhaltung'], ['22', 'Menschen & Blogs'], ['23', 'Comedy'],
  ['26', 'Praktische Tipps & Styling'], ['27', 'Bildung'], ['28', 'Wissenschaft & Technik'], ['17', 'Sport'],
  ['10', 'Musik'], ['1', 'Film & Animation'], ['2', 'Autos & Fahrzeuge'], ['19', 'Reisen & Events']];
const TABS = [
  ['geschnitten', 'Zur Freigabe'],
  ['eingang', 'Eingang (roh)'],
  ['hochgeladen', 'Hochgeladen'],
  ['einstellungen', 'Einstellungen'],
];

const FOLDER_NAMES = { eingang: 'Eingang (roh)', geschnitten: 'Zur Freigabe', hochgeladen: 'Hochgeladen' };
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
    h('h1', {}, 'Video-Zentrale'),
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
  await Promise.all([refresh(), loadSettings()]);
  render();
  startPolling();
  bindDrop();
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
      || ['queued', 'running'].includes(v.ai?.state));
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
      h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), 'Video-Zentrale'),
      tabs, h('div', { class: 'spacer' }),
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
    eingang: 'Rohaufnahmen vom OBS-Sortierer. „Zur Freigabe“ schiebt ein Video ungeschnitten weiter.',
    hochgeladen: 'Archiv: Videos, die auf YouTube und TikTok sind.',
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
    h('div', { style: { marginTop: '10px' } }, moveBox));

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
  detail = { id, v, ytBox, ttBox, moveBox, folderEl, ensureSaved, chanInfo, chan, aiBox, f, setField, setCover, setCoverFromFrame, isDirty: () => !saveBtn.disabled, markClean: () => { saveBtn.disabled = true; }, cleanup: () => document.removeEventListener('keydown', onKey) };
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
      a.frames?.length ? h('div', {}, h('b', { class: 'meta' }, 'Titelbild – Claude empfiehlt Bild ' + a.thumbnailFrame + (a.thumbnailText ? ', Text: „' + a.thumbnailText + '“' : '') + ':'),
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

function updateDetail() {
  if (!detail) return;
  const v = S.videos.find((x) => x.id === detail.id);
  if (!v) return;
  const aiChanged = JSON.stringify(v.ai || null) !== detail.aiSeen;
  if (aiChanged) {
    detail.aiSeen = JSON.stringify(v.ai || null);
    // Vorschlag wurde serverseitig übernommen und hier ist nichts ungespeichert → Felder auffrischen
    if (v.ai?.applied && v.ai?.state === 'done' && !detail.isDirty()) {
      for (const k of ['title', 'description', 'tags', 'tiktok']) detail.f[k].value = v[k] || '';
      for (const k of ['title', 'description', 'tags', 'tiktok']) detail.f[k].dispatchEvent(new Event('input'));
      detail.markClean();
      detail.v.title = v.title;
    }
    Object.assign(detail.v, { ai: v.ai, suggestion: v.suggestion, hasImage: v.hasImage, imageVersion: v.imageVersion, image: v.image });
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

// append ohne null/false (sonst steht „null“ im Text)
const add = (el, ...kids) => el.append(...kids.flat().filter((k) => k != null && k !== false));

async function renderSettings() {
  const st = await loadSettings();
  if (S.tab !== 'einstellungen' || S.openId) return;
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
    const save = run(() => api('PUT', '/api/profiles/' + p.id, { name: name.value, color: color.value, isDefault: def.checked || undefined,
      keywords: kw.value, aiStyle: style.value, category: cat.value, tags: tags.value, footer: footer.value }), 'Kanal gespeichert.');

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
      setTimeout(() => { if (S.tab === 'einstellungen' && !S.openId) again(); }, 4000);
    } else {
      add(ytPart, h('button', { class: 'btn small yt', disabled: !y.configured, title: y.configured ? '' : 'Erst unten die Google-App eintragen',
        onclick: run(() => api('POST', `/api/profiles/${p.id}/youtube/connect`)) }, 'YouTube verbinden'));
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
      add(ttPart, 
        h('div', { class: 'hint' }, `Vorher im Browser bei TikTok mit dem Konto „${p.name}“ angemeldet sein (oder dort abmelden, dann fragt TikTok nach).`),
        h('div', { class: 'row' },
          h('button', { class: 'btn small tt', disabled: !t.configured, title: t.configured ? '' : 'Erst unten die TikTok-App eintragen',
            onclick: async () => { try { const { url } = await api('GET', `/api/profiles/${p.id}/tiktok/auth-url`); window.open(url, '_blank', 'noopener'); } catch (x) { toast(x.message, true); } } }, 'TikTok verbinden')),
        h('div', { class: 'row', style: { marginTop: '6px' } }, paste,
          h('button', { class: 'btn small', onclick: run(() => api('POST', '/api/tiktok/finish', { url: paste.value, profileId: p.id }), 'TikTok verbunden.') }, 'Übernehmen')));
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
      h('li', {}, 'Google Cloud Console: Projekt anlegen, „YouTube Data API v3“ aktivieren.'),
      h('li', {}, 'OAuth-Zustimmungsbildschirm: Extern, dann „App veröffentlichen“ (sonst läuft die Anmeldung nach 7 Tagen ab).'),
      h('li', {}, 'Anmeldedaten → OAuth-Client-ID → Typ „Fernseher und Geräte mit begrenzter Eingabe“.'),
      h('li', {}, 'Hier eintragen, dann oben je Kanal „YouTube verbinden“.')),
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
      h('li', {}, 'Redirect URI (https): Zentrale über Nginx Proxy Manager → Adresse + /oauth/tiktok; sonst eigene https-Adresse und nach der Anmeldung die Adresse beim Kanal einfügen.')),
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
    h('p', { class: 'hint', style: { marginTop: '14px' } }, 'Video-Zentrale ' + (st.version || '')));

  mainEl.replaceChildren(
    h('div', { class: 'bar' }, h('h2', { class: 'h2' }, 'Kanäle'), h('span', { class: 'hint' }, 'Jeder Kanal hat eigene YouTube-/TikTok-Verbindung und Vorgaben. Die Zentrale schlägt je Video den Kanal vor.'),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'btn small', onclick: () => { const n = prompt('Name des neuen Kanals:'); if (n) run(() => api('POST', '/api/profiles', { name: n }), 'Kanal angelegt.')(); } }, '+ Kanal')),
    h('div', { class: 'settings' }, st.profiles.map(channelBox)),
    h('h2', { class: 'h2', style: { marginTop: '24px' } }, 'Apps & Zugang'),
    h('div', { class: 'settings' }, claudeBox, googleBox, tiktokBox, account));
}

start();

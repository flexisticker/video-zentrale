// YouTube Data API v3: Anmeldung per Geräte-Code (kein Weiterleitungs-URL nötig, klappt im Heimnetz ohne https),
// Upload als "privat" in Stücken (fortsetzbar), danach Titelbild.
import fs from 'node:fs';
import { db, save, saveNow } from './store.js';

const OAUTH = process.env.YT_OAUTH_BASE || 'https://oauth2.googleapis.com';
const API = process.env.YT_API_BASE || 'https://www.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const CHUNK = Number(process.env.YT_CHUNK_KB || 32768) * 1024; // Vielfaches von 256 KB

let access = { token: '', until: 0 };
let pending = null; // laufende Geräte-Anmeldung

const cfg = () => db().youtube;

async function form(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

export function status() {
  const c = cfg();
  return {
    configured: !!(c.clientId && c.clientSecret),
    connected: !!c.refreshToken,
    channel: c.channel,
    clientId: c.clientId,
    hasSecret: !!c.clientSecret,
    pending: pending && Date.now() < pending.until
      ? { code: pending.userCode, url: pending.url, until: pending.until, error: pending.error || '' } : null,
  };
}

export function configure({ clientId, clientSecret }) {
  const c = cfg();
  if (typeof clientId === 'string') c.clientId = clientId.trim();
  if (typeof clientSecret === 'string' && clientSecret.trim()) c.clientSecret = clientSecret.trim();
  saveNow();
}

export function disconnect() {
  const c = cfg();
  c.refreshToken = ''; c.channel = null; access = { token: '', until: 0 }; pending = null;
  saveNow();
}

export async function startConnect() {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw new Error('Erst Client-ID und Client-Secret eintragen.');
  const { ok, j } = await form(OAUTH + '/device/code', { client_id: c.clientId, scope: SCOPE });
  if (!ok) throw new Error('Google lehnt ab: ' + (j.error_description || j.error || 'unbekannt')
    + (j.error === 'invalid_client' ? ' (Client-Typ muss „Fernseher und Geräte mit begrenzter Eingabe“ sein)' : ''));
  pending = { device: j.device_code, userCode: j.user_code, url: j.verification_url || j.verification_uri,
    interval: (j.interval || 5) * 1000, until: Date.now() + (j.expires_in || 1800) * 1000 };
  poll(pending);
  return status();
}

async function poll(p) {
  while (pending === p && Date.now() < p.until) {
    await new Promise((r) => setTimeout(r, p.interval));
    if (pending !== p) return;
    const c = cfg();
    const { ok, j } = await form(OAUTH + '/token', { client_id: c.clientId, client_secret: c.clientSecret,
      device_code: p.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).catch(() => ({ ok: false, j: {} }));
    if (ok && j.refresh_token) {
      c.refreshToken = j.refresh_token;
      access = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
      pending = null;
      saveNow();
      loadChannel().catch(() => {});
      return;
    }
    if (j.error === 'slow_down') p.interval += 5000;
    else if (j.error && j.error !== 'authorization_pending') { p.error = j.error_description || j.error; return; }
  }
}

async function token() {
  const c = cfg();
  if (!c.refreshToken) throw new Error('YouTube ist nicht verbunden (Einstellungen).');
  if (access.token && Date.now() < access.until) return access.token;
  const { ok, j } = await form(OAUTH + '/token', { client_id: c.clientId, client_secret: c.clientSecret,
    refresh_token: c.refreshToken, grant_type: 'refresh_token' });
  if (!ok) {
    if (j.error === 'invalid_grant') { c.refreshToken = ''; saveNow(); }
    throw new Error('YouTube-Anmeldung abgelaufen – in den Einstellungen neu verbinden. (' + (j.error_description || j.error) + ')');
  }
  access = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return access.token;
}

async function loadChannel() {
  const r = await fetch(API + '/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + await token() } });
  const j = await r.json();
  const ch = j.items?.[0];
  cfg().channel = ch ? { id: ch.id, title: ch.snippet?.title || '' } : null;
  saveNow();
}

function apiError(j, fallback) {
  const e = j?.error;
  const reason = e?.errors?.[0]?.reason;
  const msg = e?.message || fallback;
  if (reason === 'quotaExceeded') return 'Tageskontingent der YouTube-API aufgebraucht (ca. 6 Uploads/Tag) – morgen erneut versuchen.';
  if (reason === 'uploadLimitExceeded') return 'YouTube-Uploadlimit des Kanals erreicht.';
  return msg;
}

export function snippetFor(v) {
  const s = db().settings;
  const tags = String(v.tags || '').split(',').map((t) => t.trim().replace(/[<>]/g, '')).filter(Boolean);
  // Tags zusammen max. 500 Zeichen (Tags mit Leerzeichen zählen mit Anführungszeichen).
  const keep = []; let len = 0;
  for (const t of tags) { const l = t.length + (t.includes(' ') ? 2 : 0) + (keep.length ? 1 : 0); if (len + l > 500) break; keep.push(t); len += l; }
  let description = String(v.description || '');
  if (s.footer) description = description ? description + '\n\n' + s.footer : s.footer;
  return {
    title: String(v.title || v.file).replace(/[<>]/g, '').slice(0, 100),
    description: description.replace(/[<>]/g, '').slice(0, 5000),
    tags: keep,
    categoryId: String(v.category || s.category || '20'),
    defaultLanguage: s.language || 'de',
    defaultAudioLanguage: s.language || 'de',
  };
}

// Upload eines Videos; progress(bytes) wird laufend gemeldet. Gibt die Video-ID zurück.
export async function upload(v, filePath, imagePath, progress) {
  const size = fs.statSync(filePath).size;
  const init = await fetch(API + '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/*' },
    body: JSON.stringify({ snippet: snippetFor(v),
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } }),
  });
  if (!init.ok) throw new Error(apiError(await init.json().catch(() => null), 'Upload-Start fehlgeschlagen (' + init.status + ')'));
  const url = init.headers.get('location');
  if (!url) throw new Error('YouTube hat keine Upload-Adresse geliefert.');

  let offset = 0, tries = 0, result = null;
  const fd = fs.openSync(filePath, 'r');
  try {
    while (!result) {
      const end = Math.min(offset + CHUNK, size);
      const buf = Buffer.alloc(end - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      let r;
      try {
        r = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + await token(),
          'Content-Length': String(buf.length), 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, body: buf });
      } catch (e) { r = null; }
      if (r && (r.status === 200 || r.status === 201)) { result = await r.json(); break; }
      if (r && r.status === 308) {
        const range = r.headers.get('range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        tries = 0; progress(offset, size); continue;
      }
      if (r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
        throw new Error(apiError(await r.json().catch(() => null), 'Upload abgelehnt (' + r.status + ')'));
      }
      // Netzfehler/5xx: Stand abfragen und dort weitermachen.
      if (++tries > 6) throw new Error('Upload mehrfach abgebrochen (Netz/YouTube). Später erneut versuchen.');
      await new Promise((res) => setTimeout(res, 2000 * tries));
      const q = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + await token(),
        'Content-Length': '0', 'Content-Range': `bytes */${size}` } }).catch(() => null);
      if (q && (q.status === 200 || q.status === 201)) { result = await q.json(); break; }
      if (q && q.status === 308) { const range = q.headers.get('range'); offset = range ? Number(range.split('-')[1]) + 1 : 0; }
    }
  } finally { fs.closeSync(fd); }
  progress(size, size);

  let thumbError = '';
  if (imagePath && result?.id) {
    try {
      let img = fs.readFileSync(imagePath);
      const type = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      if (img.length > 2 * 1024 * 1024) throw new Error('Titelbild größer als 2 MB');
      const r = await fetch(API + '/upload/youtube/v3/thumbnails/set?videoId=' + encodeURIComponent(result.id), {
        method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': type }, body: img });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        thumbError = j?.error?.errors?.[0]?.reason === 'forbidden'
          ? 'Titelbild nicht gesetzt: Kanal muss bei YouTube bestätigt sein (Telefonnummer).' : 'Titelbild nicht gesetzt: ' + apiError(j, r.status);
      }
    } catch (e) { thumbError = 'Titelbild nicht gesetzt: ' + e.message; }
  }
  return { id: result.id, privacy: result.status?.privacyStatus || 'private', thumbError };
}

export function init() {
  if (cfg().refreshToken && !cfg().channel) loadChannel().catch(() => {});
  save();
}

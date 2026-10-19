// YouTube Data API v3: Anmeldung per Geräte-Code (kein Weiterleitungs-URL nötig, klappt im Heimnetz ohne https),
// Upload als "privat" in Stücken (fortsetzbar), danach Titelbild. Eine Google-App, je Kanal eine eigene Anmeldung.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, saveNow } from './store.js';
import * as profiles from './profiles.js';

const OAUTH = process.env.YT_OAUTH_BASE || 'https://oauth2.googleapis.com';
const AUTH = process.env.YT_AUTH_BASE || 'https://accounts.google.com';
const API = process.env.YT_API_BASE || 'https://www.googleapis.com';
// Analytics (Nur-Lese-Recht) nur, wenn in der Statistik eingeschaltet – dann einmal neu verbinden
const SCOPE_BASE = 'https://www.googleapis.com/auth/youtube';
const scopes = () => SCOPE_BASE + (db().youtube.analytics ? ' https://www.googleapis.com/auth/yt-analytics.readonly' : '');
const ANALYTICS = process.env.YT_ANALYTICS_BASE || 'https://youtubeanalytics.googleapis.com';
const CHUNK = Number(process.env.YT_CHUNK_KB || 32768) * 1024; // Vielfaches von 256 KB
// Ein Stück darf höchstens so lange dauern (mind. 2 Min., sonst bei 150 KB/s) – danach gilt die Verbindung als hängend,
// wird abgebrochen und der Upload ab dem Stand fortgesetzt, den YouTube bestätigt.
export const chunkTimeout = (len) => Math.max(Number(process.env.UPLOAD_MIN_TIMEOUT_S || 120) * 1000, Math.ceil(len / (150 * 1024)) * 1000);

const access = new Map();  // Kanal-ID -> { token, until }
const pending = new Map(); // Kanal-ID -> laufende Geräte-Anmeldung

const cfg = () => db().youtube;
const conn = (p) => p.youtube;

async function form(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

export function status() {
  const c = cfg();
  const open = {};
  for (const [id, p] of pending) if (Date.now() < p.until) open[id] = { code: p.userCode, url: p.url, until: p.until, error: p.error || '' };
  return { configured: !!(c.clientId && c.clientSecret), clientId: c.clientId, hasSecret: !!c.clientSecret, pending: open };
}

export function configure({ clientId, clientSecret }) {
  const c = cfg();
  if (typeof clientId === 'string') c.clientId = clientId.trim();
  if (typeof clientSecret === 'string' && clientSecret.trim()) c.clientSecret = clientSecret.trim();
  saveNow();
}

export function disconnect(p) {
  conn(p).refreshToken = ''; conn(p).channel = null; access.delete(p.id); pending.delete(p.id);
  saveNow();
}

// ---- Anmeldung im Popup (Standardweg, braucht https-Adresse bzw. localhost) ----
const webStates = new Map(); // state -> { profileId, redirect, until }

export function webAuthUrl(p, origin) {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw new Error('Erst die Google-App (Client-ID und Secret) eintragen.');
  const redirect = String(origin || '').replace(/\/$/, '') + '/oauth/google';
  const state = crypto.randomBytes(16).toString('hex');
  webStates.set(state, { profileId: p.id, redirect, until: Date.now() + 15 * 60_000 });
  const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirect, response_type: 'code', scope: scopes(),
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state });
  return AUTH + '/o/oauth2/v2/auth?' + q;
}

export async function finishWeb(code, state) {
  const st = webStates.get(state);
  if (!st || st.until < Date.now()) throw new Error('Anmeldung abgelaufen – bitte neu starten.');
  webStates.delete(state);
  const p = profiles.get(st.profileId);
  if (!p) throw new Error('Kanal nicht gefunden.');
  const c = cfg();
  const { ok, j } = await form(OAUTH + '/token', { client_id: c.clientId, client_secret: c.clientSecret, code,
    redirect_uri: st.redirect, grant_type: 'authorization_code' });
  if (!ok || !j.refresh_token) throw new Error('Google lehnt ab: ' + (j.error_description || j.error || 'kein Refresh-Token'));
  conn(p).refreshToken = j.refresh_token;
  access.set(p.id, { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 });
  saveNow();
  await loadChannel(p).catch(() => {});
  return p;
}

export async function startConnect(p) {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw new Error('Erst Client-ID und Client-Secret eintragen.');
  const { ok, j } = await form(OAUTH + '/device/code', { client_id: c.clientId, scope: scopes() });
  if (!ok) throw new Error('Google lehnt ab: ' + (j.error_description || j.error || 'unbekannt')
    + (j.error === 'invalid_client' ? ' (Client-Typ muss „Fernseher und Geräte mit begrenzter Eingabe“ sein)' : ''));
  const run = { device: j.device_code, userCode: j.user_code, url: j.verification_url || j.verification_uri,
    interval: (j.interval || 5) * 1000, until: Date.now() + (j.expires_in || 1800) * 1000 };
  pending.set(p.id, run);
  poll(p.id, run);
  return status();
}

async function poll(id, p) {
  while (pending.get(id) === p && Date.now() < p.until) {
    await new Promise((r) => setTimeout(r, p.interval));
    if (pending.get(id) !== p) return;
    const c = cfg();
    const { ok, j } = await form(OAUTH + '/token', { client_id: c.clientId, client_secret: c.clientSecret,
      device_code: p.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).catch(() => ({ ok: false, j: {} }));
    const prof = profiles.get(id);
    if (!prof) return;
    if (ok && j.refresh_token) {
      conn(prof).refreshToken = j.refresh_token;
      access.set(id, { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 });
      pending.delete(id);
      saveNow();
      loadChannel(prof).catch(() => {});
      return;
    }
    if (j.error === 'slow_down') p.interval += 5000;
    else if (j.error && j.error !== 'authorization_pending') { p.error = j.error_description || j.error; return; }
  }
}

async function token(p) {
  const c = cfg();
  if (!conn(p).refreshToken) throw new Error(`YouTube ist für „${p.name}“ nicht verbunden (Einstellungen).`);
  const a = access.get(p.id);
  if (a && Date.now() < a.until) return a.token;
  const { ok, j } = await form(OAUTH + '/token', { client_id: c.clientId, client_secret: c.clientSecret,
    refresh_token: conn(p).refreshToken, grant_type: 'refresh_token' });
  if (!ok) {
    if (j.error === 'invalid_grant') { conn(p).refreshToken = ''; saveNow(); }
    throw new Error(`YouTube-Anmeldung von „${p.name}“ abgelaufen – in den Einstellungen neu verbinden. (` + (j.error_description || j.error) + ')');
  }
  access.set(p.id, { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

async function loadChannel(p) {
  const r = await fetch(API + '/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + await token(p) } });
  const j = await r.json();
  const ch = j.items?.[0];
  conn(p).channel = ch ? { id: ch.id, title: ch.snippet?.title || '' } : null;
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

export function snippetFor(v, p) {
  const s = db().settings;
  const tags = String(v.tags || p.tags || '').split(',').map((t) => t.trim().replace(/[<>]/g, '')).filter(Boolean);
  // Tags zusammen max. 500 Zeichen (Tags mit Leerzeichen zählen mit Anführungszeichen).
  const keep = []; let len = 0;
  for (const t of tags) { const l = t.length + (t.includes(' ') ? 2 : 0) + (keep.length ? 1 : 0); if (len + l > 500) break; keep.push(t); len += l; }
  let description = String(v.description || '');
  if (p.footer) description = description ? description + '\n\n' + p.footer : p.footer;
  return {
    title: String(v.title || v.file).replace(/[<>]/g, '').slice(0, 100),
    description: description.replace(/[<>]/g, '').slice(0, 5000),
    tags: keep,
    categoryId: String(v.category || p.category || '20'),
    defaultLanguage: s.language || 'de',
    defaultAudioLanguage: s.language || 'de',
  };
}

// Upload eines Videos; progress(bytes) wird laufend gemeldet. Gibt die Video-ID zurück.
export async function upload(v, p, filePath, imagePath, progress) {
  const token = () => tokenFor(p);
  const size = fs.statSync(filePath).size;
  const init = await fetch(API + '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/*' },
    body: JSON.stringify({ snippet: snippetFor(v, p),
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } }),
  });
  if (!init.ok) throw new Error(apiError(await init.json().catch(() => null), 'Upload-Start fehlgeschlagen (' + init.status + ')'));
  const url = init.headers.get('location');
  if (!url) throw new Error('YouTube hat keine Upload-Adresse geliefert.');

  let offset = 0, tries = 0, result = null;
  const fh = await fs.promises.open(filePath, 'r');   // asynchron lesen: eine langsame Platte blockiert nicht die ganze Zentrale
  const status = async () => fetch(url, { method: 'PUT', signal: AbortSignal.timeout(60_000), headers: { Authorization: 'Bearer ' + await token(),
    'Content-Length': '0', 'Content-Range': `bytes */${size}` } }).catch(() => null);
  try {
    while (!result) {
      const end = Math.min(offset + CHUNK, size);
      const buf = Buffer.alloc(end - offset);
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      if (bytesRead !== buf.length) throw new Error(`Videodatei ließ sich bei ${(offset / 1e9).toFixed(2).replace('.', ',')} GB nicht lesen (Datei kürzer oder Lesefehler).`);
      let r, why = '';
      try {
        r = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(chunkTimeout(buf.length)), headers: { Authorization: 'Bearer ' + await token(),
          'Content-Length': String(buf.length), 'Content-Range': `bytes ${offset}-${end - 1}/${size}` }, body: buf });
      } catch (e) { r = null; why = e.name === 'TimeoutError' ? 'Verbindung hing' : 'Netzfehler'; }
      if (r && (r.status === 200 || r.status === 201)) { result = await r.json(); break; }
      if (r && r.status === 308) {
        const range = r.headers.get('range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
        tries = 0; progress(offset, size); continue;
      }
      if (r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
        throw new Error(apiError(await r.json().catch(() => null), 'Upload abgelehnt (' + r.status + ')'));
      }
      if (r) { why = 'YouTube ' + r.status; await r.body?.cancel().catch(() => {}); }
      // Netzfehler/Hänger/5xx: Stand abfragen und dort weitermachen.
      if (++tries > 8) throw new Error(`Upload mehrfach abgebrochen bei ${Math.round(offset * 100 / size)} % (${why}). Später erneut versuchen.`);
      progress(offset, size, `${why} – neuer Versuch ${tries}/8`);
      await new Promise((res) => setTimeout(res, Math.min(30_000, 2000 * tries)));
      const q = await status();
      if (q && (q.status === 200 || q.status === 201)) { result = await q.json(); break; }
      if (q && q.status === 308) { const range = q.headers.get('range'); offset = range ? Number(range.split('-')[1]) + 1 : 0; }
      if (q && q.status === 404) throw new Error('YouTube hat die Upload-Sitzung verworfen. Bitte „Erneut versuchen“.');
    }
  } finally { await fh.close(); }
  progress(size, size);

  const thumbError = imagePath && result?.id ? await setThumbnail(result.id, p, imagePath) : '';
  return { id: result.id, privacy: result.status?.privacyStatus || 'private', thumbError, thumbSent: !!imagePath && !thumbError };
}

const tokenFor = token;

// Titelbild eines (schon hochgeladenen) Videos setzen → '' oder Fehlertext
export async function setThumbnail(videoId, p, imagePath) {
  try {
    const img = fs.readFileSync(imagePath);
    const type = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    if (img.length > 2 * 1024 * 1024) throw new Error('Titelbild größer als 2 MB');
    const r = await fetch(API + '/upload/youtube/v3/thumbnails/set?videoId=' + encodeURIComponent(videoId), {
      method: 'POST', headers: { Authorization: 'Bearer ' + await token(p), 'Content-Type': type }, body: img });
    if (r.ok) return '';
    const j = await r.json().catch(() => null);
    return j?.error?.errors?.[0]?.reason === 'forbidden'
      ? 'Titelbild nicht gesetzt: Kanal muss bei YouTube bestätigt sein (Telefonnummer).' : 'Titelbild nicht gesetzt: ' + apiError(j, r.status);
  } catch (e) { return 'Titelbild nicht gesetzt: ' + e.message; }
}

// Statistik (stats.js): Aufrufe/Likes/Kommentare – geht mit dem normalen YouTube-Recht
export async function videoStats(p, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await fetch(API + '/youtube/v3/videos?part=statistics,contentDetails&id=' + ids.slice(i, i + 50).map(encodeURIComponent).join(','),
      { headers: { Authorization: 'Bearer ' + await token(p) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiError(j, 'Statistik nicht abrufbar (' + r.status + ')'));
    for (const it of j.items || []) out[it.id] = { views: +it.statistics?.viewCount || 0, likes: +it.statistics?.likeCount || 0, comments: +it.statistics?.commentCount || 0 };
  }
  return out;
}
// YouTube Analytics: durchschnittlich angesehener Anteil/Dauer je Video (braucht das Recht yt-analytics.readonly)
export async function videoAnalytics(p, ids, startDate) {
  const out = {};
  const end = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < ids.length; i += 40) {
    const q = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate: end, metrics: 'views,averageViewDuration,averageViewPercentage',
      dimensions: 'video', filters: 'video==' + ids.slice(i, i + 40).join(','), maxResults: '200' });
    const r = await fetch(ANALYTICS + '/v2/reports?' + q, { headers: { Authorization: 'Bearer ' + await token(p) } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) throw new Error('Für YouTube Analytics den Kanal einmal neu verbinden (zusätzliches Nur-Lese-Recht).');
    if (!r.ok) throw new Error(apiError(j, 'Analytics nicht abrufbar (' + r.status + ')'));
    const col = (name) => (j.columnHeaders || []).findIndex((h) => h.name === name);
    const [iv, id, ip] = ['video', 'averageViewDuration', 'averageViewPercentage'].map(col);
    for (const row of j.rows || []) out[row[iv]] = { avgDuration: +row[id] || 0, avgPercent: +row[ip] || 0 };
  }
  return out;
}

export function init() {
  for (const p of profiles.list()) if (conn(p).refreshToken && !conn(p).channel) loadChannel(p).catch(() => {});
}

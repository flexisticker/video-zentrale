// TikTok Content Posting API: Video als Entwurf in den TikTok-Posteingang ("Upload"-Weg, Scope video.upload).
// Veröffentlichen (Text, Sichtbarkeit) macht man danach in der TikTok-App.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, saveNow } from './store.js';

const AUTH = process.env.TT_AUTH_BASE || 'https://www.tiktok.com';
const API = process.env.TT_API_BASE || 'https://open.tiktokapis.com';
const SCOPE = 'user.info.basic,video.upload';
const CHUNK = 10 * 1024 * 1024; // 5–64 MB, letzter Teil darf größer sein

let access = { token: '', until: 0 };
let states = new Map(); // state -> Ablaufzeit

const cfg = () => db().tiktok;

export function status() {
  const c = cfg();
  return {
    configured: !!(c.clientKey && c.clientSecret && c.redirectUri),
    connected: !!c.refreshToken && (!c.refreshExpires || Date.now() < c.refreshExpires),
    user: c.user, clientKey: c.clientKey, hasSecret: !!c.clientSecret, redirectUri: c.redirectUri,
    refreshExpires: c.refreshExpires || 0,
  };
}

export function configure({ clientKey, clientSecret, redirectUri }) {
  const c = cfg();
  if (typeof clientKey === 'string') c.clientKey = clientKey.trim();
  if (typeof clientSecret === 'string' && clientSecret.trim()) c.clientSecret = clientSecret.trim();
  if (typeof redirectUri === 'string') {
    const u = redirectUri.trim();
    if (u && !/^https:\/\//i.test(u)) throw new Error('TikTok verlangt eine https-Adresse als Redirect URI.');
    c.redirectUri = u;
  }
  saveNow();
}

export function disconnect() {
  const c = cfg();
  c.refreshToken = ''; c.refreshExpires = 0; c.user = null; access = { token: '', until: 0 };
  saveNow();
}

export function authUrl() {
  const c = cfg();
  if (!c.clientKey || !c.clientSecret || !c.redirectUri) throw new Error('Erst Client Key, Client Secret und Redirect URI eintragen.');
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, Date.now() + 15 * 60_000);
  const q = new URLSearchParams({ client_key: c.clientKey, scope: SCOPE, response_type: 'code',
    redirect_uri: c.redirectUri, state });
  return AUTH + '/v2/auth/authorize/?' + q;
}

async function tokenCall(data) {
  const c = cfg();
  const r = await fetch(API + '/v2/oauth/token/', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: c.clientKey, client_secret: c.clientSecret, ...data }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('TikTok lehnt ab: ' + (j.error_description || j.error || r.status));
  c.refreshToken = j.refresh_token || c.refreshToken;
  if (j.refresh_expires_in) c.refreshExpires = Date.now() + j.refresh_expires_in * 1000;
  access = { token: j.access_token, until: Date.now() + ((j.expires_in || 86400) - 120) * 1000 };
  saveNow();
  return access.token;
}

// code + state kommen über die Weiterleitung oder werden als kopierte Adresse eingefügt.
export async function finishConnect(input) {
  let code = '', state = '';
  const text = String(input || '').trim();
  try {
    const u = new URL(text);
    code = u.searchParams.get('code') || ''; state = u.searchParams.get('state') || '';
    const err = u.searchParams.get('error');
    if (err) throw new Error('TikTok meldet: ' + (u.searchParams.get('error_description') || err));
  } catch (e) {
    if (e.message.startsWith('TikTok')) throw e;
    code = text;
  }
  if (!code) throw new Error('Kein Code in der Adresse gefunden.');
  if (state) {
    const until = states.get(state);
    if (!until || until < Date.now()) throw new Error('Anmeldung abgelaufen oder fremd – bitte neu starten.');
    states.delete(state);
  }
  await tokenCall({ code: decodeURIComponent(code), grant_type: 'authorization_code', redirect_uri: cfg().redirectUri });
  await loadUser().catch(() => {});
  return status();
}

async function token() {
  const c = cfg();
  if (!c.refreshToken) throw new Error('TikTok ist nicht verbunden (Einstellungen).');
  if (access.token && Date.now() < access.until) return access.token;
  try { return await tokenCall({ grant_type: 'refresh_token', refresh_token: c.refreshToken }); }
  catch (e) { throw new Error('TikTok-Anmeldung abgelaufen – in den Einstellungen neu verbinden. (' + e.message + ')'); }
}

async function loadUser() {
  const r = await fetch(API + '/v2/user/info/?fields=display_name,avatar_url', { headers: { Authorization: 'Bearer ' + await token() } });
  const j = await r.json();
  cfg().user = j.data?.user ? { name: j.data.user.display_name || '' } : null;
  saveNow();
}

function apiErr(j, fallback) {
  const e = j?.error;
  if (e && e.code && e.code !== 'ok') {
    if (e.code === 'spam_risk_too_many_pending_share') return 'Zu viele offene Entwürfe in TikTok (max. 5 in 24 Std.) – erst in der App veröffentlichen oder löschen.';
    if (e.code === 'scope_not_authorized') return 'Scope video.upload fehlt – in der TikTok-App „Content Posting API“ hinzufügen und neu verbinden.';
    return e.message || e.code;
  }
  return fallback;
}

export async function upload(filePath, progress) {
  const size = fs.statSync(filePath).size;
  const chunk = size < 5 * 1024 * 1024 ? size : CHUNK;
  const count = Math.max(1, Math.floor(size / chunk));
  const r = await fetch(API + '/v2/post/publish/inbox/video/init/', { method: 'POST',
    headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data?.upload_url) throw new Error(apiErr(j, 'Upload-Start fehlgeschlagen (' + r.status + ')'));
  const { publish_id: publishId, upload_url: url } = j.data;
  const type = filePath.toLowerCase().endsWith('.webm') ? 'video/webm' : filePath.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunk, end = i === count - 1 ? size : start + chunk;
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      let ok = false;
      for (let t = 1; t <= 4 && !ok; t++) {
        const u = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type, 'Content-Length': String(buf.length),
          'Content-Range': `bytes ${start}-${end - 1}/${size}` }, body: buf }).catch(() => null);
        if (u && (u.status === 201 || u.status === 206 || u.ok)) ok = true;
        else if (u && u.status >= 400 && u.status < 500 && u.status !== 408 && u.status !== 429) throw new Error('TikTok lehnt den Upload ab (' + u.status + ').');
        else await new Promise((res) => setTimeout(res, 2000 * t));
      }
      if (!ok) throw new Error('Upload mehrfach abgebrochen (Netz/TikTok).');
      progress(end, size);
    }
  } finally { fs.closeSync(fd); }
  return publishId;
}

// PROCESSING_UPLOAD → SEND_TO_USER_INBOX (fertig, Hinweis in der App) | FAILED
export async function checkStatus(publishId) {
  const r = await fetch(API + '/v2/post/publish/status/fetch/', { method: 'POST',
    headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(apiErr(j, 'Status nicht abrufbar (' + r.status + ')'));
  return { status: j.data?.status || '', reason: j.data?.fail_reason || '' };
}

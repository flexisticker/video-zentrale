// TikTok Content Posting API: Video als Entwurf in den TikTok-Posteingang ("Upload"-Weg, Scope video.upload)
// oder – wenn eingeschaltet – direkt veröffentlichen ("Direct Post", Scope video.publish) mit Text und Einstellungen,
// nach den TikTok Content Sharing Guidelines (Kontoinfo live, Sichtbarkeit ohne Vorauswahl, Kennzeichnung, Musik-Bestätigung).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, saveNow } from './store.js';
import * as profiles from './profiles.js';

const AUTH = process.env.TT_AUTH_BASE || 'https://www.tiktok.com';
const API = process.env.TT_API_BASE || 'https://open.tiktokapis.com';
const scope = () => 'user.info.basic,video.upload' + (cfg().directPost ? ',video.publish' : '');
const CHUNK = 10 * 1024 * 1024; // 5–64 MB, letzter Teil darf größer sein (bis 128 MB)
const SINGLE_MAX = 64 * 1000 * 1000; // bis hierhin in einem Stück (TikTok: chunk_size darf nie größer als das Video sein)

const access = new Map(); // Kanal-ID -> { token, until }
const states = new Map(); // state -> { until, profileId }

const cfg = () => db().tiktok;
const conn = (p) => p.tiktok;

export function status() {
  const c = cfg();
  return { configured: !!(c.clientKey && c.clientSecret && c.redirectUri), clientKey: c.clientKey,
    hasSecret: !!c.clientSecret, redirectUri: c.redirectUri, directPost: !!c.directPost };
}

export function configure({ clientKey, clientSecret, redirectUri, directPost }) {
  const c = cfg();
  if (typeof directPost === 'boolean') c.directPost = directPost;
  if (typeof clientKey === 'string') c.clientKey = clientKey.trim();
  if (typeof clientSecret === 'string' && clientSecret.trim()) c.clientSecret = clientSecret.trim();
  if (typeof redirectUri === 'string') {
    const u = redirectUri.trim();
    if (u && !/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) throw new Error('TikTok verlangt eine https-Adresse als Redirect URI.');
    c.redirectUri = u;
  }
  saveNow();
}

export function disconnect(p) {
  Object.assign(conn(p), { refreshToken: '', refreshExpires: 0, user: null });
  access.delete(p.id);
  saveNow();
}

export function authUrl(p) {
  const c = cfg();
  if (!c.clientKey || !c.clientSecret || !c.redirectUri) throw new Error('Erst Client Key, Client Secret und Redirect URI eintragen.');
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, { until: Date.now() + 15 * 60_000, profileId: p.id });
  const q = new URLSearchParams({ client_key: c.clientKey, scope: scope(), response_type: 'code',
    redirect_uri: c.redirectUri, state });
  return AUTH + '/v2/auth/authorize/?' + q;
}

async function tokenCall(p, data) {
  const c = cfg();
  const r = await fetch(API + '/v2/oauth/token/', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: c.clientKey, client_secret: c.clientSecret, ...data }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('TikTok lehnt ab: ' + (j.error_description || j.error || r.status));
  conn(p).refreshToken = j.refresh_token || conn(p).refreshToken;
  if (j.refresh_expires_in) conn(p).refreshExpires = Date.now() + j.refresh_expires_in * 1000;
  access.set(p.id, { token: j.access_token, until: Date.now() + ((j.expires_in || 86400) - 120) * 1000 });
  saveNow();
  return j.access_token;
}

// code + state kommen über die Weiterleitung oder werden als kopierte Adresse eingefügt.
// Gibt den verbundenen Kanal zurück.
export async function finishConnect(input, profileId) {
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
  let id = profileId;
  if (state) {
    const st = states.get(state);
    if (!st || st.until < Date.now()) throw new Error('Anmeldung abgelaufen oder fremd – bitte neu starten.');
    states.delete(state);
    id = st.profileId;
  } else if (!profileId) throw new Error('Anmeldung ohne Kennung – bitte die komplette Adresse einfügen.');
  const p = profiles.get(id);
  if (!p) throw new Error('Kanal nicht gefunden.');
  await tokenCall(p, { code: decodeURIComponent(code), grant_type: 'authorization_code', redirect_uri: cfg().redirectUri });
  await loadUser(p).catch(() => {});
  return p;
}

async function token(p) {
  if (!conn(p).refreshToken) throw new Error(`TikTok ist für „${p.name}“ nicht verbunden (Einstellungen).`);
  const a = access.get(p.id);
  if (a && Date.now() < a.until) return a.token;
  try { return await tokenCall(p, { grant_type: 'refresh_token', refresh_token: conn(p).refreshToken }); }
  catch (e) { throw new Error(`TikTok-Anmeldung von „${p.name}“ abgelaufen – in den Einstellungen neu verbinden. (` + e.message + ')'); }
}

async function loadUser(p) {
  const r = await fetch(API + '/v2/user/info/?fields=open_id,display_name,avatar_url', { headers: { Authorization: 'Bearer ' + await token(p) } });
  const j = await r.json();
  conn(p).user = j.data?.user ? { name: j.data.user.display_name || '', openId: j.data.user.open_id || '' } : null;
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

export async function upload(p, filePath, progress, direct = null) {
  const size = fs.statSync(filePath).size;
  // Regeln laut TikTok Media Transfer Guide: chunk_size 5–64 MB (kleiner Rest im letzten Stück), Anzahl = abgerundet
  // video_size / chunk_size, Videos bis 64 MB als ein einziges Stück (chunk_size = video_size).
  const chunk = size <= SINGLE_MAX ? size : CHUNK;
  const count = Math.max(1, Math.floor(size / chunk));
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count };
  const r = direct
    ? await fetch(API + '/v2/post/publish/video/init/', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await token(p), 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ post_info: {
        title: String(direct.title || '').slice(0, 2200), privacy_level: direct.privacy,
        disable_comment: !direct.allowComment, disable_duet: !direct.allowDuet, disable_stitch: !direct.allowStitch,
        brand_organic_toggle: !!direct.brandOrganic, brand_content_toggle: !!direct.brandContent,
      }, source_info }) })
    : await fetch(API + '/v2/post/publish/inbox/video/init/', { method: 'POST',
      headers: { Authorization: 'Bearer ' + await token(p), 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ source_info }) });
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

// Kontoinfo direkt vor dem Posten (Pflicht laut TikTok): Name, Bild, erlaubte Sichtbarkeiten, gesperrte Interaktionen, max. Länge
export async function creatorInfo(p) {
  const r = await fetch(API + '/v2/post/publish/creator_info/query/', { method: 'POST',
    headers: { Authorization: 'Bearer ' + await token(p), 'Content-Type': 'application/json; charset=UTF-8' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.error?.code && j.error.code !== 'ok')) throw new Error(apiErr(j, 'Kontoinfo nicht abrufbar (' + r.status + ')'));
  const d = j.data || {};
  return { avatar: d.creator_avatar_url || '', username: d.creator_username || '', nickname: d.creator_nickname || '',
    privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [],
    commentDisabled: !!d.comment_disabled, duetDisabled: !!d.duet_disabled, stitchDisabled: !!d.stitch_disabled,
    maxDuration: Number(d.max_video_post_duration_sec) || 0 };
}

// PROCESSING_UPLOAD → SEND_TO_USER_INBOX (Entwurf zugestellt) bzw. PUBLISH_COMPLETE (veröffentlicht) | FAILED
export async function checkStatus(p, publishId) {
  const r = await fetch(API + '/v2/post/publish/status/fetch/', { method: 'POST',
    headers: { Authorization: 'Bearer ' + await token(p), 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(apiErr(j, 'Status nicht abrufbar (' + r.status + ')'));
  return { status: j.data?.status || '', reason: j.data?.fail_reason || '' };
}

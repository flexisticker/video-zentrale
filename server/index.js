// Micha’s Video-Zentrale – Server (nur Node-Bordmittel, kein npm-Paket nötig)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { load, db, save, saveNow } from './store.js';
import * as lib from './library.js';
import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as jobs from './jobs.js';
import * as profiles from './profiles.js';
import * as ai from './ai.js';
import * as autocut from './autocut.js';
import * as whisper from './whisper.js';
import * as thumbs from './thumbs.js';
import * as music from './music.js';
import * as ver from './version.js';
import * as backup from './backup.js';
import * as helper from './helper.js';
import * as ai2 from './ai.js';

const PORT = Number(process.env.PORT || 8090);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const VERSION = ver.VERSION;
const SESSION_DAYS = 30;

load();
lib.ensureDirs();
jobs.init();
youtube.init();
ai.init();
ai.afterSuggest((v) => autocut.autoApplyTips(v));
autocut.init();
ver.init();
backup.init();
const scanAll = () => lib.scan().then(() => { ai.autoQueue(); autocut.autoQueue(); });
autocut.onDone(() => scanAll().catch(() => {}));

// ---------- Hilfen ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Zu groß.'); parts.push(c); }
  try { return parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}; }
  catch { throw new HttpError(400, 'Ungültige Daten.'); }
}

async function readRaw(req, limit) {
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Datei zu groß.'); parts.push(c); }
  return Buffer.concat(parts);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}

function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

function currentSession(req) {
  const t = cookies(req).vz_session;
  if (!t) return null;
  const key = sha(t), s = db().sessions[key];
  if (!s || Date.now() - s.seen > SESSION_DAYS * 864e5) return null;
  if (Date.now() - s.seen > 3600e3) { s.seen = Date.now(); save(); }
  return key;
}

function newSession(res) {
  const t = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  for (const [k, s] of Object.entries(db().sessions)) if (now - s.seen > SESSION_DAYS * 864e5) delete db().sessions[k];
  db().sessions[sha(t)] = { at: now, seen: now };
  saveNow();
  res.setHeader('Set-Cookie', `vz_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

const fails = new Map(); // IP -> [Zeitpunkte]
function checkLimit(ip) {
  const list = (fails.get(ip) || []).filter((t) => Date.now() - t < 15 * 60e3);
  fails.set(ip, list);
  if (list.length >= 5) throw new HttpError(429, 'Zu viele Fehlversuche – 15 Minuten warten.');
}

function publicVideo(v) {
  const strip = (s) => s && { ...s, history: undefined, historyCount: s.history?.length || 0 };
  return { ...v, yt: strip(v.yt), tt: strip(v.tt), suggestion: profiles.suggest(v), plan: lib.INBOXES.includes(v.folder) || v.folder === 'rohvideos' ? autocut.planOf(v) : undefined,
    transcriptText: undefined, hasTranscript: !!v.transcriptText,
    imageVersion: v.image ? (v.imageAt || v.mtime) : v.thumbAt, hasImage: !!lib.imagePath(v),
    canRevise: ['short', 'long', 'summary'].includes(v.source?.kind) ? autocut.revisable(v) || true : undefined };
}

// endgültig löschen inkl. Standbilder, Varianten und Transkript
function purge(v) {
  const extra = [];
  for (let n = 1; n <= 9; n++) { extra.push(ai2.framePath(v, n), thumbs.variantPath(v, n)); }
  extra.push(path.join(process.env.DATA_DIR || '/data', 'transkripte', v.id + '.json'));
  lib.deleteVideo(v, extra);
}

// Papierkorb nach X Tagen automatisch leeren
function emptyOldTrash() {
  const days = Number(db().settings.trashDays) || 0;
  if (!days) return;
  const limit = Date.now() - days * 86400_000;
  for (const v of Object.values(db().videos)) {
    if (v.folder === 'papierkorb' && v.trash?.at && new Date(v.trash.at).getTime() < limit) { try { purge(v); } catch (e) { console.error('Papierkorb:', e.message); } }
  }
}
setInterval(emptyOldTrash, 3600_000).unref();
// Abgebrochene Stück-Uploads aus dem Browser nach 2 Tagen entfernen
function cleanUploadParts() {
  for (const folder of ['eingang', 'geschnitten']) {
    try {
      for (const n of fs.readdirSync(lib.dirOf(folder))) {
        if (!/^\.upload-[0-9a-f]+\.part$/.test(n)) continue;
        const f = path.join(lib.dirOf(folder), n);
        if (Date.now() - fs.statSync(f).mtimeMs > 2 * 86400_000) fs.rmSync(f, { force: true });
      }
    } catch { }
  }
}
setInterval(cleanUploadParts, 3600_000).unref();
setTimeout(emptyOldTrash, 60_000);

function getVideo(id) {
  const v = db().videos[id];
  if (!v) throw new HttpError(404, 'Video nicht gefunden.');
  return v;
}

const isUploading = (v) => ['queued', 'uploading'].includes(v.yt?.state) || ['queued', 'uploading'].includes(v.tt?.state);

// Datei mit Range-Unterstützung ausliefern (Videoplayer springt so direkt an jede Stelle).
function sendFile(req, res, file, type, downloadName) {
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, 'Datei fehlt.'); }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=0' };
  if (downloadName) base['Content-Disposition'] = `attachment; filename="${downloadName.replace(/[^\w .()\-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
}

const TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function imageExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

// ---------- Routen ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  const ip = req.socket.remoteAddress || '';

  if (p === '/api/health') return send(res, 200, { ok: true, version: VERSION });

  // Rechenhelfer (PC im Heimnetz): eigener Schlüssel statt Anmeldung
  if (p.startsWith('/api/helper/')) {
    if (!helper.checkToken(req)) throw new HttpError(401, 'Schlüssel des Rechenhelfers ungültig oder Rechenhelfer ausgeschaltet.');
    let hm;
    if (p === '/api/helper/hello' && m === 'POST') return send(res, 200, { ok: true, ...helper.hello(await readJson(req)) });
    if (p === '/api/helper/next' && m === 'GET') { const j = await helper.next(); return j ? send(res, 200, j) : send(res, 204, ''); }
    if ((hm = /^\/api\/helper\/job\/([0-9a-f]{16})\/(audio|result|error)$/.exec(p))) {
      const [, id, what] = hm;
      if (what === 'audio' && m === 'GET') { const f = helper.audioPath(id); if (!f) throw new HttpError(404, 'Auftrag unbekannt.'); return sendFile(req, res, f, 'audio/wav'); }
      if (what === 'result' && m === 'POST') { const ok = helper.result(id, await readJson(req, 64 * 1024 * 1024)); return send(res, ok ? 200 : 404, { ok }); }
      if (what === 'error' && m === 'POST') { const b = await readJson(req); return send(res, 200, { ok: helper.fail(id, b.message) }); }
    }
    throw new HttpError(404, 'Unbekannt.');
  }

  // Google/TikTok leiten nach der Freigabe hierher zurück (ohne Sitzungs-Cookie, abgesichert über "state").
  // Danach: kleine Seite, die das Popup schließt.
  if ((p === '/oauth/tiktok' || p === '/oauth/google') && m === 'GET') {
    const done = (q) => { res.writeHead(302, { Location: '/oauth-fertig.html?' + new URLSearchParams(q) }); res.end(); };
    const platform = p.endsWith('google') ? 'YouTube' : 'TikTok';
    try {
      if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error'));
      const prof = p.endsWith('google')
        ? await youtube.finishWeb(url.searchParams.get('code') || '', url.searchParams.get('state') || '')
        : await tiktok.finishConnect(url.href);
      return done({ ok: '1', platform, kanal: prof.name });
    } catch (e) { return done({ ok: '0', platform, error: e.message }); }
  }

  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-zentrale'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.');

  if (p === '/api/session') {
    return send(res, 200, { setup: !db().auth, loggedIn: !!currentSession(req), version: VERSION, name: ver.APP_NAME });
  }
  if (p === '/api/setup' && m === 'POST') {
    if (db().auth) throw new HttpError(409, 'Passwort ist schon gesetzt.');
    const { password } = await readJson(req);
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Passwort: mindestens 8 Zeichen.');
    db().auth = hashPassword(password);
    newSession(res);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/login' && m === 'POST') {
    checkLimit(ip);
    const { password } = await readJson(req);
    const a = db().auth;
    const ok = a && typeof password === 'string'
      && crypto.timingSafeEqual(Buffer.from(hashPassword(password, a.salt).hash, 'hex'), Buffer.from(a.hash, 'hex'));
    if (!ok) { fails.get(ip).push(Date.now()); throw new HttpError(401, 'Passwort falsch.'); }
    fails.delete(ip);
    newSession(res);
    return send(res, 200, { ok: true });
  }

  const session = currentSession(req);
  if (!session) throw new HttpError(401, 'Bitte anmelden.');

  if (p === '/api/logout' && m === 'POST') {
    delete db().sessions[session]; saveNow();
    res.setHeader('Set-Cookie', 'vz_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && m === 'POST') {
    const { old, password } = await readJson(req);
    const a = db().auth;
    if (hashPassword(String(old || ''), a.salt).hash !== a.hash) throw new HttpError(400, 'Altes Passwort falsch.');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Neues Passwort: mindestens 8 Zeichen.');
    db().auth = hashPassword(password);
    db().sessions = { [session]: db().sessions[session] };
    saveNow();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/videos' && m === 'GET') {
    return send(res, 200, { videos: Object.values(db().videos).map(publicVideo), busy: jobs.busy() });
  }
  if (p === '/api/scan' && m === 'POST') {
    await scanAll();
    return send(res, 200, { ok: true });
  }

  // Was läuft gerade? Zentrale (Schnitt, Claude, Uploads) und Rechenhelfer – für die Anzeige oben.
  if (p === '/api/activity' && m === 'GET') {
    const name = (v) => v ? (v.title || v.file || '').slice(0, 80) : '';
    const vids = Object.values(db().videos).filter((v) => !v.missing);
    const server = [], queue = { cut: 0, ai: 0, upload: 0 };
    const hp = helper.status();
    for (const v of vids) {
      if (v.cut?.state === 'running') {
        const viaHelper = /Rechenhelfer/.test(v.cut.step || '');
        server.push({ id: v.id, kind: 'cut', name: name(v), step: v.cut.step || 'schneidet', progress: v.cut.progress || 0, waiting: viaHelper });
      } else if (v.cut?.state === 'queued') queue.cut++;
      if (v.revise?.state === 'running') server.push({ id: v.id, kind: 'cut', name: name(v), step: '🔁 Überarbeiten: ' + (v.revise.step || 'läuft'), progress: v.revise.progress || 0, waiting: /Rechenhelfer/.test(v.revise.step || '') });
      else if (v.revise?.state === 'queued') queue.cut++;
      if (v.ai?.state === 'running') server.push({ id: v.id, kind: 'ai', name: name(v), step: 'Claude schreibt Vorschläge' });
      else if (v.ai?.state === 'queued') queue.ai++;
      for (const [k, label] of [['yt', 'YouTube'], ['tt', 'TikTok']]) {
        if (v[k]?.state === 'uploading') server.push({ id: v.id, kind: 'upload', name: name(v), step: 'Upload zu ' + label, progress: v[k].progress || 0, note: v[k].note || '' });
        else if (v[k]?.state === 'queued') queue.upload++;
      }
    }
    const byId = Object.fromEntries(vids.map((v) => [v.id, v]));
    const helperJobs = hp.open.map((j) => ({ name: name(byId[j.label]), id: j.label || '', state: j.state,
      since: j.takenAt || j.createdAt || 0, step: j.state === 'taken' ? 'Spracherkennung' : 'wartet auf Abholung' }));
    return send(res, 200, { server, queue, helper: { enabled: hp.enabled, online: hp.online, seen: hp.seen, paused: hp.paused,
      name: hp.name, status: hp.status, jobs: helperJobs }, now: Date.now() });
  }

  // Große Videos in Stücken hochladen (der Browser schickt je Anfrage höchstens ~32 MB). So bleibt nichts im
  // Nginx Proxy Manager hängen (Größengrenze, Zwischenspeicher auf dessen Platte), und ein Abbruch setzt an der
  // letzten Stelle fort. Ablauf: POST /api/upload/chunk?id=&folder=&name=&offset=&total= (Body = Stück) →
  // { size } bzw. nach dem letzten Stück { done, name, id }. Bei falschem offset 409 mit { size } = Stand auf dem Server.
  if (p === '/api/upload/chunk' && (m === 'POST' || m === 'GET')) {
    const uid = String(url.searchParams.get('id') || '');
    if (!/^[0-9a-f]{16,32}$/.test(uid)) throw new HttpError(400, 'Upload-Kennung fehlt.');
    const folder = url.searchParams.get('folder') || 'geschnitten';
    if (!['eingang', 'geschnitten'].includes(folder)) throw new HttpError(400, 'Ordner nicht erlaubt.');
    const name = lib.safeName(url.searchParams.get('name'));
    if (!name || !lib.VIDEO_EXT.includes(path.extname(name).toLowerCase())) throw new HttpError(400, 'Dateityp nicht erlaubt.');
    const total = Number(url.searchParams.get('total'));
    if (!Number.isSafeInteger(total) || total <= 0 || total > 100 * 1024 ** 3) throw new HttpError(400, 'Größe ungültig.');
    const tmp = path.join(lib.dirOf(folder), `.upload-${uid}.part`);
    const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (m === 'GET') return send(res, 200, { size: have });
    const offset = Number(url.searchParams.get('offset'));
    if (offset !== have) { req.resume(); return send(res, 409, { error: 'Stand weicht ab.', size: have }); }
    let got = 0;
    try {
      await pipeline(req, async function* (src) { for await (const c of src) { got += c.length; if (got > 128 * 1024 ** 2 || offset + got > total) throw new HttpError(413, 'Stück zu groß.'); yield c; } },
        fs.createWriteStream(tmp, { flags: have ? 'r+' : 'w', start: offset }));
    } catch (e) {
      // Abgebrochenes Stück wieder abschneiden, damit der nächste Versuch sauber am Stückanfang ansetzt
      try { fs.truncateSync(tmp, offset); } catch { }
      throw e;
    }
    const size = offset + got;
    if (size < total) return send(res, 200, { size });
    const target = lib.freeName(folder, name);
    const final = path.join(lib.dirOf(folder), target);
    fs.renameSync(tmp, final);   // gleicher Ordner → kein Laufwerkswechsel
    const st = fs.statSync(final);
    const video = lib.newVideo(folder, target);
    Object.assign(video, { size: st.size, mtime: st.mtimeMs });
    saveNow();
    scanAll();
    return send(res, 200, { done: true, size, name: target, id: video?.id || null });
  }

  // Dateien hochladen (Video, Titelbild, .json) – roh als Body, Name in der Adresse.
  if (p === '/api/upload' && m === 'POST') {
    const name = lib.safeName(url.searchParams.get('name'));
    const folder = url.searchParams.get('folder') || 'geschnitten';
    const ext = path.extname(name).toLowerCase();
    if (!name || ![...lib.VIDEO_EXT, '.jpg', '.jpeg', '.png', '.webp', '.json'].includes(ext)) throw new HttpError(400, 'Dateityp nicht erlaubt.');
    if (!['eingang', 'geschnitten'].includes(folder)) throw new HttpError(400, 'Ordner nicht erlaubt.');
    const isVideo = lib.VIDEO_EXT.includes(ext);
    const target = isVideo ? lib.freeName(folder, name) : name; // Begleitdateien ersetzen gleichnamige
    const final = path.join(lib.dirOf(folder), target);
    const tmp = path.join(lib.dirOf(folder), '.' + target + '.part');
    try {
      let size = 0; const max = isVideo ? 100 * 1024 ** 3 : 20 * 1024 ** 2;
      await pipeline(req, async function* (src) { for await (const c of src) { size += c.length; if (size > max) throw new HttpError(413, 'Datei zu groß.'); yield c; } },
        fs.createWriteStream(tmp));
      fs.renameSync(tmp, final);
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    let video = null;
    if (isVideo) {
      const st = fs.statSync(final);
      video = lib.newVideo(folder, target);
      Object.assign(video, { size: st.size, mtime: st.mtimeMs });
      saveNow();
    }
    scanAll();
    return send(res, 200, { ok: true, name: target, id: video?.id || null });
  }

  let r;
  if ((r = /^\/api\/videos\/([0-9a-f]{16})(\/.*)?$/.exec(p))) {
    const v = getVideo(r[1]);
    const sub = r[2] || '';
    if (sub === '/file' && (m === 'GET' || m === 'HEAD')) return sendFile(req, res, lib.fileOf(v), TYPES[path.extname(v.file).toLowerCase()] || 'application/octet-stream',
      url.searchParams.get('download') ? v.file : '');
    if (sub === '/tiktok-creator' && m === 'GET') {
      const prof = profiles.effective(v);
      if (!prof?.tiktok?.refreshToken) throw new HttpError(409, 'TikTok ist für diesen Kanal nicht verbunden.');
      try { return send(res, 200, await tiktok.creatorInfo(prof)); } catch (e) { throw new HttpError(502, e.message); }
    }
    if (sub === '/tiktok-posted' && m === 'POST') {
      const b = await readJson(req);
      if (!v.tt || v.tt.state === 'none') throw new HttpError(409, 'Nicht an TikTok gesendet.');
      v.tt = { ...v.tt, posted: b.undo ? '' : new Date().toISOString() };
      saveNow();
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/tiktok-status' && m === 'POST') {
      if (!v.tt?.publishId) throw new HttpError(409, 'Kein TikTok-Upload bekannt.');
      const prof = profiles.get(v.tt.profileId);
      if (!prof) throw new HttpError(409, 'Kanal unbekannt.');
      try {
        const st = await tiktok.checkStatus(prof, v.tt.publishId);
        v.tt = { ...v.tt, tikStatus: st.status || 'leer', tikReason: st.reason || '', checkedAt: new Date().toISOString(), lastCheckError: '' };
        if (['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE'].includes(st.status)) v.tt.state = 'done';
        if (st.status === 'FAILED') v.tt = { ...v.tt, state: 'error', error: 'TikTok: ' + (st.reason || 'Verarbeitung fehlgeschlagen') };
      } catch (e) { v.tt = { ...v.tt, lastCheckError: e.message, checkedAt: new Date().toISOString() }; }
      saveNow();
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/linkedin' && m === 'POST') {
      const b = await readJson(req);
      v.li = b.undo ? { state: 'none' } : { state: 'done', at: new Date().toISOString(), url: /^https:\/\//.test(String(b.url || '')) ? String(b.url) : '' };
      saveNow();
      if (!b.undo && db().settings.autoArchive && v.folder === 'geschnitten') { try { lib.moveVideo(v, 'hochgeladen'); } catch (e) { console.error('Archivieren:', e.message); } }
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/image' && m === 'GET') {
      const img = lib.imagePath(v);
      if (!img) throw new HttpError(404, 'Kein Bild.');
      const base = path.basename(v.file, path.extname(v.file));
      return sendFile(req, res, img, TYPES[path.extname(img).toLowerCase()] || 'image/jpeg',
        url.searchParams.get('download') ? `${base} – Titelbild${path.extname(img).toLowerCase() || '.jpg'}` : '');
    }
    if (sub === '' && m === 'PUT') {
      const b = await readJson(req);
      const str = (x, max) => String(x ?? '').slice(0, max);
      for (const [k, max] of [['title', 100], ['description', 5000], ['tags', 500], ['tiktok', 2200], ['note', 2000], ['category', 4]]) {
        if (k in b) v[k] = str(b[k], max);
      }
      if ('channel' in b) {
        const c = String(b.channel || '');
        if (c && !profiles.get(c)) throw new HttpError(400, 'Unbekannter Kanal.');
        if (c !== (v.channel || '')) { v.channel = c; v.channelFrom = c ? 'manual' : ''; }
      }
      v.editedAt = new Date().toISOString();
      saveNow();
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/image' && m === 'POST') {
      const buf = await readRaw(req, 15 * 1024 * 1024);
      const ext = imageExt(buf);
      if (!ext) throw new HttpError(400, 'Nur JPG, PNG oder WebP.');
      lib.setImage(v, buf, ext);
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/trash' && m === 'POST') {
      if (v.folder === 'papierkorb') return send(res, 200, publicVideo(v));
      if (isUploading(v)) throw new HttpError(409, 'Während eines Uploads nicht löschen.');
      if (['queued', 'running'].includes(v.cut?.state)) throw new HttpError(409, 'Wird gerade geschnitten – bitte warten.');
      const from = v.folder;
      lib.moveVideo(v, 'papierkorb');
      v.trash = { from, at: new Date().toISOString() }; saveNow();
      return send(res, 200, publicVideo(v));
    }
    // Überarbeiten: Short nach Wunsch aus dem Rohvideo neu schneiden (neue Fassung „v2“ daneben)
    if (sub === '/revise' && m === 'POST') {
      const b = await readJson(req);
      const wish = String(b.wish || '').trim();
      if (wish.length < 3) throw new HttpError(400, 'Bitte kurz beschreiben, was anders werden soll.');
      try { autocut.enqueueRevision(v, wish); } catch (e) { throw new HttpError(409, e.message); }
      return send(res, 200, publicVideo(v));
    }
    // Viral-Tipps (Einstieg/Schnitt) umsetzen = Überarbeitung mit den Tipps als Wunsch
    if (sub === '/apply-tips' && m === 'POST') {
      const wish = autocut.tipsWish(v);
      if (!wish) throw new HttpError(409, 'Keine Schnitt-Tipps vorhanden.');
      try { autocut.enqueueRevision(v, wish); } catch (e) { throw new HttpError(409, e.message); }
      v.tipsApplied = new Date().toISOString(); saveNow();
      return send(res, 200, publicVideo(v));
    }
    // Neue Fassung behalten → die vorherige wandert in den Papierkorb
    if (sub === '/keep-revision' && m === 'POST') {
      const old = v.revisionOf && db().videos[v.revisionOf];
      if (!old) throw new HttpError(404, 'Vorherige Fassung nicht gefunden.');
      if (old.folder !== 'papierkorb') {
        if (isUploading(old)) throw new HttpError(409, 'Die vorherige Fassung wird gerade hochgeladen.');
        const from = old.folder;
        lib.moveVideo(old, 'papierkorb');
        old.trash = { from, at: new Date().toISOString(), reason: 'durch ' + v.file + ' ersetzt' };
      }
      v.revisionKept = new Date().toISOString(); saveNow();
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/restore' && m === 'POST') {
      if (v.folder !== 'papierkorb') throw new HttpError(409, 'Video ist nicht im Papierkorb.');
      lib.moveVideo(v, lib.FOLDERS.includes(v.trash?.from) && v.trash.from !== 'papierkorb' ? v.trash.from : 'geschnitten');
      delete v.trash; saveNow();
      return send(res, 200, publicVideo(v));
    }
    if (sub === '' && m === 'DELETE') {
      if (v.folder !== 'papierkorb' && !v.missing) throw new HttpError(409, 'Erst in den Papierkorb legen.');
      purge(v);
      return send(res, 200, { ok: true });
    }
    if (sub === '/move' && m === 'POST') {
      const { folder } = await readJson(req);
      if (isUploading(v)) throw new HttpError(409, 'Während eines Uploads nicht verschieben.');
      if (['queued', 'running'].includes(v.cut?.state)) throw new HttpError(409, 'Wird gerade geschnitten – bitte warten.');
      if (!lib.FOLDERS.includes(folder)) throw new HttpError(400, 'Unbekannter Ordner.');
      lib.moveVideo(v, folder);
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/cut' && m === 'POST') {
      const b = await readJson(req);
      if (b.plan) autocut.setPlan(v, b.plan);
      autocut.enqueue(v, { force: !!b.force, now: true });
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/cutplan' && m === 'POST') { autocut.setPlan(v, await readJson(req)); return send(res, 200, publicVideo(v)); }
    if (sub === '/transcript' && m === 'GET') {
      const segs = whisper.loadTranscript(v);
      return send(res, 200, { segments: segs, text: v.transcriptText || '' });
    }
    if (sub === '/ai' && m === 'POST') {
      const b = await readJson(req);
      if (v.missing) throw new HttpError(409, 'Videodatei nicht gefunden.');
      ai.enqueue(v, String(b.extra || '').slice(0, 500));
      return send(res, 200, publicVideo(v));
    }
    let fm;
    if ((fm = /^\/ai-frame\/([1-9])(\/cover)?$/.exec(sub))) {
      const file = ai.framePath(v, Number(fm[1]));
      if (!fs.existsSync(file)) throw new HttpError(404, 'Standbild fehlt.');
      if (!fm[2] && m === 'GET') return sendFile(req, res, file, 'image/jpeg');
      if (fm[2] && m === 'POST') { lib.setImage(v, fs.readFileSync(file), '.jpg'); return send(res, 200, publicVideo(v)); }
    }
    let vm;
    if ((sub === '/aithumb' || sub === '/aithumbs') && m === 'POST') {
      const b = sub === '/aithumbs' ? await readJson(req) : {};
      await ai2.ensureFrames(v);
      await thumbs.generateAiOptions(v, (n) => { const f = ai2.framePath(v, n); return fs.existsSync(f) ? f : null; }, { count: b.count || 1, text: b.text });
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/youtube-thumb' && m === 'POST') {
      if (!v.yt?.id) throw new HttpError(409, 'Video ist noch nicht auf YouTube.');
      const prof = profiles.get(v.yt.profileId) || profiles.effective(v);
      const img = lib.imagePath(v);
      if (!prof || !img || !fs.existsSync(img)) throw new HttpError(409, 'Kein Titelbild bzw. Kanal unbekannt.');
      const err = await youtube.setThumbnail(v.yt.id, prof, img);
      if (err) throw new HttpError(502, err);
      v.yt = { ...v.yt, thumbAt: new Date().toISOString(), thumbError: '' }; saveNow();
      return send(res, 200, publicVideo(v));
    }
    if ((vm = /^\/variant\/([1-7])(\/cover|\/boost)?$/.exec(sub))) {
      const k = Number(vm[1]), file = thumbs.variantPath(v, k);
      if (!vm[2] && m === 'GET') { if (!fs.existsSync(file)) throw new HttpError(404, 'Variante fehlt.');
        return sendFile(req, res, file, 'image/jpeg', url.searchParams.get('download') ? `${path.basename(v.file, path.extname(v.file))} – Titelbild ${k}.jpg` : ''); }
      if (vm[2] === '/cover' && m === 'POST') { lib.setImage(v, fs.readFileSync(file), '.jpg'); return send(res, 200, publicVideo(v)); }
      if (vm[2] === '/boost' && m === 'POST') { await thumbs.boost(v, k); return send(res, 200, publicVideo(v)); }
    }
    if (sub === '/variants' && m === 'POST') {
      await thumbs.makeVariants(v, (n) => { const f = ai2.framePath(v, n); return fs.existsSync(f) ? f : null; });
      return send(res, 200, publicVideo(v));
    }
    if (sub === '/forget' && m === 'POST') {
      if (!v.missing) throw new HttpError(409, 'Nur fehlende Videos können entfernt werden.');
      delete db().videos[v.id]; saveNow();
      return send(res, 200, { ok: true });
    }
    let a;
    if ((a = /^\/(upload|cancel|done)\/(youtube|tiktok)$/.exec(sub)) && m === 'POST') {
      const [, action, platform] = a;
      if (action === 'upload') {
        const b = await readJson(req);
        let direct = null;
        if (platform === 'tiktok' && b.direct) {
          if (!db().tiktok.directPost) throw new HttpError(409, 'Direkt veröffentlichen ist ausgeschaltet (Einstellungen → TikTok-App).');
          const d = b.direct;
          const prof = profiles.effective(v);
          const info = await tiktok.creatorInfo(prof).catch((e) => { throw new HttpError(502, e.message); });
          if (!info.privacyOptions.includes(d.privacy)) throw new HttpError(400, 'Bitte eine Sichtbarkeit wählen.');
          if (d.brandContent && d.privacy === 'SELF_ONLY') throw new HttpError(400, 'Markeninhalte können nicht privat („Nur ich“) gepostet werden.');
          if (d.disclose && !d.brandOrganic && !d.brandContent) throw new HttpError(400, 'Bitte angeben, ob du für dich selbst, für Dritte oder beides wirbst.');
          if (info.maxDuration && v.duration > info.maxDuration) throw new HttpError(400, `Video ist länger als bei diesem Konto erlaubt (${info.maxDuration} s).`);
          direct = { title: String(d.title || '').slice(0, 2200), privacy: d.privacy,
            allowComment: !!d.allowComment && !info.commentDisabled, allowDuet: !!d.allowDuet && !info.duetDisabled, allowStitch: !!d.allowStitch && !info.stitchDisabled,
            brandOrganic: !!(d.disclose && d.brandOrganic), brandContent: !!(d.disclose && d.brandContent) };
        }
        jobs.enqueue(v, platform, direct);
      }
      else if (action === 'cancel') { if (!jobs.cancel(v, platform)) throw new HttpError(409, 'Läuft schon – nicht mehr abbrechbar.'); }
      else { const b = await readJson(req); const u = String(b.url || ''); jobs.markDone(v, platform, /^https:\/\//.test(u) ? u : ''); }
      return send(res, 200, publicVideo(v));
    }
    throw new HttpError(404, 'Unbekannt.');
  }

  if (p === '/api/settings' && m === 'GET') {
    return send(res, 200, { settings: db().settings, youtube: youtube.status(), tiktok: tiktok.status(), ai: ai.status(), cut: autocut.status(), fal: thumbs.falStatus(), music: music.status(),
      profiles: profiles.list().map(profiles.publicProfile), version: VERSION });
  }
  if (p === '/api/settings' && m === 'PUT') {
    const b = await readJson(req);
    const s = db().settings;
    if (typeof b.language === 'string') s.language = b.language.slice(0, 8);
    if (typeof b.autoArchive === 'boolean') s.autoArchive = b.autoArchive;
    if (b.trashDays != null && !isNaN(b.trashDays)) s.trashDays = Math.max(0, Math.min(365, Math.round(Number(b.trashDays))));
    saveNow();
    return send(res, 200, { ok: true });
  }
  // Standbild aus einer Rohaufnahme zum Markieren der Facecam
  if (p === '/api/facecam-frame' && m === 'GET') {
    const cand = Object.values(db().videos).filter((x) => !x.missing && x.width > x.height && ['eingang', 'rohvideos'].includes(x.folder))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0]
      || Object.values(db().videos).filter((x) => !x.missing && x.width > x.height).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
    if (!cand) throw new HttpError(404, 'Noch keine Aufnahme im Querformat vorhanden.');
    const out = path.join(process.env.DATA_DIR || '/data', 'tmp', 'facecam.jpg');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await new Promise((resolve) => {
      const pr = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.floor((cand.duration || 10) * 0.3)), '-i', lib.fileOf(cand),
        '-vf', 'scale=960:-2', '-frames:v', '1', '-q:v', '4', out], { stdio: 'ignore' });
      pr.on('close', resolve); pr.on('error', resolve);
    });
    if (!fs.existsSync(out)) throw new HttpError(500, 'Standbild nicht lesbar.');
    return sendFile(req, res, out, 'image/jpeg');
  }
  if (p === '/api/fal/config' && m === 'POST') { thumbs.falConfigure(await readJson(req)); return send(res, 200, thumbs.falStatus()); }
  if (p === '/api/photos' && m === 'GET') return send(res, 200, { photos: thumbs.photos(), labels: thumbs.LABELS });
  if (p === '/api/photos' && m === 'POST') {
    const buf = await readRaw(req, 25 * 1024 * 1024);
    return send(res, 200, await thumbs.addPhoto(buf, { label: url.searchParams.get('label'), channel: url.searchParams.get('channel') || '' }));
  }
  let ph;
  if ((ph = /^\/api\/photos\/([0-9a-f]{12})(\/image|\/recut)?$/.exec(p))) {
    const photo = thumbs.photos().find((x) => x.id === ph[1]);
    if (!photo) throw new HttpError(404, 'Foto nicht gefunden.');
    if (ph[2] === '/image' && m === 'GET') return sendFile(req, res, thumbs.photoPath(photo), TYPES[path.extname(photo.file)] || 'image/png');
    if (ph[2] === '/recut' && m === 'POST') return send(res, 200, await thumbs.recut(photo.id));
    if (!ph[2] && m === 'PUT') return send(res, 200, thumbs.updatePhoto(photo.id, await readJson(req)));
    if (!ph[2] && m === 'DELETE') { thumbs.removePhoto(photo.id); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/backup' && m === 'GET') return send(res, 200, backup.status());
  if (p === '/api/backup' && m === 'POST') { backup.create(); return send(res, 200, backup.status()); }
  if (p === '/api/backup' && m === 'DELETE') { backup.remove(url.searchParams.get('file')); return send(res, 200, backup.status()); }
  if (p === '/api/backup/config' && m === 'POST') { backup.configure(await readJson(req)); return send(res, 200, backup.status()); }
  if (p === '/api/backup/download' && m === 'GET') {
    const name = url.searchParams.get('file');
    let buf, file;
    if (name) { const f = backup.fileOf(name); if (!f) throw new HttpError(404, 'Sicherung nicht gefunden.'); buf = fs.readFileSync(f); file = path.basename(f); }
    else { buf = backup.build().buf; file = `video-zentrale-sicherung-${new Date().toISOString().slice(0, 10)}.zip`; }
    return send(res, 200, buf, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${file}"` });
  }
  if (p === '/api/backup/restore' && m === 'POST') {
    const name = url.searchParams.get('file');
    let buf;
    if (name) { const f = backup.fileOf(name); if (!f) throw new HttpError(404, 'Sicherung nicht gefunden.'); buf = fs.readFileSync(f); }
    else buf = await readRaw(req, 500 * 1024 * 1024);
    try { return send(res, 200, { ...backup.restore(buf), status: backup.status() }); }
    catch (e) { throw new HttpError(400, e.message); }
  }
  if (p === '/api/helper-config' && m === 'GET') return send(res, 200, helper.status());
  if (p === '/api/helper-download' && m === 'GET') {
    const st = helper.status();
    if (!st.enabled || !st.token) throw new HttpError(409, 'Erst den Rechenhelfer einschalten.');
    const origin = String(url.searchParams.get('origin') || '');
    if (!/^https?:\/\/[\w.\-:[\]]+$/.test(origin)) throw new HttpError(400, 'Adresse der Zentrale fehlt.');
    const dir = path.join(PUBLIC, '..', 'tools', 'rechenhelfer');
    const entries = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => ({ name: 'Rechenhelfer/' + f, data: fs.readFileSync(path.join(dir, f)) }));
    entries.push({ name: 'Rechenhelfer/rechenhelfer.json', data: Buffer.from(JSON.stringify({ url: origin, token: st.token }, null, 2)) });
    return send(res, 200, backup.zip(entries), { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="Rechenhelfer.zip"' });
  }
  if (p === '/api/helper-config' && m === 'POST') { helper.configure(await readJson(req)); return send(res, 200, helper.status()); }
  if (p === '/api/coach' && m === 'GET') return send(res, 200, db().coach || {});
  if (p === '/api/coach' && m === 'POST') {
    const b = await readJson(req);
    try { return send(res, 200, await ai.coach(b.profileId)); } catch (e) { throw new HttpError(400, e.message); }
  }
  if (p === '/api/trash/empty' && m === 'POST') {
    let n = 0;
    for (const v of Object.values(db().videos)) if (v.folder === 'papierkorb') { purge(v); n++; }
    return send(res, 200, { deleted: n });
  }
  if (p === '/api/version' && m === 'GET') return send(res, 200, ver.info());
  if (p === '/api/version/check' && m === 'POST') { await ver.checkUpdate(true); return send(res, 200, ver.info()); }
  if (p === '/api/music/config' && m === 'POST') { music.configure(await readJson(req)); return send(res, 200, music.status()); }
  if (p === '/api/cut/config' && m === 'POST') { autocut.configure(await readJson(req)); return send(res, 200, autocut.status()); }
  if (p === '/api/ai/config' && m === 'POST') { ai.configure(await readJson(req)); return send(res, 200, ai.status()); }
  if (p === '/api/profiles' && m === 'POST') return send(res, 200, profiles.publicProfile(profiles.create(await readJson(req))));
  if (p === '/api/youtube/config' && m === 'POST') { youtube.configure(await readJson(req)); return send(res, 200, youtube.status()); }
  if (p === '/api/tiktok/config' && m === 'POST') { tiktok.configure(await readJson(req)); return send(res, 200, tiktok.status()); }
  if (p === '/api/tiktok/finish' && m === 'POST') {
    const b = await readJson(req);
    return send(res, 200, profiles.publicProfile(await tiktok.finishConnect(b.url, b.profileId)));
  }
  if ((r = /^\/api\/profiles\/([a-z0-9-]{1,40})(\/.*)?$/.exec(p))) {
    const prof = profiles.get(r[1]);
    if (!prof) throw new HttpError(404, 'Kanal nicht gefunden.');
    const sub = r[2] || '';
    if (sub === '' && m === 'PUT') return send(res, 200, profiles.publicProfile(profiles.update(prof.id, await readJson(req))));
    if (sub === '' && m === 'DELETE') { profiles.remove(prof.id); return send(res, 200, { ok: true }); }
    if (sub === '/youtube/connect' && m === 'POST') return send(res, 200, await youtube.startConnect(prof));
    if (sub === '/youtube/auth-url' && m === 'GET') {
      const origin = url.searchParams.get('origin') || '';
      if (!/^https:\/\/[^/]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new HttpError(400, 'Anmeldung per Fenster braucht eine https-Adresse.');
      return send(res, 200, { url: youtube.webAuthUrl(prof, origin) });
    }
    if (sub === '/youtube/disconnect' && m === 'POST') { youtube.disconnect(prof); return send(res, 200, { ok: true }); }
    if (sub === '/tiktok/auth-url' && m === 'GET') return send(res, 200, { url: tiktok.authUrl(prof) });
    if (sub === '/tiktok/disconnect' && m === 'POST') { tiktok.disconnect(prof); return send(res, 200, { ok: true }); }
  }

  throw new HttpError(404, 'Unbekannt.');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Interner Fehler: ' + e.message : e.message });
    else res.destroy();
  }
});

server.requestTimeout = 0; // große Uploads
server.listen(PORT, () => console.log(`${ver.APP_NAME} ${VERSION}${ver.BUILD.build ? ' (Build ' + ver.BUILD.build + ')' : ''} läuft auf Port ${PORT}`));

scanAll();
setInterval(() => scanAll().catch((e) => console.error('Scan:', e.message)), 60_000);
process.on('SIGTERM', () => { try { saveNow(); } finally { process.exit(0); } });

// Video-Zentrale – Server (nur Node-Bordmittel, kein npm-Paket nötig)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { load, db, save, saveNow } from './store.js';
import * as lib from './library.js';
import * as youtube from './youtube.js';
import * as tiktok from './tiktok.js';
import * as jobs from './jobs.js';
import * as profiles from './profiles.js';

const PORT = Number(process.env.PORT || 8090);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(PUBLIC, '..', 'package.json'), 'utf8')).version;
const SESSION_DAYS = 30;

load();
lib.ensureDirs();
jobs.init();
youtube.init();

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
  return { ...v, yt: strip(v.yt), tt: strip(v.tt), suggestion: profiles.suggest(v),
    imageVersion: v.image ? (v.imageAt || v.mtime) : v.thumbAt, hasImage: !!lib.imagePath(v) };
}

function getVideo(id) {
  const v = db().videos[id];
  if (!v) throw new HttpError(404, 'Video nicht gefunden.');
  return v;
}

const isUploading = (v) => ['queued', 'uploading'].includes(v.yt?.state) || ['queued', 'uploading'].includes(v.tt?.state);

// Datei mit Range-Unterstützung ausliefern (Videoplayer springt so direkt an jede Stelle).
function sendFile(req, res, file, type) {
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, 'Datei fehlt.'); }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=0' };
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
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

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

  // TikTok leitet hierher zurück (ohne Sitzungs-Cookie, abgesichert über "state").
  if (p === '/oauth/tiktok' && m === 'GET') {
    try { const p = await tiktok.finishConnect(url.href); res.writeHead(302, { Location: '/?tiktok=ok&kanal=' + encodeURIComponent(p.name) + '#einstellungen' }); }
    catch (e) { res.writeHead(302, { Location: '/?tiktok=' + encodeURIComponent(e.message) + '#einstellungen' }); }
    return res.end();
  }

  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-zentrale'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.');

  if (p === '/api/session') {
    return send(res, 200, { setup: !db().auth, loggedIn: !!currentSession(req), version: VERSION });
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
    await lib.scan();
    return send(res, 200, { ok: true });
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
    lib.scan();
    return send(res, 200, { ok: true, name: target, id: video?.id || null });
  }

  let r;
  if ((r = /^\/api\/videos\/([0-9a-f]{16})(\/.*)?$/.exec(p))) {
    const v = getVideo(r[1]);
    const sub = r[2] || '';
    if (sub === '/file' && (m === 'GET' || m === 'HEAD')) return sendFile(req, res, lib.fileOf(v), TYPES[path.extname(v.file).toLowerCase()] || 'application/octet-stream');
    if (sub === '/image' && m === 'GET') {
      const img = lib.imagePath(v);
      if (!img) throw new HttpError(404, 'Kein Bild.');
      return sendFile(req, res, img, TYPES[path.extname(img).toLowerCase()] || 'image/jpeg');
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
    if (sub === '/move' && m === 'POST') {
      const { folder } = await readJson(req);
      if (isUploading(v)) throw new HttpError(409, 'Während eines Uploads nicht verschieben.');
      if (!lib.FOLDERS.includes(folder)) throw new HttpError(400, 'Unbekannter Ordner.');
      lib.moveVideo(v, folder);
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
      if (action === 'upload') jobs.enqueue(v, platform);
      else if (action === 'cancel') { if (!jobs.cancel(v, platform)) throw new HttpError(409, 'Läuft schon – nicht mehr abbrechbar.'); }
      else { const b = await readJson(req); const u = String(b.url || ''); jobs.markDone(v, platform, /^https:\/\//.test(u) ? u : ''); }
      return send(res, 200, publicVideo(v));
    }
    throw new HttpError(404, 'Unbekannt.');
  }

  if (p === '/api/settings' && m === 'GET') {
    return send(res, 200, { settings: db().settings, youtube: youtube.status(), tiktok: tiktok.status(),
      profiles: profiles.list().map(profiles.publicProfile), version: VERSION });
  }
  if (p === '/api/settings' && m === 'PUT') {
    const b = await readJson(req);
    const s = db().settings;
    if (typeof b.language === 'string') s.language = b.language.slice(0, 8);
    if (typeof b.autoArchive === 'boolean') s.autoArchive = b.autoArchive;
    saveNow();
    return send(res, 200, { ok: true });
  }
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
server.listen(PORT, () => console.log(`Video-Zentrale ${VERSION} läuft auf Port ${PORT}`));

lib.scan();
setInterval(() => lib.scan().catch((e) => console.error('Scan:', e.message)), 60_000);
process.on('SIGTERM', () => { try { saveNow(); } finally { process.exit(0); } });

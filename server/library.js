// Videoordner einlesen: /videos/eingang (Rohaufnahmen), /videos/geschnitten (bereit), /videos/hochgeladen (Archiv).
// Neben einem Video dürfen liegen: <name>.jpg|.png|.webp (Titelbild) und <name>.json (Titel, Texte).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { db, save, DATA_DIR } from './store.js';
import * as profiles from './profiles.js';

export const VIDEO_DIR = process.env.VIDEO_DIR || '/videos';
export const FOLDERS = ['eingang', 'eingang-profi', 'geschnitten', 'hochgeladen', 'rohvideos', 'papierkorb'];
export const INBOXES = ['eingang', 'eingang-profi']; // Rohaufnahmen (eingang-profi = LinkedIn/geschäftlich)
export const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.webm', '.m4v'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const SETTLE_MS = 60_000; // Datei wird evtl. noch kopiert

export const dirOf = (folder) => path.join(VIDEO_DIR, folder);
export const fileOf = (v) => path.join(dirOf(v.folder), v.file);
// v.file darf Unterordner enthalten (z. B. „MichaModus/2026-10/Fortnite/2026-10-11 Fortnite – Clutch.mp4“, immer mit /)
const relDir = (file) => { const d = path.posix.dirname(String(file).replace(/\\/g, '/')); return d === '.' ? '' : d; };
const relJoin = (dir, name) => (dir ? dir + '/' + name : name);
const stemOf = (file) => path.basename(file, path.extname(file));

export function ensureDirs() {
  for (const f of FOLDERS) fs.mkdirSync(dirOf(f), { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

// Erlaubte Dateinamen: keine Pfade, keine Steuerzeichen.
export function safeName(name) {
  const n = path.basename(String(name || '')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  if (!n || n === '.' || n === '..' || n.startsWith('.')) return '';
  return n.slice(0, 180);
}

// freier Name im Ordner (name darf einen Unterordner enthalten) – „Titel (2).mp4“ usw.
export function freeName(folder, name, ignore = null) {
  const dir = relDir(name), ext = path.extname(name), base = stemOf(name);
  let n = name, i = 2;
  while (fs.existsSync(path.join(dirOf(folder), n)) && path.join(dirOf(folder), n) !== ignore) n = relJoin(dir, `${base} (${i++})${ext}`);
  return n;
}

function sidecars(folder, file) {
  const dir = relDir(file), base = stemOf(file);
  const out = { image: null, json: null };
  for (const e of IMAGE_EXT) {
    if (fs.existsSync(path.join(dirOf(folder), relJoin(dir, base + e)))) { out.image = relJoin(dir, base + e); break; }
  }
  if (fs.existsSync(path.join(dirOf(folder), relJoin(dir, base + '.json')))) out.json = relJoin(dir, base + '.json');
  return out;
}

// alle Videos eines Ordners, auch in Unterordnern (bis 4 Ebenen) → relative Pfade mit /
function walk(folder, sub = '', depth = 0, out = []) {
  let list = [];
  try { list = fs.readdirSync(path.join(dirOf(folder), sub), { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    if (e.name.startsWith('.')) continue;
    const rel = relJoin(sub, e.name);
    if (e.isDirectory() && depth < 4) walk(folder, rel, depth + 1, out);
    else if (e.isFile() && VIDEO_EXT.includes(path.extname(e.name).toLowerCase())) out.push(rel);
  }
  return out;
}

function readMeta(folder, jsonName) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dirOf(folder), jsonName), 'utf8'));
    const str = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');
    const tags = Array.isArray(m.tags) ? m.tags.join(', ') : str(m.tags, 500);
    return {
      title: str(m.title, 100),
      description: str(m.description, 5000),
      tags,
      category: str(m.category, 4),
      tiktok: str(m.tiktok ?? m.caption, 2200),
      note: str(m.note, 2000),
      channel: profiles.find(m.channel ?? m.kanal)?.id || '',
    };
  } catch { return null; }
}

export function newVideo(folder, file) {
  const id = crypto.randomBytes(8).toString('hex');
  const v = {
    id, folder, file, createdAt: new Date().toISOString(),
    title: stemOf(file).slice(0, 100),
    // leer = Vorgabe des Kanals (Tags, Kategorie) beim Upload
    description: '', tags: '', category: '', tiktok: '', note: '', channel: '', channelFrom: '',
    size: 0, mtime: 0, duration: null, width: null, height: null, image: null, thumbAt: 0,
    yt: { state: 'none' }, tt: { state: 'none' }, missing: false,
  };
  db().videos[id] = v;
  return v;
}

let scanning = null;
export function scan() {
  if (!scanning) scanning = doScan().finally(() => { scanning = null; });
  return scanning;
}

async function doScan() {
  const videos = db().videos;
  const byPlace = new Map(Object.values(videos).map((v) => [v.folder + '/' + v.file, v]));
  const seen = new Set();
  const now = Date.now();
  let changed = false;
  for (const folder of FOLDERS) {
    for (const name of walk(folder)) {
      let st;
      try { st = fs.statSync(path.join(dirOf(folder), name)); } catch { continue; }
      if (!st.isFile() || st.size === 0) continue;
      let v = byPlace.get(folder + '/' + name);
      if (!v) {
        if (now - st.mtimeMs < SETTLE_MS) continue; // noch im Kopieren
        // Von außen verschoben? Gleicher Name + Größe in anderem Ordner, dort verschwunden.
        v = Object.values(videos).find((x) => path.basename(x.file) === path.basename(name) && x.size === st.size && !fs.existsSync(fileOf(x)));
        if (v) { v.folder = folder; v.file = name; } else v = newVideo(folder, name);
        // Ordner „eingang-profi“: gehört zum LinkedIn-Kanal (geschäftlich, professioneller Stil)
        if (folder === 'eingang-profi' && !v.channel) { const pro = profiles.proProfile(); if (pro) { v.channel = pro.id; v.channelFrom = 'ordner'; } }
        changed = true;
      }
      seen.add(v.id);
      if (v.missing) { v.missing = false; changed = true; }
      const side = sidecars(folder, name);
      if (side.json) {
        const jm = fs.statSync(path.join(dirOf(folder), side.json)).mtimeMs;
        if (jm > (v.metaAt || 0)) {
          const m = readMeta(folder, side.json);
          if (m) {
            for (const k of Object.keys(m)) if (m[k]) v[k] = m[k];
            if (m.channel) v.channelFrom = 'json';
          }
          v.metaAt = jm; changed = true;
        }
      }
      if (side.image !== v.image) { v.image = side.image; v.thumbAt = 0; changed = true; }
      if (st.size !== v.size || st.mtimeMs !== v.mtime) {
        v.size = st.size; v.mtime = st.mtimeMs; v.duration = null; v.thumbAt = 0; changed = true;
      }
    }
  }
  for (const v of Object.values(videos)) {
    if (!seen.has(v.id) && !v.missing) { v.missing = true; changed = true; }
  }
  if (changed) save();
  // Metadaten + Vorschaubilder nacheinander (ffmpeg ist teuer).
  for (const v of Object.values(videos)) {
    if (v.missing) continue;
    if (v.duration == null) await probe(v);
    if (!v.image && !v.thumbAt) await makeThumb(v);
  }
}

function run(cmd, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

async function probe(v) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', fileOf(v)]);
  try {
    const j = JSON.parse(r.out);
    const s = j.streams?.[0] || {};
    let w = s.width || null, h = s.height || null;
    const rot = Math.abs(Number(s.side_data_list?.[0]?.rotation || 0));
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    v.width = w; v.height = h; v.duration = Number(j.format?.duration) || 0;
  } catch { v.duration = 0; }
  save();
}

export const thumbPath = (v) => path.join(THUMB_DIR, v.id + '.jpg');

async function makeThumb(v) {
  const at = v.duration ? Math.max(0, Math.floor(v.duration * 0.3)) : 0;
  const r = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', fileOf(v),
    '-vf', 'thumbnail=60,scale=640:-2', '-frames:v', '1', '-q:v', '4', thumbPath(v)]);
  v.thumbAt = r.code === 0 ? Date.now() : -1; // -1 = nicht möglich, nicht dauernd neu versuchen
  save();
}

// Datei verschieben – auch zwischen Laufwerken (z. B. /data → /videos bei Unraid: dort scheitert rename mit EXDEV).
// Kopiert dann erst unter verstecktem Namen und benennt am Ziel um, damit nie eine halbe Datei als Video erscheint.
export function moveFile(src, dst) {
  try { fs.renameSync(src, dst); return; }
  catch (e) { if (e.code !== 'EXDEV') throw e; }
  const part = path.join(path.dirname(dst), '.' + path.basename(dst) + '.part');
  try {
    fs.copyFileSync(src, part);
    fs.renameSync(part, dst);
  } catch (e) { fs.rmSync(part, { force: true }); throw e; }
  fs.rmSync(src, { force: true });
}

// Endgültig löschen (nur aus dem Papierkorb): Video, Begleitdateien (Titelbild, .json) und alle Zwischendateien der Zentrale.
export function deleteVideo(v, extraFiles = []) {
  const dir = relDir(v.file), base = stemOf(v.file);
  const files = [fileOf(v), ...[...IMAGE_EXT, '.json'].map((e) => path.join(dirOf(v.folder), relJoin(dir, base + e))), thumbPath(v), ...extraFiles];
  for (const f of files) fs.rmSync(f, { force: true });
  removeEmptyDirs(v.folder, dir);
  delete db().videos[v.id];
  save();
}

// leere Unterordner nach dem Verschieben aufräumen (nie den Hauptordner selbst)
function removeEmptyDirs(folder, dir) {
  while (dir) {
    const full = path.join(dirOf(folder), dir);
    try { if (fs.readdirSync(full).length) return; fs.rmdirSync(full); } catch { return; }
    dir = relDir(dir);
  }
}

// Video samt Begleitdateien an einen neuen Ort (Ordner + relativer Pfad, auch umbenennen) → neuer relativer Pfad
export function relocate(v, folder, rel) {
  if (!FOLDERS.includes(folder)) throw new Error('Ordner nicht erlaubt.');
  rel = String(rel).replace(/\\/g, '/').split('/').map((x) => safeName(x)).filter(Boolean).join('/');
  if (!rel || !VIDEO_EXT.includes(path.extname(rel).toLowerCase())) throw new Error('Ungültiger Dateiname.');
  if (folder === v.folder && rel === v.file) return v.file;
  const src = fileOf(v);
  const target = freeName(folder, rel, src);
  const oldDir = relDir(v.file), oldBase = stemOf(v.file);
  const newDir = relDir(target), newBase = stemOf(target);
  fs.mkdirSync(path.join(dirOf(folder), newDir), { recursive: true });
  moveFile(src, path.join(dirOf(folder), target));
  for (const e of [...IMAGE_EXT, '.json']) {
    const s = path.join(dirOf(v.folder), relJoin(oldDir, oldBase + e));
    if (fs.existsSync(s)) {
      const d = path.join(dirOf(folder), relJoin(newDir, newBase + e));
      if (!fs.existsSync(d)) moveFile(s, d);
    }
  }
  const oldFolder = v.folder;
  v.folder = folder; v.file = target;
  if (v.image) v.image = relJoin(newDir, newBase + path.extname(v.image));
  removeEmptyDirs(oldFolder, oldDir);
  save();
  return target;
}

// Video samt Begleitdateien in einen anderen Hauptordner (flach; die Ordnung übernimmt organize.js)
export function moveVideo(v, folder) {
  if (!FOLDERS.includes(folder) || folder === v.folder) return;
  relocate(v, folder, path.basename(v.file));
}

// Titelbild als Begleitdatei speichern (ersetzt ein vorhandenes).
export function setImage(v, buf, ext) {
  const dir = relDir(v.file), base = stemOf(v.file);
  for (const e of IMAGE_EXT) {
    const p = path.join(dirOf(v.folder), relJoin(dir, base + e));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.writeFileSync(path.join(dirOf(v.folder), relJoin(dir, base + ext)), buf);
  v.image = relJoin(dir, base + ext);
  v.imageAt = Date.now();
  save();
}

export function imagePath(v) {
  if (v.image) return path.join(dirOf(v.folder), v.image);
  if (v.thumbAt > 0) return thumbPath(v);
  return null;
}

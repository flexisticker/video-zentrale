// Sicherung der Einstellungen: alle Kanäle, Verbindungen, Schlüssel, Videodaten (Titel, Texte, Status), Fotos und Transkripte
// als ZIP. Täglich automatisch nach /data/sicherung (die ältesten werden gelöscht), jederzeit herunterladen/wiederherstellen.
// Nicht enthalten: Videos selbst, Musik, Whisper-Modelle, erzeugte Vorschaubilder (lassen sich neu erzeugen).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db, save, saveNow, replace, DATA_DIR } from './store.js';
import { VERSION } from './version.js';

const DIR = path.join(DATA_DIR, 'sicherung');
const FOLDERS = ['fotos', 'transkripte']; // Unterordner von /data, die mitgesichert werden
const cfg = () => db().backup;

// ---------- ZIP (ohne Fremdpaket) ----------
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const crc = zlib.crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Keine gültige Sicherungsdatei (ZIP).');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Sicherungsdatei beschädigt.');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lName = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    const raw = buf.slice(start, start + size);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

// ---------- Sicherung ----------
const stamp = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
};

export function build() {
  const s = JSON.parse(JSON.stringify(db()));
  delete s.sessions; // Anmeldungen gehören nicht in die Sicherung
  const info = { app: 'video-zentrale', version: VERSION, at: new Date().toISOString(),
    videos: Object.keys(s.videos || {}).length, profiles: (s.profiles || []).length, photos: (s.photos || []).length };
  const entries = [{ name: 'info.json', data: Buffer.from(JSON.stringify(info, null, 1)) },
    { name: 'zentrale.json', data: Buffer.from(JSON.stringify(s, null, 1)) }];
  for (const f of FOLDERS) {
    const dir = path.join(DATA_DIR, f);
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of list) if (e.isFile()) entries.push({ name: `${f}/${e.name}`, data: fs.readFileSync(path.join(dir, e.name)) });
  }
  return { buf: zip(entries), info };
}

export function list() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => /^sicherung-.*\.zip$/.test(f)); } catch { return []; }
  return files.map((f) => { const st = fs.statSync(path.join(DIR, f)); return { file: f, size: st.size, at: st.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function create(label = '') {
  const c = cfg();
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const { buf } = build();
    const file = `sicherung-${stamp()}${label ? '-' + label : ''}.zip`;
    fs.writeFileSync(path.join(DIR, file + '.tmp'), buf);
    fs.renameSync(path.join(DIR, file + '.tmp'), path.join(DIR, file));
    c.lastAt = new Date().toISOString(); c.lastFile = file; c.lastError = '';
    // Aufräumen: nur automatische zählen, Sicherungen vor einer Wiederherstellung bleiben ebenfalls begrenzt
    const all = list();
    for (const old of all.slice(Math.max(1, c.keep || 14))) fs.rmSync(path.join(DIR, old.file), { force: true });
    save();
    return file;
  } catch (e) {
    c.lastError = e.message; save();
    throw e;
  }
}

export const fileOf = (name) => {
  const f = path.basename(String(name || ''));
  if (!/^sicherung-[\w\-.]+\.zip$/.test(f)) return null;
  const full = path.join(DIR, f);
  return fs.existsSync(full) ? full : null;
};

export function remove(name) { const f = fileOf(name); if (f) fs.rmSync(f, { force: true }); }

// Wiederherstellen aus ZIP-Inhalt. Vorher wird der aktuelle Stand gesichert.
export function restore(buf) {
  const files = unzip(buf);
  const raw = files.get('zentrale.json');
  if (!raw) throw new Error('In der Datei fehlt zentrale.json – keine Sicherung der Video-Zentrale.');
  let data;
  try { data = JSON.parse(raw.toString('utf8')); } catch { throw new Error('zentrale.json ist beschädigt.'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.profiles) || typeof data.videos !== 'object') throw new Error('Sicherung unvollständig (Kanäle/Videos fehlen).');
  const before = create('vor-wiederherstellung');
  for (const [name, content] of files) {
    const [folder, file, ...rest] = name.split('/');
    if (rest.length || !FOLDERS.includes(folder) || !file || file.startsWith('.') || path.basename(file) !== file) continue;
    fs.mkdirSync(path.join(DATA_DIR, folder), { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, folder, file), content);
  }
  const keepBackup = { ...cfg() };
  replace(data);
  db().backup = { ...db().backup, lastAt: keepBackup.lastAt, lastFile: keepBackup.lastFile, lastError: '' };
  saveNow();
  return { before, videos: Object.keys(data.videos).length, profiles: data.profiles.length };
}

export function status() { return { ...cfg(), dir: '/data/sicherung', list: list() }; }

export function configure(b) {
  const c = cfg();
  if (typeof b.auto === 'boolean') c.auto = b.auto;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || '')) c.time = b.time;
  if (b.keep != null && !isNaN(b.keep)) c.keep = Math.round(Math.min(90, Math.max(1, Number(b.keep))));
  saveNow();
}

// Täglich zur eingestellten Uhrzeit (einmal pro Tag; holt eine verpasste Sicherung nach dem Start nach).
export function init() {
  const tick = () => {
    const c = cfg();
    if (!c.auto) return;
    const now = new Date();
    const [hh, mm] = (c.time || '03:30').split(':').map(Number);
    const due = new Date(now); due.setHours(hh, mm, 0, 0);
    if (now < due) due.setDate(due.getDate() - 1);
    if (!c.lastAt || new Date(c.lastAt) < due) { try { create(); } catch (e) { console.error('Sicherung fehlgeschlagen:', e.message); } }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000).unref();
}

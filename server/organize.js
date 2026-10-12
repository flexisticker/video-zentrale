// Ordnung: sprechende Dateinamen und saubere Ordner auf der Platte, Speicherplatz, Aufräum-Vorschläge.
//   rohvideos\<Kanal>\<JJJJ-MM>\<Spiel/Thema>\2026-10-11 20-33 Fortnite – Rohvideo.mkv
//   hochgeladen\<Kanal>\<JJJJ>\<MM>\2026-10-11 Fortnite – Clutch in letzter Sekunde (Short).mp4
//   geschnitten: nur umbenennen (Arbeitsordner bleibt flach), eingang/papierkorb: unverändert.
// Thema = Claudes „game“ aus dem Vorschlag (bei Rohvideos: das häufigste Thema der daraus geschnittenen Videos).
// Nie während Upload, Schnitt oder Überarbeitung; jede Verschiebung wird protokolliert und lässt sich rückgängig machen.
import fs from 'node:fs';
import path from 'node:path';
import { db, save, saveNow } from './store.js';
import * as lib from './library.js';
import * as profiles from './profiles.js';

const cfg = () => (db().org ||= { enabled: true, rename: true, folders: true, rawDays: 30, log: [] });
const vids = () => Object.values(db().videos);
const busy = (v) => ['queued', 'uploading'].includes(v.yt?.state) || ['queued', 'uploading'].includes(v.tt?.state)
  || ['queued', 'running'].includes(v.cut?.state) || ['queued', 'running'].includes(v.revise?.state);

// Dateinamen-tauglich: keine Emojis/Sonderzeichen, die Windows oder Unraid stören
export const clean = (s, max = 80) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N} .,!'&()+\-–]/gu, ' ')
  .replace(/\s+/g, ' ').replace(/^[ .\-–]+|[ .]+$/g, '').slice(0, max).trim();

export const childrenOf = (raw) => vids().filter((x) => x.source?.rawId === raw.id && !x.missing);
const rawOf = (v) => (v.source?.rawId ? db().videos[v.source.rawId] : null);

// Thema eines Videos (Spiel bzw. Thema laut Claude); Rohvideo: häufigstes Thema seiner Videos
export function topicOf(v) {
  if (v.ai?.game) return clean(v.ai.game, 40);
  if (v.source?.rawId) {
    const r = rawOf(v);
    if (r && r.ai?.game) return clean(r.ai.game, 40);
  }
  const kids = v.source ? [] : childrenOf(v);
  const count = {};
  for (const k of kids) if (k.ai?.game) { const t = clean(k.ai.game, 40); count[t] = (count[t] || 0) + 1; }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// Aufnahmedatum: Rohvideo = Dateizeit; geschnittene Videos = Datum ihres Rohvideos
function dateOf(v) {
  const r = rawOf(v);
  const ms = (r?.mtime || v.mtime) || Date.parse(v.createdAt) || Date.now();
  return new Date(ms);
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function kindLabel(v) {
  const k = v.source?.kind;
  if (k === 'short') return profiles.isPro(profiles.effective(v)) ? 'LinkedIn-Clip' : 'Short';
  if (k === 'long') return 'Langfassung';
  if (k === 'summary') return 'Kurzfassung';
  return '';
}

// gewünschter Name + Unterordner (oder null, wenn noch nicht genug bekannt ist)
export function desired(v) {
  const c = cfg();
  const ext = path.extname(v.file).toLowerCase();
  const d = dateOf(v);
  const topic = topicOf(v);
  const isRaw = !v.source;
  const ageDays = (Date.now() - (Date.parse(v.createdAt) || Date.now())) / 86400_000;
  // ohne Thema noch warten (Claude-Vorschlag kommt meist kurz nach dem Schnitt), nach 2 Tagen trotzdem ordnen
  if (!topic && ageDays < 2) return null;
  let name = v.file.split('/').pop();
  if (c.rename) {
    if (isRaw) name = `${ymd(d)} ${pad(d.getHours())}-${pad(d.getMinutes())} ${topic || 'Aufnahme'} – Rohvideo${ext}`;
    else {
      const ver = / (v\d+)$/.exec(path.basename(v.file, path.extname(v.file)))?.[1];
      const title = clean(v.title, 70) || clean(path.basename(v.file, ext), 70);
      const kind = kindLabel(v);
      name = `${ymd(d)} ${topic && !title.toLowerCase().includes(topic.toLowerCase()) ? topic + ' – ' : ''}${title}${kind ? ` (${kind})` : ''}${ver ? ' ' + ver : ''}${ext}`;
    }
  }
  let dir = '';
  if (c.folders) {
    const chan = clean(profiles.effective(isRaw ? (childrenOf(v)[0] || v) : v)?.name || 'Ohne Kanal', 40);
    if (v.folder === 'rohvideos') dir = `${chan}/${d.getFullYear()}-${pad(d.getMonth() + 1)}/${topic || 'Sonstiges'}`;
    if (v.folder === 'hochgeladen') dir = `${chan}/${d.getFullYear()}/${pad(d.getMonth() + 1)}`;
  }
  return dir ? `${dir}/${name}` : name;
}

// ein Video an seinen Platz bringen → true wenn verschoben/umbenannt
export function organizeOne(v, { force = false } = {}) {
  const c = cfg();
  if (!c.enabled && !force) return false;
  if (v.missing || busy(v) || v.orgLock || !['rohvideos', 'hochgeladen', 'geschnitten'].includes(v.folder)) return false;
  // Rohvideo nicht anfassen, solange daraus noch überarbeitet wird
  if (!v.source && childrenOf(v).some((k) => ['queued', 'running'].includes(k.revise?.state))) return false;
  // geschnittene Videos erst umbenennen, wenn Claudes Vorschlag (Titel) da ist oder du den Titel geändert hast
  if (v.folder === 'geschnitten' && !(v.ai?.state === 'done' || v.editedAt)) return false;
  const want = desired(v);
  if (!want || want === v.file) return false;
  // nur der Zähler „(2)“ unterscheidet sich → nichts tun
  if (want.replace(/ \(\d+\)(?=\.[^.]+$)/, '') === v.file.replace(/ \(\d+\)(?=\.[^.]+$)/, '')) return false;
  const from = v.file;
  try { lib.relocate(v, v.folder, want); }
  catch (e) { console.error('Ordnen', v.file, e.message); return false; }
  c.log.unshift({ id: v.id, at: new Date().toISOString(), folder: v.folder, from, to: v.file });
  c.log = c.log.slice(0, 300);
  return true;
}

let running = false;
export function organizeAll({ force = false } = {}) {
  if (running) return 0;
  running = true;
  let n = 0;
  try { for (const v of vids()) if (organizeOne(v, { force })) n++; }
  finally { running = false; }
  if (n) saveNow();
  return n;
}
let soonTimer = null;
export function soon() { clearTimeout(soonTimer); soonTimer = setTimeout(() => organizeAll(), 5000); }

// letzte Verschiebung rückgängig (und das Video künftig nicht mehr automatisch anfassen)
export function undo(index) {
  const c = cfg();
  const e = c.log[index];
  if (!e) throw new Error('Eintrag nicht gefunden.');
  const v = db().videos[e.id];
  if (!v || v.missing) throw new Error('Video nicht mehr vorhanden.');
  if (busy(v)) throw new Error('Video wird gerade bearbeitet oder hochgeladen.');
  if (v.folder !== e.folder) throw new Error('Video liegt inzwischen in einem anderen Ordner.');
  lib.relocate(v, v.folder, e.from);
  v.orgLock = true;   // von Hand zurückgeholt → nicht wieder automatisch umbenennen
  c.log.splice(index, 1);
  saveNow();
  return v;
}

// Speicherplatz je Ordner + freier Platz auf dem Laufwerk
export function storage() {
  const by = {};
  for (const v of vids()) if (!v.missing) by[v.folder] = (by[v.folder] || 0) + (v.size || 0);
  let free = null, total = null;
  try { const s = fs.statfsSync(lib.VIDEO_DIR); free = s.bavail * s.bsize; total = s.blocks * s.bsize; } catch { /* nicht verfügbar */ }
  return { folders: by, free, total };
}

// Rohvideos, die weg können: geschnitten, alles daraus hochgeladen/gepostet/aussortiert, älter als rawDays
export function cleanupCandidates() {
  const days = cfg().rawDays || 30;
  const out = [];
  for (const r of vids()) {
    if (r.folder !== 'rohvideos' || r.missing || r.source || busy(r)) continue;
    const at = Date.parse(r.cut?.at || r.createdAt) || 0;
    const age = (Date.now() - at) / 86400_000;
    if (age < days) continue;
    const kids = childrenOf(r);
    if (!kids.length) continue;
    const open = kids.filter((k) => !(k.folder === 'hochgeladen' || k.folder === 'papierkorb' || k.li?.posted));
    if (open.length) continue;
    out.push({ id: r.id, file: r.file, size: r.size || 0, age: Math.round(age), kids: kids.length, topic: topicOf(r) });
  }
  return out.sort((a, b) => b.size - a.size);
}
export function cleanup(ids) {
  let n = 0, bytes = 0;
  const ok = new Set(cleanupCandidates().map((x) => x.id));
  for (const id of ids || []) {
    const r = db().videos[id];
    if (!r || !ok.has(id)) continue;
    const from = r.folder;
    lib.moveVideo(r, 'papierkorb');
    r.trash = { from, at: new Date().toISOString(), reason: 'Aufräumen (alles daraus ist hochgeladen)' };
    n++; bytes += r.size || 0;
  }
  saveNow();
  return { moved: n, bytes };
}

export function status() {
  const c = cfg();
  return { enabled: c.enabled, rename: c.rename, folders: c.folders, rawDays: c.rawDays, log: c.log.slice(0, 30),
    pending: vids().filter((v) => { try { const w = ['rohvideos', 'hochgeladen', 'geschnitten'].includes(v.folder) && !v.missing && !v.orgLock ? desired(v) : null; return w && w !== v.file; } catch { return false; } }).length };
}
export function configure(b) {
  const c = cfg();
  for (const k of ['enabled', 'rename', 'folders']) if (typeof b[k] === 'boolean') c[k] = b[k];
  if (b.rawDays != null && !isNaN(b.rawDays)) c.rawDays = Math.max(1, Math.min(365, Math.round(Number(b.rawDays))));
  save();
  return status();
}

export function init() {
  cfg();
  setTimeout(() => organizeAll(), 90_000);
  setInterval(() => organizeAll(), 3600_000).unref();
}

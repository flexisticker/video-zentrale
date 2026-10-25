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
import * as ai from './ai.js';

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
  if (v.orgTopic) return clean(v.orgTopic, 40);          // von Hand bzw. nachträglich erkannt
  const r = v.source?.rawId ? rawOf(v) : null;
  if (r?.orgTopic) return clean(r.orgTopic, 40);          // Thema der Aufnahme gilt für alle Videos daraus
  if (v.ai?.game) return clean(v.ai.game, 40);
  if (r?.ai?.game) return clean(r.ai.game, 40);
  const kids = v.source ? [] : childrenOf(v);
  const count = {};
  for (const k of kids) { const g = k.orgTopic || k.ai?.game; if (g) { const t = clean(g, 40); count[t] = (count[t] || 0) + 1; } }
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
  if (!k && v.height && v.width && v.height > v.width) return profiles.isPro(profiles.effective(v)) ? 'LinkedIn-Clip' : 'Short';
  return '';
}

// gewünschter Name + Unterordner (oder null, wenn noch nicht genug bekannt ist)
export function desired(v, { now = false } = {}) {
  const c = cfg();
  const ext = path.extname(v.file).toLowerCase();
  const d = dateOf(v);
  const topic = topicOf(v);
  // Rohvideo = Aufnahme im Ordner rohvideos; ältere, von Hand geschnittene Videos (ohne Schnitt-Herkunft) sind fertige Videos
  const isRaw = !v.source && v.folder === 'rohvideos';
  // Alter nach Dateizeit (ältere Bestände sofort, frische Aufnahmen/Schnitte warten auf Claudes Thema)
  const ageDays = (Date.now() - Math.min(v.mtime || Infinity, Date.parse(v.createdAt) || Infinity, Date.now())) / 86400_000;
  // ohne Thema noch warten (Claude-Vorschlag kommt meist kurz nach dem Schnitt), nach 2 Tagen trotzdem ordnen
  if (!topic && ageDays < 2 && !now) return null;
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

// schon richtig (auch wenn nur der Zähler „(2)“ abweicht)?
const noCounter = (f) => f.replace(/ \(\d+\)(?=\.[^.]+$)/, '');
const samePlace = (want, file) => !want || want === file || noCounter(want) === noCounter(file);

// ein Video an seinen Platz bringen → true wenn verschoben/umbenannt
export function organizeOne(v, { force = false, now = false } = {}) {
  const c = cfg();
  if (!c.enabled && !force) return false;
  if (v.missing || busy(v) || v.orgLock || !['rohvideos', 'hochgeladen', 'geschnitten'].includes(v.folder)) return false;
  // Rohvideo nicht anfassen, solange daraus noch überarbeitet wird
  if (!v.source && childrenOf(v).some((k) => ['queued', 'running'].includes(k.revise?.state))) return false;
  // geschnittene Videos erst umbenennen, wenn Claudes Vorschlag (Titel) da ist oder du den Titel geändert hast
  if (v.folder === 'geschnitten' && !(v.ai?.state === 'done' || v.editedAt)) return false;
  const want = desired(v, { now });
  if (samePlace(want, v.file)) return false;
  const from = v.file;
  try { lib.relocate(v, v.folder, want); }
  catch (e) { console.error('Ordnen', v.file, e.message); return false; }
  c.log.unshift({ id: v.id, at: new Date().toISOString(), folder: v.folder, from, to: v.file });
  c.log = c.log.slice(0, 300);
  return true;
}

let running = false;
export function organizeAll({ force = false, now = false } = {}) {
  if (running) return 0;
  running = true;
  let n = 0;
  try { for (const v of vids()) if (organizeOne(v, { force, now })) n++; }
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

// Vorschau „Bestand umstellen“: was passiert mit jedem Video (ohne etwas zu verschieben)
const ORG_FOLDERS = ['rohvideos', 'hochgeladen', 'geschnitten'];
export function plan() {
  const moves = [], skipped = [], noTopic = [];
  for (const v of vids()) {
    if (v.missing || !ORG_FOLDERS.includes(v.folder)) continue;
    const why = busy(v) ? 'wird gerade bearbeitet oder hochgeladen'
      : v.orgLock ? 'von dir zurückgeholt (bleibt, wo es ist)'
      : v.folder === 'geschnitten' && !(v.ai?.state === 'done' || v.editedAt) ? 'wartet auf den KI-Vorschlag' : '';
    if (!topicOf(v)) noTopic.push(v.id);
    if (why) { skipped.push({ id: v.id, folder: v.folder, file: v.file, why }); continue; }
    let want = null;
    try { want = desired(v, { now: true }); } catch { /* egal */ }
    if (samePlace(want, v.file)) continue;
    moves.push({ id: v.id, folder: v.folder, from: v.file, to: want, topic: topicOf(v) });
  }
  return { moves, skipped, noTopic: noTopic.length, topics: topicJob };
}

// Themen für Videos ohne Thema per Claude bestimmen (läuft im Hintergrund, Stand in topicJob)
let topicJob = null;
export function detectTopics() {
  if (topicJob?.state === 'running') return topicJob;
  // Rohvideos mit Kindern bekommen ihr Thema über die Kinder → nur die Videos fragen, die selbst keins haben
  const list = vids().filter((v) => !v.missing && ORG_FOLDERS.includes(v.folder) && !topicOf(v));
  topicJob = { state: 'running', done: 0, total: list.length, found: 0, at: new Date().toISOString() };
  if (!list.length) { topicJob.state = 'done'; return topicJob; }
  ai.detectTopics(list, (d, t) => { topicJob.done = d; topicJob.total = t; })
    .then(({ topics, cost }) => {
      for (const [id, t] of Object.entries(topics)) { const v = db().videos[id]; if (v && !topicOf(v)) { v.orgTopic = t; v.orgTopicBy = 'Claude'; } }
      topicJob = { ...topicJob, state: 'done', done: topicJob.total, found: Object.keys(topics).length, cost: Math.round(cost * 100) / 100 };
      saveNow();
    })
    .catch((e) => { topicJob = { ...topicJob, state: 'error', error: e.message }; });
  return topicJob;
}

// Thema von Hand setzen (bei einer Aufnahme gilt es für alles daraus)
export function setTopic(v, topic) {
  const t = clean(topic, 40);
  if (t) { v.orgTopic = t; v.orgTopicBy = 'Hand'; } else { delete v.orgTopic; delete v.orgTopicBy; }
  saveNow();
  soon();
  return t;
}

// Bestand umstellen: alles an den neuen Platz, auch Videos ohne Thema (→ „Sonstiges“/„Aufnahme“)
export function convert() {
  const before = cfg().log.length;
  const n = organizeAll({ force: true, now: true });
  return { moved: n, logged: cfg().log.length - before };
}

export function status() {
  const c = cfg();
  return { enabled: c.enabled, rename: c.rename, folders: c.folders, rawDays: c.rawDays, log: c.log.slice(0, 30),
    pending: vids().filter((v) => { try { return ORG_FOLDERS.includes(v.folder) && !v.missing && !v.orgLock && !busy(v) && !(v.folder === 'geschnitten' && !(v.ai?.state === 'done' || v.editedAt)) && !samePlace(desired(v), v.file); } catch { return false; } }).length };
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

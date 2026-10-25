// Rechenhelfer: ein PC im Heimnetz (z. B. mit RTX 3070) übernimmt rechenintensive Aufgaben, solange er läuft.
// Bisher: Spracherkennung (Whisper, großes Modell). Der PC holt sich Aufträge über /api/helper/* (eigener Schlüssel,
// keine Anmeldung nötig), lädt den Ton (WAV 16 kHz) und schickt das Whisper-Ergebnis (JSON) zurück.
// Ist kein Helfer online oder dauert es zu lange, rechnet der Server wie bisher selbst.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, save, saveNow, DATA_DIR } from './store.js';

const OUT_DIR = path.join(DATA_DIR, 'helper-out');   // Dateien, die der Helfer zurückschickt (z. B. Stimme aus Demucs)

const cfg = () => db().helper;
const ONLINE_MS = 90_000;          // so lange gilt der Helfer nach dem letzten Lebenszeichen als online
const jobs = new Map();            // id -> { id, kind, wav, model, state: 'open'|'taken', takenAt, resolve, reject, timer }
const waiters = [];                // offene Long-Poll-Anfragen des Helfers

export function status() {
  const c = cfg();
  return { enabled: !!c.enabled, token: c.token || '', model: c.model, online: online(), lastSeen: c.lastSeen || '', name: c.name || '',
    gpu: c.gpu || '', version: c.version || '', status: c.status || '', paused: !!c.paused, pauseGaming: c.pauseGaming !== false,
    ...releaseStatus(), caps: c.caps || ['whisper'], analyse: c.analyse !== false, waitPc: c.waitPc !== false, waitHours: c.waitHours || 12,
    ocrWords: (c.ocrWords || []).join(', '), gpuLoad: c.gpuLoad || 25, games: (c.games || []).join(', '), seen: !!(c.lastSeen && Date.now() - new Date(c.lastSeen).getTime() < ONLINE_MS), done: c.done || 0, failed: c.failed || 0, lastError: c.lastError || '',
    open: [...jobs.values()].map((j) => ({ id: j.id, state: j.state, kind: j.kind, label: j.label, createdAt: j.createdAt, takenAt: j.takenAt || 0 })) };
}

export function configure(b) {
  const c = cfg();
  if (typeof b.enabled === 'boolean') c.enabled = b.enabled;
  if (['large-v3-turbo', 'large-v3', 'medium', 'small'].includes(b.model)) c.model = b.model;
  if (typeof b.pauseGaming === 'boolean') c.pauseGaming = b.pauseGaming;
  if (['manual', 'auto', 'night'].includes(b.mode)) c.mode = b.mode;
  if (typeof b.analyse === 'boolean') c.analyse = b.analyse;
  if (typeof b.waitPc === 'boolean') c.waitPc = b.waitPc;
  if (b.waitHours != null && !isNaN(b.waitHours)) c.waitHours = Math.max(1, Math.min(72, Math.round(Number(b.waitHours))));
  if (typeof b.ocrWords === 'string') c.ocrWords = b.ocrWords.split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 80);
  const t = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x || '');
  if (t(b.nightFrom)) c.nightFrom = b.nightFrom;
  if (t(b.nightTo)) c.nightTo = b.nightTo;
  if (b.gpuLoad != null && !isNaN(b.gpuLoad)) c.gpuLoad = Math.max(5, Math.min(95, Math.round(Number(b.gpuLoad))));
  if (typeof b.games === 'string') c.games = b.games.split(/[,\n]/).map((x) => x.trim().replace(/\.exe$/i, '')).filter(Boolean).slice(0, 50);
  if (b.newToken || (c.enabled && !c.token)) c.token = crypto.randomBytes(24).toString('base64url');
  saveNow();
}

// Helfer lädt gerade whisper.cpp/Modell oder hat einen Startfehler → noch nicht bereit für Aufträge
const preparing = (st) => /^(lädt|startet|Fehler|Modell |whisper\.cpp )/.test(String(st || ''));
// online = Lebenszeichen, nicht pausiert (z. B. weil gerade gezockt wird) und nicht mehr beim Vorbereiten
export const online = () => { const c = cfg(); return !!(c.enabled && released() && !c.paused && !preparing(c.status) && c.lastSeen && Date.now() - new Date(c.lastSeen).getTime() < ONLINE_MS); };

// ---------- Grafikkarte freigeben ----------
// mode: 'manual' = nur nach Freigabe (Knopf in der Zentrale oder Verknüpfung auf dem PC-Desktop), 'auto' = immer wenn frei (wie bis 1.27),
// 'night' = im Nachtfenster automatisch + nach Freigabe. Startest du trotz Freigabe OBS/ein Spiel, endet die Freigabe.
const mins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function inNight(c, d = new Date()) {
  const now = d.getHours() * 60 + d.getMinutes(), a = mins(c.nightFrom || '02:00'), b = mins(c.nightTo || '07:00');
  return a <= b ? now >= a && now < b : now >= a || now < b;
}
export function released() {
  const c = cfg();
  const mode = c.mode || 'manual';
  if (mode === 'auto') return true;
  if (c.releaseUntil && Date.parse(c.releaseUntil) > Date.now()) return true;
  return mode === 'night' && inNight(c);
}
// hours: Zahl (Stunden), 'morning' (bis 8 Uhr), 'stop' (bis gestoppt = 7 Tage), 0 = sperren
export function release(hours, by = 'Zentrale') {
  const c = cfg();
  let until = 0;
  if (hours === 'morning') { const d = new Date(); d.setHours(8, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); until = d.getTime(); }
  else if (hours === 'stop') until = Date.now() + 7 * 86400_000;
  else if (Number(hours) > 0) until = Date.now() + Math.min(72, Number(hours)) * 3600_000;
  c.releaseUntil = until ? new Date(until).toISOString() : '';
  c.releaseBy = by; c.releaseAt = new Date().toISOString(); c.releaseEnded = '';
  saveNow();
  return releaseStatus();
}
export function releaseStatus() {
  const c = cfg();
  return { mode: c.mode || 'manual', released: released(), until: c.releaseUntil && Date.parse(c.releaseUntil) > Date.now() ? c.releaseUntil : '',
    by: c.releaseBy || '', ended: c.releaseEnded || '', nightFrom: c.nightFrom || '02:00', nightTo: c.nightTo || '07:00' };
}

export function checkToken(req) {
  const t = String(req.headers['x-helper-token'] || '');
  const c = cfg();
  if (!c.enabled || !c.token || t.length !== c.token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(c.token));
}

export function hello(b = {}) {
  const c = cfg();
  c.lastSeen = new Date().toISOString();
  if (b.name) c.name = String(b.name).slice(0, 80);
  if (b.gpu != null) c.gpu = String(b.gpu).slice(0, 120);
  if (b.version) c.version = String(b.version).slice(0, 20);
  if (b.status) c.status = String(b.status).slice(0, 200);
  if (Array.isArray(b.caps)) c.caps = b.caps.map(String).filter((x) => /^[a-z]{2,20}$/.test(x)).slice(0, 10);
  if (typeof b.paused === 'boolean') {
    // Zocken/OBS trotz Freigabe → Freigabe endet (sonst rechnet der PC nach dem Spiel ungefragt weiter)
    if (b.paused && !c.paused && c.releaseUntil && Date.parse(c.releaseUntil) > Date.now()) { c.releaseUntil = ''; c.releaseEnded = new Date().toISOString() + ' – ' + (b.status || 'Spiel/OBS erkannt'); }
    c.paused = b.paused;
  }
  save();
  const L = db().llm || {};
  return { model: c.model, analyse: c.analyse !== false, ocrLang: 'de,en', llm: { enabled: !!L.pc?.enabled, model: L.pc?.model || '' }, ...releaseStatus(), gaming: { enabled: c.pauseGaming !== false, gpuLoad: c.gpuLoad || 25, games: c.games || [] } };
}

// Auftrag an den Helfer geben → Promise mit dem Whisper-JSON. Bricht ab (reject), wenn der Helfer verschwindet.
export function transcribe(wav, { timeoutMs, label = '' }) {
  const id = crypto.randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const job = { id, kind: 'whisper', wav, files: { audio: wav }, out: {}, label, createdAt: Date.now(), model: cfg().model || 'large-v3', state: 'open', resolve, reject };
    job.timer = setTimeout(() => finish(job, new Error('Rechenhelfer hat nicht rechtzeitig geantwortet.')), timeoutMs);
    // Nicht abgeholt innerhalb von 2 Minuten → Server rechnet selbst
    job.pickup = setTimeout(() => { if (job.state === 'open') finish(job, new Error('Rechenhelfer hat den Auftrag nicht abgeholt.')); }, 120_000);
    jobs.set(id, job);
    const i = waiters.findIndex((w) => w.caps.includes('whisper'));
    if (i >= 0) waiters.splice(i, 1)[0](job);
  });
}

function finish(job, err, result) {
  if (!jobs.has(job.id)) return;
  clearTimeout(job.timer); clearTimeout(job.pickup);
  jobs.delete(job.id);
  const c = cfg();
  if (err) { c.failed = (c.failed || 0) + 1; c.lastError = err.message; job.reject(err); }
  else { c.done = (c.done || 0) + 1; c.lastError = ''; job.resolve(result); }
  save();
}

// Kann der Helfer diese Art Auftrag? (alte Helfer melden keine caps → nur Whisper)
export const can = (kind) => { const c = cfg(); return kind === 'whisper' || (c.caps || []).includes(kind); };
export const canNow = (kind) => online() && can(kind);

// Allgemeiner Auftrag (ab Helfer 1.5): files = { name: Pfad } zum Abholen, params = Einstellungen.
// → Promise { json, files: { name: Pfad auf dem Server } } – Ergebnisdateien lädt der Helfer über /upload/<name> hoch.
export function submit(kind, { files = {}, params = {}, label = '', timeoutMs = 3600_000, pickupMs = 120_000 } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const job = { id, kind, files, params, label, createdAt: Date.now(), model: cfg().model || 'large-v3', state: 'open', resolve, reject, out: {} };
    job.timer = setTimeout(() => finish(job, new Error('Rechenhelfer hat nicht rechtzeitig geantwortet.')), timeoutMs);
    job.pickup = setTimeout(() => { if (job.state === 'open') finish(job, new Error('Rechenhelfer hat den Auftrag nicht abgeholt.')); }, pickupMs);
    jobs.set(id, job);
    const i = waiters.findIndex((w) => w.caps.includes(kind));
    if (i >= 0) waiters.splice(i, 1)[0](job);
  });
}
export function filePath(id, name) { const j = jobOf(id); const f = j?.files?.[name] || (name === 'audio' ? j?.wav : null); return f && fs.existsSync(f) ? f : null; }
// Ergebnisdatei vom Helfer: Speicherort für den Upload (nur einfache Namen)
export function uploadPath(id, name) {
  const j = jobOf(id);
  if (!j || !/^[\w.-]{1,60}$/.test(name)) return null;
  const dir = path.join(OUT_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  j.out[name] = path.join(dir, name);
  return j.out[name];
}
export function cleanupOut(id) { fs.rmSync(path.join(OUT_DIR, id), { recursive: true, force: true }); }

// Long-Poll: wartet bis zu 25 s auf einen Auftrag. caps = was der Helfer kann (Standard nur Whisper)
export function next(caps = ['whisper']) {
  cfg().lastSeen = new Date().toISOString();
  const open = [...jobs.values()].find((j) => j.state === 'open' && caps.includes(j.kind));
  const take = (j) => { j.state = 'taken'; j.takenAt = Date.now(); return { id: j.id, kind: j.kind, model: j.model, lang: 'de', params: j.params || {}, files: Object.keys(j.files || {}) }; };
  if (open) return Promise.resolve(take(open));
  return new Promise((resolve) => {
    const w = (j) => { clearTimeout(t); resolve(take(j)); };
    w.caps = caps;
    const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(null); }, 25_000);
    waiters.push(w);
  });
}

export const jobOf = (id) => jobs.get(String(id || '')) || null;
export function audioPath(id) { const j = jobOf(id); return j && fs.existsSync(j.wav) ? j.wav : null; }
export function result(id, data) {
  const j = jobOf(id);
  if (!j) return false;
  if (j.kind !== 'whisper') { finish(j, null, { json: data || {}, files: { ...j.out } }); return true; }
  if (!data || !Array.isArray(data.transcription)) { finish(j, new Error('Ergebnis des Rechenhelfers unlesbar.')); return true; }
  finish(j, null, data);
  return true;
}
export function fail(id, message) { const j = jobOf(id); if (j) finish(j, new Error('Rechenhelfer: ' + String(message || 'Fehler').slice(0, 300))); return !!j; }

// Rechenhelfer: ein PC im Heimnetz (z. B. mit RTX 3070) übernimmt rechenintensive Aufgaben, solange er läuft.
// Bisher: Spracherkennung (Whisper, großes Modell). Der PC holt sich Aufträge über /api/helper/* (eigener Schlüssel,
// keine Anmeldung nötig), lädt den Ton (WAV 16 kHz) und schickt das Whisper-Ergebnis (JSON) zurück.
// Ist kein Helfer online oder dauert es zu lange, rechnet der Server wie bisher selbst.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, save, saveNow } from './store.js';

const cfg = () => db().helper;
const ONLINE_MS = 90_000;          // so lange gilt der Helfer nach dem letzten Lebenszeichen als online
const jobs = new Map();            // id -> { id, kind, wav, model, state: 'open'|'taken', takenAt, resolve, reject, timer }
const waiters = [];                // offene Long-Poll-Anfragen des Helfers

export function status() {
  const c = cfg();
  return { enabled: !!c.enabled, token: c.token || '', model: c.model, online: online(), lastSeen: c.lastSeen || '', name: c.name || '',
    gpu: c.gpu || '', version: c.version || '', done: c.done || 0, failed: c.failed || 0, lastError: c.lastError || '',
    open: [...jobs.values()].map((j) => ({ id: j.id, state: j.state, kind: j.kind })) };
}

export function configure(b) {
  const c = cfg();
  if (typeof b.enabled === 'boolean') c.enabled = b.enabled;
  if (['large-v3-turbo', 'large-v3', 'medium', 'small'].includes(b.model)) c.model = b.model;
  if (b.newToken || (c.enabled && !c.token)) c.token = crypto.randomBytes(24).toString('base64url');
  saveNow();
}

export const online = () => { const c = cfg(); return !!(c.enabled && c.lastSeen && Date.now() - new Date(c.lastSeen).getTime() < ONLINE_MS); };

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
  save();
}

// Auftrag an den Helfer geben → Promise mit dem Whisper-JSON. Bricht ab (reject), wenn der Helfer verschwindet.
export function transcribe(wav, { timeoutMs }) {
  const id = crypto.randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const job = { id, kind: 'whisper', wav, model: cfg().model || 'large-v3-turbo', state: 'open', resolve, reject };
    job.timer = setTimeout(() => finish(job, new Error('Rechenhelfer hat nicht rechtzeitig geantwortet.')), timeoutMs);
    // Nicht abgeholt innerhalb von 2 Minuten → Server rechnet selbst
    job.pickup = setTimeout(() => { if (job.state === 'open') finish(job, new Error('Rechenhelfer hat den Auftrag nicht abgeholt.')); }, 120_000);
    jobs.set(id, job);
    const w = waiters.shift();
    if (w) w(job);
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

// Long-Poll: wartet bis zu 25 s auf einen Auftrag
export function next() {
  hello();
  const open = [...jobs.values()].find((j) => j.state === 'open');
  const take = (j) => { j.state = 'taken'; j.takenAt = Date.now(); return { id: j.id, kind: j.kind, model: j.model, lang: 'de' }; };
  if (open) return Promise.resolve(take(open));
  return new Promise((resolve) => {
    const w = (j) => { clearTimeout(t); resolve(take(j)); };
    const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(null); }, 25_000);
    waiters.push(w);
  });
}

export const jobOf = (id) => jobs.get(String(id || '')) || null;
export function audioPath(id) { const j = jobOf(id); return j && fs.existsSync(j.wav) ? j.wav : null; }
export function result(id, data) {
  const j = jobOf(id);
  if (!j) return false;
  if (!data || !Array.isArray(data.transcription)) { finish(j, new Error('Ergebnis des Rechenhelfers unlesbar.')); return true; }
  finish(j, null, data);
  return true;
}
export function fail(id, message) { const j = jobOf(id); if (j) finish(j, new Error('Rechenhelfer: ' + String(message || 'Fehler').slice(0, 300))); return !!j; }

// Sprache → Text mit whisper.cpp (läuft lokal im Container, kostet nichts). Modell wird beim ersten Bedarf geladen.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, save, DATA_DIR } from './store.js';
import * as helper from './helper.js';

const BIN = process.env.WHISPER_BIN || 'whisper-cli';
// Variante mit NVIDIA-CUDA (eigener Build im Image); CUDA-Bibliotheken liegen daneben, der Treiber kommt vom Host.
const BIN_GPU = process.env.WHISPER_BIN_GPU || '/usr/local/bin/whisper-cli-cuda';
const GPU_LIBS = process.env.WHISPER_GPU_LIBS || '/usr/local/lib/whisper-cuda';
let gpuState = { tried: false, ok: false, error: '' };
const MODEL_URL = process.env.WHISPER_MODEL_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{m}.bin';
const DIR = path.join(DATA_DIR, 'whisper');
const TMP = path.join(DATA_DIR, 'tmp');
export const MODELS = { base: '≈ 140 MB, schnell, einfache Qualität', small: '≈ 470 MB, gute Qualität (empfohlen)',
  medium: '≈ 1,5 GB, sehr gut, deutlich langsamer' };

const cfg = () => db().cut.whisper;
const modelFile = (m) => path.join(DIR, `ggml-${m}.bin`);
let download = null; // { model, done, total, error }

export function status() {
  const c = cfg();
  return { enabled: c.enabled, model: c.model, threads: c.threads, models: MODELS, useGpu: c.gpu !== false, lastEngine, helperOnline: helper.online(),
    gpu: { available: fs.existsSync(BIN_GPU), ...gpuState },
    installed: Object.keys(MODELS).filter((m) => fs.existsSync(modelFile(m))),
    download: download && { ...download } };
}

async function ensureModel(m) {
  const file = modelFile(m);
  if (fs.existsSync(file)) return file;
  if (download?.model === m && !download.error) { while (download && !download.error && !fs.existsSync(file)) await new Promise((r) => setTimeout(r, 2000)); }
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(DIR, { recursive: true });
  download = { model: m, done: 0, total: 0, error: '' };
  const part = file + '.part';
  try {
    const r = await fetch(MODEL_URL.replace('{m}', m));
    if (!r.ok || !r.body) throw new Error('Download fehlgeschlagen (' + r.status + ')');
    download.total = Number(r.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(part);
    for await (const chunk of r.body) {
      download.done += chunk.length;
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    fs.renameSync(part, file);
    download = null;
    return file;
  } catch (e) {
    fs.rmSync(part, { force: true });
    download = { ...download, error: 'Whisper-Modell konnte nicht geladen werden: ' + e.message };
    throw new Error(download.error);
  }
}

function run(cmd, args, onLine, env) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('nice', ['-n', '15', cmd, ...args], { stdio: ['ignore', 'ignore', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
    p.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-4000); if (onLine) for (const l of s.split(/\r?\n/)) onLine(l); });
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

// Nur eine Erkennung gleichzeitig (CPU).
let chain = Promise.resolve();

// → Wörter [{ s, e, t }] (Sekunden, Text) – ein Eintrag je Wort (für Untertitel)
export function transcribe(videoFile, key, onProgress = () => {}) {
  const job = chain.then(() => doTranscribe(videoFile, key, onProgress));
  chain = job.catch(() => {});
  return job;
}

async function doTranscribe(videoFile, key, onProgress) {
  const c = cfg();
  const model = await ensureModel(c.model || 'small');
  fs.mkdirSync(TMP, { recursive: true });
  const wav = path.join(TMP, key + '.wav'), base = path.join(TMP, key);
  try {
    const a = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoFile, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    if (a.code !== 0 || !fs.existsSync(wav)) return []; // keine Tonspur
    // -ml 1 -sow: ein Segment je Wort → Zeitmarken pro Wort
    const args = ['-m', model, '-f', wav, '-l', 'de', '-ml', '1', '-sow', '-oj', '-of', base, '-pp'];
    let eng = 'Zentrale';
    const prog = (l) => { const m = /progress\s*=\s*(\d+)%/.exec(l); if (m) onProgress(Number(m[1]), eng); };
    // Rechenhelfer-PC online? Dann rechnet der (großes Modell, starke Grafikkarte). Klappt das nicht, rechnet der Server.
    if (helper.online()) {
      const secs = fs.statSync(wav).size / 32000;
      try {
        onProgress(1, 'Rechenhelfer ' + (db().helper.name || 'PC'));
        const j = await helper.transcribe(wav, { timeoutMs: Math.max(10 * 60_000, secs * 1000), label: key });
        lastEngine = 'Rechenhelfer (' + (db().helper.name || 'PC') + ')';
        return toWords(j);
      } catch (e) { console.error('Rechenhelfer:', e.message, '– rechne selbst.'); }
    }
    let r = null;
    // Grafikkarte zuerst (wenn eingebaut, erlaubt und nicht schon gescheitert)
    if (c.gpu !== false && fs.existsSync(BIN_GPU) && !(gpuState.tried && !gpuState.ok)) {
      eng = 'Zentrale, Grafikkarte'; onProgress(0, eng);
      r = await run(BIN_GPU, [...args, '-t', '2'], prog, { LD_LIBRARY_PATH: GPU_LIBS + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') });
      const failed = r.code !== 0;
      gpuState = { tried: true, ok: !failed, error: failed ? (r.err.split('\n').find((l) => /cuda|libcuda|CUDA|device|GPU/i.test(l)) || r.err.trim().split('\n').pop() || '').slice(0, 200) : '' };
      if (failed) { console.error('Whisper auf Grafikkarte gescheitert, nehme Prozessor:', gpuState.error); r = null; }
    }
    if (!r) { eng = 'Zentrale, Prozessor'; onProgress(0, eng); r = await run(BIN, [...args, '-t', String(c.threads || 4)], prog); }
    if (r.code !== 0) throw new Error('Whisper-Fehler: ' + (r.err.trim().split('\n').pop() || r.code));
    lastEngine = gpuState.ok && gpuState.tried ? 'Server-Grafikkarte' : 'Server-Prozessor';
    return toWords(JSON.parse(fs.readFileSync(base + '.json', 'utf8')));
  } finally {
    fs.rmSync(wav, { force: true });
    fs.rmSync(base + '.json', { force: true });
  }
}

let lastEngine = '';
const toWords = (j) => (j.transcription || []).map((x) => ({ s: (x.offsets?.from || 0) / 1000, e: (x.offsets?.to || 0) / 1000, t: String(x.text || '').trim() }))
  .filter((x) => x.t && !/^\[.*\]$|^\(.*\)$/.test(x.t)); // [Musik], (Lachen) o. Ä. weglassen

// Wörter zu Sätzen/Zeilen gruppieren (Anzeige, Text für Claude)
// Satzgrenzen: Satzzeichen von Whisper oder deutliche Sprechpause. Lange Monologe ohne Punkt (beim Zocken häufig)
// werden an der größten Pause geteilt – nicht stur nach n Wörtern, sonst landet ein Schnitt mitten im Satz.
export function sentences(words) {
  const out = []; let cur = null;
  for (const w of words || []) {
    if (cur && (w.s - cur.e >= 0.7 || /[.!?…]["“”»]?$/.test(cur.ws[cur.ws.length - 1].t))) { out.push(cur); cur = null; }
    if (!cur) cur = { ws: [] };
    cur.ws.push(w); cur.e = w.e;
  }
  if (cur) out.push(cur);
  const split = (ws) => {
    const len = ws[ws.length - 1].e - ws[0].s;
    if (ws.length <= 30 && len <= 15) return [ws];
    let best = -1, gap = -1;
    for (let i = 3; i < ws.length - 3; i++) {
      const g = ws[i].s - ws[i - 1].e + (/[,;:]$/.test(ws[i - 1].t) ? 0.25 : 0);   // Komma = guter Trennpunkt
      if (g > gap) { gap = g; best = i; }
    }
    if (best < 0) return [ws];
    return [...split(ws.slice(0, best)), ...split(ws.slice(best))];
  };
  return out.flatMap((x) => split(x.ws)).map((ws) => ({ s: ws[0].s, e: ws[ws.length - 1].e, t: ws.map((w) => w.t).join(' ').replace(/\s+([.,!?;:…])/g, '$1') }));
}

// Text eines Zeitraums (für Shorts) bzw. alles.
export const textOf = (segs, from = 0, to = Infinity) =>
  segs.filter((x) => x.e > from && x.s < to).map((x) => x.t).join(' ').replace(/\s+/g, ' ').trim();

export const fmtTime = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};

// Transkripte liegen als Datei, nicht im Speicher (können lang werden).
const TDIR = path.join(DATA_DIR, 'transkripte');
export function saveTranscript(v, words) {
  fs.mkdirSync(TDIR, { recursive: true });
  fs.writeFileSync(path.join(TDIR, v.id + '.json'), JSON.stringify({ words }));
  v.transcriptAt = new Date().toISOString();
  v.transcriptText = textOf(words).slice(0, 20000);
  save();
}
export function loadWords(v) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(TDIR, v.id + '.json'), 'utf8'));
    return Array.isArray(j) ? j : j.words; // 1.3.0 speicherte Sätze als Liste
  } catch { return null; }
}
// Sätze mit Zeitmarken (für Anzeige und Claude)
export function loadTranscript(v) {
  const w = loadWords(v);
  return w ? sentences(w) : null;
}

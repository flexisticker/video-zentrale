// Automatischer Schnitt: neue Rohaufnahmen aus "eingang" → Langfassung + Shorts in "geschnitten", Original → "rohvideos".
// Schritte: Lautstärke/Bildwechsel messen → Sprache erkennen (Whisper) → Highlights wählen (Claude, sonst lauteste Stellen)
// → schneiden (ffmpeg, niedrige Priorität). Alles läuft nacheinander, damit der Server nicht ausgelastet wird.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as lib from './library.js';
import * as whisper from './whisper.js';
import * as ai from './ai.js';
import * as gpu from './gpu.js';
import { buildAss } from './captions.js';
import { fileURLToPath } from 'node:url';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

const TMP = path.join(DATA_DIR, 'tmp');
const cfg = () => db().cut;

export function status() { return { ...cfg(), whisper: whisper.status(), gpu: gpu.status(), running: running ? { id: running } : null, queued: queue.length }; }

export function configure(b) {
  const c = cfg();
  const num = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x)));
  if (typeof b.auto === 'boolean') c.auto = b.auto;
  if (typeof b.longVersion === 'boolean') c.longVersion = b.longVersion;
  if (typeof b.cutPauses === 'boolean') c.cutPauses = b.cutPauses;
  if (b.silenceDb != null && !isNaN(b.silenceDb)) c.silenceDb = num(b.silenceDb, -70, -20);
  if (b.minPause != null && !isNaN(b.minPause)) c.minPause = num(b.minPause, 5, 600);
  if (b.shorts != null && !isNaN(b.shorts)) c.shorts = Math.round(num(b.shorts, 0, 5));
  if (b.shortMin != null && !isNaN(b.shortMin)) c.shortMin = Math.round(num(b.shortMin, 10, 170));
  if (b.shortMax != null && !isNaN(b.shortMax)) c.shortMax = Math.round(num(b.shortMax, c.shortMin, 180));
  if (typeof b.moveRaw === 'boolean') c.moveRaw = b.moveRaw;
  if (b.captions) {
    if (typeof b.captions.enabled === 'boolean') c.captions.enabled = b.captions.enabled;
    if (/^#[0-9a-f]{6}$/i.test(b.captions.color || '')) c.captions.color = b.captions.color;
  }
  if (b.facecam) {
    const f = b.facecam, ok = (x) => typeof x === 'number' && x >= 0 && x <= 1;
    if (typeof f.enabled === 'boolean') c.facecam.enabled = f.enabled;
    if (ok(f.x) && ok(f.y) && ok(f.w) && ok(f.h) && f.x + f.w <= 1.001 && f.y + f.h <= 1.001) Object.assign(c.facecam, { x: f.x, y: f.y, w: f.w, h: f.h });
  }
  const w = b.whisper || {};
  if (typeof w.enabled === 'boolean') c.whisper.enabled = w.enabled;
  if (whisper.MODELS[w.model]) c.whisper.model = w.model;
  if (w.threads != null && !isNaN(w.threads)) c.whisper.threads = Math.round(num(w.threads, 1, 32));
  saveNow();
  autoQueue();
}

// ---------- Hilfen ----------
function ffmpeg(args, onLine) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('nice', ['-n', '15', 'ffmpeg', '-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (d) => { const s = d.toString(); err = (err + s).slice(-6000); if (onLine) for (const l of s.split(/\r?\n/)) onLine(l); };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}
const lastError = (r) => r.err.trim().split('\n').filter((l) => !/^\s*(frame=|size=|out_time|progress=|speed=|bitrate=|total_size|dup_frames|drop_frames|stream_)/.test(l)).slice(-2).join(' ');

function progressFrom(total, cb) {
  return (l) => { const m = /out_time_(?:ms|us)=(\d+)/.exec(l); if (m && total > 0) cb(Math.min(100, Number(m[1]) / 1e6 / total * 100)); };
}

// Lautheit (LUFS, „momentary“) je Sekunde.
async function loudness(file, duration) {
  const per = new Map();
  // framelog=verbose schreibt die Werte nur bei Protokollstufe „verbose“
  const r = await ffmpeg(['-nostats', '-loglevel', 'verbose', '-i', file, '-map', '0:a:0', '-vn', '-filter:a', 'ebur128=framelog=verbose', '-f', 'null', '-'], (l) => {
    const m = /\bt:\s*([\d.]+)\s+TARGET.*?\bM:\s*(-?[\d.]+|-inf)/.exec(l);
    if (!m) return;
    const sec = Math.floor(Number(m[1])), val = m[2] === '-inf' ? -70 : Math.max(-70, Number(m[2]));
    const a = per.get(sec) || [0, 0]; a[0] += val; a[1]++; per.set(sec, a);
  });
  const n = Math.max(1, Math.ceil(duration || 0));
  const out = new Array(n).fill(-70);
  for (const [s, [sum, c]] of per) if (s < n) out[s] = sum / c;
  return { values: out, hasAudio: r.code === 0 && per.size > 0 };
}

// Bildwechsel (nur Keyframes ansehen → schnell).
async function sceneChanges(file) {
  const times = [];
  await ffmpeg(['-nostats', '-skip_frame', 'nokey', '-i', file, '-map', '0:v:0', '-an', '-vf', "scale=160:-2,select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], (l) => {
    const m = /pts_time:([\d.]+)/.exec(l);
    if (m) times.push(Number(m[1]));
  });
  return times;
}

const percentile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? -70; };

// Ruhige Abschnitte (Menü, Pause, Laden) → zu entfernende Bereiche [a, b].
function pauses(loud, c) {
  const out = []; let start = -1;
  for (let i = 0; i <= loud.length; i++) {
    const quiet = i < loud.length && loud[i] < c.silenceDb;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) { if (i - start >= c.minPause) out.push([start + 2, i - 2]); start = -1; }
  }
  return out.filter(([a, b]) => b - a >= 3);
}

function keepRanges(duration, cut) {
  const keep = []; let pos = 0;
  for (const [a, b] of cut) { if (a > pos) keep.push([pos, a]); pos = b; }
  if (pos < duration) keep.push([pos, duration]);
  return keep.filter(([a, b]) => b - a > 0.5);
}

// Kandidaten für Shorts: Fenster mit hoher Aktivität (laut + Bildwechsel), sich nicht überlappend.
function candidates(loud, scenes, duration, cut, len) {
  if (duration < len + 5) return duration >= 10 ? [{ start: 0, end: duration, score: 0, peak: Math.max(...loud) }] : [];
  const med = percentile(loud, 0.5), hi = percentile(loud, 0.95);
  const spread = Math.max(3, hi - med);
  const score = loud.map((v) => Math.max(-1, Math.min(2, (v - med) / spread)));
  for (const t of scenes) { const i = Math.floor(t); if (i < score.length) score[i] += 0.6; }
  for (const [a, b] of cut) for (let i = Math.floor(a); i < Math.min(b, score.length); i++) score[i] = -2;
  const win = [];
  let sum = score.slice(0, len).reduce((x, y) => x + y, 0);
  for (let s = 0; s + len <= score.length; s++) {
    if (s > 0) sum += score[s + len - 1] - score[s - 1];
    win.push({ start: s, sum });
  }
  win.sort((a, b) => b.sum - a.sum);
  const picked = [];
  for (const w of win) {
    if (picked.length >= 12) break;
    if (picked.some((p) => Math.abs(p.start - w.start) < len)) continue;
    picked.push(w);
  }
  return picked.map((w) => ({ start: w.start, end: w.start + len, score: Math.round(w.sum * 10) / 10,
    peak: Math.round(Math.max(...loud.slice(w.start, w.start + len)) * 10) / 10,
    scenes: scenes.filter((t) => t >= w.start && t < w.start + len).length }));
}

function concatList(file, ranges) {
  const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  return ranges.map(([a, b]) => `file ${q(file)}\ninpoint ${a.toFixed(3)}\noutpoint ${b.toFixed(3)}`).join('\n') + '\n';
}

const LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11';

async function renderLong(v, file, keep, hasAudio, out, onP) {
  const total = keep.reduce((s, [a, b]) => s + b - a, 0);
  const audio = hasAudio ? ['-map', '0:a:0', '-af', LOUDNORM, '-c:a', 'aac', '-b:a', '192k'] : [];
  let args;
  if (keep.length === 1 && keep[0][0] === 0) {
    args = ['-i', file, '-map', '0:v:0', ...audio, '-c:v', 'copy'];
  } else {
    // Schnitte ohne Neukodieren des Bildes: setzt an Keyframes an (± 1–2 s), dafür schnell.
    const list = path.join(TMP, v.id + '-schnitt.txt');
    fs.writeFileSync(list, concatList(file, keep));
    args = ['-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', ...audio, '-c:v', 'copy'];
  }
  const r = await ffmpeg([...args, '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out], progressFrom(total, onP));
  fs.rmSync(path.join(TMP, v.id + '-schnitt.txt'), { force: true });
  if (r.code !== 0) throw new Error('Langfassung: ' + lastError(r));
}

// Short im Hochformat: Bildmitte oder Facecam oben + Spiel unten, animierte Untertitel, Grafikkarte wenn vorhanden.
async function renderShort(v, file, s, hasAudio, out, onP, words) {
  const c = cfg();
  const vertical = v.height > v.width;
  const fc = c.facecam;
  const useCam = !vertical && fc?.enabled && fc.w > 0.02 && fc.h > 0.02;
  const n = (x) => Number(x).toFixed(4);
  let graph;
  if (vertical) graph = '[0:v]scale=1080:-2,setsar=1[base]';
  else if (useCam) {
    graph = `[0:v]split[a][b];[a]crop=iw*${n(fc.w)}:ih*${n(fc.h)}:iw*${n(fc.x)}:ih*${n(fc.y)},scale=1080:704:force_original_aspect_ratio=increase,crop=1080:704[top];`
      + '[b]scale=-2:1216,crop=1080:1216[bot];[top][bot]vstack,setsar=1[base]';
  } else graph = '[0:v]crop=trunc(ih*9/16/2)*2:ih,scale=1080:1920,setsar=1[base]';
  let ass = '';
  const clipWords = (words || []).filter((w) => w.s >= s.start && w.e <= s.end).map((w) => ({ s: w.s - s.start, e: w.e - s.start, t: w.t }));
  if (c.captions?.enabled && clipWords.length) {
    ass = path.join(TMP, `${v.id}-s${Math.round(s.start)}.ass`);
    fs.writeFileSync(ass, buildAss(clipWords, { color: c.captions.color, posY: useCam ? 0.74 : 0.7 }));
    graph += `;[base]ass=${ass}:fontsdir=${FONTS},fps=30[v]`;
  } else graph += ';[base]fps=30[v]';
  const audio = hasAudio ? ['-map', '0:a:0', '-af', LOUDNORM, '-c:a', 'aac', '-b:a', '160k'] : [];
  const r = await gpu.encodeWithFallback((venc) => ffmpeg(['-ss', s.start.toFixed(2), '-i', file, '-t', (s.end - s.start).toFixed(2),
    '-filter_complex', graph, '-map', '[v]', ...audio, ...venc,
    '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out], progressFrom(s.end - s.start, onP)));
  if (ass) fs.rmSync(ass, { force: true });
  if (r.code !== 0) throw new Error('Short: ' + lastError(r));
}

// fertige Datei unter freiem Namen in "geschnitten" ablegen und als Video eintragen
function publish(tmp, name, fields) {
  const target = lib.freeName('geschnitten', name);
  fs.renameSync(tmp, path.join(lib.dirOf('geschnitten'), target));
  const st = fs.statSync(path.join(lib.dirOf('geschnitten'), target));
  const nv = lib.newVideo('geschnitten', target);
  Object.assign(nv, { size: st.size, mtime: st.mtimeMs }, fields);
  return nv;
}

// ---------- Ablauf ----------
async function runCut(v) {
  const c = cfg();
  const file = lib.fileOf(v);
  const step = (s, progress = 0) => { v.cut = { ...v.cut, state: 'running', step: s, progress: Math.round(progress) }; save(); };
  fs.mkdirSync(TMP, { recursive: true });
  const duration = v.duration || 0;
  if (!duration) throw new Error('Länge des Videos unbekannt (Datei beschädigt?).');

  step('Lautstärke messen');
  const { values: loud, hasAudio } = await loudness(file, duration);
  step('Bildwechsel suchen');
  const scenes = await sceneChanges(file);

  let words = whisper.loadWords(v);
  let segs = words ? whisper.sentences(words) : null;
  if (!segs && c.whisper.enabled) {
    step('Sprache erkennen (Whisper)');
    try {
      words = await whisper.transcribe(file, v.id, (p) => step('Sprache erkennen (Whisper)', p));
      whisper.saveTranscript(v, words); segs = whisper.sentences(words);
    } catch (e) { v.cut.warning = e.message; segs = null; words = null; }
  }

  let cut = c.cutPauses && hasAudio ? pauses(loud, c) : [];
  const removedAll = cut.reduce((s, [a, b]) => s + b - a, 0);
  if (c.cutPauses && !hasAudio) v.cut.warning = 'Keine Tonspur erkannt – nichts gekürzt.';
  if (removedAll > duration * 0.5) {
    // Sicherung: lieber nichts kürzen als das halbe Video wegwerfen (Schwelle passt dann nicht zur Aufnahme)
    v.cut.warning = `Über die Hälfte wäre als „ruhig“ entfernt worden (${whisper.fmtTime(removedAll)}) – nichts gekürzt. Schwelle in den Einstellungen prüfen.`;
    cut = [];
  }
  const keep = keepRanges(duration, cut);
  const len = Math.round((c.shortMin + c.shortMax) / 2);
  const cands = c.shorts > 0 ? candidates(loud, scenes, duration, cut, len) : [];

  let shorts = [];
  if (cands.length) {
    step('Highlights auswählen');
    if (db().ai.apiKey) {
      try { shorts = await ai.chooseHighlights(v, cands, segs, c); }
      catch (e) { v.cut.warning = 'Claude-Auswahl: ' + e.message + ' – lauteste Stellen genommen.'; }
    }
    if (!shorts.length) shorts = cands.slice(0, c.shorts).map((x) => ({ ...x, title: '', reason: 'laute/bewegte Stelle' }));
  }

  const base = path.basename(v.file, path.extname(v.file));
  const jobs = (c.longVersion ? 1 : 0) + shorts.length;
  let done = 0;
  const outputs = [];
  const sourceNote = (a, b) => `Aus „${v.file}“${a != null ? ` (${whisper.fmtTime(a)}–${whisper.fmtTime(b)})` : ''}.`;

  if (c.longVersion) {
    step('Langfassung schneiden', 0);
    const tmp = path.join(TMP, v.id + '-lang.mp4');
    await renderLong(v, file, keep, hasAudio, tmp, (p) => step('Langfassung schneiden', (done + p / 100) / jobs * 100));
    const removed = Math.round(cut.reduce((s, [a, b]) => s + b - a, 0));
    const nv = publish(tmp, `${base} – Langfassung.mp4`, {
      source: { rawId: v.id, rawFile: v.file, kind: 'long', removed },
      note: sourceNote() + (removed ? ` ${whisper.fmtTime(removed)} ruhige Abschnitte entfernt.` : ''),
      transcriptText: segs ? whisper.textOf(segs).slice(0, 20000) : '',
    });
    outputs.push(nv.id); done++;
  }
  for (let i = 0; i < shorts.length; i++) {
    const s = shorts[i];
    step(`Short ${i + 1} von ${shorts.length} schneiden`);
    const tmp = path.join(TMP, `${v.id}-short${i + 1}.mp4`);
    await renderShort(v, file, s, hasAudio, tmp, (p) => step(`Short ${i + 1} von ${shorts.length} schneiden`, (done + p / 100) / jobs * 100), words);
    const nv = publish(tmp, `${base} – Short ${i + 1}.mp4`, {
      source: { rawId: v.id, rawFile: v.file, kind: 'short', start: s.start, end: s.end },
      title: s.title ? s.title.slice(0, 100) : `${base} – Short ${i + 1}`,
      note: sourceNote(s.start, s.end) + (s.reason ? ' Warum: ' + s.reason : ''),
      transcriptText: segs ? whisper.textOf(segs, s.start, s.end) : '',
    });
    outputs.push(nv.id); done++;
  }

  v.cut = { ...v.cut, state: 'done', step: '', progress: 100, at: new Date().toISOString(), outputs,
    removed: Math.round(cut.reduce((s, [a, b]) => s + b - a, 0)), shorts: shorts.length };
  saveNow();
  if (c.moveRaw) lib.moveVideo(v, 'rohvideos');
}

// ---------- Warteschlange ----------
const queue = [];
let running = null;

export function enqueue(v, { force = false } = {}) {
  if (v.missing) throw new Error('Videodatei nicht gefunden.');
  if (['queued', 'running'].includes(v.cut?.state)) return;
  if (v.cut?.state === 'done' && !force) return;
  v.cut = { state: 'queued', step: '', progress: 0, at: new Date().toISOString() };
  queue.push(v.id);
  save();
  next();
}

async function next() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = id;
  const v = db().videos[id];
  try {
    if (v && !v.missing) await runCut(v);
  } catch (e) {
    console.error('Schnitt', v?.file, e);
    if (v) { v.cut = { ...v.cut, state: 'error', error: e.message, step: '' }; saveNow(); }
  } finally {
    for (const f of fs.existsSync(TMP) ? fs.readdirSync(TMP) : []) if (f.startsWith(id + '-')) fs.rmSync(path.join(TMP, f), { force: true });
    running = null;
    afterRun?.();
    next();
  }
}

let afterRun = null;
export function onDone(fn) { afterRun = fn; }

// neue Rohaufnahmen automatisch schneiden (jede nur einmal)
export function autoQueue() {
  if (!cfg().auto) return;
  for (const v of Object.values(db().videos)) {
    if (v.folder === 'eingang' && !v.missing && v.duration != null && v.duration > 0 && !v.cut) enqueue(v);
  }
}

export function init() {
  gpu.check().then((g) => console.log('Grafikkarte:', g.nvenc ? 'NVENC aktiv' : 'nicht genutzt (' + g.error + ')'));
  for (const v of Object.values(db().videos)) {
    if (['queued', 'running'].includes(v.cut?.state)) { v.cut = { ...v.cut, state: 'queued' }; queue.push(v.id); }
  }
  setTimeout(next, 5000);
}

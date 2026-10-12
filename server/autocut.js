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
import * as music from './music.js';
import * as profiles from './profiles.js';
import { buildAss, buildCalmAss, buildHookAss, buildFxAss } from './captions.js';
import * as fx from './cutfx.js';
import * as sfx from './sfx.js';
import * as thumbs from './thumbs.js';
import { fileURLToPath } from 'node:url';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

const TMP = path.join(DATA_DIR, 'tmp');
const cfg = () => db().cut;

export function status() {
  return { ...cfg(), whisper: whisper.status(), gpu: gpu.status(), running: running ? { id: running } : null, queued: queue.length,
    windowOpen: inWindow() };
}

export function configure(b) {
  const c = cfg();
  const num = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x)));
  if (typeof b.auto === 'boolean') c.auto = b.auto;
  if (typeof b.longVersion === 'boolean') c.longVersion = b.longVersion;
  if (typeof b.cutPauses === 'boolean') c.cutPauses = b.cutPauses;
  if (b.silenceDb != null && !isNaN(b.silenceDb)) c.silenceDb = num(b.silenceDb, -70, -20);
  if (b.minPause != null && !isNaN(b.minPause)) c.minPause = num(b.minPause, 5, 600);
  if (b.shorts != null && !isNaN(b.shorts)) c.shorts = Math.round(num(b.shorts, 0, 10));
  if (b.shortMin != null && !isNaN(b.shortMin)) c.shortMin = Math.round(num(b.shortMin, 10, 170));
  if (b.shortMax != null && !isNaN(b.shortMax)) c.shortMax = Math.round(num(b.shortMax, c.shortMin, 180));
  if (typeof b.moveRaw === 'boolean') c.moveRaw = b.moveRaw;
  if (typeof b.longCopy === 'boolean') c.longCopy = b.longCopy;
  if (typeof b.hookText === 'boolean') c.hookText = b.hookText;
  if (b.summary != null && !isNaN(b.summary)) c.summary = Math.round(num(b.summary, 0, 1800));
  if (b.window) {
    const t = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x || '');
    if (typeof b.window.enabled === 'boolean') c.window.enabled = b.window.enabled;
    if (t(b.window.from)) c.window.from = b.window.from;
    if (t(b.window.to)) c.window.to = b.window.to;
  }
  if (typeof (b.whisper || {}).gpu === 'boolean') c.whisper.gpu = b.whisper.gpu;
  if (b.captions) {
    if (typeof b.captions.enabled === 'boolean') c.captions.enabled = b.captions.enabled;
    if (/^#[0-9a-f]{6}$/i.test(b.captions.color || '')) c.captions.color = b.captions.color;
  }
  if (b.linkedin) {
    if (['4:5', '1:1', '16:9'].includes(b.linkedin.format)) c.linkedin.format = b.linkedin.format;
    if (typeof b.linkedin.captions === 'boolean') c.linkedin.captions = b.linkedin.captions;
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
async function loudness(file, duration, range = null) {
  const per = new Map(), fine = [];
  const off = range ? range.from : 0;
  const seek = range ? ['-ss', range.from.toFixed(2), '-t', range.span.toFixed(2)] : [];
  // framelog=verbose schreibt die Werte nur bei Protokollstufe „verbose“ (alle 0,1 s)
  const r = await ffmpeg(['-nostats', '-loglevel', 'verbose', ...seek, '-i', file, '-map', '0:a:0', '-vn', '-filter:a', 'ebur128=framelog=verbose', '-f', 'null', '-'], (l) => {
    const m = /\bt:\s*([\d.]+)\s+TARGET.*?\bM:\s*(-?[\d.]+|-inf)/.exec(l);
    if (!m) return;
    const t = Number(m[1]) + off, val = m[2] === '-inf' ? -70 : Math.max(-70, Number(m[2]));
    const sec = Math.floor(t);
    const a = per.get(sec) || [0, 0]; a[0] += val; a[1]++; per.set(sec, a);
    fine[Math.floor(t * 10)] = val;   // Zehntelsekunden (für Tempo-Schnitte)
  });
  const n = Math.max(1, Math.ceil(duration || 0));
  const out = new Array(n).fill(-70);
  for (const [s, [sum, c]] of per) if (s < n) out[s] = sum / c;
  for (let i = 0; i < fine.length; i++) if (fine[i] === undefined) fine[i] = -70;
  return { values: out, fine, hasAudio: r.code === 0 && per.size > 0 };
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
function candidates(loud, scenes, duration, cut, len, max = 12) {
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
    if (picked.length >= max) break;
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

// Bildrate der Quelle (für gleichmäßige Ausgabe); OBS nimmt oft mit variabler Rate auf
function probeFps(file) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,r_frame_rate', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(30));
    p.on('close', () => {
      const rates = out.trim().split(/[\s,]+/).map((x) => { const [a, b] = x.split('/').map(Number); return b ? a / b : a; }).filter((x) => x > 1 && x < 241);
      const f = rates[0] || 30;
      const std = [24, 25, 30, 48, 50, 60].reduce((best, x) => (Math.abs(x - f) < Math.abs(best - f) ? x : best), 30);
      resolve(Math.min(60, Math.abs(std - f) < 1.5 ? std : Math.round(f)));
    });
  });
}

// teaser = { at, len, text }: Höhepunkt vorweg (aus der Überarbeitung), danach die Langfassung
async function renderLong(v, file, keep, hasAudio, out, onP, track, teaser = null) {
  const main = keep.reduce((s, [a, b]) => s + b - a, 0);
  const total = main + (teaser ? teaser.len : 0);
  const mInput = track ? ['-stream_loop', '-1', '-i', track.file] : [];
  const whole = keep.length === 1 && keep[0][0] === 0;
  // Schnell ohne Neukodieren nur, wenn nichts geschnitten wird oder ausdrücklich gewünscht (setzt an Keyframes an → kann ruckeln)
  if (!teaser && (whole || cfg().longCopy)) {
    const audio = track ? ['-filter_complex', music.mixGraph({ hasVoice: hasAudio, dur: total, track }), '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(2)]
      : hasAudio ? ['-map', '0:a:0', '-af', LOUDNORM, '-c:a', 'aac', '-b:a', '192k'] : [];
    let args;
    if (whole) args = ['-i', file, ...mInput, '-map', '0:v:0', ...audio, '-c:v', 'copy'];
    else {
      const list = path.join(TMP, v.id + '-schnitt.txt');
      fs.writeFileSync(list, concatList(file, keep));
      args = ['-f', 'concat', '-safe', '0', '-i', list, ...mInput, '-map', '0:v:0', ...audio, '-c:v', 'copy'];
    }
    const r = await ffmpeg([...args, '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out], progressFrom(total, onP));
    fs.rmSync(path.join(TMP, v.id + '-schnitt.txt'), { force: true });
    if (r.code !== 0) throw new Error('Langfassung: ' + lastError(r));
    return;
  }
  // Bildgenau und flüssig: gleichmäßige Bildrate, behaltene Abschnitte auswählen, Zeitstempel neu, Grafikkarte wenn möglich
  const fps = await probeFps(file);
  const expr = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
  let g = `[0:v]fps=${fps},select='${expr}',setpts=N/(${fps}*TB)` + (teaser ? ',setsar=1[mv]' : '[v]');
  if (hasAudio) g += `;[0:a:0]aselect='${expr}',asetpts=N/SR/TB` + (teaser ? ',aformat=sample_rates=48000:channel_layouts=stereo[ma]' : '[va]');
  const tInput = [];
  if (teaser) {
    // Teaser als eigene Eingabe (gleiche Datei, nur die paar Sekunden) → vor die Langfassung setzen
    const ti = track ? 2 : 1;
    tInput.push('-ss', teaser.at.toFixed(3), '-t', teaser.len.toFixed(3), '-i', file);
    g += `;[${ti}:v]fps=${fps},setpts=PTS-STARTPTS,setsar=1[tv]`;
    if (hasAudio) g += `;[${ti}:a:0]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=${Math.max(0, teaser.len - 0.15).toFixed(2)}:d=0.15[ta]`;
    g += `;[tv]${hasAudio ? '[ta]' : ''}[mv]${hasAudio ? '[ma]' : ''}concat=n=2:v=1:a=${hasAudio ? 1 : 0}[cv0]` + (hasAudio ? '[va]' : '');
    const hookAss = teaser.text && v.width ? buildHookAss(teaser.text, { until: Math.min(teaser.len, 4), width: v.width, height: v.height }) : '';
    if (hookAss) {
      const f = path.join(TMP, v.id + '-teaser.ass');
      fs.writeFileSync(f, hookAss);
      g += `;[cv0]ass=${f}:fontsdir=${FONTS}[v]`;
    } else g += ';[cv0]null[v]';
  }
  if (track) g += ';' + music.mixGraph({ hasVoice: hasAudio, dur: total, track, voiceIn: 'va' });
  else if (hasAudio) g += `;[va]${LOUDNORM},aresample=48000[aout]`;
  const script = path.join(TMP, v.id + '-lang.filter');
  fs.writeFileSync(script, g);
  const audioMap = track || hasAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : [];
  const r = await gpu.encodeWithFallback((venc) => ffmpeg(['-i', file, ...mInput, ...tInput, '-filter_complex_script', script, '-map', '[v]', ...audioMap, ...venc,
    '-t', total.toFixed(2), '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out], progressFrom(total, onP)));
  fs.rmSync(script, { force: true });
  fs.rmSync(path.join(TMP, v.id + '-teaser.ass'), { force: true });
  if (r.code !== 0) throw new Error('Langfassung: ' + lastError(r));
}

// Effekte eines Shorts vorbereiten: Freeze/Zeitlupe/Zoom in die Abschnitte, Sounds und Sticker besorgen
async function prepareFx(s, profile, warn) {
  const level = s.fxLevel || ai.fxLevelOf(profile);
  const r = fx.applyFx(s.parts, s.fx, { level, start: s.start, end: s.end, stickers: ai.fxStickers(profile) });
  s.parts = r.parts; s.events = r.events; s.fxLevel = level;
  for (const e of s.events) {
    if (e.sound || e.soundIdea) {
      e.soundFile = (e.sound && await sfx.get(e.sound)) || (e.soundIdea ? await sfx.custom(e.soundIdea, 1.2) : null)
        || (e.sound && !sfx.LIBRARY[e.sound] ? await sfx.custom(e.sound.replace(/[-_]/g, ' '), 1) : null);
    }
    if (e.kind === 'sticker') {
      try { e.stickerFile = await thumbs.makeSticker(e.sticker, profile?.id); } catch (x) { warn('Sticker: ' + x.message); }
    }
  }
  const missing = s.events.filter((e) => (e.sound || e.soundIdea) && !e.soundFile).length;
  if (missing && !db().fal?.key) warn('Soundeffekte brauchen den fal.ai-Schlüssel (oder eigene Sounds in musik/sfx).');
  return fx.describeFx(s.events);
}

// Short im Hochformat: Bildmitte oder Facecam oben + Spiel unten, animierte Untertitel, Grafikkarte wenn vorhanden.
// s.parts = Abschnitte der Quelle (Hook-Vorschau, Zurückspulen, Tempo-Schnitte – siehe cutfx.js); ohne parts am Stück.
async function renderShort(v, file, s, hasAudio, out, onP, words, track, pro = false) {
  const c = cfg();
  const vertical = v.height > v.width;
  const fc = c.facecam;
  const useCam = !pro && !vertical && fc?.enabled && fc.w > 0.02 && fc.h > 0.02;
  const n = (x) => Number(x).toFixed(4);
  const parts = s.parts?.length ? s.parts : [{ a: s.start, b: s.end }];
  const total = fx.totalLen(parts);
  const base = Math.max(0, Math.min(...parts.map((p) => p.a)) - 0.5);
  const span = Math.max(...parts.map((p) => p.b)) - base + 0.5;
  // LinkedIn: 4:5 (1080 × 1350), 1:1 (1080 × 1080) oder 16:9 (1920 × 1080, nur aus Querformat)
  const fmt = pro ? (c.linkedin?.format === '16:9' && vertical ? '4:5' : c.linkedin?.format || '4:5') : '';
  const [W, H] = fmt === '1:1' ? [1080, 1080] : fmt === '4:5' ? [1080, 1350] : fmt === '16:9' ? [1920, 1080] : [1080, 1920];
  const even = (x) => Math.max(2, Math.round((x || 0) / 2) * 2);
  let graph = fx.concatGraph(parts, { base, hasAudio, W0: v.width ? even(v.width) : 0, H0: v.height ? even(v.height) : 0 }) + ';';
  if (pro) graph += `[cv]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[base]`;
  else if (vertical) graph += '[cv]scale=1080:-2,setsar=1[base]';
  else if (useCam) {
    graph += `[cv]split[a][b];[a]crop=iw*${n(fc.w)}:ih*${n(fc.h)}:iw*${n(fc.x)}:ih*${n(fc.y)},scale=1080:704:force_original_aspect_ratio=increase,crop=1080:704[top];`
      + '[b]scale=-2:1216,crop=1080:1216[bot];[top][bot]vstack,setsar=1[base]';
  } else graph += '[cv]crop=trunc(ih*9/16/2)*2:ih,scale=1080:1920,setsar=1[base]';
  const tmpFiles = [];
  let last = 'base';
  const clipWords = fx.mapWords(words, parts);
  if ((pro ? c.linkedin?.captions !== false : c.captions?.enabled) && clipWords.length) {
    const ass = path.join(TMP, `${v.id}-s${Math.round(s.start)}.ass`);
    fs.writeFileSync(ass, pro ? buildCalmAss(clipWords, { width: W, height: H })
      : buildAss(clipWords, { color: c.captions.color, posY: useCam ? 0.74 : 0.7 }));
    tmpFiles.push(ass);
    graph += `;[${last}]ass=${ass}:fontsdir=${FONTS}[cap]`; last = 'cap';
  }
  const hookAss = s.hook?.text && c.hookText !== false ? buildHookAss(s.hook.text, { until: fx.hookTextUntil(parts, s.hook), width: W, height: H, pro, color: c.captions?.color }) : '';
  if (hookAss) {
    const f = path.join(TMP, `${v.id}-h${Math.round(s.start)}.ass`);
    fs.writeFileSync(f, hookAss); tmpFiles.push(f);
    graph += `;[${last}]ass=${f}:fontsdir=${FONTS}[hk]`; last = 'hk';
  }
  // Effekte (Emojis, Blitz, Wackeln, Texte, Sticker, Sounds) – Zeiten schon im fertigen Short (cutfx.applyFx)
  const fxIn = [];
  const firstFx = track ? 2 : 1;
  const events = s.events || [];
  const shakes = events.filter((e) => e.kind === 'shake');
  if (shakes.length) {
    const wob = (k) => shakes.map((e) => `if(between(t,${e.t.toFixed(2)},${(e.t + 0.45).toFixed(2)}),24*${k}(t*75)*(1-(t-${e.t.toFixed(2)})/0.45),0)`).join('+');
    graph += `;[${last}]crop=w=iw-56:h=ih-56:x='28+${wob('sin')}':y='28+${wob('cos')}',scale=${W}:${H},setsar=1[shk]`; last = 'shk';
  }
  const texts = events.filter((e) => e.text && ['freeze', 'replay', 'text'].includes(e.kind)).map((e) => ({ t: e.t, dur: Math.min(1.5, e.dur || 1.1), text: e.text }));
  const fxAss = buildFxAss(texts, { width: W, height: H, color: c.captions?.color });
  if (fxAss) {
    const f = path.join(TMP, `${v.id}-fx${Math.round(s.start)}.ass`);
    fs.writeFileSync(f, fxAss); tmpFiles.push(f);
    graph += `;[${last}]ass=${f}:fontsdir=${FONTS}[fxt]`; last = 'fxt';
  }
  let k = 0;
  for (const e of events) {
    if (e.kind === 'flash') {
      graph += `;color=c=white:s=${W}x${H}:r=30:d=0.35,format=rgba,fade=t=out:st=0:d=0.35:alpha=1,setpts=PTS-STARTPTS+${e.t.toFixed(3)}/TB[fl${k}]`
        + `;[${last}][fl${k}]overlay=enable='between(t,${e.t.toFixed(3)},${(e.t + 0.35).toFixed(3)})':eof_action=pass[o${k}]`;
      last = 'o' + k++; continue;
    }
    const img = e.kind === 'emoji' ? fx.emojiFile(e.emoji) : e.kind === 'sticker' ? e.stickerFile : null;
    if (!img) continue;
    const D = e.dur || (e.kind === 'sticker' ? 1.6 : 1.4);
    const S = Math.round(W * (e.big ? 0.36 : e.kind === 'sticker' ? 0.46 : 0.26) / 2) * 2;
    const [px, py] = fx.POSITIONS[e.pos] || fx.POSITIONS.mitte;
    const idx = firstFx + fxIn.length;
    fxIn.push({ img, D });
    graph += `;[${idx}:v]format=rgba,scale=256:256:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,`
      + `zoompan=z='if(lt(on,5),1+on*0.25,if(lt(on,10),2.25-(on-5)*0.05,2))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${S}x${S}:fps=30,format=rgba,`
      + `rotate=a='0.16*sin(t*14)*exp(-t*3)':c=0x00000000,fade=t=out:st=${Math.max(0.2, D - 0.3).toFixed(2)}:d=0.3:alpha=1,setpts=PTS-STARTPTS+${e.t.toFixed(3)}/TB[em${k}]`
      + `;[${last}][em${k}]overlay=x=${Math.round(W * px)}-overlay_w/2:y=${Math.round(H * py)}-overlay_h/2:enable='between(t,${e.t.toFixed(3)},${(e.t + D).toFixed(3)})':eof_action=pass[o${k}]`;
    last = 'o' + k++;
  }
  graph += `;[${last}]fps=30[v]`;
  let audio = [];
  let aMain = '';
  if (track) {
    graph += ';' + music.mixGraph({ hasVoice: hasAudio, dur: total, track, voiceIn: 'ca' });
    aMain = 'aout';
  } else if (hasAudio) {
    graph += `;[ca]${LOUDNORM},aresample=48000[aout]`;
    aMain = 'aout';
  }
  // Sounds dazumischen (feste Lautstärke je Effekt-Stufe; Sounds sind auf −16 LUFS normalisiert)
  const sounds = events.filter((e) => e.soundFile);
  const sIn = [];
  if (sounds.length) {
    const vol = fx.FX_LEVELS[s.fxLevel]?.vol || 0.6;
    if (!aMain) { graph += `;aevalsrc=0|0:s=48000:d=${total.toFixed(3)}[aout]`; aMain = 'aout'; }
    graph += `;[${aMain}]anull[amain]`;
    const labels = ['[amain]'];
    sounds.forEach((e, i) => {
      const idx = firstFx + fxIn.length + i;
      sIn.push(e.soundFile);
      const ms = Math.round(e.t * 1000);
      graph += `;[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},adelay=${ms}|${ms}[sx${i}]`;
      labels.push(`[sx${i}]`);
    });
    graph += `;${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0,alimiter=limit=0.95[afx]`;
    aMain = 'afx';
  }
  if (aMain) audio = ['-map', `[${aMain}]`, '-c:a', 'aac', '-b:a', '160k'];
  const mInput = track ? ['-stream_loop', '-1', '-i', track.file] : [];
  const extraIn = [...fxIn.flatMap((x) => ['-loop', '1', '-framerate', '30', '-t', x.D.toFixed(2), '-i', x.img]), ...sIn.flatMap((f) => ['-i', f])];
  const script = path.join(TMP, `${v.id}-s${Math.round(s.start)}.filter`);
  fs.writeFileSync(script, graph); tmpFiles.push(script);
  const r = await gpu.encodeWithFallback((venc) => ffmpeg(['-ss', base.toFixed(3), '-t', span.toFixed(3), '-i', file, ...mInput, ...extraIn,
    '-filter_complex_script', script, '-map', '[v]', ...audio, ...venc, '-t', total.toFixed(3),
    '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out], progressFrom(total, onP)));
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
  if (r.code !== 0) throw new Error('Short: ' + lastError(r));
  return total;
}

const SEG = 15; // Länge der Bausteine einer Kurzfassung (Sekunden)

// Was soll geschnitten werden? Vorgaben aus den Einstellungen, je Video überschreibbar (v.cutPlan)
export function planOf(v) {
  const c = cfg();
  const profile = profiles.effective(v);
  const p = v.cutPlan || {};
  return {
    long: typeof p.long === 'boolean' ? p.long : c.longVersion,
    shorts: Number.isFinite(p.shorts) ? Math.max(0, Math.min(10, p.shorts)) : (Number.isFinite(profile?.shorts) ? profile.shorts : c.shorts),
    summary: Number.isFinite(p.summary) ? Math.max(0, Math.min(1800, p.summary)) : (c.summary || 0),
    wish: String(p.wish || '').slice(0, 500),
  };
}
export function setPlan(v, b = {}) {
  const p = {};
  if (typeof b.long === 'boolean') p.long = b.long;
  if (b.shorts != null && !isNaN(b.shorts)) p.shorts = Math.round(Number(b.shorts));
  if (b.summary != null && !isNaN(b.summary)) p.summary = Math.round(Number(b.summary));
  if (typeof b.wish === 'string') p.wish = b.wish.trim().slice(0, 500);
  v.cutPlan = p;
  save();
  return planOf(v);
}

// Kurzfassung: Stellen hintereinander, neu kodiert (Ton je Stelle kurz ein-/ausgeblendet gegen Knackser)
async function renderSummary(v, file, reel, hasAudio, out, onP, track, teaserText = '', teaserLen = 0) {
  const total = reel.reduce((x, r) => x + r.end - r.start, 0);
  let g = '';
  reel.forEach((r, i) => {
    const d = (r.end - r.start).toFixed(3);
    g += `[0:v]trim=${r.start.toFixed(3)}:${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
    if (hasAudio) g += `[0:a:0]atrim=${r.start.toFixed(3)}:${r.end.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, d - 0.15)}:d=0.15[a${i}];`;
  });
  g += reel.map((_, i) => `[v${i}]` + (hasAudio ? `[a${i}]` : '')).join('') + `concat=n=${reel.length}:v=1:a=${hasAudio ? 1 : 0}[cv${teaserText ? '0' : ''}]` + (hasAudio ? '[ca]' : '');
  const assFile = path.join(TMP, v.id + '-kurz-teaser.ass');
  if (teaserText) {
    fs.writeFileSync(assFile, buildHookAss(teaserText, { until: Math.min(4, teaserLen || 4), width: v.width || 1920, height: v.height || 1080 }));
    g += `;[cv0]ass=${assFile}:fontsdir=${FONTS}[cv]`;
  }
  let audio = [];
  if (track) { g += ';' + music.mixGraph({ hasVoice: hasAudio, dur: total, voiceIn: 'ca', track }); audio = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']; }
  else if (hasAudio) { g += `;[ca]${LOUDNORM},aresample=48000[aout]`; audio = ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']; }
  const mInput = track ? ['-stream_loop', '-1', '-i', track.file] : [];
  const r = await gpu.encodeWithFallback((venc) => ffmpeg(['-i', file, ...mInput, '-filter_complex', g, '-map', '[cv]', ...audio, ...venc,
    '-t', total.toFixed(2), '-movflags', '+faststart', '-progress', 'pipe:1', '-y', out], progressFrom(total, onP)));
  fs.rmSync(assFile, { force: true });
  if (r.code !== 0) throw new Error('Kurzfassung: ' + lastError(r));
}

// fertige Datei unter freiem Namen in "geschnitten" ablegen und als Video eintragen
function publish(tmp, name, fields, raw) {
  const target = lib.freeName('geschnitten', name);
  lib.moveFile(tmp, path.join(lib.dirOf('geschnitten'), target));
  const st = fs.statSync(path.join(lib.dirOf('geschnitten'), target));
  const nv = lib.newVideo('geschnitten', target);
  Object.assign(nv, { size: st.size, mtime: st.mtimeMs }, fields);
  // von Hand/über den Ordner gewählter Kanal gilt auch für die geschnittenen Videos
  if (raw?.channel) { nv.channel = raw.channel; nv.channelFrom = raw.channelFrom || 'roh'; }
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
  const { values: loud, fine, hasAudio } = await loudness(file, duration);
  step('Bildwechsel suchen');
  const scenes = await sceneChanges(file);

  let words = whisper.loadWords(v);
  let segs = words ? whisper.sentences(words) : null;
  if (!segs && c.whisper.enabled) {
    step('Sprache erkennen (Whisper)');
    try {
      words = await whisper.transcribe(file, v.id, (p, eng) => step('Sprache erkennen' + (eng ? ' – ' + eng : ' (Whisper)'), p));
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
  const plan = planOf(v);
  const len = Math.round((c.shortMin + c.shortMax) / 2);
  const cands = plan.shorts > 0 ? candidates(loud, scenes, duration, cut, len, Math.min(30, Math.max(12, plan.shorts * 3))) : [];

  const profile = profiles.effective(v);
  const pro = profiles.isPro(profile);
  let shorts = [];
  if (cands.length) {
    step('Highlights auswählen');
    if (db().ai.apiKey) {
      try { shorts = await ai.chooseHighlights(v, cands, segs, { ...c, shorts: plan.shorts }, profile, plan.wish); }
      catch (e) { v.cut.warning = 'Claude-Auswahl: ' + e.message + ' – lauteste Stellen genommen.'; }
    }
    if (!shorts.length) shorts = cands.slice(0, plan.shorts).map((x) => ({ ...x, title: '', reason: 'laute/bewegte Stelle' }));
  }

  // Kurzfassung: die besten Stellen hintereinander (Ziellänge in Sekunden)
  let reel = [];
  if (plan.summary > 0 && duration > plan.summary + 20) {
    step('Kurzfassung planen');
    const parts = candidates(loud, scenes, duration, cut, SEG, Math.min(40, Math.ceil(plan.summary / SEG) * 3));
    if (db().ai.apiKey) {
      try { reel = await ai.chooseSummary(v, parts, segs, plan.summary, profile, plan.wish); }
      catch (e) { v.cut.warning = 'Claude-Kurzfassung: ' + e.message + ' – beste Stellen nach Lautstärke genommen.'; }
    }
    if (!reel.length) {
      let total = 0;
      for (const x of parts) { if (total >= plan.summary) break; reel.push({ start: x.start, end: x.end }); total += x.end - x.start; }
    }
    reel.sort((a, b) => a.start - b.start);
  } else if (plan.summary > 0) v.cut.warning = 'Video ist kürzer als die gewünschte Kurzfassung – keine Kurzfassung erstellt.';

  const base = path.basename(v.file, path.extname(v.file));
  const jobs = (plan.long ? 1 : 0) + shorts.length + (reel.length ? 1 : 0);
  let done = 0;
  const outputs = [];
  const sourceNote = (a, b) => `Aus „${v.file}“${a != null ? ` (${whisper.fmtTime(a)}–${whisper.fmtTime(b)})` : ''}.`;

  const getTrack = async (kind, seconds, idea, label) => {
    try {
      const t = await music.trackFor({ profile, kind, seconds, idea });
      if (t) step(label + (t.kind === 'ai' ? ' (mit KI-Musik)' : ' (mit Musik)'));
      return t;
    } catch (e) { v.cut.warning = 'Musik: ' + e.message + ' – ohne Musik geschnitten.'; return null; }
  };

  if (reel.length) {
    const label = 'Kurzfassung schneiden';
    step(label, 0);
    const tmp = path.join(TMP, v.id + '-kurz.mp4');
    const total = reel.reduce((x, r) => x + r.end - r.start, 0);
    const track = await getTrack('long', total, {}, label);
    const onP = (p) => step(label, (done + p / 100) / jobs * 100);
    try { await renderSummary(v, file, reel, hasAudio, tmp, onP, track); }
    catch (e) { if (!track) throw e; v.cut.warning = 'Mischen mit Musik ging nicht – Kurzfassung ohne Musik.'; await renderSummary(v, file, reel, hasAudio, tmp, onP, null); }
    const nv = publish(tmp, `${base} – Kurzfassung.mp4`, {
      source: { rawId: v.id, rawFile: v.file, kind: 'summary', parts: reel.map((r) => [r.start, r.end]) },
      note: sourceNote() + ` Kurzfassung aus ${reel.length} Stellen (${whisper.fmtTime(total)}).` + (plan.wish ? ' Wunsch: ' + plan.wish : '') + music.noteOf(track),
      music: track ? { kind: track.kind, name: track.name, mood: track.mood || '' } : null,
      transcriptText: segs ? reel.map((r) => whisper.textOf(segs, r.start, r.end)).join(' … ').slice(0, 20000) : '',
    }, v);
    outputs.push(nv.id); done++;
  }

  if (plan.long) {
    step('Langfassung schneiden', 0);
    const tmp = path.join(TMP, v.id + '-lang.mp4');
    const total = keep.reduce((s, [a, b]) => s + b - a, 0);
    const track = await getTrack('long', total, {}, 'Langfassung schneiden');
    try { await renderLong(v, file, keep, hasAudio, tmp, (p) => step('Langfassung schneiden', (done + p / 100) / jobs * 100), track); }
    catch (e) {
      if (!track) throw e;
      v.cut.warning = 'Mischen mit Musik ging nicht – Langfassung ohne Musik.';
      await renderLong(v, file, keep, hasAudio, tmp, (p) => step('Langfassung schneiden', (done + p / 100) / jobs * 100), null);
    }
    const removed = Math.round(cut.reduce((s, [a, b]) => s + b - a, 0));
    const nv = publish(tmp, `${base} – Langfassung.mp4`, {
      source: { rawId: v.id, rawFile: v.file, kind: 'long', removed, keep: keep.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]) },
      note: sourceNote() + (removed ? ` ${whisper.fmtTime(removed)} ruhige Abschnitte entfernt.` : '') + music.noteOf(track),
      music: track ? { kind: track.kind, name: track.name, mood: track.mood || '' } : null,
      transcriptText: segs ? whisper.textOf(segs).slice(0, 20000) : '',
    }, v);
    outputs.push(nv.id); done++;
  }
  const hookStyle = profile?.hookStyle || (pro ? 'cold' : 'auto');
  const tempo = profile?.tempo || (pro ? 'ruhig' : 'normal');
  for (let i = 0; i < shorts.length; i++) {
    const s = shorts[i];
    s.hook = fx.cleanHook(s.hook, s.start, s.end, hookStyle, pro);
    s.parts = fx.buildParts({ start: s.start, end: s.end, hook: s.hook, words, fine: hasAudio ? fine : null, tempo });
    const fxHow = await prepareFx(s, profile, (m) => { v.cut.warning = m; });
    step(`Short ${i + 1} von ${shorts.length} schneiden`);
    const tmp = path.join(TMP, `${v.id}-short${i + 1}.mp4`);
    const label = `Short ${i + 1} von ${shorts.length} schneiden`;
    const track = await getTrack('short', fx.totalLen(s.parts), { mood: s.mood, music: s.music }, label);
    try { await renderShort(v, file, s, hasAudio, tmp, (p) => step(label, (done + p / 100) / jobs * 100), words, track, pro); }
    catch (e) {
      if (!track) throw e;
      v.cut.warning = 'Mischen mit Musik ging nicht – Short ohne Musik.';
      await renderShort(v, file, s, hasAudio, tmp, (p) => step(label, (done + p / 100) / jobs * 100), words, null, pro);
    }
    const how = [fx.describe(s.hook, tempo, s.parts, s.start, s.end), fxHow].filter(Boolean).join(' · ');
    const nv = publish(tmp, `${base} – ${pro ? 'LinkedIn-Clip' : 'Short'} ${i + 1}.mp4`, {
      source: { rawId: v.id, rawFile: v.file, kind: 'short', start: s.start, end: s.end, hook: s.hook || null, tempo, fx: s.fx || [] },
      edit: { hook: s.hook || null, tempo, parts: s.parts.length, how, fxHow, fxLevel: s.fxLevel },
      title: s.title ? s.title.slice(0, 100) : `${base} – Short ${i + 1}`,
      viral: Number.isFinite(s.viral) ? { score: s.viral, why: s.viralWhy || '', tip: s.viralTip || '', by: 'Schnitt' } : undefined,
      note: sourceNote(s.start, s.end) + (s.reason ? ' Warum: ' + s.reason : '') + (how ? ' ' + how + '.' : '') + music.noteOf(track),
      music: track ? { kind: track.kind, name: track.name, mood: track.mood || '' } : null,
      transcriptText: segs ? whisper.textOf(segs, s.start, s.end) : '',
    }, v);
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

// Zeitfenster (Nachtbetrieb): „01:00“–„07:00“, auch über Mitternacht („22:00“–„06:00“)
const minutes = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export function inWindow(d = new Date()) {
  const w = cfg().window;
  if (!w?.enabled) return true;
  const now = d.getHours() * 60 + d.getMinutes(), a = minutes(w.from), b = minutes(w.to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

export function enqueue(v, { force = false, now = false } = {}) {
  if (v.missing) throw new Error('Videodatei nicht gefunden.');
  if (['queued', 'running'].includes(v.cut?.state)) {
    if (now && v.cut.state === 'queued' && !priority.has(v.id)) { priority.add(v.id); v.cut = { ...v.cut, now: true }; save(); next(); }
    return;
  }
  if (v.cut?.state === 'done' && !force) return;
  v.cut = { state: 'queued', step: '', progress: 0, at: new Date().toISOString(), now: !!now };
  if (now) priority.add(v.id);
  queue.push(v.id);
  save();
  next();
}
const priority = new Set(); // „Jetzt schneiden“ von Hand: ignoriert das Zeitfenster

let windowTimer = null;
async function next() {
  if (running) return;
  // Von Hand angestoßene zuerst; sonst nur im Zeitfenster
  let i = queue.findIndex((x) => typeof x === 'object' || priority.has(x));   // Überarbeitungen sind immer von Hand angestoßen
  if (i < 0 && !inWindow()) {
    clearTimeout(windowTimer);
    windowTimer = setTimeout(next, 60_000); // jede Minute nachsehen, ob das Fenster offen ist
    return;
  }
  if (i < 0) i = 0;
  const [item] = queue.splice(i, 1);
  if (!item) return;
  if (typeof item === 'object') return runRevision(item);
  const id = item;
  priority.delete(id);
  running = id;
  const v = db().videos[id];
  try {
    if (v && !v.missing) await runCut(v);
  } catch (e) {
    console.error('Schnitt', v?.file, e);
    if (v) {
      v.cut = { ...v.cut, state: 'error', error: e.message, step: '' }; saveNow();
      // halbfertige Zwischendateien dieses Videos wegräumen (können mehrere GB groß sein)
      try { for (const f of fs.readdirSync(TMP)) if (f.startsWith(v.id + '-')) fs.rmSync(path.join(TMP, f), { force: true }); } catch { /* egal */ }
    }
  } finally {
    for (const f of fs.existsSync(TMP) ? fs.readdirSync(TMP) : []) if (f.startsWith(id + '-')) fs.rmSync(path.join(TMP, f), { force: true });
    running = null;
    afterRun?.();
    next();
  }
}

let afterRun = null;
export function onDone(fn) { afterRun = fn; }

// ---------- Überarbeiten (ein Short wird nach Wunsch aus dem Rohvideo neu geschnitten) ----------
// Versionsnummer v2, v3 … bezogen auf die erste Fassung
function nextVersionName(out) {
  const rootId = out.revisionRoot || out.id;
  const root = db().videos[rootId] || out;
  root.revCount = (root.revCount || 1) + 1;
  const stem = path.basename(out.file, path.extname(out.file)).replace(/ v\d+$/, '');
  return { rootId, n: root.revCount, name: `${stem} v${root.revCount}.mp4` };
}

// Lang-/Kurzfassung nach Wunsch neu schneiden (Abschnitte, Teaser, Tempo, Musik)
async function reviseLongVersion(out, raw, wish, words, segs, profile, step) {
  const file = lib.fileOf(raw);
  const summary = out.source.kind === 'summary';
  step('Lautstärke messen');
  const { values: loud, fine, hasAudio } = await loudness(file, raw.duration);
  step('Claude plant die neue Fassung');
  const r = await ai.reviseLong(raw, out, wish, segs, hasAudio ? loud : null, profile);
  // Tempo innerhalb der Abschnitte
  let keep = [];
  for (const [a, b] of r.segments) keep.push(...(r.tempo !== 'aus' && hasAudio ? fx.tempoKeep(words, fine, a, b, r.tempo) : [[a, b]]));
  keep = keep.filter(([a, b]) => b - a >= 0.2);
  const main = keep.reduce((x, [a, b]) => x + b - a, 0);
  const seconds = main + (r.teaser ? r.teaser.len : 0);
  let track = null;
  if (r.music && profile?.music !== false && db().music?.enabled !== false) {
    step('Musik wählen');
    try { track = await music.trackFor({ profile, kind: 'long', seconds, idea: {} }); } catch (e) { out.revise.warning = 'Musik: ' + e.message; }
  }
  const tmp = path.join(TMP, `${raw.id}-rev-${out.id}.mp4`);
  const label = summary ? 'Kurzfassung neu schneiden' : 'Langfassung neu schneiden';
  const onP = (p) => step(label, p);
  step(label);
  const render = async (t) => {
    if (summary) {
      const reel = [...(r.teaser ? [{ start: r.teaser.at, end: r.teaser.at + r.teaser.len }] : []), ...keep.map(([a, b]) => ({ start: a, end: b }))];
      await renderSummary(raw, file, reel, hasAudio, tmp, onP, t, r.teaser?.text || '', r.teaser?.len || 0);
    } else await renderLong(raw, file, keep, hasAudio, tmp, onP, t, r.teaser);
  };
  try { await render(track); } catch (e) { if (!track) throw e; track = null; await render(null); }
  const { rootId, n, name } = nextVersionName(out);
  const how = [r.teaser ? `Teaser ${String(r.teaser.len).replace('.', ',')} s vorweg${r.teaser.text ? ` „${r.teaser.text}“` : ''}` : '',
    `${r.segments.length} Abschnitt${r.segments.length === 1 ? '' : 'e'}, neue Länge ${whisper.fmtTime(seconds)}${out.duration ? ` (vorher ${whisper.fmtTime(out.duration)})` : ''}`,
    r.tempo !== 'aus' ? `Tempo ${r.tempo}` : ''].filter(Boolean).join(' · ');
  const nv = publish(tmp, name, {
    source: { ...out.source, ...(summary ? { parts: keep } : { keep }), teaser: r.teaser, tempo: r.tempo },
    edit: { teaser: r.teaser, tempo: r.tempo, parts: keep.length, how },
    title: r.title || out.title, description: out.description, tags: out.tags, category: out.category, viral: out.viral,
    revisionOf: out.id, revisionRoot: rootId, revisionWish: wish, revisionChanges: r.changes,
    note: `Überarbeitung (v${n}) von „${out.file}“. Wunsch: ${wish}. Claude: ${r.changes} ${how}.` + music.noteOf(track),
    music: track ? { kind: track.kind, name: track.name, mood: track.mood || '' } : null,
    transcriptText: segs ? r.segments.map(([a, b]) => whisper.textOf(segs, a, b)).join(' … ').slice(0, 20000) : '',
  }, { channel: out.channel || profile?.id, channelFrom: out.channelFrom || 'überarbeitung' });
  out.revise = { ...out.revise, state: 'done', step: '', progress: 100, doneAt: new Date().toISOString(), newId: nv.id, newFile: nv.file };
  saveNow();
}
export function revisable(out) {
  if (!['short', 'long', 'summary'].includes(out?.source?.kind)) return 'Überarbeiten geht bei Videos aus dem automatischen Schnitt (Shorts, Lang- und Kurzfassung).';
  const raw = db().videos[out.source.rawId];
  if (!raw || raw.missing) return 'Das Rohvideo ist nicht mehr da – ohne Rohvideo kann nicht neu geschnitten werden.';
  if (!db().ai.apiKey) return 'Für die Überarbeitung braucht es den Claude-Schlüssel (Einstellungen).';
  return '';
}
// Viral-Tipps (Einstieg/Schnitt) als Überarbeitungswunsch
export function tipsWish(v) {
  const x = v.viral || {};
  const parts = [x.hook && 'Einstieg: ' + x.hook, x.edit && 'Schnitt: ' + x.edit, !x.hook && !x.edit && x.tip ? x.tip : ''].filter(Boolean);
  return parts.length ? 'Viral-Tipps umsetzen – ' + parts.join(' · ') : '';
}
// Nach dem Claude-Vorschlag: Tipps einmal automatisch umsetzen (nicht bei Fassungen, die selbst schon Überarbeitungen sind)
export function autoApplyTips(v) {
  if (db().ai.autoTips === false || v.tipsApplied || v.revisionOf || v.folder !== 'geschnitten') return;
  if (!v.viral?.score || v.viral.score >= 9) return;
  const wish = tipsWish(v);
  if (!wish || revisable(v)) return;
  if (['queued', 'running'].includes(v.revise?.state)) return;
  v.tipsApplied = new Date().toISOString();
  enqueueRevision(v, wish);
}
export function enqueueRevision(out, wish) {
  const why = revisable(out);
  if (why) throw new Error(why);
  if (['queued', 'running'].includes(out.revise?.state)) throw new Error('Wird schon überarbeitet.');
  out.revise = { state: 'queued', wish: String(wish).slice(0, 500), at: new Date().toISOString(), step: '', progress: 0 };
  queue.push({ revise: out.id, wish: out.revise.wish });
  save();
  next();
}
async function runRevision({ revise: outId, wish }) {
  const out = db().videos[outId];
  const raw = out && db().videos[out.source?.rawId];
  running = 'rev-' + outId;
  try {
    if (!out) return;
    const step = (s, progress = 0) => { out.revise = { ...out.revise, state: 'running', step: s, progress: Math.round(progress) }; save(); };
    const why = revisable(out);
    if (why) throw new Error(why);
    const c = cfg();
    const file = lib.fileOf(raw);
    fs.mkdirSync(TMP, { recursive: true });
    let words = whisper.loadWords(raw);
    if (!words && c.whisper.enabled) {
      step('Sprache erkennen');
      try { words = await whisper.transcribe(file, raw.id, (p, eng) => step('Sprache erkennen' + (eng ? ' – ' + eng : ''), p)); whisper.saveTranscript(raw, words); }
      catch { words = null; }
    }
    const segs = words ? whisper.sentences(words) : null;
    const profile = profiles.effective(out);
    const pro = profiles.isPro(profile);
    if (out.source.kind !== 'short') return await reviseLongVersion(out, raw, wish, words, segs, profile, step);
    step('Claude plant die neue Fassung');
    const r = await ai.reviseShort(raw, out, wish, segs, profile, { minLen: Math.min(c.shortMin || 30, 15), maxLen: Math.max(c.shortMax || 45, 60) });
    step('Lautstärke messen');
    const { fine, hasAudio } = await loudness(file, raw.duration, { from: Math.max(0, r.start - 1), span: r.end - r.start + 2 });
    let style = profile?.hookStyle || (pro ? 'cold' : 'auto');
    if (style === 'off' && /hook|anfang|einstieg/i.test(wish)) style = 'auto';
    const s = { start: r.start, end: r.end, hook: fx.cleanHook(r.hook, r.start, r.end, style, pro) };
    s.parts = fx.buildParts({ start: s.start, end: s.end, hook: s.hook, words, fine: hasAudio ? fine : null, tempo: r.tempo });
    s.fx = r.fx; s.fxLevel = r.fxLevel;
    step('Effekte vorbereiten');
    const fxHow = await prepareFx(s, profile, (m) => { out.revise.warning = m; });
    const seconds = fx.totalLen(s.parts);
    let track = null;
    if (r.music && profile?.music !== false && db().music?.enabled !== false) {
      step('Musik wählen');
      try { track = await music.trackFor({ profile, kind: 'short', seconds, idea: { mood: out.music?.mood } }); }
      catch (e) { out.revise.warning = 'Musik: ' + e.message; }
    }
    const tmp = path.join(TMP, `${raw.id}-rev-${out.id}.mp4`);
    const onP = (p) => step('Neu schneiden', p);
    step('Neu schneiden');
    try { await renderShort(raw, file, s, hasAudio, tmp, onP, words, track, pro); }
    catch (e) { if (!track) throw e; track = null; await renderShort(raw, file, s, hasAudio, tmp, onP, words, null, pro); }
    // Versionsnummer: v2, v3 … bezogen auf die erste Fassung
    const { rootId, n, name } = nextVersionName(out);
    const how = [fx.describe(s.hook, r.tempo, s.parts, s.start, s.end), fxHow].filter(Boolean).join(' · ');
    const nv = publish(tmp, name, {
      source: { ...out.source, start: s.start, end: s.end, hook: s.hook || null, tempo: r.tempo, fx: s.fx || [] },
      edit: { hook: s.hook || null, tempo: r.tempo, parts: s.parts.length, how, fxHow, fxLevel: s.fxLevel },
      title: r.title || out.title, description: out.description, tags: out.tags, category: out.category,
      viral: r.viral ? { score: r.viral, why: r.viralWhy, tip: r.viralTip, by: 'Überarbeitung' } : out.viral,
      revisionOf: out.id, revisionRoot: rootId, revisionWish: wish, revisionChanges: r.changes,
      note: `Überarbeitung (v${n}) von „${out.file}“. Wunsch: ${wish}. Claude: ${r.changes}` + (how ? ' ' + how + '.' : '') + music.noteOf(track),
      music: track ? { kind: track.kind, name: track.name, mood: track.mood || '' } : null,
      transcriptText: segs ? whisper.textOf(segs, s.start, s.end) : '',
    }, { channel: out.channel || profile?.id, channelFrom: out.channelFrom || 'überarbeitung' });
    out.revise = { ...out.revise, state: 'done', step: '', progress: 100, doneAt: new Date().toISOString(), newId: nv.id, newFile: nv.file };
    saveNow();
  } catch (e) {
    console.error('Überarbeitung', out?.file, e);
    if (out) { out.revise = { ...out.revise, state: 'error', error: e.message, step: '' }; saveNow(); }
  } finally {
    for (const f of fs.existsSync(TMP) ? fs.readdirSync(TMP) : []) if (raw && f.startsWith(`${raw.id}-rev-${outId}`)) fs.rmSync(path.join(TMP, f), { force: true });
    running = null;
    afterRun?.();
    next();
  }
}

// neue Rohaufnahmen automatisch schneiden (jede nur einmal)
export function autoQueue() {
  if (!cfg().auto) return;
  for (const v of Object.values(db().videos)) {
    if (lib.INBOXES.includes(v.folder) && !v.missing && v.duration != null && v.duration > 0 && !v.cut) enqueue(v);
  }
}

export function init() {
  music.ensureDirs();
  gpu.check().then((g) => console.log('Grafikkarte:', g.nvenc ? 'NVENC aktiv' : 'nicht genutzt (' + g.error + ')'));
  for (const v of Object.values(db().videos)) {
    if (['queued', 'running'].includes(v.cut?.state)) { v.cut = { ...v.cut, state: 'queued' }; queue.push(v.id); }
    if (['queued', 'running'].includes(v.revise?.state)) v.revise = { ...v.revise, state: 'error', error: 'Durch Neustart unterbrochen – bitte erneut anstoßen.' };
  }
  setTimeout(next, 5000);
}

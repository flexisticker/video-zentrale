// PC-Analyse (Rechenhelfer ab 1.5, RTX 3070): was der Server allein nicht schafft.
//  - Demucs: Stimme vom Spielton trennen (für Twitch-VODs mit nur einer Tonspur) → genauere Spracherkennung + echter Tonfall
//  - Geräusch-Erkennung (AudioSet-Modell AST): Lachen, Schreien, Jubel, Explosion, Schüsse – je Sekunde mit Sicherheit
//  - Texterkennung (EasyOCR) im Bild alle 2 s: „VICTORY“, „ELIMINATED“, „#1“ … (Wörterliste einstellbar)
// Ergebnis je Rohvideo unter /data/analyse/<id>/ (result.json, voice.wav), am Video v.analyse.
// Der Schnitt wartet (einstellbar) bis die Grafikkarte freigegeben ist – höchstens waitHours, „Jetzt schneiden“ wartet nie.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { db, save, DATA_DIR } from './store.js';
import * as helper from './helper.js';
import * as backup from './backup.js';

const DIR = path.join(DATA_DIR, 'analyse');
const TMP = path.join(DATA_DIR, 'tmp');
export const dirOf = (v) => path.join(DIR, v.id);
export const voicePath = (v) => path.join(dirOf(v), 'voice.wav');

export const DEFAULT_WORDS = ['victory', 'victory royale', 'sieg', 'gewonnen', 'winner', 'winner winner', '#1', 'champion', 'eliminated', 'eliminiert',
  'ausgeschaltet', 'knocked', 'niedergeschlagen', 'headshot', 'double kill', 'triple kill', 'quadra kill', 'penta kill', 'ace', 'clutch', 'you died',
  'gestorben', 'wasted', 'defeat', 'niederlage', 'game over', 'level up', 'achievement', 'erfolg', 'mvp', 'legendary', 'legendär', 'goal', 'tor'];
const words = () => (db().helper.ocrWords?.length ? db().helper.ocrWords : DEFAULT_WORDS);

function ffmpeg(args) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('nice', ['-n', '15', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

export function load(v) {
  try { return JSON.parse(fs.readFileSync(path.join(dirOf(v), 'result.json'), 'utf8')); } catch { return null; }
}
export const hasVoice = (v) => fs.existsSync(voicePath(v));

// Braucht dieses Video noch eine PC-Analyse?
export function needed(v) {
  const c = db().helper;
  return !!(c.enabled && c.analyse !== false && !v.analyse?.at && !(v.analyse?.failed >= 2));
}
export const available = () => helper.canNow('analyse');

// Ausführen (Server bereitet Ton + Bilder vor, PC rechnet). onStep(text, prozent). track = Tonspur der Mischung.
export async function run(v, file, { duration, voiceTrack = null, onStep = () => {} } = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  const base = path.join(TMP, `${v.id}-an`);
  const audio = base + '.flac', frames = base + '-bilder.zip', framesDir = base + '-bilder';
  try {
    onStep('PC-Analyse vorbereiten');
    // Demucs nur, wenn es keine eigene Stimmspur gibt
    const demucs = voiceTrack == null;
    const r1 = await ffmpeg(['-y', '-i', file, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'flac', '-compression_level', '3', audio]);
    if (r1.code !== 0) throw new Error('Ton nicht lesbar: ' + r1.err.trim().split('\n').pop());
    fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir);
    // Bilder alle 2 s (960 px breit) für die Texterkennung; Dateiname = Sekunde
    await ffmpeg(['-y', '-i', file, '-an', '-vf', 'fps=0.5,scale=960:-2', '-q:v', '5', '-start_number', '0', path.join(framesDir, 'f%06d.jpg')]);
    const names = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
    const entries = names.map((f, i) => ({ name: `t${String(i * 2).padStart(6, '0')}.jpg`, data: fs.readFileSync(path.join(framesDir, f)) }));
    fs.writeFileSync(frames, backup.zip(entries));
    fs.rmSync(framesDir, { recursive: true, force: true });
    onStep('PC-Analyse läuft (Rechenhelfer)');
    const timeoutMs = Math.max(30 * 60_000, (duration || 3600) * 1000 * 1.5);
    const res = await helper.submit('analyse', { files: { audio: audio, frames: frames }, params: { demucs, events: true, ocr: names.length > 0, framesStep: 2 },
      label: v.id, timeoutMs, pickupMs: 5 * 60_000 });
    const out = dirOf(v);
    fs.mkdirSync(out, { recursive: true });
    const j = res.json || {};
    const result = {
      at: new Date().toISOString(),
      events: (Array.isArray(j.events) ? j.events : []).filter((e) => Number.isFinite(e.t)).slice(0, 20000)
        .map((e) => ({ t: Number(e.t), kind: String(e.kind || ''), label: String(e.label || '').slice(0, 40), score: Number(e.score) || 0, stem: String(e.stem || '') })),
      ocr: (Array.isArray(j.ocr) ? j.ocr : []).filter((x) => Number.isFinite(x.t)).slice(0, 50000).map((x) => ({ t: Number(x.t), text: String(x.text || '').slice(0, 80) })),
      took: Number(j.took) || null, device: String(j.device || ''),
    };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result));
    if (res.files?.['voice.wav'] && fs.existsSync(res.files['voice.wav'])) {
      fs.copyFileSync(res.files['voice.wav'], voicePath(v));
    }
    v.analyse = { at: result.at, events: result.events.length, ocr: result.ocr.length, voice: hasVoice(v), device: result.device, took: result.took };
    save();
    return result;
  } catch (e) {
    v.analyse = { ...(v.analyse || {}), failed: (v.analyse?.failed || 0) + 1, error: e.message, errorAt: new Date().toISOString() };
    save();
    throw e;
  } finally {
    for (const f of [audio, frames]) fs.rmSync(f, { force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

// Ergebnisse für den Schnitt: Geräusche als Ereignisse (wie [Lachen] aus Whisper), Spieltexte als Signale
const KIND = { laugh: 'laugh', shout: 'shout', scream: 'shout', cheer: 'cheer', bang: 'bang', cry: 'shout' };
export function signals(v, duration) {
  const r = load(v);
  if (!r) return { events: [], extra: [], lines: '' };
  // Geräusche: zusammenhängende Sekunden derselben Art zu einem Ereignis zusammenfassen
  const events = [];
  for (const e of [...r.events].sort((a, b) => a.t - b.t)) {
    const kind = KIND[e.kind];
    if (!kind || e.t < 0 || e.t > duration) continue;
    const last = events[events.length - 1];
    if (last && last.kind === kind && e.t - last.e <= 1.5) { last.e = e.t + 1; last.score = Math.max(last.score, e.score); continue; }
    events.push({ s: e.t, e: e.t + 1, kind, score: e.score, t: e.label, src: 'pc' });
  }
  // Spieltexte: nur Treffer aus der Wörterliste, jeder Treffer einmal je 20 s
  const list = words();
  const extra = [], lines = [];
  const seen = new Map();
  for (const o of r.ocr) {
    const txt = o.text.toLowerCase();
    const hit = list.find((w) => (w.length <= 3 ? new RegExp(`(^|[^\\p{L}\\d])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\d]|$)`, 'u').test(txt) : txt.includes(w)));
    if (!hit || o.t > duration) continue;
    if (seen.has(hit) && o.t - seen.get(hit) < 20) continue;
    seen.set(hit, o.t);
    const label = `Spieltext „${o.text.slice(0, 30)}“`;
    extra.push({ t: Math.max(0, o.t - 2), w: 2.2, label, spread: 4 });
    lines.push(`Sekunde ${Math.round(o.t)}: ${label}`);
  }
  for (const e of events.filter((x) => x.score >= 0.5).slice(0, 60)) lines.push(`Sekunde ${Math.round(e.s)}: Geräusch ${e.t} (${Math.round(e.score * 100)} %)`);
  return { events, extra, lines: lines.slice(0, 80).join('\n') };
}

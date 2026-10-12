// Hintergrundmusik für Shorts (und auf Wunsch die Langfassung): eigene Titel aus /videos/musik (z. B. von Epidemic Sound)
// oder KI-Musik über fal.ai (Sonilo, laut Anbieter kommerziell nutzbar). Gemischt wird unter die Stimme mit „Ducking“
// (Musik wird leiser, sobald gesprochen wird).
//
// Ordner:  musik/                    → für alle Kanäle
//          musik/<kanal-id>/         → nur für diesen Kanal (z. B. musik/michamodus)
//          musik/[<kanal-id>/]<stimmung>/ → Stimmung (episch, lustig, spannend, chillig, energisch, fröhlich, traurig)
//          musik/ki/                 → von der KI erzeugte Titel (Nachweis, werden nicht wiederverwendet)
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as credits from './credits.js';
import { db, save, saveNow } from './store.js';
import * as lib from './library.js';

const FAL = process.env.FAL_BASE || 'https://fal.run';
export const MOODS = ['episch', 'lustig', 'spannend', 'chillig', 'energisch', 'fröhlich', 'traurig'];
export const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];
export const LEVELS = { leise: -32, mittel: -28, laut: -24 }; // alte Stufen (bis 1.9.4), jetzt Regler `lufs`
// Absenkung, während gesprochen wird (sidechaincompress)
export const DUCK = {
  leicht: { threshold: 0.06, ratio: 2.5, attack: 150, release: 1200, knee: 6 },
  mittel: { threshold: 0.04, ratio: 4, attack: 80, release: 800, knee: 4 },
  stark: { threshold: 0.02, ratio: 8, attack: 20, release: 400, knee: 2.8 },
};
const musicLufs = () => { const c = cfg(); return Number.isFinite(c.lufs) ? c.lufs : (LEVELS[c.level] ?? -30); };
const PRICE_PER_S = 0.0025; // sonilo/v1.1/text-to-music, $ je Sekunde (mind. 10 s), Stand 11.10.2026

const cfg = () => db().music;
const fal = () => db().fal;
export const musicDir = () => path.join(lib.VIDEO_DIR, 'musik');
const aiDir = () => path.join(musicDir(), 'ki');

export function ensureDirs() {
  try {
    fs.mkdirSync(aiDir(), { recursive: true });
    for (const p of db().profiles) fs.mkdirSync(path.join(musicDir(), p.id), { recursive: true });
  } catch { /* Ordner nicht beschreibbar – Musik dann nur per KI bzw. aus */ }
}

const isAudio = (f) => AUDIO_EXT.includes(path.extname(f).toLowerCase()) && !f.startsWith('.');
const moodOf = (dir) => { const n = path.basename(dir).toLowerCase(); return MOODS.includes(n) ? n : ''; };

function filesIn(dir, depth = 0) {
  let out = [];
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const full = path.join(dir, e.name);
    if (e.isFile() && isAudio(e.name)) out.push(full);
    else if (e.isDirectory() && depth < 1 && MOODS.includes(e.name.toLowerCase())) out = out.concat(filesIn(full, depth + 1));
  }
  return out;
}

// Titel für einen Kanal: Kanalordner + allgemeiner Ordner (ohne ki/ und ohne Ordner anderer Kanäle)
export function tracksFor(profileId) {
  const root = musicDir();
  const own = profileId ? filesIn(path.join(root, profileId)) : [];
  return [...own, ...filesIn(root)].map((f) => ({ file: f, name: path.basename(f), mood: moodOf(path.dirname(f)), own: own.includes(f) }));
}

export function status() {
  const c = cfg();
  const counts = {};
  for (const p of db().profiles) counts[p.id] = tracksFor(p.id).length;
  return { ...c, lufs: musicLufs(), duckLevel: c.duck === false ? 'aus' : (c.duckLevel || 'leicht'), moods: MOODS, levels: Object.keys(LEVELS), counts, common: filesIn(musicDir()).length,
    falConfigured: !!fal().key, folder: '\\\\PowerServer\\videos\\musik', pricePerMinute: Math.round(PRICE_PER_S * 60 * 100) / 100 };
}

export function configure(b) {
  const c = cfg();
  for (const k of ['enabled', 'shorts', 'long', 'duck']) if (typeof b[k] === 'boolean') c[k] = b[k];
  if (['mixed', 'library', 'ai'].includes(b.source)) c.source = b.source;
  if (LEVELS[b.level] != null) c.level = b.level;
  if (b.lufs != null && !isNaN(b.lufs)) c.lufs = Math.round(Math.min(-18, Math.max(-42, Number(b.lufs))));
  if (b.duckLevel === 'aus') c.duck = false;
  else if (DUCK[b.duckLevel]) { c.duck = true; c.duckLevel = b.duckLevel; }
  if (b.longMax != null && !isNaN(b.longMax)) c.longMax = Math.round(Math.min(600, Math.max(30, Number(b.longMax))));
  if (typeof b.model === 'string' && /^[a-z0-9][a-z0-9\-/.]{2,80}$/i.test(b.model.trim())) c.model = b.model.trim();
  saveNow();
}

// Eigenen Titel wählen: passende Stimmung zuerst, Kanalordner vor allgemein, kürzlich genutzte zuletzt, sonst Zufall.
export function pickTrack(profileId, mood) {
  const all = tracksFor(profileId);
  if (!all.length) return null;
  const recent = cfg().recent || [];
  const score = (t) => (mood && t.mood === mood ? 4 : 0) + (t.own ? 2 : 0) - (recent.includes(t.name) ? 3 + (recent.length - recent.indexOf(t.name)) / 100 : 0);
  const best = Math.max(...all.map(score));
  const top = all.filter((t) => score(t) >= best - 0.5);
  const t = top[Math.floor(Math.random() * top.length)];
  return t;
}

function remember(name) {
  const c = cfg();
  c.recent = [name, ...(c.recent || []).filter((n) => n !== name)].slice(0, 15);
  save();
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'musik';

// KI-Musik erzeugen → Datei in musik/ki/
export async function generate({ prompt, seconds, profileId, label }) {
  if (!fal().key) throw new Error('fal.ai-Schlüssel fehlt (Einstellungen → Titelbilder & Fotos).');
  const duration = Math.max(10, Math.min(600, Math.ceil(seconds)));
  const r = await fetch(`${FAL}/${cfg().model || 'sonilo/v1.1/text-to-music'}`, {
    method: 'POST',
    headers: { Authorization: 'Key ' + fal().key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, duration, num_samples: 1 }),
  });
  const j = await r.json().catch(() => ({}));
  { const fe = credits.falError(r.status, j); if (fe) throw new Error(fe); }
  const url = j.audio?.url || j.audios?.[0]?.url;
  if (!r.ok || !url) throw new Error('fal.ai-Musik: ' + (j.detail?.[0]?.msg || j.detail || j.error || r.status));
  const a = await fetch(url);
  if (!a.ok) throw new Error('fal.ai-Musik: Ergebnis nicht abrufbar.');
  fs.mkdirSync(aiDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const ext = path.extname(new URL(url).pathname) || '.m4a';
  const file = path.join(aiDir(), `${stamp} ${profileId || 'alle'} ${slug(label)}${ext}`);
  fs.writeFileSync(file, Buffer.from(await a.arrayBuffer()));
  // Nachweis daneben: Prompt, Modell, Zeit (für Rückfragen zu Rechten)
  fs.writeFileSync(file.replace(/\.[^.]+$/, '.txt'), [`Modell: ${cfg().model}`, `Erzeugt: ${new Date().toISOString()}`, `Länge: ${duration} s`, `Prompt: ${prompt}`, `Quelle: ${url}`].join('\n') + '\n');
  const c = cfg();
  c.generated = (c.generated || 0) + 1;
  c.spent = Math.round(((c.spent || 0) + duration * PRICE_PER_S) * 10000) / 10000;
  saveNow();
  return file;
}

// Musik für einen Clip besorgen. kind: 'short' | 'long'. idea: { mood, music } von Claude (optional).
// → { file, kind: 'library'|'ai', name, mood, prompt? } oder null (aus / nichts gefunden / Fehler → warning)
export async function trackFor({ profile, kind, seconds, idea = {} }) {
  const c = cfg();
  if (!c.enabled || profile?.music === false || (kind === 'short' && !c.shorts) || (kind === 'long' && !c.long)) return null;
  const mood = MOODS.includes(idea.mood) ? idea.mood : (profile?.musicMood || '');
  if (c.source !== 'ai') {
    const t = pickTrack(profile?.id, mood);
    if (t) { remember(t.name); return { file: t.file, kind: 'library', name: t.name, mood: t.mood || mood, lufs: await measure(t.file) }; }
    if (c.source === 'library') return null;
  }
  if (!fal().key) return null;
  const style = (profile?.musicStyle || 'modern instrumental background music').trim();
  const prompt = [style, idea.music, mood ? `mood: ${moodEnglish[mood]}` : '',
    'instrumental only, no vocals, no singing, clean mix that sits under spoken voice, consistent energy, loopable ending'].filter(Boolean).join('. ');
  const len = kind === 'long' ? Math.min(seconds, c.longMax || 180) : seconds + 1;
  const file = await generate({ prompt, seconds: len, profileId: profile?.id, label: mood || kind });
  return { file, kind: 'ai', name: path.basename(file), mood, prompt, lufs: await measure(file) };
}

const moodEnglish = { episch: 'epic, cinematic', lustig: 'funny, playful, quirky', spannend: 'tense, suspenseful', chillig: 'chill, relaxed, lo-fi',
  energisch: 'energetic, driving, hype', 'fröhlich': 'happy, upbeat, positive', traurig: 'sad, emotional' };

// Lautheit eines Titels einmal messen (integriert, erste 3 Minuten) → feste Verstärkung statt fortlaufender Angleichung
const measured = new Map();
export function measure(file) {
  let st; try { st = fs.statSync(file); } catch { return Promise.resolve(null); }
  const key = file + '|' + st.mtimeMs;
  if (measured.has(key)) return Promise.resolve(measured.get(key));
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-t', '180', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const m = /Integrated loudness:\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(err);
      const v = m ? Number(m[1]) : null;
      if (v != null && v > -70) measured.set(key, v);
      resolve(v != null && v > -70 ? v : null);
    });
  });
}

// ffmpeg-Filter: Eingang 0 = Video mit Stimme (oder ohne Ton), Eingang `idx` = Musik (mit -stream_loop -1).
// Ergebnis-Label [aout]. dur = Länge des Ausgabeclips in Sekunden.
export function mixGraph({ hasVoice, idx = 1, dur, voiceIn = '0:a:0', voiceFilter = 'loudnorm=I=-14:TP=-1.5:LRA=11', track }) {
  const c = cfg();
  const target = hasVoice ? musicLufs() : -16;
  const fadeOut = Math.max(0, dur - 2).toFixed(2);
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  // gemessen → feste Verstärkung (keine Pump-Effekte); sonst wie bisher loudnorm
  const level = Number.isFinite(track?.lufs) ? `volume=${(target - track.lufs).toFixed(1)}dB` : `loudnorm=I=${target}:TP=-2:LRA=11`;
  const music = `[${idx}:a]${fmt},atrim=0:${(dur + 0.5).toFixed(2)},${level},${fmt},`
    + `afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=2`;
  if (!hasVoice) return `${music},alimiter=limit=0.95[aout]`;
  const voice = `[${voiceIn}]${voiceFilter},${fmt}`;
  if (!c.duck) return `${voice}[v1];${music}[m];[v1][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`;
  const d = DUCK[c.duckLevel] || DUCK.leicht;
  return `${voice},asplit=2[v1][v2];${music}[m];[m][v2]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}:knee=${d.knee}:makeup=1[md];`
    + '[v1][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]';
}

// Hinweis für Notiz/Beschreibung
export function noteOf(m) {
  if (!m) return '';
  return m.kind === 'ai' ? ` Musik: KI-generiert (${cfg().model}) – „${m.name}“.` : ` Musik: „${m.name}“ (eigener Ordner).`;
}

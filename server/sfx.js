// Soundeffekte für Shorts: Grundbaukasten (einmal per KI erzeugt und gemerkt), eigene Sounds im Ordner musik/sfx,
// Sonder-Sounds nach Claudes Beschreibung (einmal erzeugt, nach Beschreibung gemerkt).
// KI: fal.ai sonilo/v1.1/text-to-sound-effects (prompt, duration 0,5–180 s, audio_format → audio.url; 0,0018 $/s,
// laut Anbieter kommerziell nutzbar – Schema/Preis am 12.10.2026 per fal-Connector geprüft).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as credits from './credits.js';
import { db, saveNow } from './store.js';
import * as lib from './library.js';

const FAL = process.env.FAL_BASE || 'https://fal.run';
const MODEL = 'sonilo/v1.1/text-to-sound-effects';
const PRICE_PER_S = 0.0018;
const fal = () => db().fal;
export const sfxDir = () => path.join(lib.VIDEO_DIR, 'musik', 'sfx');
const kiDir = () => path.join(sfxDir(), 'ki');
const AUDIO = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'];

// Grundbaukasten: id → [Beschreibung für die KI (englisch), Länge s, deutscher Name]
export const LIBRARY = {
  whoosh: ['fast cinematic whoosh swoosh transition', 0.8, 'Whoosh'],
  rewind: ['VHS tape rewinding, fast reverse whir with mechanical tape squeal', 1.2, 'Band zurückspulen'],
  boom: ['deep cinematic bass boom impact with sub drop', 1.5, 'Bass-Boom'],
  hit: ['punchy short impact hit, video game style', 0.5, 'Treffer'],
  scratch: ['vinyl record scratch stop', 0.8, 'Plattenkratzer'],
  ding: ['bright notification ding bell', 0.8, 'Ding'],
  pop: ['short cartoon pop bubble', 0.4, 'Pop'],
  click: ['camera shutter click', 0.4, 'Kamera-Klick'],
  glitch: ['digital glitch stutter sound', 0.7, 'Glitch'],
  riser: ['tension riser sweep building up', 2.0, 'Spannungsaufbau'],
  drumroll: ['short snare drum roll', 2.0, 'Trommelwirbel'],
  win: ['triumphant short brass fanfare win jingle', 1.5, 'Sieg-Fanfare'],
  fail: ['sad trombone wah wah fail', 1.8, 'Trauriges Posaunen-Fail'],
  gasp: ['small audience gasp, surprised', 1.0, 'Erstaunen'],
  heartbeat: ['tense heartbeat thumps', 1.5, 'Herzschlag'],
  slowmo: ['deep slow motion whoosh, time slowing down', 1.2, 'Zeitlupe'],
  coin: ['video game coin collect sound', 0.5, 'Münze'],
  levelup: ['retro video game level up jingle', 1.2, 'Level-Up'],
  error: ['retro game error buzzer, wrong answer', 0.8, 'Fehler-Summer'],
  alarm: ['short alarm siren alert', 1.2, 'Alarm'],
  swish: ['quick swish swipe', 0.4, 'Swish'],
  thud: ['heavy body fall thud', 0.6, 'Dumpfer Aufprall'],
  sparkle: ['magic sparkle shimmer twinkle', 1.0, 'Glitzern'],
  punch: ['cartoon punch slap', 0.4, 'Cartoon-Schlag'],
  sting: ['dramatic orchestral sting, dun dun dun', 1.6, 'Drama-Sting'],
  cash: ['cash register cha-ching', 0.8, 'Kasse'],
  typing: ['fast keyboard typing', 1.0, 'Tippen'],
  printer: ['mechanical 3D printer stepper motors whirring', 1.5, '3D-Drucker'],
  clock: ['clock ticking fast', 1.5, 'Uhr tickt'],
  explosion: ['short explosion with debris', 1.5, 'Explosion'],
};

const exists = (f) => { try { return fs.statSync(f).size > 500; } catch { return false; } };
const libFile = (id) => path.join(kiDir(), `${id}.m4a`);
const slug = (s) => String(s).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Eigene Sounds des Kunden (musik/sfx/*.mp3 …): Name ohne Endung → Datei. Gleicher Name wie im Baukasten ersetzt diesen.
export function ownSounds() {
  const out = {};
  try { for (const n of fs.readdirSync(sfxDir())) if (AUDIO.includes(path.extname(n).toLowerCase()) && !n.startsWith('.')) out[slug(n)] = path.join(sfxDir(), n); } catch { /* Ordner fehlt */ }
  return out;
}
// Für Claude: verfügbare Sound-IDs (Baukasten + eigene)
export function available() {
  const own = ownSounds();
  return { library: Object.keys(LIBRARY), own: Object.keys(own).filter((k) => !LIBRARY[k]) };
}

export function status() {
  const own = ownSounds();
  return { model: MODEL, dir: 'musik/sfx', ready: Object.keys(LIBRARY).filter((id) => exists(libFile(id)) || own[id]).length, total: Object.keys(LIBRARY).length,
    sounds: Object.entries(LIBRARY).map(([id, [, len, name]]) => ({ id, name, len, ready: !!(own[id] || exists(libFile(id))), own: !!own[id] })),
    own: Object.keys(own).filter((k) => !LIBRARY[k]), custom: (() => { try { return fs.readdirSync(kiDir()).filter((n) => n.startsWith('x-') && n.endsWith('.m4a')).length; } catch { return 0; } })(),
    spent: db().sfx?.spent || 0, generated: db().sfx?.generated || 0, falKey: !!fal()?.key };
}

function ff(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => resolve({ ok: false, err: 'ffmpeg fehlt' }));
    p.on('close', (code) => resolve({ ok: code === 0, err }));
  });
}

// Einen Sound per KI erzeugen → normalisierte .m4a (gleich laut, damit das Mischen planbar ist)
async function generate(prompt, seconds, file) {
  if (!fal()?.key) throw new Error('fal.ai-Schlüssel fehlt (Einstellungen → Titelbilder & Fotos).');
  const duration = Math.max(0.5, Math.min(10, Number(seconds) || 1));
  const r = await fetch(`${FAL}/${MODEL}`, {
    method: 'POST', headers: { Authorization: 'Key ' + fal().key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, duration, audio_format: 'aac' }),
  });
  const j = await r.json().catch(() => ({}));
  { const fe = credits.falError(r.status, j); if (fe) throw new Error(fe); }
  const url = j.audio?.url || j.audios?.[0]?.url;
  if (!r.ok || !url) throw new Error('fal.ai-Sound: ' + (j.detail?.[0]?.msg || j.detail || j.error || r.status));
  const a = await fetch(url);
  if (!a.ok) throw new Error('fal.ai-Sound: Ergebnis nicht abrufbar.');
  fs.mkdirSync(kiDir(), { recursive: true });
  const raw = file + '.roh';
  fs.writeFileSync(raw, Buffer.from(await a.arrayBuffer()));
  // auf −16 LUFS (Spitzen −1,5 dB) bringen, 48 kHz Stereo
  const n = await ff(['-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000', '-ac', '2', '-c:a', 'aac', '-b:a', '160k', file]);
  if (!n.ok) fs.renameSync(raw, file); else fs.rmSync(raw, { force: true });
  fs.writeFileSync(file.replace(/\.m4a$/, '.txt'), [`Modell: ${MODEL}`, `Erzeugt: ${new Date().toISOString()}`, `Länge: ${duration} s`, `Prompt: ${prompt}`].join('\n') + '\n');
  const c = (db().sfx ||= {});
  c.generated = (c.generated || 0) + 1;
  c.spent = Math.round(((c.spent || 0) + duration * PRICE_PER_S) * 10000) / 10000;
  saveNow();
  return file;
}

// Baukasten-Sound holen (eigene Datei › schon erzeugt › jetzt erzeugen) → Pfad oder null
export async function get(id) {
  const own = ownSounds();
  if (own[id]) return own[id];
  const def = LIBRARY[id];
  if (!def) return null;
  const f = libFile(id);
  if (exists(f)) return f;
  if (!fal()?.key) return null;
  try { return await generate(def[0], def[1], f); } catch (e) { console.error('Sound', id, e.message); return null; }
}

// Sonder-Sound nach Beschreibung (einmal erzeugt, danach aus dem Speicher)
export async function custom(prompt, seconds = 1) {
  const p = String(prompt || '').trim().slice(0, 200);
  if (!p) return null;
  const f = path.join(kiDir(), 'x-' + crypto.createHash('sha1').update(p.toLowerCase()).digest('hex').slice(0, 16) + '.m4a');
  if (exists(f)) return f;
  if (!fal()?.key) return null;
  try { return await generate(p, seconds, f); } catch (e) { console.error('Sonder-Sound', e.message); return null; }
}

// ganzen Baukasten erzeugen (Knopf in den Einstellungen) → Anzahl neu erzeugt
let building = null;
export function buildLibrary() {
  if (building) return building;
  building = (async () => {
    let n = 0;
    for (const id of Object.keys(LIBRARY)) {
      if (ownSounds()[id] || exists(libFile(id))) continue;
      await get(id);
      if (exists(libFile(id))) n++;
    }
    return n;
  })().finally(() => { building = null; });
  return building;
}
export const isBuilding = () => !!building;
export function fileFor(id) { const own = ownSounds(); return own[id] || (exists(libFile(id)) ? libFile(id) : null); }

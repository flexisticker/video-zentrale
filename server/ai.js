// Claude schlägt Titel, Beschreibung, Tags, TikTok-Text, Kanal und Titelbild vor.
// Grundlage: Standbilder aus dem Video + Dateiname/Notiz + Kanal-Angaben. (Ton/Sprache hört Claude nicht.)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as profiles from './profiles.js';
import { fileOf, setImage } from './library.js';

const MODEL = 'claude-opus-5-5';
const FRAMES = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
const FRAME_DIR = path.join(DATA_DIR, 'ki');
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }; // US-$ je Token (Claude Opus 5.5)

const cfg = () => db().ai;

export function status() {
  const c = cfg();
  return { configured: !!c.apiKey, auto: c.auto, hints: c.hints, keyHint: c.apiKey ? '…' + c.apiKey.slice(-4) : '',
    spent: c.spent || 0, count: c.count || 0 };
}

export function configure(b) {
  const c = cfg();
  if (typeof b.apiKey === 'string' && b.apiKey.trim() && b.apiKey.trim() !== c.apiKey) {
    c.apiKey = b.apiKey.trim();
    // am alten Schlüssel gescheiterte Videos dürfen automatisch neu
    for (const v of Object.values(db().videos)) if (v.ai?.state === 'error' && !v.ai.titles) delete v.ai;
  }
  if (b.removeKey === true) c.apiKey = '';
  if (typeof b.auto === 'boolean') c.auto = b.auto;
  if (typeof b.hints === 'string') c.hints = b.hints.slice(0, 3000);
  saveNow();
  autoQueue();
}

export const framePath = (v, n) => path.join(FRAME_DIR, `${v.id}-${n}.jpg`);

function ffmpeg(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), 120_000);
    p.on('error', () => { clearTimeout(t); resolve(false); });
    p.on('close', (c) => { clearTimeout(t); resolve(c === 0); });
  });
}

async function extractFrames(v) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const out = [];
  for (let i = 0; i < FRAMES.length; i++) {
    const at = v.duration ? (v.duration * FRAMES[i]).toFixed(2) : String(i);
    const file = framePath(v, i + 1);
    // längste Seite max. 1280 px – reicht Claude und hält die Kosten klein
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', fileOf(v),
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'", '-frames:v', '1', '-q:v', '4', file]);
    if (ok && fs.existsSync(file)) out.push({ n: i + 1, file, at: Number(at) });
  }
  if (!out.length) throw new Error('Keine Standbilder lesbar (ffmpeg).');
  return out;
}

function schema(ids) {
  const s = (description) => ({ type: 'string', description });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'game', 'channel', 'channelReason', 'titles', 'description', 'tags', 'tiktok', 'thumbnailFrame', 'thumbnailText'],
    properties: {
      summary: s('Ein Satz: was im Video passiert (für den Creator, nicht fürs Publikum).'),
      game: s('Erkanntes Spiel bzw. Produkt/Thema, leer wenn unklar.'),
      channel: { type: 'string', enum: ids, description: 'Kanal-ID, zu dem das Video am besten passt.' },
      channelReason: s('Kurze Begründung für den Kanal.'),
      titles: { type: 'array', items: { type: 'string' }, description: 'Genau 3 YouTube-Titel, je höchstens 90 Zeichen, unterschiedlich im Stil.' },
      description: s('YouTube-Beschreibung: starke erste Zeile, 2–4 kurze Absätze, ohne Hashtag-Block, ohne erfundene Links.'),
      tags: { type: 'array', items: { type: 'string' }, description: '8–15 YouTube-Tags ohne #, kleingeschrieben.' },
      tiktok: s('TikTok-Text: 1–2 kurze Sätze mit Hook + 3–6 passende Hashtags, höchstens 300 Zeichen.'),
      thumbnailFrame: { type: 'integer', description: 'Nummer des Standbilds (1–6), das sich am besten als Titelbild eignet.' },
      thumbnailText: s('2–4 Wörter als Text fürs Titelbild (groß, knallig).'),
    },
  };
}

function prompt(v, frames, extra) {
  const lines = profiles.list().map((p) =>
    `- ID "${p.id}" = ${p.name}${p.isDefault ? ' (Standard)' : ''}: ${p.aiStyle || 'keine Beschreibung'}. Stichwörter: ${p.keywords || '–'}. Standard-Tags: ${p.tags || '–'}`);
  const orient = v.width && v.height ? (v.height > v.width ? 'Hochformat (Short/TikTok)' : 'Querformat') : 'unbekannt';
  return [
    'Du hilfst einem deutschen Creator, seine Videos für YouTube und TikTok zu veröffentlichen.',
    'Schreibe auf Deutsch, locker und direkt (Du-Form ans Publikum), ohne Übertreibung und ohne Clickbait-Lügen:',
    'alles, was du schreibst, muss zu dem passen, was auf den Standbildern zu sehen ist. Erfinde keine Fakten, Links oder Namen.',
    'Wenn du etwas nicht sicher erkennst (z. B. das Spiel), formuliere allgemein statt zu raten.',
    '',
    'Kanäle:',
    ...lines,
    cfg().hints ? '\nAllgemeine Hinweise des Creators:\n' + cfg().hints : '',
    '',
    'Video:',
    `- Dateiname: ${v.file}`,
    `- Bisheriger Titel: ${v.title || '–'}`,
    `- Länge: ${v.duration ? Math.round(v.duration) + ' Sekunden' : 'unbekannt'}, ${orient}`,
    v.tags ? `- Bisherige Tags: ${v.tags}` : '',
    v.note ? `- Notiz des Creators: ${v.note}` : '',
    v.channel ? `- Der Creator hat den Kanal "${v.channel}" gewählt – schreibe passend dazu.` : '',
    extra ? `- Hinweis für diesen Vorschlag: ${extra}` : '',
    '',
    `Es folgen ${frames.length} Standbilder in zeitlicher Reihenfolge (Nummer und Zeitpunkt stehen davor).`,
  ].filter((l) => l !== '').join('\n');
}

let client = null, clientKey = '';
function api() {
  const key = cfg().apiKey;
  if (!key) throw new Error('Kein Claude-API-Schlüssel eingetragen (Einstellungen → Claude).');
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 180_000 }); clientKey = key; }
  return client;
}

function friendly(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Claude-API-Schlüssel ungültig – unter Einstellungen → Claude prüfen.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Der API-Schlüssel darf dieses Modell nicht nutzen.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude ist gerade ausgelastet bzw. Limit erreicht – später erneut versuchen.';
  if (e instanceof Anthropic.BadRequestError) return /credit|balance/i.test(e.message) ? 'Kein Guthaben mehr im Anthropic-Konto (console.anthropic.com → Billing).' : 'Claude lehnt die Anfrage ab: ' + e.message;
  if (e instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu Claude (Internet/Firewall des Servers?).';
  if (e instanceof Anthropic.APIError) return `Claude-Fehler ${e.status}: ${e.message}`;
  return e.message;
}

// Vorschlag erzeugen und am Video speichern.
export async function suggest(v, extra = '') {
  const frames = await extractFrames(v);
  const ids = profiles.list().map((p) => p.id);
  const content = [{ type: 'text', text: prompt(v, frames, extra) }];
  for (const f of frames) {
    content.push({ type: 'text', text: `Standbild ${f.n} (bei ${Math.round(f.at)} s):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f.file).toString('base64') } });
  }
  let r;
  try {
    r = await api().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // lehnt Claude ab, versucht es Anthropic automatisch mit einem passenden anderen Modell
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema(ids) } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('Claude hat diesen Vorschlag abgelehnt (Inhaltsprüfung).');
  if (r.stop_reason === 'max_tokens') throw new Error('Antwort von Claude abgeschnitten – bitte erneut versuchen.');
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('Antwort von Claude nicht lesbar.'); }
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const c = cfg();
  c.spent = Math.round(((c.spent || 0) + cost) * 10000) / 10000; c.count = (c.count || 0) + 1;
  const clip = (x, n) => String(x || '').slice(0, n);
  v.ai = {
    state: 'done', at: new Date().toISOString(), model: r.model || MODEL, cost: Math.round(cost * 10000) / 10000,
    frames: frames.map((f) => f.n),
    summary: clip(out.summary, 500), game: clip(out.game, 100),
    channel: ids.includes(out.channel) ? out.channel : '', channelReason: clip(out.channelReason, 300),
    titles: (Array.isArray(out.titles) ? out.titles : []).map((t) => clip(t, 100)).filter(Boolean).slice(0, 5),
    description: clip(out.description, 4500),
    tags: (Array.isArray(out.tags) ? out.tags : []).map((t) => clip(String(t).replace(/^#/, ''), 60)).filter(Boolean).slice(0, 20),
    tiktok: clip(out.tiktok, 2200),
    thumbnailFrame: Number.isInteger(out.thumbnailFrame) && frames.some((f) => f.n === out.thumbnailFrame) ? out.thumbnailFrame : frames[0].n,
    thumbnailText: clip(out.thumbnailText, 60),
  };
  // Noch nichts von Hand oder per .json eingetragen → Vorschlag gleich übernehmen (bleibt änderbar).
  if (!v.editedAt && !v.metaAt) {
    const a = v.ai;
    if (a.titles[0]) v.title = a.titles[0];
    v.description = a.description;
    v.tags = a.tags.join(', ');
    v.tiktok = a.tiktok;
    a.applied = true;
  }
  if (!v.image) {
    try { setImage(v, fs.readFileSync(framePath(v, v.ai.thumbnailFrame)), '.jpg'); v.ai.coverApplied = true; } catch { /* egal */ }
  }
  saveNow();
  return v.ai;
}

// ---- Warteschlange (eins nach dem anderen) ----
const queue = [];
let running = false;

export function enqueue(v, extra = '') {
  if (!cfg().apiKey) throw new Error('Kein Claude-API-Schlüssel eingetragen (Einstellungen → Claude).');
  if (['queued', 'running'].includes(v.ai?.state)) return;
  v.ai = { ...(v.ai || {}), state: 'queued', error: '' };
  queue.push({ id: v.id, extra });
  save();
  next();
}

async function next() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  const v = db().videos[job.id];
  try {
    if (v && !v.missing) {
      v.ai = { ...v.ai, state: 'running' }; save();
      await suggest(v, job.extra);
    }
  } catch (e) {
    if (v) { v.ai = { ...v.ai, state: 'error', error: e.message }; saveNow(); }
  } finally { running = false; next(); }
}

// Neue geschnittene Videos automatisch vorschlagen lassen (nur einmal je Video).
export function autoQueue() {
  const c = cfg();
  if (!c.apiKey || !c.auto) return;
  for (const v of Object.values(db().videos)) {
    if (v.folder === 'geschnitten' && !v.missing && v.duration != null && !v.ai) enqueue(v);
  }
}

export function init() {
  for (const v of Object.values(db().videos)) {
    if (['queued', 'running'].includes(v.ai?.state)) v.ai = { ...v.ai, state: v.ai.titles ? 'done' : 'error', error: v.ai.titles ? '' : 'Durch Neustart unterbrochen.' };
  }
}

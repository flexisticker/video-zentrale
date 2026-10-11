// Claude schlägt Titel, Beschreibung, Tags, TikTok-Text, Kanal und Titelbild vor.
// Grundlage: Standbilder aus dem Video + Dateiname/Notiz + Kanal-Angaben. (Ton/Sprache hört Claude nicht.)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { db, save, saveNow, DATA_DIR } from './store.js';
import * as profiles from './profiles.js';
import { fileOf, setImage } from './library.js';
import * as whisper from './whisper.js';
import * as thumbs from './thumbs.js';

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

function schema(ids, labels) {
  const s = (description) => ({ type: 'string', description });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'game', 'channel', 'channelReason', 'titles', 'description', 'tags', 'tiktok', 'thumbnailFrame', 'thumbnailText', 'thumbs'],
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
      thumbs: { type: 'array', description: 'Genau 3 unterschiedliche Titelbild-Ideen (Bild, Foto des Creators, Text, Seite des Fotos).',
        items: { type: 'object', additionalProperties: false, required: ['frame', 'photo', 'text', 'side'], properties: {
          frame: { type: 'integer', description: 'Standbild-Nummer 1–6 als Hintergrund' },
          photo: { type: 'string', enum: labels, description: 'Gesichtsausdruck des Creators, der zur Szene passt ("" = kein Foto)' },
          text: s('2–4 Wörter, neugierig machend, nicht identisch mit dem Titel'),
          side: { type: 'string', enum: ['left', 'right'], description: 'Seite für das Foto; der Text kommt auf die andere Seite – wähle die Seite, auf der im Standbild weniger Wichtiges ist' },
        } } },
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
    v.transcriptText ? `- Gesprochener Text (automatisch erkannt, kann Fehler enthalten): „${v.transcriptText.slice(0, 12000)}“` : '',
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
  // Gesprochenes erkennen, wenn Whisper an ist und das Video noch kein Transkript hat (z. B. von Hand geschnitten)
  if (!v.transcriptText && !v.source && db().cut?.whisper?.enabled) {
    try { const segs = await whisper.transcribe(fileOf(v), v.id); whisper.saveTranscript(v, segs); } catch { /* ohne Ton weiter */ }
  }
  const frames = await extractFrames(v);
  const ids = profiles.list().map((p) => p.id);
  const labels = ['', ...new Set(thumbs.photos().map((p) => p.label))];
  const content = [{ type: 'text', text: prompt(v, frames, extra) + (labels.length > 1
    ? `\n\nFür Titelbilder gibt es freigestellte Fotos des Creators mit diesen Gesichtsausdrücken: ${labels.filter(Boolean).join(', ')}.`
      + ' Gute Titelbilder: ein klares Gefühl im Gesicht, das zur Szene passt, 2–4 große Wörter, starker Kontrast, neugierig machend.'
    : '\n\nEs gibt (noch) keine Fotos des Creators – nimm photo "".') }];
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
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema(ids, labels) } },
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
    thumbs: (Array.isArray(out.thumbs) ? out.thumbs : []).slice(0, 3).map((t) => ({
      frame: frames.some((f) => f.n === t.frame) ? t.frame : frames[0].n, photo: clip(t.photo, 30),
      text: clip(t.text, 60), side: t.side === 'left' ? 'left' : 'right' })),
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
  // Titelbild-Varianten (Standbild + Foto + Text); ohne eigenes Titelbild gleich Variante 1 nehmen
  let vars = [];
  try { vars = await thumbs.makeVariants(v, (n) => { const f = framePath(v, n); return fs.existsSync(f) ? f : null; }); } catch (e) { console.error('Varianten', e.message); }
  if (!v.image) {
    try {
      const src = vars.length ? thumbs.variantPath(v, 1) : framePath(v, v.ai.thumbnailFrame);
      setImage(v, fs.readFileSync(src), '.jpg'); v.ai.coverApplied = true;
    } catch { /* egal */ }
  }
  saveNow();
  return v.ai;
}

// Aus Kandidaten-Stellen eines Rohvideos die besten Shorts wählen.
// cands: [{start, end, peak, scenes}] (Sekunden); segs: Whisper-Segmente oder null.
export async function chooseHighlights(v, cands, segs, c) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const content = [{ type: 'text', text: [
    'Du schneidest aus einer Rohaufnahme die besten Kurzvideos (Shorts/TikTok) für einen deutschen Creator.',
    `Wähle bis zu ${c.shorts} Stellen, die allein funktionieren: klarer Moment (Sieg, Fail, Überraschung, Lacher, Erklärung mit Pointe),`,
    'starker Anfang in den ersten 2 Sekunden, Ende nach der Pointe. Lieber weniger, wenn nichts taugt (dann leere Liste).',
    `Länge je Short ${c.shortMin}–${c.shortMax} Sekunden. Start/Ende dürfen bis zu 15 Sekunden um den Kandidaten verschoben werden.`,
    `Video: „${v.file}“, Länge ${whisper.fmtTime(v.duration)}. ${v.note ? 'Notiz: ' + v.note : ''}`,
    segs?.length ? 'Gesprochenes ist je Kandidat angegeben (automatisch erkannt, kann Fehler enthalten).' : 'Kein gesprochener Text verfügbar.',
    '',
    'Kandidaten (aus Lautstärke und Bildwechseln vorsortiert); zu jedem folgt ein Standbild aus der Mitte:',
  ].join('\n') }];
  for (let i = 0; i < cands.length; i++) {
    const k = cands[i];
    const mid = (k.start + k.end) / 2;
    const file = path.join(FRAME_DIR, `${v.id}-k${i + 1}.jpg`);
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', mid.toFixed(2), '-i', fileOf(v),
      '-vf', "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))'", '-frames:v', '1', '-q:v', '5', file]);
    const said = segs ? whisper.textOf(segs, k.start - 5, k.end + 5).slice(0, 600) : '';
    content.push({ type: 'text', text: `Kandidat ${i + 1}: ${whisper.fmtTime(k.start)}–${whisper.fmtTime(k.end)} (Sekunde ${k.start}–${k.end}), `
      + `lauteste Stelle ${k.peak} LUFS, ${k.scenes} Bildwechsel${said ? `, gesagt: „${said}“` : ''}` });
    if (ok && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
      fs.rmSync(file, { force: true });
    }
  }
  const schemaH = {
    type: 'object', additionalProperties: false, required: ['shorts'],
    properties: { shorts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['candidate', 'start', 'end', 'title', 'reason'],
      properties: {
        candidate: { type: 'integer', description: 'Nummer des Kandidaten' },
        start: { type: 'number', description: 'Start in Sekunden ab Videoanfang' },
        end: { type: 'number', description: 'Ende in Sekunden ab Videoanfang' },
        title: { type: 'string', description: 'Kurzer, packender Titel für den Short (höchstens 70 Zeichen)' },
        reason: { type: 'string', description: 'Ein Satz: warum diese Stelle' },
      } } } },
  };
  let r;
  try {
    r = await api().beta.messages.create({
      model: MODEL, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schemaH } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) { throw new Error(friendly(e)); }
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const a = cfg(); a.spent = Math.round(((a.spent || 0) + cost) * 10000) / 10000; a.count = (a.count || 0) + 1; save();
  const dur = v.duration;
  const picked = [];
  for (const s of (out.shorts || []).slice(0, c.shorts)) {
    const k = cands[s.candidate - 1];
    if (!k) continue;
    let start = Math.max(0, Math.max(k.start - 15, Math.min(Number(s.start), k.end)));
    let end = Math.min(dur, Math.min(k.end + 15, Math.max(Number(s.end), start + c.shortMin)));
    if (end - start > c.shortMax) end = start + c.shortMax;
    if (end - start < Math.min(c.shortMin, 10)) continue;
    if (picked.some((p) => start < p.end && end > p.start)) continue;
    picked.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, title: String(s.title || '').slice(0, 100), reason: String(s.reason || '').slice(0, 300) });
  }
  return picked;
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

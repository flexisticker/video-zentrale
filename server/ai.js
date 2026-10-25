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
import * as fx from './cutfx.js';
import * as sfx from './sfx.js';
import * as credits from './credits.js';
import * as bounds from './bounds.js';
import * as vision from './vision.js';
import * as llm from './llm.js';
import { STYLES, STYLE_IDS, HOOK_LOOKS } from './captions.js';

const MODEL = 'claude-opus-5-5';
const FRAMES = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
const FRAME_DIR = path.join(DATA_DIR, 'ki');
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 }; // US-$ je Token (Claude Opus 5.5)

const cfg = () => db().ai;

export function status() {
  const c = cfg();
  return { configured: !!c.apiKey, auto: c.auto, autoTips: c.autoTips !== false, qc: c.qc !== false, scout: c.scout !== false, cutEffort: cutEffort(), hints: c.hints, keyHint: c.apiKey ? '…' + c.apiKey.slice(-4) : '',
    spent: c.spent || 0, count: c.count || 0, blocked: claudeBlocked() };
}

export function configure(b) {
  const c = cfg();
  if (typeof b.apiKey === 'string' && b.apiKey.trim() && b.apiKey.trim() !== c.apiKey) {
    c.apiKey = b.apiKey.trim();
    delete c.blocked;   // neuer Schlüssel → Claude wieder versuchen
    // am alten Schlüssel gescheiterte Videos dürfen automatisch neu
    for (const v of Object.values(db().videos)) if (v.ai?.state === 'error' && !v.ai.titles) delete v.ai;
  }
  if (b.removeKey === true) c.apiKey = '';
  if (b.unblock === true) delete c.blocked;
  if (typeof b.auto === 'boolean') c.auto = b.auto;
  if (typeof b.autoTips === 'boolean') c.autoTips = b.autoTips;
  if (typeof b.qc === 'boolean') c.qc = b.qc;
  if (typeof b.scout === 'boolean') c.scout = b.scout;
  if (CUT_EFFORTS.includes(b.cutEffort)) c.cutEffort = b.cutEffort;
  if (typeof b.hints === 'string') c.hints = b.hints.slice(0, 3000);
  saveNow();
  autoQueue();
}

// Wird nach jedem fertigen Vorschlag aufgerufen (z. B. Viral-Tipps automatisch umsetzen – siehe autocut.autoApplyTips)
let suggested = null;
export function afterSuggest(fn) { suggested = fn; }

// Schnitt-Entscheidungen (Highlights, Kurzfassung, Überarbeiten): höchste Denkstufe, gestreamt (lange Denkzeit → kein HTTP-Timeout)
export const CUT_EFFORTS = ['medium', 'high', 'xhigh', 'max'];
export const cutEffort = () => (CUT_EFFORTS.includes(cfg().cutEffort) ? cfg().cutEffort : 'max');
// Ein KI-Auftrag: je nach Einstellung lokal (Ollama, llm.js) oder Claude; „auto“ = lokal, bei Fehler Claude.
// → { out, engine, model, vision (Bilder gesehen?), cost }
// Claude gesperrt (kein Guthaben, Schlüssel ungültig/ohne Rechte)? → 6 Stunden lang gar nicht erst fragen, alles lokal
const BLOCK_MS = 6 * 3600_000;
const isBlockErr = (e) => e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError
  || (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(e.message));
export function claudeBlocked() { const b = cfg().blocked; return b?.at && Date.now() - Date.parse(b.at) < BLOCK_MS ? b : null; }
export function unblockClaude() { delete cfg().blocked; saveNow(); }
const claudeUsable = () => !!cfg().apiKey && !claudeBlocked();
export function canAsk(task) {
  const m = llm.modeOf(task);
  if (m === 'lokal') return llm.ready();
  return claudeUsable() || llm.ready();   // Claude-Aufgaben laufen lokal weiter, wenn Claude nicht geht
}
export async function ask(task, content, schema, { effort, maxTokens = 64000 } = {}) {
  const mode = llm.modeOf(task);
  const local = async (why = '') => ({ ...(await llm.chat(task, content, schema, PRICE)), cost: 0, ...(why ? { why } : {}) });
  let localErr = null;
  // lokal zuerst: Aufgabe steht auf lokal/auto – oder Claude ist gesperrt bzw. ohne Schlüssel
  if ((mode !== 'claude' || !claudeUsable()) && llm.ready()) {
    try { return await local(mode === 'claude' ? (cfg().apiKey ? 'Claude gesperrt' : 'kein Claude-Schlüssel') : ''); }
    catch (e) { localErr = e; if (mode === 'lokal' || !claudeUsable()) throw new Error('Lokale KI: ' + e.message); }
  } else if (mode === 'lokal') throw new Error('Lokale KI nicht erreichbar (Ollama-Adresse fehlt bzw. PC nicht freigegeben).');
  if (!cfg().apiKey) throw new Error('Kein Claude-API-Schlüssel und keine lokale KI eingerichtet (Einstellungen).');
  if (claudeBlocked()) throw new Error(`Claude gesperrt (${claudeBlocked().reason}) und keine lokale KI erreichbar – Einstellungen → Lokale KI.`);
  let r;
  try {
    r = await api().beta.messages.stream({ model: MODEL, max_tokens: maxTokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: effort || cutEffort(), format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content }] }).finalMessage();
  } catch (e) {
    const msg = friendly(e);
    if (isBlockErr(e)) {
      cfg().blocked = { at: new Date().toISOString(), reason: msg }; saveNow();
      if (llm.ready() && !localErr) { try { return await local('Claude gesperrt'); } catch (x) { throw new Error(msg + ' Lokale KI: ' + x.message); } }
    }
    throw new Error(msg);
  }
  const cost = (r.usage?.input_tokens || 0) * PRICE.input + (r.usage?.output_tokens || 0) * PRICE.output;
  const a = cfg(); a.spent = Math.round(((a.spent || 0) + cost) * 10000) / 10000; a.count = (a.count || 0) + 1; save();
  llm.recordClaude(task, cost, (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0));
  if (r.stop_reason === 'refusal') throw new Error('abgelehnt');
  if (r.stop_reason === 'max_tokens') throw new Error('Claude hat zu lange nachgedacht (Antwort abgeschnitten) – bitte noch einmal starten.');
  return { out: JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('')), engine: localErr ? 'Claude (lokal gescheitert)' : 'Claude', model: r.model || MODEL, vision: true, cost };
}
async function cutCall(content, schema, { effort, task = 'schnitt' } = {}) { return (await ask(task, content, schema, { effort })).out; }
const SENTENCE_RULES = 'SAUBERE SCHNITTE (sehr wichtig): Schneide nie mitten im Satz. Das Gesprochene ist in nummerierte Sätze zerlegt (S12 [Start–Ende] Text). '
  + 'Gib Anfang und Ende als Satznummern an (fromSentence = erster Satz, toSentence = letzter Satz des Clips); geschnitten wird kurz vor dem ersten und '
  + 'kurz nach dem letzten Satz. Der Clip beginnt mit einem Satz, der ohne Vorwissen verständlich ist (nicht mit „und dann …“ als Antwort auf etwas Fehlendes), '
  + 'und endet nach der Pointe bzw. Reaktion – nicht nach einer halben Aussage. Folgt direkt auf die Pointe eine kurze Reaktion (Lachen, „Alter!“), nimm sie mit. '
  + 'Ohne Sprache an der Stelle: fromSentence/toSentence = 0, dann zählen start/end (Sekunden) – lege sie in einen ruhigen Moment oder auf einen Bildwechsel, nicht mitten in die Action.';

// für trailer.js
export { cutCall, SENTENCE_RULES };

export const framePath = (v, n) => path.join(FRAME_DIR, `${v.id}-${n}.jpg`);

function ffmpeg(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), 120_000);
    p.on('error', () => { clearTimeout(t); resolve(false); });
    p.on('close', (c) => { clearTimeout(t); resolve(c === 0); });
  });
}

// Standbilder sicherstellen (auch ohne Claude-Vorschlag, z. B. für KI-Titelbilder) → Nummern der vorhandenen Bilder
export async function ensureFrames(v) {
  const have = FRAMES.map((_, i) => i + 1).filter((n) => fs.existsSync(framePath(v, n)));
  if (have.length >= 3) return have;
  return (await extractFrames(v)).map((x) => x.n);
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

function schema(ids, labels, pro = false) {
  const s = (description) => ({ type: 'string', description });
  if (pro) return proSchema(ids, labels, s);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'game', 'channel', 'channelReason', 'titles', 'description', 'tags', 'tiktok', 'thumbnailFrame', 'thumbnailText', 'thumbs', 'aiThumb', 'viral'],
    properties: {
      summary: s('Ein Satz: was im Video passiert (für den Creator, nicht fürs Publikum).'),
      viral: { type: 'object', additionalProperties: false, required: ['score', 'why', 'tip', 'hook', 'edit', 'packaging', 'nextTime'],
        description: 'Ehrliche Einschätzung des Viral-Potenzials dieses Videos auf der Zielplattform – wie ein erfahrener Creator-Coach, direkt und konkret.',
        properties: { score: { type: 'integer', description: '1 = kaum, 10 = sehr hoch' }, why: s('Ein Satz Begründung (Hook, Emotion, Überraschung, Teilwert …)'),
          tip: s('Der wichtigste Tipp in einem Satz'),
          hook: s('Tipp zum Einstieg/Hook: wie die ersten 2 Sekunden fesseln (konkret, bezogen auf dieses Video)'),
          edit: s('Tipp zu Schnitt/Inhalt: was raus, kürzer, schneller, was betonen'),
          packaging: s('Tipp zu Titel/Titelbild/Text: was klickstärker wäre'),
          nextTime: s('Tipp für den Creator fürs nächste Mal beim Aufnehmen (z. B. Reaktionen laut aussprechen, Facecam, Ziel vorher ansagen)') } },
      game: s('Erkanntes Spiel bzw. Produkt/Thema, leer wenn unklar.'),
      channel: { type: 'string', enum: ids, description: 'Kanal-ID, zu dem das Video am besten passt.' },
      channelReason: s('Kurze Begründung für den Kanal.'),
      titles: { type: 'array', items: { type: 'string' }, description: 'Genau 3 YouTube-Titel, je höchstens 90 Zeichen, unterschiedlich im Stil.' },
      description: s('YouTube-Beschreibung: starke erste Zeile, 2–4 kurze Absätze, ohne Hashtag-Block, ohne erfundene Links.'),
      tags: { type: 'array', items: { type: 'string' }, description: '8–15 YouTube-Tags ohne #, kleingeschrieben.' },
      tiktok: s('TikTok-Text: 1–2 kurze Sätze mit Hook + 3–6 passende Hashtags, höchstens 300 Zeichen.'),
      thumbnailFrame: { type: 'integer', description: 'Nummer des Standbilds (1–6), das sich am besten als Titelbild eignet.' },
      thumbnailText: s('2–4 Wörter als Text fürs Titelbild (groß, knallig).'),
      aiThumb: { type: 'object', additionalProperties: false, required: ['frame', 'photo', 'text', 'scene'],
        description: 'Idee für ein von einer Bild-KI erzeugtes Titelbild (das stärkste, klickstärkste).',
        properties: {
          frame: { type: 'integer', description: 'Standbild-Nummer 1–6 als Szenen-Vorlage' },
          photo: { type: 'string', enum: labels, description: 'Gesichtsausdruck des Creators ("" = Creator nicht ins Bild)' },
          text: s('2–4 Wörter Schlagzeile fürs Bild, exakt so geschrieben, wie sie erscheinen soll'),
          scene: s('Auf Englisch: Bildaufbau für die Bild-KI – was im Vordergrund/Hintergrund passiert, Pose und Emotion der Person, '
            + 'Licht und Farben, wo der Text steht. Konkret, bildhaft, 2–4 Sätze, ohne den Text selbst zu wiederholen.'),
        } },
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

// LinkedIn: gleiche Felder, andere Bedeutung (titles = Einstiegszeilen, description = Beitrag, tags = Hashtags, tiktok = Kurzfassung)
function proSchema(ids, labels, s) {
  const base = schema(ids, labels, false);
  const P = base.properties;
  P.titles = { type: 'array', items: { type: 'string' }, description: 'Genau 3 mögliche Einstiegszeilen (Hook) für den LinkedIn-Beitrag, je höchstens 90 Zeichen, sachlich und neugierig machend, Ich-Form, ohne Emojis.' };
  P.description = s('Der komplette LinkedIn-Beitrag in der Ich-Form (Michael postet als Person): erste Zeile = stärkster Hook (gleich dem ersten Titel), '
    + 'danach 3–6 kurze Absätze mit konkretem Mehrwert für Geschäftskunden (Problem → Lösung → Ergebnis bzw. Erfahrung/Tipp), professionell und seriös, '
    + 'ohne Übertreibung, ohne Marktschreierei, höchstens 1–2 dezente Emojis oder keine, am Ende eine offene Frage an das Netzwerk. 700–1500 Zeichen. '
    + 'Keine Hashtags im Text, keine erfundenen Zahlen, Kunden oder Links.');
  P.tags = { type: 'array', items: { type: 'string' }, description: '3–5 passende, gebräuchliche LinkedIn-Hashtags ohne #, z. B. 3ddruck, textildruck, werbetechnik, handwerk, mittelstand.' };
  P.tiktok = s('Ein Satz Kurzfassung als Videotitel bei LinkedIn (höchstens 100 Zeichen).');
  P.thumbnailText = s('2–4 sachliche Wörter fürs Titelbild (seriös, kein Clickbait).');
  P.aiThumb.properties.scene = s('Auf Englisch: Bildaufbau für ein seriöses, professionelles Titelbild (clean corporate look, ruhige Mimik, '
    + 'Werkstatt/Produkt im Fokus, natürliches Licht, dezente Farben). Konkret, 2–4 Sätze, ohne den Text selbst zu wiederholen.');
  return base;
}

function proPrompt(v, frames, extra, profile) {
  const orient = v.width && v.height ? (v.height > v.width ? 'Hochformat' : 'Querformat') : 'unbekannt';
  return [
    'Du hilfst Michael, Inhaber von Flexisticker (3D-Druck, Textil- und Tassendruck), ein Video auf seinem persönlichen LinkedIn-Profil zu veröffentlichen.',
    'Er postet als Person in der Ich-Form. Schreibe auf Deutsch, professionell, seriös und glaubwürdig – geschäftlicher Ton, kein Slang, keine Gaming-Sprache,',
    'keine Übertreibungen. Alles muss zu dem passen, was auf den Standbildern zu sehen bzw. im Video gesagt wird. Erfinde keine Fakten, Zahlen, Kunden oder Links.',
    `Profil: ${profile?.aiStyle || ''}`,
    cfg().hints ? '\nAllgemeine Hinweise:\n' + cfg().hints : '',
    '',
    'Video:',
    `- Dateiname: ${v.file}`,
    `- Bisheriger Titel: ${v.title || '–'}`,
    `- Länge: ${v.duration ? Math.round(v.duration) + ' Sekunden' : 'unbekannt'}, ${orient}`,
    v.note ? `- Notiz von Michael: ${v.note}` : '',
    v.transcriptText ? `- Gesprochener Text (automatisch erkannt, kann Fehler enthalten): „${v.transcriptText.slice(0, 12000)}“` : '',
    extra ? `- Hinweis für diesen Vorschlag: ${extra}` : '',
    `- Kanal: nimm "${profile.id}".`,
    '',
    `Es folgen ${frames.length} Standbilder in zeitlicher Reihenfolge (Nummer und Zeitpunkt stehen davor).`,
  ].filter((l) => l !== '').join('\n');
}

function prompt(v, frames, extra) {
  const lines = profiles.list().filter((p) => !profiles.isPro(p)).map((p) =>
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
  if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) { credits.flag('claude', 'Claude: Guthaben im Anthropic-Konto aufgebraucht.'); return 'Kein Guthaben mehr im Anthropic-Konto (console.anthropic.com → Billing).'; }
  if (e instanceof Anthropic.BadRequestError) return 'Claude lehnt die Anfrage ab: ' + e.message;
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
  const chosen = v.channel ? profiles.get(v.channel) : null;
  const pro = profiles.isPro(chosen);
  // LinkedIn wählt Claude nie selbst – nur wenn das Video von Hand bzw. über „eingang-profi“ dorthin gehört
  const ids = pro ? [chosen.id] : profiles.list().filter((p) => !profiles.isPro(p)).map((p) => p.id);
  const labels = ['', ...new Set(thumbs.photos().map((p) => p.label))];
  const content = [{ type: 'text', text: (pro ? proPrompt(v, frames, extra, chosen) : prompt(v, frames, extra)) + (labels.length > 1
    ? `\n\nFür Titelbilder gibt es freigestellte Fotos des Creators mit diesen Gesichtsausdrücken: ${labels.filter(Boolean).join(', ')}.`
      + (pro ? ' Gute Titelbilder für LinkedIn: seriös, ruhige freundliche Mimik (z. B. „zeigend“, „nachdenklich“, „cool“), Produkt/Werkstatt im Fokus, 2–4 sachliche Wörter.'
        : ' Gute Titelbilder: ein klares Gefühl im Gesicht, das zur Szene passt, 2–4 große Wörter, starker Kontrast, neugierig machend.')
    : '\n\nEs gibt (noch) keine Fotos des Creators – nimm photo "".') }];
  for (const f of frames) {
    content.push({ type: 'text', text: `Standbild ${f.n} (bei ${Math.round(f.at)} s):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f.file).toString('base64') } });
  }
  const r = await ask('texte', content, schema(ids, labels, pro), { effort: 'medium', maxTokens: 16000 });
  const out = r.out, cost = r.cost;
  const clip = (x, n) => String(x || '').slice(0, n);
  v.ai = {
    state: 'done', at: new Date().toISOString(), model: r.model || MODEL, engine: r.engine, cost: Math.round(cost * 10000) / 10000,
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
    aiThumb: out.aiThumb ? { frame: frames.some((f) => f.n === out.aiThumb.frame) ? out.aiThumb.frame : frames[0].n,
      photo: clip(out.aiThumb.photo, 30), text: clip(out.aiThumb.text, 60), scene: clip(out.aiThumb.scene, 1200) } : null,
    viral: out.viral && Number(out.viral.score) ? { score: Math.max(1, Math.min(10, Math.round(Number(out.viral.score)))),
      why: clip(out.viral.why, 300), tip: clip(out.viral.tip, 300), hook: clip(out.viral.hook, 300), edit: clip(out.viral.edit, 300),
      packaging: clip(out.viral.packaging, 300), nextTime: clip(out.viral.nextTime, 300) } : null,
  };
  if (v.ai.viral) v.viral = { ...v.ai.viral, by: 'Claude', at: v.ai.at };
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
  // KI-Titelbild (fal.ai) – wird bevorzugt Titelbild, wenn noch keins gesetzt ist
  let aiOk = false;
  if (thumbs.autoAiThumb() && v.width > v.height && v.ai.aiThumb) {
    try { await thumbs.generateAi(v, (n) => { const f = framePath(v, n); return fs.existsSync(f) ? f : null; }); aiOk = true; }
    catch (e) { v.ai.aiThumbError = e.message; console.error('KI-Titelbild', e.message); }
  }
  if (!v.image) {
    try {
      const src = aiOk ? thumbs.variantPath(v, 5) : vars.length ? thumbs.variantPath(v, 1) : framePath(v, v.ai.thumbnailFrame);
      setImage(v, fs.readFileSync(src), '.jpg'); v.ai.coverApplied = true;
    } catch { /* egal */ }
  }
  saveNow();
  return v.ai;
}

// Effekt-Regie: Claude plant je Short Emojis, Sounds und Bild-Effekte (siehe cutfx.applyFx)
const FX_SCHEMA = { type: 'array', description: 'Effekte im Clip (leer, wenn nichts passt)', items: { type: 'object', additionalProperties: false,
  required: ['at', 'kind', 'emoji', 'sound', 'soundIdea', 'text', 'pos', 'sticker'], properties: {
    at: { type: 'number', description: 'Sekunde ab Videoanfang (innerhalb des Clips), genau auf dem Moment' },
    kind: { type: 'string', enum: fx.FX_KINDS },
    emoji: { type: 'string', description: 'bei kind=emoji: genau ein Emoji aus der Liste, sonst leer' },
    sound: { type: 'string', description: 'Sound-ID aus der Liste oder leer' },
    soundIdea: { type: 'string', description: 'nur wenn kein Listen-Sound passt: kurze englische Beschreibung eines Soundeffekts, sonst leer' },
    text: { type: 'string', description: 'kurzer Text (max. 3 Wörter) bei freeze/replay/text, sonst leer' },
    pos: { type: 'string', enum: Object.keys(fx.POSITIONS) },
    sticker: { type: 'string', description: 'bei kind=sticker: englische Idee für einen Comic-Sticker (z. B. "the person screaming in panic"), sonst leer' },
  } } };
const FX_RULES = (level, stickers) => {
  const L = fx.FX_LEVELS[level] || fx.FX_LEVELS.normal;
  if (!L.max) return 'Effekte: keine (gib fx als leere Liste).';
  const s = sfx.available();
  return [
    `Effekte (fx) – du bist der Effekt-Regisseur. Stufe „${level}“: höchstens ${L.max} Effekte je Clip, erlaubt: ${L.kinds.filter((k) => k !== 'sticker' || stickers).join(', ')}.`,
    'Stimmig statt überladen: jeder Effekt sitzt GENAU auf einem echten Moment (Kill, Ausraster, Fail, Pointe, Ergebnis), mindestens 1,5 s Abstand, nicht in den ersten 1,5 s nach einer Hook-Vorschau.',
    'Arten: emoji = animiertes Emoji (Reaktion auf den Moment); sound = nur Soundeffekt; flash = weißer Blitz beim Einschlag; shake = Bild wackelt kurz;',
    'punch = schneller Zoom-Punch; freeze = Standbild 1 s mit kurzem Text (z. B. „WARTE …“, „OH NEIN“) vor der Auflösung; replay = Zeitlupen-Wiederholung des Höhepunkts;',
    'text = großer Kurztext; sticker = KI-Comic-Sticker des Creators (höchstens 1, nur beim stärksten Moment).',
    `Emojis (nur diese): ${Object.keys(fx.emojiList()).filter((e) => e !== '⏪').join(' ')}`,
    `Sounds (IDs): ${s.library.join(', ')}${s.own.length ? '; eigene des Creators (bevorzugen, wenn passend): ' + s.own.join(', ') : ''}. Zu Emojis passt meist pop, zu Treffern hit/boom.`,
    'Zurückspulen und Hook-Start bekommen automatisch Sound – dafür nichts eintragen.',
  ].join('\n');
};

// Text-Vorlagen je Clip (captions.js): Untertitel-Stil, Look des Hook-Texts, Schlüsselwörter (farbig, größer, ggf. mit Emoji)
const TEXT_SCHEMA = { type: 'object', additionalProperties: false, required: ['style', 'hookLook', 'emph'], properties: {
  style: { type: 'string', enum: STYLE_IDS, description: 'Untertitel-Stil' },
  hookLook: { type: 'string', enum: Object.keys(HOOK_LOOKS), description: 'Look des Hook-Texts' },
  emph: { type: 'array', description: '2–6 Schlüsselwörter, genau so geschrieben wie gesprochen (einzelne Wörter)', items: { type: 'object', additionalProperties: false,
    required: ['word', 'emoji'], properties: { word: { type: 'string' }, emoji: { type: 'string', description: 'passendes Emoji aus der Effekt-Liste oder leer (höchstens 2 je Clip mit Emoji)' } } } },
} };
const TEXT_RULES = (profile) => {
  const fixed = STYLES[profile?.captionStyle] ? profile.captionStyle : '';
  const look = HOOK_LOOKS[profile?.hookLook] ? profile.hookLook : '';
  return [
    'TEXT (text) – Untertitel wie bei StreamLadder/Opus Clip:',
    fixed ? `Stil ist fest eingestellt: gib style "${fixed}".` : 'Wähle den Untertitel-Stil passend zur Stimmung des Clips: ' + STYLE_IDS.map((k) => `${k} (${STYLES[k].desc})`).join('; ') + '.',
    look ? `Hook-Look fest: "${look}".` : 'Hook-Look: kasten (neutral), banner (laut, frech), umriss (groß, episch), neon (Nacht/Chill/Party).',
    'emph: die 2–6 Wörter, die beim Zuhören am meisten knallen (Zahlen, Namen, Ausrufe, Pointe) – werden farbig und größer. Emoji nur, wenn es den Moment wirklich unterstreicht.',
  ].join('\n');
};
export function parseText(t) {
  if (!t || typeof t !== 'object') return null;
  return { style: STYLES[t.style] ? t.style : '', hookLook: HOOK_LOOKS[t.hookLook] ? t.hookLook : '',
    emph: (Array.isArray(t.emph) ? t.emph : []).slice(0, 8).map((x) => ({ word: String(x?.word || '').slice(0, 40), emoji: String(x?.emoji || '').slice(0, 8) })).filter((x) => x.word) };
}

// Hook: der Moment, der in den ersten 1–2 Sekunden fesselt (für Shorts – siehe cutfx.js)
const HOOK_SCHEMA = { type: 'object', additionalProperties: false, required: ['mode', 'at', 'len', 'text'], properties: {
  mode: { type: 'string', enum: ['preview', 'cold', 'none'], description: 'preview = Höhepunkt 1–2,5 s vorweg zeigen, dann zurückspulen und den Clip von vorn; cold = Clip direkt kurz vor dem Höhepunkt beginnen (Anlauf weg); none = Anfang ist schon stark' },
  at: { type: 'number', description: 'Sekunde (ab Videoanfang) des stärksten Moments im Clip (Ausruf, Kill, Fail, Ergebnis)' },
  len: { type: 'number', description: 'Länge der Vorschau in Sekunden (1–2,5)' },
  text: { type: 'string', description: 'Hook-Text fürs erste Bild, höchstens 5 Wörter, Deutsch, neugierig machend (z. B. „Wie konnte das passieren?“); leer wenn unpassend' },
} };
const HOOK_RULES = (pro, profile) => {
  const style = profile?.hookStyle || (pro ? 'cold' : 'auto');
  if (style === 'off') return 'Hook: nicht gewünscht – gib mode "none" und leeren text.';
  return [
    'Hook (die ersten 1–2 Sekunden entscheiden, ob jemand weiterwischt): Bestimme je Clip den stärksten Moment (at).',
    pro ? 'LinkedIn: kein Effekt – nimm "cold" (mit der Kernaussage bzw. dem Ergebnis einsteigen) oder "none"; Hook-Text sachlich (z. B. „So spare ich 30 % Material“).'
      : style === 'auto' ? 'Wähle "preview", wenn der Höhepunkt erst später kommt und die Vorgeschichte zum Verständnis nötig ist; "cold", wenn der Moment ohne Anlauf wirkt; "none", wenn der Clip schon stark beginnt.'
      : style === 'preview' ? 'Der Creator möchte möglichst "preview" (Höhepunkt vorweg, dann zurückspulen).' : 'Der Creator möchte möglichst "cold" (direkt mitten rein).',
    profile?.hookHint ? `Hinweis zum Kanal: ${profile.hookHint}` : '',
  ].filter(Boolean).join('\n');
};

// Bildaufbau je Clip (Querformat → 9:16): Claude liest auf den Kontaktbögen ab, wo die Facecam sitzt und wo die Action ist
const LAYOUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['mode', 'camX', 'camY', 'camW', 'camH', 'focus'], properties: {
  mode: { type: 'string', enum: ['cam', 'crop', 'blur'], description: 'cam = Facecam oben + Spiel unten; crop = 9:16-Ausschnitt um die Action; blur = ganzes Bild mit unscharfem Hintergrund' },
  camX: { type: 'number', description: 'Facecam: linker Rand in Prozent der Bildbreite (0–100), 0 wenn keine' },
  camY: { type: 'number', description: 'Facecam: oberer Rand in Prozent der Bildhöhe, 0 wenn keine' },
  camW: { type: 'number', description: 'Facecam: Breite in Prozent der Bildbreite, 0 wenn keine' },
  camH: { type: 'number', description: 'Facecam: Höhe in Prozent der Bildhöhe, 0 wenn keine' },
  focus: { type: 'number', description: 'waagerechte Mitte der wichtigen Action in Prozent der Bildbreite (50 = Mitte; Fadenkreuz bei Shootern = 50)' },
} };
const LAYOUT_RULES = [
  'BILDAUFBAU (layout) je Clip – das Video wird ins Hochformat 9:16 gebracht. Jede Kachel der Kontaktbögen zeigt das GANZE Bild verkleinert.',
  'Ist eine Facecam (eingeblendetes Kamerabild des Creators) zu sehen: mode "cam" und ihre Lage in Prozent (camX/camY = linke obere Ecke, camW/camH = Größe) – möglichst genau am Rand des Kamerabilds; sie kann je Szene woanders sitzen.',
  'Ohne Facecam: "crop" (Ausschnitt um focus) oder "blur", wenn wichtige Dinge über das ganze Bild verteilt sind (Übersicht, Menüs/Text, Strategie-Karte, Drucker in Totale).',
  'Ist die ganze Szene ein Kamerabild (kein Spiel), nimm "crop" mit focus auf das Gesicht.',
].join('\n');
// Top/Flop-Beispiele aus echten Zahlen (stats.js meldet sich hier an, sonst leer)
let examplesFn = null;
export function setExamples(fn) { examplesFn = fn; }
const examplesFor = (profile) => { try { return examplesFn ? examplesFn(profile) : ''; } catch { return ''; } };

// Späher: Claude liest das GANZE Transkript (mit Tonfall-Markern und Twitch-Signalen) und nennt starke Momente –
// auch leise, witzige Stellen, die die Lautstärke nicht findet. Ergebnis = zusätzliche Kandidaten.
export async function scoutMoments(v, sents, profile, { signals = '', wish = '', max = 20 } = {}) {
  if (!sents?.length || sents.length < 15) return [];
  const pro = profiles.isPro(profile);
  const text = [
    pro ? 'Du suchst in der Abschrift einer Aufnahme die stärksten Stellen für kurze LinkedIn-Clips (Kernaussagen, Tipps, Ergebnisse).'
      : 'Du suchst in der Abschrift einer Gaming-/Creator-Aufnahme die stärksten Momente für Shorts/TikTok: Lacher, Rage, Fails, Überraschungen, Pointen, Clutches, absurde Sprüche, Geschichten mit Auflösung.',
    'Du siehst die ganze Aufnahme als nummerierte Sätze (Sekunden ab Videoanfang). In Klammern stehen gemessene Signale: „laut +9 dB“ = deutlich lauter als die normale Stimme,',
    '„schnell“ = schneller gesprochen, LACHEN/SCHREIT = Geräusch erkannt, „…“ = typischer Ausruf. Das sind Hinweise, keine Pflicht – witzige leise Stellen zählen genauso.',
    profile?.clipHints ? `Worauf der Creator Wert legt: ${profile.clipHints}` : '',
    wish ? `Wunsch des Creators: „${wish}“` : '',
    examplesFor(profile),
    signals ? 'Weitere Signale (Twitch-Chat, Zuschauer-Clips, Marker):\n' + signals : '',
    `Nenne bis zu ${max} Momente, beste zuerst. Je Moment den Satzbereich, der für sich verständlich ist (Vorgeschichte bis Reaktion), und kurz warum.`,
    '', 'Abschrift:', bounds.sentenceLines(sents, 0, Infinity, 150000),
  ].filter(Boolean).join('\n');
  const schema = { type: 'object', additionalProperties: false, required: ['moments'], properties: { moments: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['fromSentence', 'toSentence', 'why'], properties: {
      fromSentence: { type: 'integer' }, toSentence: { type: 'integer' }, why: { type: 'string', description: 'höchstens 12 Wörter' } } } } } };
  const o = await cutCall([{ type: 'text', text }], schema, { effort: 'high', task: 'scout' });
  return (o.moments || []).slice(0, max).map((m) => {
    const r = bounds.fromSentences(sents, m.fromSentence, m.toSentence);
    return r && r.end - r.start < 240 ? { start: r.start, end: r.end, t: (r.start + r.end) / 2, label: 'Claude: ' + String(m.why || '').slice(0, 80) } : null;
  }).filter(Boolean);
}

// Aus Kandidaten-Stellen eines Rohvideos die besten Shorts wählen.
// cands: [{start, end, why[]}] (Sekunden); opts.sents = nummerierte Sätze mit Tonfall-Markern (signals.annotate)
export async function chooseHighlights(v, cands, segs, c, profile, wish = '', opts = {}) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const sents = opts.sents || bounds.numbered(segs);
  const pro = profiles.isPro(profile);
  const vertical = v.height > v.width;
  const content = [{ type: 'text', text: [
    ...(pro ? [
      'Du schneidest aus einer Rohaufnahme die besten kurzen Clips für LinkedIn – gepostet vom Inhaber eines Druck- und 3D-Druck-Betriebs als Person.',
      `Wähle bis zu ${c.shorts} Stellen, die allein verständlich und professionell sind: eine klare Kernaussage, ein Tipp, ein Ergebnis,`,
      'ein Vorher/Nachher, ein gelöstes Kundenproblem oder ein interessanter Einblick in die Fertigung. Keine Albernheiten, kein Leerlauf.',
      'Der Anfang muss in den ersten 2 Sekunden zeigen, worum es geht; Ende nach einem abgeschlossenen Gedanken. Lieber weniger, wenn nichts taugt.',
      `Kanalbeschreibung: ${profile.aiStyle || ''}`,
    ] : [
      'Du schneidest aus einer Rohaufnahme die besten Kurzvideos (Shorts/TikTok) für einen deutschen Creator – auf dem Niveau von Profi-Clippern (StreamLadder, Opus Clip).',
      `Wähle bis zu ${c.shorts} Stellen, die allein funktionieren: klarer Moment (Sieg, Fail, Überraschung, Lacher, Rage, Erklärung mit Pointe),`,
      'starker Anfang in den ersten 1–2 Sekunden, Ende direkt nach Pointe/Reaktion (kein Auslaufen – ein Ende, das zum Nochmal-Schauen einlädt). Lieber weniger, wenn nichts taugt (dann leere Liste).',
    ]),
    `LÄNGE folgt dem Moment: ${c.shortMin}–${c.shortMax} Sekunden; meist sind 20–40 s am stärksten, länger nur für eine Geschichte mit Auflösung. Start/Ende dürfen bis zu 15 Sekunden um den Kandidaten verschoben werden.`,
    profile?.clipHints ? `Worauf der Creator bei diesem Kanal Wert legt: ${profile.clipHints}` : '',
    examplesFor(profile),
    'Nimm ruhig viele Stellen, wenn sie taugen – jede, die Zuschauer bindet (Hook, Emotion, Pointe), ist ein eigener Clip wert.',
    'Schätze für jeden Clip das Viral-Potenzial ehrlich ein (1 = kaum, 10 = sehr hoch): starker Hook in den ersten 2 Sekunden, Emotion,'
      + ' Überraschung, Wiederschau- und Teilwert, Verständlichkeit ohne Kontext. Keine Gefälligkeitswerte.',
    wish ? `WICHTIG – Wunsch des Creators für diesen Schnitt: „${wish}“. Richte die Auswahl danach aus (auch wenn dadurch weniger Shorts entstehen).` : '',
    HOOK_RULES(pro, profile),
    FX_RULES(fxLevelOf(profile), fxStickers(profile)),
    pro ? '' : TEXT_RULES(profile),
    !pro && !vertical ? LAYOUT_RULES + '\nEffekt "cam" = Facecam 1,6 s groß bei der stärksten Gesichts-Reaktion (nur mit mode "cam", höchstens 2 je Clip).' : '',
    `Video: „${v.file}“, Länge ${whisper.fmtTime(v.duration)}. ${v.note ? 'Notiz: ' + v.note : ''}`,
    sents.length ? 'Gesprochenes ist je Kandidat als nummerierte Sätze angegeben (automatisch erkannt, kann Fehler enthalten). In Klammern gemessene Signale (laut +x dB = lauter als die normale Stimme, LACHEN/SCHREIT = Geräusch erkannt).' : 'Kein gesprochener Text verfügbar.',
    sents.length ? SENTENCE_RULES : '',
    '',
    'Kandidaten (aus Signalen vorsortiert: Stimme, Tonfall, Lacher, Lautstärke, Bildwechsel, Twitch, Claude-Späher). Zu jedem folgt ein Kontaktbogen aus 9 Bildern quer durch den Kandidaten (Sekunde oben links):',
  ].filter(Boolean).join('\n') }];
  for (let i = 0; i < cands.length; i++) {
    const k = cands[i];
    const file = path.join(FRAME_DIR, `${v.id}-k${i + 1}.jpg`);
    const sheet = await vision.contactSheet(fileOf(v), k.start, k.end, file, { vertical });
    const said = sents.length ? bounds.sentenceLines(sents, k.start - 15, k.end + 15, 3000) : '';
    content.push({ type: 'text', text: `Kandidat ${i + 1}: ${whisper.fmtTime(k.start)}–${whisper.fmtTime(k.end)} (Sekunde ${k.start}–${k.end})`
      + (k.why?.length ? `, Signale: ${k.why.join('; ')}` : '') + (k.peak != null ? `, lauteste Stelle ${k.peak} LUFS` : '') + (said ? `\nGesprochen:\n${said}` : '') });
    if (sheet) { content.push(vision.asImage(sheet)); fs.rmSync(sheet, { force: true }); }
  }
  const schemaH = {
    type: 'object', additionalProperties: false, required: ['shorts'],
    properties: { shorts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['candidate', 'fromSentence', 'toSentence', 'start', 'end', 'title', 'reason', 'mood', 'music', 'viral', 'viralWhy', 'viralTip', 'hook', 'fx', 'layout', 'text'],
      properties: {
        candidate: { type: 'integer', description: 'Nummer des Kandidaten' },
        fromSentence: { type: 'integer', description: 'Nummer des ersten Satzes (S…), 0 wenn an der Stelle nicht gesprochen wird' },
        toSentence: { type: 'integer', description: 'Nummer des letzten Satzes (S…), 0 wenn an der Stelle nicht gesprochen wird' },
        start: { type: 'number', description: 'Start in Sekunden ab Videoanfang' },
        end: { type: 'number', description: 'Ende in Sekunden ab Videoanfang' },
        title: { type: 'string', description: 'Kurzer, packender Titel für den Short (höchstens 70 Zeichen)' },
        reason: { type: 'string', description: 'Ein Satz: warum diese Stelle' },
        mood: { type: 'string', enum: ['episch', 'lustig', 'spannend', 'chillig', 'energisch', 'fröhlich', 'traurig'], description: 'Stimmung der Stelle (für Hintergrundmusik)' },
        music: { type: 'string', description: 'English, one short phrase: fitting instrumental background music (genre, tempo, instruments), e.g. "fast hype trap beat with heavy 808s"' },
        viral: { type: 'integer', description: 'Viral-Potenzial 1–10 (ehrlich)' },
        viralWhy: { type: 'string', description: 'Ein Satz: warum diese Einschätzung' },
        viralTip: { type: 'string', description: 'Ein konkreter Tipp, wie der Clip mehr Potenzial bekommt (z. B. Hook-Text, früher einsteigen)' },
        hook: HOOK_SCHEMA,
        fx: FX_SCHEMA,
        layout: LAYOUT_SCHEMA,
        text: TEXT_SCHEMA,
      } } } },
  };
  const { out, vision: sawImages } = await ask('schnitt', content, schemaH);
  const dur = v.duration;
  const picked = [];
  for (const s of (out.shorts || []).slice(0, c.shorts)) {
    const k = cands[s.candidate - 1];
    if (!k) continue;
    // Satznummern haben Vorrang (exakte Grenzen); sonst Sekunden. Feinschliff (Einrasten, Maximallänge) macht bounds.snapRange beim Schnitt.
    const bySent = bounds.fromSentences(sents, s.fromSentence, s.toSentence);
    const okSent = bySent && bySent.start >= k.start - 25 && bySent.end <= k.end + 25 && bySent.end - bySent.start <= c.shortMax + 20;
    let start = okSent ? bySent.start : Math.max(0, Math.max(k.start - 15, Math.min(Number(s.start), k.end)));
    let end = okSent ? bySent.end : Math.min(dur, Math.min(k.end + 15, Math.max(Number(s.end), start + c.shortMin)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end - start < Math.min(c.shortMin, 10)) end = Math.min(dur, start + c.shortMin);
    if (picked.some((p) => start < p.end && end > p.start)) continue;
    picked.push({ bySentence: !!okSent, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, title: String(s.title || '').slice(0, 100), reason: String(s.reason || '').slice(0, 300),
      mood: String(s.mood || ''), music: String(s.music || '').slice(0, 200),
      viral: Math.max(1, Math.min(10, Math.round(Number(s.viral) || 0))) || undefined, viralWhy: String(s.viralWhy || '').slice(0, 300), viralTip: String(s.viralTip || '').slice(0, 300),
      hook: s.hook && typeof s.hook === 'object' ? { mode: s.hook.mode, at: Number(s.hook.at), len: Number(s.hook.len), text: String(s.hook.text || '').slice(0, 60) } : null,
      fx: Array.isArray(s.fx) ? s.fx.slice(0, 15) : [], layoutRaw: sawImages && s.layout && typeof s.layout === 'object' ? s.layout : null, signals: k.why || [], text: parseText(s.text) });
  }
  return picked;
}

// Render-Prüfung (qc.js): Claude sieht den FERTIGEN Clip als Kontaktbogen und prüft ihn wie ein Editor vor dem Posten
export async function reviewClip(sheetFile, info = {}) {
  const text = [
    'Du bist Qualitätsprüfer für Shorts/TikTok. Hier ist ein Kontaktbogen des FERTIG geschnittenen Clips (12 Bilder in zeitlicher Folge, Sekunde oben links).',
    `Titel: „${info.title || ''}“. Länge ${Math.round(info.duration || 0)} s.` + (info.hook?.text ? ` Hook-Text (erste Sekunden): „${info.hook.text}“.` : '')
      + (info.layoutHow ? ` ${info.layoutHow}.` : '') + (info.fxHow ? ` ${info.fxHow}.` : ''),
    info.machine?.length ? `Technische Prüfung meldet: ${info.machine.join('; ')}.` : '',
    'Prüfe nur, was man sieht: Ist das Gesicht/die Facecam abgeschnitten oder von Text/Emojis verdeckt? Ist die Action im Bild oder schneidet der Ausschnitt das Wichtige ab?',
    'Sind Untertitel lesbar (nicht zu viel, nicht am Rand, nicht über dem Spiel-HUD)? Zieht das erste Bild sofort rein? Wirkt es überladen? Endet es sauber?',
    'ok = true, wenn man es so posten kann. score 1–10 = handwerkliche Qualität. issues = konkrete Mängel (kurz, Deutsch). fixWish = Anweisung für eine Überarbeitung (Du-Form an den Schnitt, z. B. „Ausschnitt nach rechts auf die Action, Hook-Text kürzer“), leer wenn ok.',
  ].filter(Boolean).join('\n');
  const schema = { type: 'object', additionalProperties: false, required: ['ok', 'score', 'issues', 'fixWish'], properties: {
    ok: { type: 'boolean' }, score: { type: 'integer' }, issues: { type: 'array', items: { type: 'string' } }, fixWish: { type: 'string' } } };
  // Ohne Bildverständnis (lokales Textmodell) ist eine Bild-Prüfung sinnlos → nur die technische Prüfung zählt
  if (llm.modeOf('pruefung') !== 'claude' && llm.ready() && !(await llm.visionAvailable())) return null;
  const o = await cutCall([{ type: 'text', text }, vision.asImage(sheetFile)], schema, { effort: 'medium', task: 'pruefung' });
  return { ok: !!o.ok, score: Math.max(1, Math.min(10, Math.round(Number(o.score) || 0))) || null,
    issues: (o.issues || []).slice(0, 6).map((x) => String(x).slice(0, 160)), fixWish: String(o.fixWish || '').slice(0, 400) };
}

// Kurzfassung: aus Bausteinen (je ~15 s) die besten in Summe ca. `target` Sekunden wählen – zeitliche Reihenfolge bleibt.
export async function chooseSummary(v, parts, segs, target, profile, wish = '') {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const sents = bounds.numbered(segs);
  const pro = profiles.isPro(profile);
  const content = [{ type: 'text', text: [
    pro ? 'Du stellst aus einer Rohaufnahme eine professionelle Kurzfassung für LinkedIn zusammen (Inhaber eines Druck- und 3D-Druck-Betriebs, als Person).'
      : 'Du stellst aus einer Rohaufnahme eine Kurzfassung (Best-of / Zusammenfassung) für YouTube zusammen.',
    `Ziellänge insgesamt ca. ${Math.round(target)} Sekunden (±15 %). Wähle passende Stellen aus den Bausteinen; sie werden in zeitlicher Reihenfolge`,
    'hintereinander geschnitten. Die Kurzfassung soll für sich verständlich sein: klarer Einstieg, die wichtigsten Momente bzw. Aussagen, ein Abschluss.',
    'Bausteine bestehen aus ganzen Sätzen. Du darfst einen Baustein über die Satznummern enger fassen oder bis zu 2 Sätze davor/danach mitnehmen,'
      + ' damit ein Gedanke vollständig ist (fromSentence/toSentence). Schneide nie mitten im Satz; ohne Sprache (0/0) gelten start/end.',
    'Achte auf den Übergang: Der nächste Baustein soll nicht mit einem Bezug auf Weggeschnittenes beginnen („wie gesagt“, „und deswegen“).',
    wish ? `WICHTIG – Wunsch des Creators: „${wish}“. Richte die Auswahl danach aus.` : '',
    `Video: „${v.file}“, Länge ${whisper.fmtTime(v.duration)}. ${v.note ? 'Notiz: ' + v.note : ''}`,
    segs?.length ? 'Gesprochenes steht je Baustein dabei (automatisch erkannt).' : 'Kein gesprochener Text verfügbar.',
    '', 'Bausteine (zu jedem ein Standbild aus der Mitte):',
  ].filter(Boolean).join('\n') }];
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    const file = path.join(FRAME_DIR, `${v.id}-z${i + 1}.jpg`);
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', ((k.start + k.end) / 2).toFixed(2), '-i', fileOf(v),
      '-vf', "scale='if(gt(iw,ih),min(480,iw),-2)':'if(gt(iw,ih),-2,min(480,ih))'", '-frames:v', '1', '-q:v', '6', file]);
    const said = sents.length ? bounds.sentenceLines(sents, k.start - 0.05, k.end + 0.05, 1500) : '';
    content.push({ type: 'text', text: `Baustein ${i + 1}: Sekunde ${k.start}–${k.end}${k.from ? ` (Sätze S${k.from}–S${k.to})` : ''}, lauteste Stelle ${k.peak} LUFS, ${k.scenes} Bildwechsel${said ? `\n${said}` : ''}` });
    if (ok && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
      fs.rmSync(file, { force: true });
    }
  }
  const schemaS = { type: 'object', additionalProperties: false, required: ['parts'],
    properties: { parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['part', 'fromSentence', 'toSentence', 'start', 'end'], properties: {
      part: { type: 'integer', description: 'Nummer des Bausteins' },
      fromSentence: { type: 'integer', description: 'erster Satz (S…), 0 ohne Sprache' },
      toSentence: { type: 'integer', description: 'letzter Satz (S…), 0 ohne Sprache' },
      start: { type: 'number', description: 'Start in Sekunden ab Videoanfang' },
      end: { type: 'number', description: 'Ende in Sekunden ab Videoanfang' } } } } } };
  const out = await cutCall(content, schemaS, { task: 'schnitt' });
  const picked = [];
  for (const x of out.parts || []) {
    const k = parts[x.part - 1];
    if (!k) continue;
    const bySent = bounds.fromSentences(sents, x.fromSentence, x.toSentence);
    const okSent = bySent && bySent.start >= k.start - 30 && bySent.end <= k.end + 30;
    const start = okSent ? bySent.start : Math.max(0, k.start - 8, Math.min(Number(x.start), k.end - 3));
    const end = okSent ? bySent.end : Math.min(v.duration, k.end + 8, Math.max(Number(x.end), start + 3));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 2) continue;
    if (picked.some((p) => start < p.end && end > p.start)) continue;
    picked.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
  }
  // nicht über 130 % der Ziellänge
  picked.sort((p, q) => p.start - q.start);
  let total = 0;
  return picked.filter((p) => { total += p.end - p.start; return total <= target * 1.3 || p === picked[0]; });
}

// ---- Warteschlange (eins nach dem anderen) ----
const queue = [];
let running = 0;
// lokal mit Server + PC: zwei Vorschläge gleichzeitig (je Rechner einer), sonst einer nach dem anderen
const parallel = () => (llm.modeOf('texte') !== 'claude' || !claudeUsable() ? Math.max(1, llm.engines()) : 1);

export function enqueue(v, extra = '') {
  if (!canAsk('texte')) throw new Error('Kein Claude-API-Schlüssel und keine lokale KI eingerichtet (Einstellungen).');
  if (['queued', 'running'].includes(v.ai?.state)) return;
  v.ai = { ...(v.ai || {}), state: 'queued', error: '' };
  queue.push({ id: v.id, extra });
  save();
  next();
}

async function next() {
  if (running >= parallel()) return;
  const job = queue.shift();
  if (!job) return;
  running++;
  next();   // ggf. gleich den nächsten auf dem anderen Rechner starten
  const v = db().videos[job.id];
  try {
    if (v && !v.missing) {
      v.ai = { ...v.ai, state: 'running' }; save();
      await suggest(v, job.extra);
      try { suggested?.(v); } catch (e) { console.error('Nach dem Vorschlag:', e.message); }
    }
  } catch (e) {
    if (v) { v.ai = { ...v.ai, state: 'error', error: e.message }; saveNow(); }
  } finally { running--; next(); }
}

// Neue geschnittene Videos automatisch vorschlagen lassen (nur einmal je Video).
export function autoQueue() {
  const c = cfg();
  if (!canAsk('texte') || !c.auto) return;
  for (const v of Object.values(db().videos)) {
    if (v.folder === 'geschnitten' && !v.missing && v.duration != null && !v.ai) enqueue(v);
  }
}

// 💡 Coach: Claude schaut auf die letzten Videos eines Kanals und gibt persönliche Tipps + Ideen (nur Text, wenige Cent).
export async function coach(profileId) {
  const prof = profiles.get(profileId) || profiles.fallback();
  const vids = Object.values(db().videos).filter((v) => !v.missing && v.folder !== 'papierkorb' && profiles.effective(v)?.id === prof.id
    && ['geschnitten', 'hochgeladen'].includes(v.folder))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 25);
  if (vids.length < 2) throw new Error('Zu wenige Videos in diesem Kanal für eine Einschätzung (mindestens 2).');
  const lines = vids.map((v, i) => [
    `${i + 1}. „${v.title || v.file}“ (${v.height > v.width ? 'Hochformat/Short' : 'Querformat'}, ${v.duration ? Math.round(v.duration) + ' s' : '?'}`
      + `${v.yt?.state === 'done' ? ', auf YouTube' : ''}${v.tt?.state === 'done' ? ', auf TikTok' : ''})`,
    v.ai?.summary ? `   Inhalt: ${v.ai.summary}` : '',
    v.viral?.score ? `   Viral-Einschätzung ${v.viral.score}/10: ${v.viral.why || ''}` : '',
    v.transcriptText ? `   Gesprochen (Ausschnitt): „${v.transcriptText.slice(0, 300)}“` : '',
  ].filter(Boolean).join('\n')).join('\n');
  const schemaC = { type: 'object', additionalProperties: false, required: ['summary', 'strengths', 'tips', 'ideas'], properties: {
    summary: { type: 'string', description: 'Zwei Sätze: wo der Kanal gerade steht' },
    strengths: { type: 'array', items: { type: 'string' }, description: '2–3 Dinge, die schon gut funktionieren (konkret)' },
    tips: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: {
      title: { type: 'string', description: 'Kurze Überschrift' }, text: { type: 'string', description: '2–3 Sätze, konkret und umsetzbar, mit Beispiel aus seinen Videos' } } },
      description: '5 persönliche Tipps, nach Wirkung sortiert (Hook, Rhythmus, Themen, Aufnahme, Titel/Titelbild, Regelmäßigkeit, Community)' },
    ideas: { type: 'array', items: { type: 'string' }, description: '3–5 konkrete Ideen für nächste Videos/Shorts, die zu seinem Stil passen' },
  } };
  const r = await ask('coach', [{ type: 'text', text: [
        `Du bist ein erfahrener, ehrlicher Coach für Kurzvideos und YouTube. Der Creator Michael (Deutsch, Du-Form) will mit dem Kanal „${prof.name}“ mehr Reichweite.`,
        `Kanal: ${prof.aiStyle || ''}`, prof.clipHints ? `Worauf er Wert legt: ${prof.clipHints}` : '',
        'Schau dir seine letzten Videos an und gib ihm persönliche, konkrete Tipps – keine Allgemeinplätze. Sei ehrlich, aber motivierend.',
        examplesFor(prof) || 'Zahlen zu Aufrufen liegen noch nicht vor; stütze dich auf Inhalte, Titel und die Viral-Einschätzungen.', '', 'Letzte Videos:', lines,
      ].filter(Boolean).join('\n') }], schemaC, { effort: 'medium', maxTokens: 8000 });
  const out = r.out, cost = r.cost;
  db().coach = { ...(db().coach || {}), [prof.id]: { at: new Date().toISOString(), videos: vids.length, cost: Math.round(cost * 10000) / 10000, ...out } };
  saveNow();
  return db().coach[prof.id];
}

// Spiel/Thema für ältere Videos nachträglich bestimmen (für die Ordnung): je Video Titel, Datei, Inhalt, Gesprochenes;
// ohne jeden Text ein Standbild. Ein Aufruf je 20 Videos → items [{id, game}] (leer = unklar).
export async function detectTopics(list, onProgress = () => {}) {
  if (!canAsk('themen')) throw new Error('Für die Themen-Erkennung braucht es den Claude-Schlüssel oder die lokale KI (Einstellungen).');
  const known = [...new Set(Object.values(db().videos).map((v) => v.orgTopic || v.ai?.game).filter(Boolean))].slice(0, 60);
  const out = {};
  let cost = 0;
  for (let i = 0; i < list.length; i += 20) {
    const batch = list.slice(i, i + 20);
    const content = [{ type: 'text', text: [
      'Ordne jedem Video das Spiel bzw. Thema zu (für Ordnernamen, z. B. „Fortnite“, „Minecraft“, „3D-Druck Halterung“). Kurz, 1–3 Wörter, offizielle Schreibweise.',
      known.length ? `Schon verwendete Themen (gleiche Schreibweise nutzen, wenn passend): ${known.join(', ')}` : '',
      'Wenn wirklich nicht erkennbar: leerer Text. Nichts erfinden.', '',
    ].filter(Boolean).join('\n') }];
    for (const v of batch) {
      const text = [v.title && `Titel: ${v.title}`, `Datei: ${v.file.split('/').pop()}`, v.description && `Beschreibung: ${String(v.description).slice(0, 300)}`,
        v.ai?.summary && `Inhalt: ${v.ai.summary}`, (v.tags || []).length ? `Tags: ${v.tags.slice(0, 10).join(', ')}` : '',
        v.transcriptText && `Gesprochen: „${v.transcriptText.slice(0, 400)}“`].filter(Boolean);
      content.push({ type: 'text', text: `\n[${v.id}] ` + text.join(' · ') });
      if (!v.title && !v.ai?.summary && !v.transcriptText) {
        try {
          const n = (await ensureFrames(v))[2] || 1;
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(framePath(v, n)).toString('base64') } });
        } catch { /* kein Bild */ }
      }
    }
    const schemaT = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'game'], properties: { id: { type: 'string', enum: batch.map((v) => v.id) }, game: { type: 'string' } } } } } };
    let r;
    try { r = await ask('themen', content, schemaT, { effort: 'low', maxTokens: 4000 }); } catch (e) { if (e.message === 'abgelehnt') continue; throw e; }
    for (const x of r.out.items || []) if (batch.some((v) => v.id === x.id) && x.game?.trim()) { out[x.id] = x.game.trim().slice(0, 60); if (!known.includes(out[x.id])) known.push(out[x.id]); }
    cost += r.cost;
    onProgress(Math.min(list.length, i + 20), list.length);
  }
  saveNow();
  return { topics: out, cost };
}

export function init() {
  for (const v of Object.values(db().videos)) {
    if (['queued', 'running'].includes(v.ai?.state)) v.ai = { ...v.ai, state: v.ai.titles ? 'done' : 'error', error: v.ai.titles ? '' : 'Durch Neustart unterbrochen.' };
  }
}

// Überarbeitung eines Shorts nach Wunsch: Claude sieht den bisherigen Schnitt, das Gesprochene ringsum und Standbilder
// und legt Start/Ende, Hook, Tempo und Musik neu fest. raw = Rohvideo, out = bisheriger Short.
export async function reviseShort(raw, out, wish, segs, profile, { minLen = 15, maxLen = 60, sents: sentsA = null } = {}) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const pro = profiles.isPro(profile);
  const vertical = raw.height > raw.width;
  const src = out.source;
  const from = Math.max(0, src.start - 120), to = Math.min(raw.duration || src.end + 120, src.end + 120);
  const sents = sentsA || bounds.numbered(segs);
  const said = bounds.sentenceLines(sents, from, to, 12000);
  const hook = out.edit?.hook || src.hook;
  const content = [{ type: 'text', text: [
    pro ? 'Du überarbeitest einen LinkedIn-Clip (Inhaber eines Druck- und 3D-Druck-Betriebs, als Person, professionell).'
      : 'Du überarbeitest einen Short (TikTok/YouTube Shorts) für einen deutschen Creator. Ziel: mehr Zuschauer halten, mehr Wiederschauen.',
    `WUNSCH DES CREATORS: „${wish}“ – setze das konsequent um.`,
    `Bisheriger Clip: Sekunde ${src.start.toFixed(1)}–${src.end.toFixed(1)} der Rohaufnahme „${raw.file}“ (Länge ${(src.end - src.start).toFixed(0)} s), Titel „${out.title || ''}“.`,
    hook ? `Bisheriger Hook: ${hook.mode}${hook.at != null ? ' bei Sekunde ' + hook.at : ''}${hook.text ? `, Text „${hook.text}“` : ''}.` : 'Bisher kein Hook.',
    `Bisheriges Tempo: ${out.edit?.tempo || src.tempo || 'normal'}. Musik: ${out.music ? 'ja' : 'nein'}.`,
    `Du darfst Start und Ende frei im Bereich Sekunde ${from.toFixed(0)}–${to.toFixed(0)} wählen; Länge ${minLen}–${maxLen} Sekunden.`,
    'Geschnitten wird neu aus der Rohaufnahme (nicht aus dem bisherigen Clip): Was vorher fehlte – Vorgeschichte, Reaktion danach, herausgekürzte Pausen –, kannst du zurückholen.',
    'Tempo: aus = nichts herausschneiden, ruhig = nur lange Pausen, normal = Pausen + „ähm“, schnell = Jump Cuts + kurze Zooms.',
    HOOK_RULES(pro, profile),
    FX_RULES(fxLevelOf(profile, wish), fxStickers(profile)),
    pro ? '' : TEXT_RULES(profile) + (out.edit?.style ? `\nBisheriger Stil: ${out.edit.style}${out.edit.hookLook ? ', Hook-Look ' + out.edit.hookLook : ''}.` : ''),
    out.edit?.fxHow ? `Bisherige Effekte: ${out.edit.fxHow}.` : '',
    out.edit?.layout ? `Bisheriger Bildaufbau: ${out.edit.layout.mode}${out.edit.layout.cam ? ` (Facecam bei ${Math.round(out.edit.layout.cam.x * 100)} %/${Math.round(out.edit.layout.cam.y * 100)} %, ${Math.round(out.edit.layout.cam.w * 100)} × ${Math.round(out.edit.layout.cam.h * 100)} %)` : ''}, focus ${Math.round((out.edit.layout.focus ?? 0.5) * 100)} %.` : '',
    out.qc?.issues?.length ? `Prüfung des bisherigen Clips: ${out.qc.issues.join('; ')}.` : '',
    profile?.clipHints ? `Worauf der Creator bei diesem Kanal Wert legt: ${profile.clipHints}` : '',
    examplesFor(profile),
    !pro && !vertical ? LAYOUT_RULES + '\nEffekt "cam" = Facecam 1,6 s groß bei der stärksten Gesichts-Reaktion (nur mit mode "cam", höchstens 2).' : '',
    said ? SENTENCE_RULES : '',
    said ? 'Gesprochenes in diesem Bereich als nummerierte Sätze (Sekunden ab Videoanfang, automatisch erkannt; in Klammern gemessener Tonfall):\n' + said : 'Kein gesprochener Text verfügbar.',
    '', 'Kontaktbögen (je 9 Bilder, Sekunde oben links): bisheriger Clip, davor, danach.',
  ].filter(Boolean).join('\n') }];
  const ranges = [[src.start, src.end, 'Bisheriger Clip'], [from, src.start, 'Davor'], [src.end, to, 'Danach']].filter(([a, b]) => b - a >= 4);
  for (const [a, b, label] of ranges) {
    const file = path.join(FRAME_DIR, `${raw.id}-r${Math.round(a)}.jpg`);
    const sheet = await vision.contactSheet(fileOf(raw), a, b, file, { vertical });
    if (!sheet) continue;
    content.push({ type: 'text', text: `${label} (Sekunde ${Math.round(a)}–${Math.round(b)}):` }, vision.asImage(sheet));
    fs.rmSync(sheet, { force: true });
  }
  const schema = { type: 'object', additionalProperties: false,
    required: ['fromSentence', 'toSentence', 'start', 'end', 'title', 'hook', 'tempo', 'music', 'changes', 'viral', 'viralWhy', 'viralTip', 'fx', 'layout', 'text'], properties: {
      fx: FX_SCHEMA,
      layout: LAYOUT_SCHEMA,
      text: TEXT_SCHEMA,
      fromSentence: { type: 'integer', description: 'erster Satz (S…) des neuen Clips, 0 ohne Sprache' },
      toSentence: { type: 'integer', description: 'letzter Satz (S…) des neuen Clips, 0 ohne Sprache' },
      start: { type: 'number', description: 'neuer Start (Sekunde ab Videoanfang)' },
      end: { type: 'number', description: 'neues Ende (Sekunde ab Videoanfang)' },
      title: { type: 'string', description: 'Titel (höchstens 70 Zeichen)' },
      hook: HOOK_SCHEMA,
      tempo: { type: 'string', enum: ['aus', 'ruhig', 'normal', 'schnell'] },
      music: { type: 'boolean', description: 'Hintergrundmusik ja/nein' },
      changes: { type: 'string', description: 'Ein bis zwei Sätze auf Deutsch (Du-Form an den Creator): was du geändert hast und warum' },
      viral: { type: 'integer', description: 'Viral-Potenzial 1–10 der neuen Fassung (ehrlich)' },
      viralWhy: { type: 'string' },
      viralTip: { type: 'string' },
    } };
  const { out: o, vision: sawImages } = await ask('ueberarbeiten', content, schema);
  const bySent = bounds.fromSentences(sents, o.fromSentence, o.toSentence);
  const okSent = bySent && bySent.start >= from - 5 && bySent.end <= to + 5 && bySent.end - bySent.start <= maxLen + 20;
  let start = okSent ? bySent.start : Math.max(from, Math.min(to - minLen, Number(o.start)));
  if (!Number.isFinite(start)) start = src.start;
  let end = okSent ? bySent.end : Math.min(to, Math.max(start + minLen, Number(o.end)));
  if (!Number.isFinite(end)) end = src.end;
  // Maximallänge regelt bounds.snapRange (an Satzende statt hart abschneiden)
  return { bySentence: !!okSent, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, title: String(o.title || out.title || '').slice(0, 100),
    hook: o.hook ? { mode: o.hook.mode, at: Number(o.hook.at), len: Number(o.hook.len), text: String(o.hook.text || '').slice(0, 60) } : null,
    tempo: fx.TEMPO[o.tempo] !== undefined ? o.tempo : 'normal', music: !!o.music, changes: String(o.changes || '').slice(0, 500),
    viral: Math.max(1, Math.min(10, Math.round(Number(o.viral) || 0))) || undefined, viralWhy: String(o.viralWhy || '').slice(0, 300), viralTip: String(o.viralTip || '').slice(0, 300),
    fx: Array.isArray(o.fx) ? o.fx.slice(0, 15) : [], fxLevel: fxLevelOf(profile, wish), layoutRaw: sawImages && o.layout && typeof o.layout === 'object' ? o.layout : null, text: parseText(o.text) };
}

// Effekt-Stufe des Kanals; „mehr/weniger Effekte“ im Überarbeitungswunsch verschiebt sie um eine Stufe
const FX_ORDER = ['aus', 'dezent', 'normal', 'viel'];
export function fxLevelOf(profile, wish = '') {
  let i = FX_ORDER.indexOf(profile?.fxLevel || (profiles.isPro(profile) ? 'aus' : 'normal'));
  if (i < 0) i = 2;
  if (/mehr effekte/i.test(wish)) i = Math.min(3, i + 1);
  if (/weniger effekte/i.test(wish)) i = Math.max(1, i - 1);
  if (/ohne effekte|keine effekte/i.test(wish)) i = 0;
  return FX_ORDER[i];
}
export const fxStickers = (profile) => !!profile?.fxImages && !!db().fal?.key && !profiles.isPro(profile);

// Überarbeitung einer Langfassung oder Kurzfassung: Claude bekommt das ganze Video als Transkript in Zeitblöcken,
// die lautesten Stellen und Standbilder und legt fest, welche Abschnitte bleiben (+ optional Teaser vorweg).
export async function reviseLong(raw, out, wish, segs, loud, profile) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  const pro = profiles.isPro(profile);
  const src = out.source, dur = raw.duration || 0;
  const summary = src.kind === 'summary';
  const t = (x) => whisper.fmtTime(x);
  // Gesprochenes in ~20-s-Blöcken (spart Platz bei langen Aufnahmen)
  const blocks = [];
  for (const x of segs || []) {
    const last = blocks[blocks.length - 1];
    if (last && x.s - last.s < 20) { last.e = x.e; last.t += ' ' + x.t; } else blocks.push({ s: x.s, e: x.e, t: x.t });
  }
  // möglichst ganze Sätze mit Nummer (exakte Grenzen); nur bei sehr langen Aufnahmen 20-s-Blöcke
  const sents = bounds.numbered(segs);
  let said = bounds.sentenceLines(sents, 0, Infinity, 150000);
  const bySentences = !said.endsWith('[… gekürzt]');
  if (!bySentences) {
    said = blocks.map((b) => `[${Math.floor(b.s)}–${Math.ceil(b.e)}] ${b.t}`).join('\n');
    if (said.length > 120000) said = said.slice(0, 120000) + '\n[… gekürzt]';
  }
  // lauteste 5-s-Fenster als Hinweise auf Action
  const peaks = [];
  if (loud?.length) {
    const win = [];
    for (let i = 0; i + 5 <= loud.length; i += 5) win.push([i, loud.slice(i, i + 5).reduce((a, b) => a + b, 0) / 5]);
    for (const [i, val] of win.sort((a, b) => b[1] - a[1]).slice(0, 25).sort((a, b) => a[0] - b[0])) peaks.push(`${i}–${i + 5} s (${val.toFixed(0)} LUFS)`);
  }
  const cur = summary ? (src.parts || []).map(([a, b]) => `${Math.round(a)}–${Math.round(b)}`).join(', ')
    : src.keep?.length ? `${src.keep.length} Abschnitte, ${t(src.keep.reduce((x, [a, b]) => x + b - a, 0))} lang (Sekunden: ${src.keep.slice(0, 200).map(([a, b]) => `${Math.round(a)}–${Math.round(b)}`).join(', ')})`
    : `ganze Aufnahme ohne ruhige Abschnitte${src.removed ? ` (${t(src.removed)} entfernt)` : ''}`;
  const content = [{ type: 'text', text: [
    pro ? 'Du überarbeitest ein professionelles LinkedIn-Video (Inhaber eines Druck- und 3D-Druck-Betriebs, als Person).'
      : `Du überarbeitest eine ${summary ? 'Kurzfassung (Best-of)' : 'Langfassung'} für YouTube von einem deutschen Creator. Ziel: Zuschauer halten (Watchtime), kein Leerlauf.`,
    `WUNSCH DES CREATORS: „${wish}“ – setze das konsequent um.`,
    `Rohaufnahme „${raw.file}“, Länge ${t(dur)} (${Math.round(dur)} s). Bisherige Fassung: ${cur}; Titel „${out.title || ''}“, Musik: ${out.music ? 'ja' : 'nein'}.`,
    'Gib die Abschnitte an, die im neuen Video bleiben (Sekunden ab Anfang der Rohaufnahme, zeitlich sortiert, ohne Überschneidung, je mind. 3 s).',
    'Geschnitten wird immer neu aus der kompletten Rohaufnahme, nicht aus der bisherigen Fassung: Stellen, die bisher fehlten, darfst und sollst du zurückholen, wenn sie gut sind oder der Wunsch es verlangt. Nichts geht durch frühere Überarbeitungen verloren.',
    'Schneide sauber an Satzgrenzen. Typisch rauszuschneiden: Intro/Lobby/Ladebildschirm/Menü/Warten am Anfang, Leerlauf, Wiederholungen, Outro-Gelaber.',
    'Teaser (optional, sehr wirksam auf YouTube): ein 3–8 s langer Höhepunkt, der ganz vorne läuft, bevor das Video normal beginnt; dazu ein kurzer Text (max. 5 Wörter).',
    'Tempo innerhalb der Abschnitte: aus = nichts, ruhig = nur lange Pausen, normal = Pausen + „ähm“, schnell = auch kurze Pausen.',
    profile?.clipHints ? `Worauf der Creator bei diesem Kanal Wert legt: ${profile.clipHints}` : '',
    peaks.length ? 'Lauteste Stellen (oft Action/Reaktion): ' + peaks.join(', ') : '',
    said && bySentences ? 'Abschnitte bitte über Satznummern angeben (fromSentence/toSentence; Abschnitt ohne Sprache: 0/0 und start/end). Nie mitten im Satz schneiden;'
      + ' ein Abschnitt endet nach einem abgeschlossenen Gedanken, der nächste beginnt nicht mit einem Bezug auf Weggeschnittenes.' : '',
    said ? `Gesprochenes (Sekunden ab Anfang, automatisch erkannt${bySentences ? ', nummerierte Sätze' : ''}):\n` + said : 'Kein gesprochener Text verfügbar – orientiere dich an Lautstärke und Standbildern.',
    '', 'Standbilder (Sekunde steht davor):',
  ].filter(Boolean).join('\n') }];
  const n = Math.min(10, Math.max(4, Math.round(dur / 120)));
  for (let i = 0; i < n; i++) {
    const at = Math.round(dur * (i + 0.5) / n);
    const file = path.join(FRAME_DIR, `${raw.id}-l${at}.jpg`);
    const ok = await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', fileOf(raw),
      '-vf', "scale='if(gt(iw,ih),min(512,iw),-2)':'if(gt(iw,ih),-2,min(512,ih))'", '-frames:v', '1', '-q:v', '6', file]);
    content.push({ type: 'text', text: `Sekunde ${at}:` });
    if (ok && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
      fs.rmSync(file, { force: true });
    }
  }
  const schema = { type: 'object', additionalProperties: false,
    required: ['segments', 'teaser', 'tempo', 'music', 'title', 'changes'], properties: {
      segments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fromSentence', 'toSentence', 'start', 'end'],
        properties: { fromSentence: { type: 'integer', description: 'erster Satz (S…), 0 ohne Sprache' }, toSentence: { type: 'integer', description: 'letzter Satz (S…), 0 ohne Sprache' },
          start: { type: 'number' }, end: { type: 'number' } } } },
      teaser: { type: 'object', additionalProperties: false, required: ['use', 'at', 'len', 'text'], properties: {
        use: { type: 'boolean' }, at: { type: 'number', description: 'Start des Höhepunkts (Sekunde)' },
        len: { type: 'number', description: '3–8 Sekunden' }, text: { type: 'string', description: 'höchstens 5 Wörter, leer wenn unpassend' } } },
      tempo: { type: 'string', enum: ['aus', 'ruhig', 'normal', 'schnell'] },
      music: { type: 'boolean' },
      title: { type: 'string', description: 'Titel (höchstens 100 Zeichen)' },
      changes: { type: 'string', description: 'Ein bis zwei Sätze auf Deutsch (Du-Form an den Creator): was du geändert hast und warum, mit neuer Länge' },
    } };
  const o = await cutCall(content, schema, { task: 'ueberarbeiten' });
  // Abschnitte prüfen: in der Aufnahme, sortiert, zusammengeführt, mind. 3 s
  const segsOut = [];
  for (const x of (o.segments || []).map((x) => { const b = bySentences && bounds.fromSentences(sents, x.fromSentence, x.toSentence); return b ? [b.start, b.end] : [Math.max(0, Number(x.start)), Math.min(dur, Number(x.end))]; })
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e - s >= 3).sort((p, q) => p[0] - q[0])) {
    const last = segsOut[segsOut.length - 1];
    if (last && x[0] <= last[1] + 0.5) last[1] = Math.max(last[1], x[1]); else segsOut.push(x);
  }
  if (!segsOut.length) throw new Error('Claude hat keine brauchbaren Abschnitte geliefert.');
  const tz = o.teaser;
  const teaser = tz?.use && Number.isFinite(Number(tz.at)) && !pro
    ? { at: Math.max(0, Math.min(dur - 3, Number(tz.at))), len: Math.max(3, Math.min(8, Number(tz.len) || 5)), text: String(tz.text || '').slice(0, 60) } : null;
  return { segments: segsOut.map(([s, e]) => [Math.round(s * 10) / 10, Math.round(e * 10) / 10]), teaser,
    tempo: fx.TEMPO[o.tempo] !== undefined ? o.tempo : 'aus', music: !!o.music, title: String(o.title || out.title || '').slice(0, 100),
    changes: String(o.changes || '').slice(0, 600) };
}
